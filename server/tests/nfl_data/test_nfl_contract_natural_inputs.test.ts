import assert from 'node:assert/strict';
import test from 'node:test';
import type { NflContractScenarioArgs, NflIllustrativeContractYear } from '../../src/nfl_contracts/types.js';
import { extractBudget, validateNflScenarioInputProvenance } from '../../src/nfl_contracts/input_provenance.js';
import { executeContractComparison, executeCapStrategy } from '../../src/nfl_conversation/contract_tools.js';
import { updateNflConversationState } from '../../src/nfl_conversation/state.js';

const EXACT_LIVE_PROMPT = 'For a clearly hypothetical price test, acquire Jakobi Meyers for NYG after June 1 in 2026 with a new signing bonus of $2 million, active years 2026 and 2027 only, base salary $2 million in 2026 and $4.5 million in 2027. Outstanding guaranteed salary is $2 million for 2026 and $0 for 2027. All other compensation, guarantees, incentives, prior-team payments and prior-team obligations are zero; no void years or options. This is the complete illustrative compensation schedule, not his actual contract or an asking price. Use a $5 million available cap budget and $1 million reserve. Protect Burns and Thomas. Compare no acquisition, acquisition alone, and acquisition funded by converting $6 million of Paulson Adebo’s 2026 salary. Show both years, annual cash, whether funding is necessary, and the CBA mechanism.';
const year = (year: number, base_salary: number, guaranteed_salary: number): NflIllustrativeContractYear => ({ year, kind: 'active', base_salary, guaranteed_salary, other_cash: 0, guaranteed_other_cash: 0, incentives_cap_charge: 0, incentives_cash: 0, salary_paid_by_prior_team: 0, other_cash_paid_by_prior_team: 0 });
const fixture = (question = EXACT_LIVE_PROMPT): NflContractScenarioArgs => ({
  schema_version: 1, team_id: 'NYG', season: 2026, timing: 'post_june_1',
  budget: { type: 'cap', amount: 5_000_000, reserve: 1_000_000 },
  moves: [
    { player_id: 'Jakobi Meyers', action: 'acquire', illustrative_terms: { basis: 'user_supplied_illustrative', label: 'Complete illustrative schedule', user_input: question, terms_complete: true, signing_bonus: 2_000_000, years: [year(2026, 2_000_000, 2_000_000), year(2027, 4_500_000, 0)], prior_team_obligations: [], guarantee_note: 'The explicitly supplied outstanding guarantees.' } },
    { player_id: 'Paulson Adebo', action: 'restructure', conversion_amount: 6_000_000 },
  ],
});

test('the failed live wording and budget-only follow-ups retain field identity and recompute funding', async () => {
  const question='“Let’s explore Meyers using the saved hypothetical contract. We have $5 million of available cap budget and want to retain a $1 million reserve. Protect Burns and Thomas. Compare doing nothing, acquiring him without restructuring anyone, and using the minimum funding needed. Show this year’s and next year’s cap and cash.”';
  const state=updateNflConversationState({objective:'contract',budget:{type:'cap',amount:5e6,reserve:1e6}},undefined,question);
  const first=await executeCapStrategy({},fixture(),undefined,state.active,question);
  assert.equal((first.body.cap_strategy as any).decision.kind,'no_funding');
  assert.deepEqual((first.body.contract_scenario!.args as NflContractScenarioArgs).protected_player_ids,['Brian Burns','Andrew Thomas']);
  const secondQuestion='Actually, we only have $3 million available. Keep everything else unchanged. What is the smallest salary conversion that makes this work, and what does it cost us next year?';
  const second=await executeCapStrategy({},first.body.contract_scenario!.args as NflContractScenarioArgs,first.body.cap_strategy,state.active,secondQuestion);
  assert.equal((second.body.cap_strategy as any).decision.selected.conversion,2e6);
  const thirdQuestion='What if I find another $1 million? Do we still need the restructure?';
  const secondArgs=second.body.contract_scenario!.args as NflContractScenarioArgs;
  const thirdState=updateNflConversationState({objective:'contract',budget:{type:'cap',amount:4e6,reserve:1e6}}, {...state,active:{...state.active,budget:secondArgs.budget!}},thirdQuestion);
  const third=await executeCapStrategy({},secondArgs,second.body.cap_strategy,thirdState.active,thirdQuestion,[],secondArgs.budget);
  assert.equal((third.body.cap_strategy as any).decision.kind,'no_funding');
  assert.equal((third.body.contract_scenario!.args as NflContractScenarioArgs).budget!.amount,4e6);
  const initialTerms=(first.body.contract_scenario!.args as NflContractScenarioArgs).moves[0].illustrative_terms;
  for(const answer of [second,third])assert.deepEqual((answer.body.contract_scenario!.args as NflContractScenarioArgs).moves[0].illustrative_terms,initialTerms);
  assert.deepEqual(initialTerms!.years,fixture().moves[0].illustrative_terms!.years);
  assert.equal(initialTerms!.user_input,EXACT_LIVE_PROMPT);
  assert.deepEqual(extractBudget(thirdQuestion,'cap'),[]);
  assert.deepEqual(extractBudget(thirdQuestion,'cash',secondArgs.budget),[]);
  assert.deepEqual(extractBudget('Meyers has $3 million available.','cap',secondArgs.budget),[]);
  for(const qualifier of ['in cash','next year','for his signing bonus'])assert.deepEqual(extractBudget(`We have $3 million available ${qualifier}. Keep the cap budget unchanged.`,'cap',secondArgs.budget),[]);
  const cashMention=await executeCapStrategy({},secondArgs,second.body.cap_strategy,{...state.active,budget:secondArgs.budget!},'We have $9 million available in cash. Keep the cap budget unchanged.');
  assert.deepEqual((cashMention.body.contract_scenario!.args as NflContractScenarioArgs).budget,secondArgs.budget);
  assert.deepEqual(extractBudget('Add another $1 million to Meyers’s signing bonus.','cap',secondArgs.budget),[]);
  assert.deepEqual(extractBudget('We have $5 million of available cash budget and keep $1 million in reserve.','cap'),[]);
  assert.throws(()=>updateNflConversationState({objective:'contract',budget:{type:'cap',amount:1e6,reserve:5e6}},undefined,question),/separately/);
});

test('the verbatim compound live prompt binds terms, funding, budget and protections together', async () => {
  const args = fixture(); delete args.budget; // Exercise the server's shared budget extraction.
  const answer = await executeContractComparison(args, EXACT_LIVE_PROMPT, undefined, undefined);
  assert.equal(answer.comparison_result.status, 'conditional');
  assert.deepEqual(answer.scenario_args.budget, { type: 'cap', amount: 5_000_000, reserve: 1_000_000 });
  assert.deepEqual(answer.scenario_args.protected_player_ids, ['Brian Burns', 'Andrew Thomas']);
  assert.deepEqual(answer.comparison_result.alternatives.map(a => a.result.budget!.after_reserve), [4_000_000, 1_000_000, 4_000_000]);
  assert.deepEqual(answer.comparison_result.alternatives.map(a => a.result.budget!.fits), [true, true, true]);
  assert.deepEqual(answer.comparison_result.years.map(y => y.alternatives.map(a => a.cap_charge)), [
    [24_199_390, 27_199_390, 24_199_390],
    [20_317_037, 25_817_037, 28_817_037],
  ]);
  assert.deepEqual(answer.comparison_result.years.map(y => y.alternatives.map(a => a.cap_room_change_vs_hold)), [
    [0, -3_000_000, 0], [0, -5_500_000, -8_500_000],
  ]);
  assert.deepEqual(answer.comparison_result.years.map(y => y.alternatives.map(a => a.cash_change_vs_hold)), [
    [0, 4_000_000, 4_000_000], [0, 4_500_000, 4_500_000],
  ]);
  assert.equal(answer.scenario_args.moves[0].illustrative_terms!.user_input, EXACT_LIVE_PROMPT);
  assert.equal(answer.scenario_args.moves[1].conversion_amount, 6_000_000);
});

test('set_scenario and contract binding share the exact available-cap-budget interpretation', () => {
  const scenario = updateNflConversationState({
    operation: 'update', objective: 'acquisition',
    budget: { type: 'cap', amount: 5_000_000, reserve: 1_000_000 },
    protected_player_names: ['Brian Burns', 'Andrew Thomas'],
  }, undefined, EXACT_LIVE_PROMPT);
  assert.deepEqual(scenario.active.budget, fixture().budget);
  assert.deepEqual(extractBudget(EXACT_LIVE_PROMPT, 'cap'), [5_000_000]);
  assert.deepEqual(extractBudget(EXACT_LIVE_PROMPT, 'reserve'), [1_000_000]);
  assert.deepEqual(extractBudget(EXACT_LIVE_PROMPT, 'cash'), []);
  assert.throws(() => updateNflConversationState({ objective: 'acquisition', budget: { type: 'cap', amount: 1_000_000, reserve: 5_000_000 } }, undefined, EXACT_LIVE_PROMPT), /separately supplied amounts/);
});

test('available budget wording preserves cap/cash identity and amount-to-label pairing', () => {
  for (const [question, kind] of [
    ['Use a $5m available cap budget and a $1m reserve.', 'cap'],
    ['The available cash budget is $5 million. Reserve $1 million.', 'cash'],
    ['Available cap budget: $5m. $1m reserve.', 'cap'],
  ] as const) {
    assert.deepEqual(extractBudget(question, kind), [5_000_000]);
    assert.deepEqual(extractBudget(question, 'reserve'), [1_000_000]);
    assert.deepEqual(extractBudget(question, kind === 'cap' ? 'cash' : 'cap'), []);
  }
  const swapped = fixture(); swapped.budget = { type: 'cap', amount: 1_000_000, reserve: 5_000_000 };
  const result = validateNflScenarioInputProvenance(swapped, { current_question: EXACT_LIVE_PROMPT });
  assert.equal(result.ok, false);
  assert.ok(result.gaps.some(g => g.path === 'budget.amount'));
  assert.ok(result.gaps.some(g => g.path === 'budget.reserve'));
  const wrongType = fixture(); wrongType.budget!.type = 'cash';
  assert.equal(validateNflScenarioInputProvenance(wrongType, { current_question: EXACT_LIVE_PROMPT }).ok, false);
});

test('converting still binds to the named funding player and cannot borrow unrelated amounts', async () => {
  for (const question of [
    EXACT_LIVE_PROMPT.replace('converting $6 million of Paulson Adebo’s', 'converting $6 million of Brian Burns’s'),
    EXACT_LIVE_PROMPT.replace('converting $6 million of Paulson Adebo’s', 'converting $6 million of Jakobi Meyers’s and Paulson Adebo’s'),
    EXACT_LIVE_PROMPT.replace('converting $6 million of Paulson Adebo’s 2026 salary', 'converting Paulson Adebo’s salary'),
  ]) await assert.rejects(() => executeContractComparison(fixture(question), question, undefined, undefined), /explicit user inputs/);
  const swapped = fixture();
  swapped.moves[0].illustrative_terms!.years[1].base_salary = 6_000_000;
  swapped.moves[1].conversion_amount = 4_500_000;
  const checked = validateNflScenarioInputProvenance(swapped, { current_question: EXACT_LIVE_PROMPT });
  assert.equal(checked.ok, false);
  assert.ok(checked.gaps.some(g => g.path.endsWith('years[1].base_salary')));
  assert.ok(checked.gaps.some(g => g.path.endsWith('conversion_amount')));
});

test('a complete illustrative schedule remains explicit and cannot be inferred from a negated claim', () => {
  for (const phrase of ['complete illustrative compensation schedule', 'complete hypothetical compensation schedule', 'complete compensation schedule']) {
    const question = EXACT_LIVE_PROMPT.replace('complete illustrative compensation schedule', phrase);
    assert.equal(validateNflScenarioInputProvenance(fixture(question), { current_question: question }).ok, true);
  }
  for (const question of [
    EXACT_LIVE_PROMPT.replace('is the complete illustrative', 'is not the complete illustrative'),
    EXACT_LIVE_PROMPT.replace('complete illustrative compensation schedule', 'incomplete illustrative compensation schedule'),
    EXACT_LIVE_PROMPT.replace('complete illustrative compensation schedule', 'illustrative compensation schedule'),
  ]) {
    const checked = validateNflScenarioInputProvenance(fixture(question), { current_question: question });
    assert.equal(checked.ok, false);
    assert.ok(checked.gaps.some(g => g.code === 'COMPLETENESS_NOT_EXPLICIT'));
  }
});

test('ordinary connective wording does not create a fake player or authorize optional numeric inputs', async () => {
  const question = EXACT_LIVE_PROMPT.replace('Compare no acquisition, acquisition alone, and acquisition funded', 'Compare hold and acquisition alone, or acquisition funded');
  assert.equal(validateNflScenarioInputProvenance(fixture(question), { current_question: question }).ok, true);
  const invented = fixture(); invented.moves[1].credited_seasons = 5;
  await assert.rejects(() => executeContractComparison(invented, EXACT_LIVE_PROMPT, undefined, undefined), /credited_seasons/);
});


test('unpaid salary wording binds the amount to the supplied season', () => {
  const question = EXACT_LIVE_PROMPT + ' Paulson Adebo has $8 million of unpaid 2026 salary available for conversion.';
  const args=fixture(question); args.moves[1].unpaid_salary_available=8e6;
  const result=validateNflScenarioInputProvenance(args,{current_question:question}); assert.equal(result.ok,true,JSON.stringify(result));
  const wrongYear=question.replace('unpaid 2026 salary','unpaid 2027 salary');
  assert.equal(validateNflScenarioInputProvenance(args,{current_question:wrongYear}).ok,false);
});
