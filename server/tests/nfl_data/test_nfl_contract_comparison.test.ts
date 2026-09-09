import assert from 'node:assert/strict';
import test from 'node:test';
import { buildNflContractComparison, calculateNflContractComparison, NFL_CONTRACT_CBA_URL, nflContractComparisonTool, validateNflScenarioInputProvenance, type NflContractComparisonResult, type NflContractScenarioArgs, type NflIllustrativeContractYear } from '../../src/nfl_contracts/index.js';
import { executeContractComparison } from '../../src/nfl_conversation/contract_tools.js';

const EXACT_LIVE_PROMPT = 'Convert $6 million of Paulson Adebo’s 2026 salary after June 1. Compare holding versus converting, show the effect this year and next year, explain whether cash changes, and cite the CBA mechanism.';
const COMPOUND_PROMPT = 'Convert $6m of Paulson Adebo’s 2026 salary after June 1. Compare hold vs conversion across this year and next, cash, future obligations and controlling CBA mechanism.';
const conversion = (amount = 6_000_000): NflContractScenarioArgs => ({ schema_version: 1, season: 2026, team_id: 'NYG', timing: 'post_june_1', moves: [{ player_id: 'Paulson Adebo', action: 'restructure', conversion_amount: amount }] });
const annual = (year: number, salary: number, guarantee: number, kind: 'active' | 'void' = 'active'): NflIllustrativeContractYear => ({ year, kind, base_salary: salary, other_cash: 0, incentives_cap_charge: 0, incentives_cash: 0, guaranteed_salary: guarantee, guaranteed_other_cash: 0, salary_paid_by_prior_team: 0, other_cash_paid_by_prior_team: 0 });
const ACQUISITION_PROMPT = 'Acquire Example Receiver for NYG after June 1 in 2026 using complete illustrative terms. New signing bonus $2 million, active years 2026 and 2027 only, base salary $2 million in 2026 and $3 million in 2027. Outstanding guaranteed salary is $2 million for 2026 and $0 for 2027. All other compensation, guarantees, incentives, prior-team payments and prior-team obligations are zero; no void years or options. This is the complete compensation schedule. Convert $6 million of Paulson Adebo’s 2026 salary. Cap budget $5 million and reserve $1 million. Compare holding, acquisition alone and acquisition with that funding.';
function acquisition(withFunding = true): NflContractScenarioArgs {
  const args = conversion();
  args.moves = [{ player_id: 'Example Receiver', action: 'acquire', illustrative_terms: { basis: 'user_supplied_illustrative', label: 'Complete user illustration', user_input: ACQUISITION_PROMPT, terms_complete: true, signing_bonus: 2_000_000, years: [annual(2026, 2_000_000, 2_000_000), annual(2027, 3_000_000, 0)], prior_team_obligations: [], guarantee_note: 'Explicit outstanding guarantees.' } }, ...(withFunding ? args.moves : [])];
  args.budget = { type: 'cap', amount: 5_000_000, reserve: 1_000_000 };
  return args;
}
const metrics = (result: NflContractComparisonResult, year: number, id = 'requested') => result.years.find(y => y.year === year)!.alternatives.find(a => a.alternative_id === id)!;

test('exact failed live prompts execute hold and conversion in one call, with cash and controlling rules', async () => {
  for (const prompt of [EXACT_LIVE_PROMPT, COMPOUND_PROMPT, EXACT_LIVE_PROMPT.replace('Adebo’s', "Adebo's"), EXACT_LIVE_PROMPT.replace('Paulson Adebo’s', 'Adebo’s')]) {
    const args = conversion(); const before = structuredClone(args);
    const answer = await executeContractComparison(args, prompt, undefined, undefined);
    assert.deepEqual(args, before, 'tool input is not mutated');
    assert.equal(answer.comparison_result.status, 'conditional');
    assert.deepEqual(answer.comparison_result.alternatives.map(a => a.id), ['hold', 'requested']);
    assert.equal(metrics(answer.comparison_result, 2026, 'hold').cap_charge, 24_199_390);
    assert.equal(metrics(answer.comparison_result, 2026).cap_charge, 21_199_390);
    assert.equal(metrics(answer.comparison_result, 2026).cap_room_change_vs_hold, 3_000_000);
    assert.equal(metrics(answer.comparison_result, 2027, 'hold').cap_charge, 20_317_037);
    assert.equal(metrics(answer.comparison_result, 2027).cap_charge, 23_317_037);
    assert.equal(metrics(answer.comparison_result, 2027).cap_room_change_vs_hold, -3_000_000);
    for (const year of [2026, 2027]) {
      assert.equal(metrics(answer.comparison_result, year).cash_change_vs_hold, 0);
      assert.equal(metrics(answer.comparison_result, year).cash_charge, null);
      assert.equal(metrics(answer.comparison_result, year).added_proration, 3_000_000);
    }
    assert.ok(answer.comparison_result.mechanisms.some(m => m.cba_section.includes('Article 13 §6(b)(i)') && /June 1 does not change/.test(m.application)));
    assert.ok(answer.comparison_result.mechanisms.every(m => m.source_url === NFL_CONTRACT_CBA_URL));
    assert.match(answer.body.answer, /\$3,000,000.*-\$3,000,000.*cash changes by \$0/i);
  }
});

test('same-dollar conversion before/after June 1 has the same allocation and keeps timing uncertainty', () => {
  const post = calculateNflContractComparison(conversion());
  const pre = calculateNflContractComparison({ ...conversion(), timing: 'pre_june_1' });
  assert.deepEqual(post.years, pre.years);
  assert.ok(post.alternatives.at(-1)!.result.issues.some(i => i.code === 'PAYMENT_TIMING_UNVERIFIED'));
});

test('follow-up changes the requested conversion to $8m rather than persisting the generated hold', async () => {
  const first = await executeContractComparison(conversion(), EXACT_LIVE_PROMPT, undefined, undefined);
  const prior = first.body.contract_scenario!.args as NflContractScenarioArgs;
  assert.equal(prior.moves[0].action, 'restructure');
  assert.equal(prior.moves[0].conversion_amount, 6_000_000);
  const changed = await executeContractComparison(conversion(8_000_000), 'Increase the conversion to $8 million.', prior, undefined);
  assert.equal(metrics(changed.comparison_result, 2026).cap_room_change_vs_hold, 4_000_000);
  assert.equal(metrics(changed.comparison_result, 2027).cap_room_change_vs_hold, -4_000_000);
  assert.equal((changed.body.contract_scenario!.args as NflContractScenarioArgs).moves[0].conversion_amount, 8_000_000);
  assert.deepEqual(JSON.parse(JSON.stringify(changed.body.contract_scenario!.result)).comparison, changed.comparison_result);
  await assert.rejects(() => executeContractComparison(conversion(), 'Increase the conversion to $8 million.', prior, undefined), /FIELD|conversion_amount/);
});

test('conversion provenance rejects another player, unrelated money and invented optional fields', async () => {
  for (const prompt of [
    'Inspect Paulson Adebo. Convert $6 million of Brian Burns’s 2026 salary after June 1.',
    'Compare Paulson Adebo holding versus converting. Convert $6m from Brian Burns’s salary.',
    'Paulson Adebo has a $6 million cash budget and $0 reserve. Compare holding versus converting.',
    'Paulson Adebo has a signing bonus $6 million. Compare hold vs conversion.',
  ]) await assert.rejects(() => executeContractComparison(conversion(), prompt, undefined, undefined), /explicit user inputs/);
  for (const extra of [{ credited_seasons: 5 }, { unpaid_salary_available: 6_000_000 }]) {
    const invented = conversion(); Object.assign(invented.moves[0], extra);
    await assert.rejects(() => executeContractComparison(invented, EXACT_LIVE_PROMPT, undefined, undefined), /explicit user inputs/);
  }
});

test('Make that $8 million changes only the sole prior conversion and rejects ambiguous references', async () => {
  const prior = conversion();
  const answer = await executeContractComparison(conversion(8_000_000), 'Make that $8 million', prior, undefined);
  assert.equal(metrics(answer.comparison_result, 2026).cap_room_change_vs_hold, 4_000_000);
  assert.equal((answer.body.contract_scenario!.args as NflContractScenarioArgs).moves[0].conversion_amount, 8_000_000);
  await assert.rejects(() => executeContractComparison(conversion(), 'Make that $8 million.', prior, undefined), /conversion_amount/);
  await assert.rejects(() => executeContractComparison(conversion(8_000_000), 'Make that $8 million for Brian Burns.', prior, undefined), /explicit user inputs/);
  await assert.rejects(() => executeContractComparison(conversion(8_000_000), 'Make that $8 million and another $2 million.', prior, undefined), /explicit user inputs/);
  const two = conversion(); two.moves.push({ player_id: 'Brian Burns', action: 'restructure', conversion_amount: 2_000_000 });
  const changed = structuredClone(two); changed.moves[0].conversion_amount = 8_000_000;
  await assert.rejects(() => executeContractComparison(changed, 'Make that $8 million.', two, undefined), /explicit user inputs/);
  const mixed = acquisition(); const changedMixed = structuredClone(mixed); changedMixed.moves[1].conversion_amount = 8_000_000;
  await assert.rejects(() => executeContractComparison(changedMixed, 'Make that $8 million.', mixed, undefined), /explicit user inputs/);
});

test('complete literal acquisition plus funding yields three comparable alternatives and distinct budget effects', async () => {
  const args = acquisition(); const original = structuredClone(args);
  const answer = await executeContractComparison(args, ACQUISITION_PROMPT, undefined, undefined);
  assert.deepEqual(args, original);
  const result = answer.comparison_result;
  assert.deepEqual(result.cohort, ['Example Receiver', 'Paulson Adebo']);
  assert.deepEqual(result.alternatives.map(a => a.id), ['hold', 'acquire_without_funding', 'requested']);
  assert.equal(metrics(result, 2026, 'hold').cap_charge, 24_199_390);
  assert.equal(metrics(result, 2026, 'acquire_without_funding').cap_charge, 27_199_390);
  assert.equal(metrics(result, 2026).cap_charge, 24_199_390);
  assert.equal(metrics(result, 2026, 'acquire_without_funding').cap_room_change_vs_hold, -3_000_000);
  assert.equal(metrics(result, 2026).cap_room_change_vs_hold, 0);
  assert.equal(metrics(result, 2027).cap_room_change_vs_hold, -7_000_000);
  assert.equal(metrics(result, 2026).cash_charge, null);
  assert.equal(metrics(result, 2026).cash_change_vs_hold, 4_000_000);
  assert.equal(metrics(result, 2027).cash_change_vs_hold, 3_000_000);
  assert.deepEqual(result.alternatives.map(a => a.result.budget!.after_reserve), [4_000_000, 1_000_000, 4_000_000]);
  assert.equal(result.alternatives[1].scenario_args!.moves[1].action, 'hold');
  assert.equal(result.alternatives[1].scenario_args!.moves[1].conversion_amount, undefined);
  assert.equal((answer.body.contract_scenario!.args as NflContractScenarioArgs).moves[1].action, 'restructure');
});

test('cash budget cannot count conversion cap relief as cash funding', () => {
  const args = acquisition(); args.budget!.type = 'cash'; args.budget!.amount = 4_000_000;
  const result = calculateNflContractComparison(args);
  assert.deepEqual(result.alternatives.map(a => a.result.budget!.after_reserve), [3_000_000, -1_000_000, -1_000_000]);
  assert.deepEqual(result.alternatives.map(a => a.result.budget!.fits), [true, false, false]);
});

test('acquisition-only baseline means zero new selected obligations and retains all future void years', () => {
  const args = acquisition(false); const terms = args.moves[0].illustrative_terms!;
  terms.signing_bonus = 8_000_000;
  terms.years.push(annual(2028, 0, 0, 'void'), annual(2029, 0, 0, 'void'));
  terms.prior_team_obligations = [{ year: 2026, cap: 9_000_000, cash: 7_000_000 }];
  const result = calculateNflContractComparison(args);
  assert.equal(result.alternatives[0].scenario_args, null);
  assert.deepEqual(result.alternatives[0].result.moves, []);
  assert.deepEqual(result.alternatives.map(a => a.result.years.map(y => y.year)), [[2026, 2027, 2028, 2029], [2026, 2027, 2028, 2029]]);
  assert.equal(metrics(result, 2028, 'hold').cap_charge, 0);
  assert.equal(metrics(result, 2026).cap_charge, 4_000_000);
  assert.equal(metrics(result, 2026).cash_charge, 10_000_000);
  assert.equal(metrics(result, 2028).dead_money, 4_000_000);
  assert.equal(metrics(result, 2028).cap_room_change_vs_hold, -4_000_000);
  assert.equal(metrics(result, 2029).cap_charge, 0);
  assert.deepEqual(result.alternatives[1].result.moves[0].original_team_obligations, terms.prior_team_obligations);
  assert.match(result.alternatives[0].result.assumptions[0], /does not assert a zero team payroll/);
});

test('incomplete incoming terms do not become known zero, while seller charges stay separate', () => {
  const args = acquisition(false); args.moves = [{ player_id: 'Courtland Sutton', action: 'acquire' }];
  const result = calculateNflContractComparison(args);
  assert.equal(result.status, 'blocked');
  assert.equal(metrics(result, 2026, 'hold').cap_charge, 0);
  assert.equal(metrics(result, 2026).cap_charge, null);
  assert.equal(metrics(result, 2026).dead_money, null);
  assert.equal(metrics(result, 2026).added_proration, null);
  assert.equal(result.alternatives.at(-1)!.result.budget!.fits, null);
  assert.ok(result.alternatives.at(-1)!.result.moves[0].original_team_obligations.length > 0);
});

test('protected funding blocks only that alternative and Slayton source conflict keeps hold unknown', async () => {
  const args = acquisition(); args.protected_player_ids = ['Paulson Adebo'];
  const protectedResult = calculateNflContractComparison(args);
  assert.equal(protectedResult.alternatives[0].result.status, 'reported');
  assert.equal(protectedResult.alternatives[1].result.status, 'illustrative');
  assert.equal(protectedResult.alternatives[2].result.status, 'blocked');
  assert.equal(metrics(protectedResult, 2026).cap_charge, null);
  const fromText = await executeContractComparison(conversion(), EXACT_LIVE_PROMPT + ' Protect Paulson Adebo.', undefined, undefined);
  assert.equal(fromText.comparison_result.status, 'blocked');
  const conflictArgs = conversion(); conflictArgs.moves = [{ player_id: 'Darius Slayton', action: 'release' }];
  const conflict = calculateNflContractComparison(conflictArgs);
  assert.equal(metrics(conflict, 2026, 'hold').cap_charge, null);
  assert.equal(metrics(conflict, 2026).cap_room_change_vs_hold, null);
  assert.equal(metrics(conflict, 2026).cash_change_vs_hold, null);
});

test('CBA mechanisms, component tables and calculations retain valid source references', async () => {
  const answer = await buildNflContractComparison(acquisition());
  const refs = new Set(answer.sources.map(s => s.ref_index));
  for (const item of [...answer.body.tables, ...answer.body.calculations, ...answer.body.key_findings]) assert.ok(item.source_refs.every(ref => refs.has(ref)));
  assert.ok(answer.body.tables.some(t => t.title.includes('reported contract components')));
  assert.ok(answer.body.tables.some(t => t.title.includes('Controlling CBA mechanism')));
  assert.ok(answer.sources.some(s => JSON.stringify(s.data).includes('comparison_mechanisms')));
  assert.equal(nflContractComparisonTool.name, 'nfl_contract_comparison');
  assert.match(nflContractComparisonTool.description, /once per player/);
});

test('generated hold never bypasses missing requested action or duplicate-move protections', () => {
  const hold = conversion(); hold.moves = [{ player_id: 'Paulson Adebo', action: 'hold' }];
  assert.throws(() => calculateNflContractComparison(hold), /requires a requested alternative/);
  const duplicate = conversion(); duplicate.moves.push({ player_id: 'Paulson Adebo', action: 'hold' });
  const result = calculateNflContractComparison(duplicate);
  assert.equal(result.status, 'blocked');
  assert.equal(metrics(result, 2026).cap_charge, null);
});

test('player and field isolation still reject bonus/base amount swaps with compound funding', () => {
  const args = acquisition();
  args.moves[0].illustrative_terms!.signing_bonus = 3_000_000;
  args.moves[0].illustrative_terms!.years[1].base_salary = 2_000_000;
  const checked = validateNflScenarioInputProvenance(args, { current_question: ACQUISITION_PROMPT });
  assert.equal(checked.ok, false);
  assert.ok(checked.gaps.some(g => g.path.endsWith('signing_bonus')));
  assert.ok(checked.gaps.some(g => g.path.endsWith('years[1].base_salary')));
});
