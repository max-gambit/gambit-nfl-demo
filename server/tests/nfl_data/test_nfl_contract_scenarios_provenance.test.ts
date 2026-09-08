import assert from 'node:assert/strict';
import test from 'node:test';
import { validateNflScenarioInputProvenance } from '../../src/nfl_contracts/input_provenance.js';
import type { NflContractScenarioArgs, NflIllustrativeContractYear } from '../../src/nfl_contracts/types.js';

const QUESTION = 'Use a hypothetical new receiver contract to show complete arithmetic: acquire Example Receiver for NYG after June 1 in 2026. New signing bonus $2 million, active years 2026 and 2027 only, base salary $2 million in 2026 and $3 million in 2027. Outstanding guaranteed salary is $2 million for 2026 and $0 for 2027. All other compensation, guarantees, incentives, prior-team payments and prior-team obligations are zero; no void years or options. This is the complete compensation schedule. Keep the $5 million cap budget and $1 million reserve.';
const FOLLOWUP = 'Keep those exact illustrative terms and budget, but change the 2027 base salary to $4 million. Recalculate.';
const year = (y: number, base: number, guaranteed: number): NflIllustrativeContractYear => ({ year: y, kind: 'active', base_salary: base, other_cash: 0, incentives_cap_charge: 0, incentives_cash: 0, guaranteed_salary: guaranteed, guaranteed_other_cash: 0, salary_paid_by_prior_team: 0, other_cash_paid_by_prior_team: 0 });
const fixture = (question = QUESTION): NflContractScenarioArgs => ({ schema_version: 1, season: 2026, team_id: 'NYG', timing: 'post_june_1', budget: { type: 'cap', amount: 5_000_000, reserve: 1_000_000 }, moves: [{ player_id: 'Example Receiver', action: 'acquire', illustrative_terms: { basis: 'user_supplied_illustrative', label: 'Complete user illustration', user_input: question, terms_complete: true, signing_bonus: 2_000_000, years: [year(2026, 2_000_000, 2_000_000), year(2027, 3_000_000, 0)], prior_team_obligations: [], guarantee_note: 'Outstanding guarantees are the explicit user amounts.' } }] });
const conversion = (amount = 6_000_000, player = 'Paulson Adebo'): NflContractScenarioArgs => ({ schema_version: 1, season: 2026, team_id: 'NYG', timing: 'post_june_1', moves: [{ player_id: player, action: 'restructure', conversion_amount: amount }] });
const check = (args: NflContractScenarioArgs, current_question: string, prior_args?: NflContractScenarioArgs) => validateNflScenarioInputProvenance(args, { current_question, prior_args });
const hasGap = (result: ReturnType<typeof check>, path: string, code?: string) => result.gaps.some(g => g.path.includes(path) && (!code || g.code === code));

test('complete natural example binds every amount and explicit zero category', () => {
  const args = fixture();
  const result = check(args, QUESTION);
  assert.deepEqual(result, { ok: true, gaps: [] });
  assert.equal(args.moves[0].illustrative_terms!.user_input, QUESTION);
});

test('one-field follow-up retains exact same-player prior terms and budget', () => {
  const prior = fixture(); const next = structuredClone(prior);
  next.moves[0].illustrative_terms!.years[1].base_salary = 4_000_000;
  assert.deepEqual(check(next, FOLLOWUP, prior), { ok: true, gaps: [] });
  next.moves[0].illustrative_terms!.user_input = `${QUESTION}\n\n${FOLLOWUP}`;
  assert.equal(check(next, FOLLOWUP, prior).ok, true);
});

test('ignoring the explicit current field change cannot pass as unchanged prior data', () => {
  const prior = fixture();
  assert.ok(hasGap(check(prior, FOLLOWUP, prior), 'years[1].base_salary', 'FIELD_VALUE_MISMATCH'));
});

test('current changed money binds to its year rather than another year carrying the same amount', () => {
  const prior = fixture(); const next = structuredClone(prior);
  next.moves[0].illustrative_terms!.years[0].base_salary = 4_000_000;
  const result = check(next, FOLLOWUP, prior);
  assert.equal(result.ok, false);
  assert.ok(hasGap(result, 'years[0].base_salary', 'MISSING_FIELD_EVIDENCE'));
  assert.ok(hasGap(result, 'years[1].base_salary', 'FIELD_VALUE_MISMATCH'));
});

test('signing bonus and base salary cannot swap merely because both amounts occur', () => {
  const question = QUESTION.replace('New signing bonus $2 million', 'New signing bonus $8 million');
  const args = fixture(question);
  args.moves[0].illustrative_terms!.years[0].base_salary = 8_000_000;
  const result = check(args, question);
  assert.ok(hasGap(result, '.signing_bonus', 'FIELD_VALUE_MISMATCH'));
  assert.ok(hasGap(result, 'years[0].base_salary', 'FIELD_VALUE_MISMATCH'));
});

test('zero guarantees, prior payments, and obligations need their own explicit categories', () => {
  for (const [removed, field] of [['guarantees, ', 'guaranteed_other_cash'], ['prior-team payments and ', 'salary_paid_by_prior_team'], [' and prior-team obligations', 'prior_team_obligations']] as const) {
    const question = QUESTION.replace(removed, '');
    const result = check(fixture(question), question);
    assert.equal(result.ok, false, removed);
    assert.ok(hasGap(result, field), JSON.stringify(result.gaps));
  }
});

test('silence about all extra terms cannot manufacture eight zero fields', () => {
  const question = QUESTION.replace('All other compensation, guarantees, incentives, prior-team payments and prior-team obligations are zero; ', '');
  const result = check(fixture(question), question);
  assert.equal(result.ok, false);
  assert.ok(hasGap(result, 'other_cash'));
  assert.ok(hasGap(result, 'incentives_cash'));
  assert.ok(hasGap(result, 'guaranteed_other_cash'));
  assert.ok(hasGap(result, 'salary_paid_by_prior_team'));
});

test('year numbers are not currency and unrelated previous amounts are not evidence', () => {
  const args = conversion(2026);
  const question = 'Calculate a 2026 post-June salary conversion for Paulson Adebo.';
  assert.ok(hasGap(check(args, question), 'conversion_amount', 'MISSING_FIELD_EVIDENCE'));
  const prior = conversion(6_000_000);
  prior.budget = { type: 'cap', amount: 8_000_000, reserve: 1_000_000 };
  const next = structuredClone(prior); next.moves[0].conversion_amount = 8_000_000;
  assert.ok(hasGap(check(next, 'Keep the cap budget unchanged and recalculate.', prior), 'conversion_amount', 'MISSING_FIELD_EVIDENCE'));
});

test('conversion amount binds to conversion wording and a named player or unique prior conversion', () => {
  const prior = conversion();
  assert.equal(check(prior, 'Calculate a 2026 post-June salary conversion of $6 million for Paulson Adebo').ok, true);
  assert.equal(check(conversion(8_000_000), 'Increase the conversion to $8 million.', prior).ok, true);
  assert.equal(check(conversion(8_000_000), 'Increase the conversion to $8 million.').ok, false);
  assert.equal(check(conversion(8_000_000), 'Increase the conversion to $8 million for Brian Burns.', prior).ok, false);
  assert.equal(check(conversion(8_000_000), 'This is not for Paulson Adebo. Convert $8 million for brian burns.', prior).ok, false);
});

test('one global sentence naming multiple conversions is rejected as ambiguous', () => {
  const args = conversion(); args.moves.push({ player_id: 'Brian Burns', action: 'restructure', conversion_amount: 8_000_000 });
  const q = 'Convert $6 million for Paulson Adebo and $8 million for Brian Burns in 2026.';
  assert.equal(check(args, q).ok, false);
  assert.equal(check(args, 'Convert $6 million for Paulson Adebo in 2026. Convert $8 million for Brian Burns in 2026.').ok, true);
  const swap = structuredClone(args); swap.moves[0].conversion_amount = 8_000_000; swap.moves[1].conversion_amount = 6_000_000;
  assert.equal(check(swap, 'Convert $6 million for Paulson Adebo in 2026. Convert $8 million for Brian Burns in 2026.').ok, false);
});

test('a follow-up with two prior conversions must identify the player', () => {
  const prior = conversion(); prior.moves.push({ player_id: 'Brian Burns', action: 'restructure', conversion_amount: 2_000_000 });
  const next = structuredClone(prior); next.moves[0].conversion_amount = 8_000_000;
  assert.equal(check(next, 'Increase the conversion to $8 million.', prior).ok, false);
  assert.equal(check(next, 'Increase the conversion to $8 million for Paulson Adebo.', prior).ok, true);
});

test('prior values from another player cannot silently become new receiver terms', () => {
  const prior = fixture(); const next = structuredClone(prior);
  next.moves[0].player_id = 'Different Receiver';
  next.moves[0].illustrative_terms!.user_input = FOLLOWUP;
  assert.equal(check(next, FOLLOWUP, prior).ok, false);
  assert.ok(hasGap(check(next, FOLLOWUP, prior), 'player_id', 'PLAYER_NOT_EXPLICIT'));
});

test('literal initial and prior user_input are retained, not summarized or rewritten', () => {
  const args = fixture(); args.moves[0].illustrative_terms!.user_input = 'The user approved a two-year contract.';
  assert.ok(hasGap(check(args, QUESTION), 'user_input', 'USER_INPUT_NOT_LITERAL'));
  const prior = fixture(); const next = structuredClone(prior);
  next.moves[0].illustrative_terms!.years[1].base_salary = 4_000_000;
  next.moves[0].illustrative_terms!.user_input = FOLLOWUP;
  assert.ok(hasGap(check(next, FOLLOWUP, prior), 'user_input', 'PRIOR_USER_INPUT_NOT_RETAINED'));
});

test('budget and reserve cannot swap values or change cap/cash type silently', () => {
  const args = fixture(); args.budget!.amount = 1_000_000; args.budget!.reserve = 5_000_000;
  const result = check(args, QUESTION);
  assert.ok(hasGap(result, 'budget.amount', 'FIELD_VALUE_MISMATCH'));
  assert.ok(hasGap(result, 'budget.reserve', 'FIELD_VALUE_MISMATCH'));
  const cash = fixture(); cash.budget!.type = 'cash';
  assert.ok(hasGap(check(cash, QUESTION), 'budget.type', 'BUDGET_TYPE_MISMATCH'));
});

test('active and void years cannot be inferred from the presence of salary years', () => {
  const question = QUESTION.replace('active years 2026 and 2027 only, ', '').replace('no void years or options', 'no options');
  const result = check(fixture(question), question);
  assert.ok(hasGap(result, 'active_years', 'MISSING_YEAR_KINDS'));
  assert.ok(hasGap(result, 'void_years', 'MISSING_YEAR_KINDS'));
  const rangeQuestion = QUESTION.replace('active years 2026 and 2027 only', 'active years 2026–2027 only');
  const ranged = fixture(rangeQuestion);
  assert.equal(check(ranged, rangeQuestion).ok, true);
  ranged.moves[0].illustrative_terms!.years.pop();
  assert.ok(hasGap(check(ranged, rangeQuestion), 'active_years', 'YEAR_SET_MISMATCH'));
});

test('new optional unpaid salary and credited seasons need field-specific evidence', () => {
  const args = conversion(); args.moves[0].unpaid_salary_available = 8_000_000; args.moves[0].credited_seasons = 5;
  const q = 'Calculate a 2026 post-June salary conversion of $6 million for Paulson Adebo. Unpaid salary available is $8 million. Credited seasons are 5.';
  assert.equal(check(args, q).ok, true);
  assert.equal(check(args, 'Calculate a 2026 post-June salary conversion of $6 million for Paulson Adebo. He played 5 seasons and earns $8 million.').ok, false);
});

test('nonzero original-team obligations bind cap, cash, player and year separately', () => {
  const question = QUESTION.replace(' and prior-team obligations', '') + ' Prior-team cap obligation is $3 million in 2026. Prior-team cash obligation is $2 million in 2026.';
  const args = fixture(question); args.moves[0].illustrative_terms!.prior_team_obligations = [{ year: 2026, cap: 3_000_000, cash: 2_000_000 }];
  assert.equal(check(args, question).ok, true);
  args.moves[0].illustrative_terms!.prior_team_obligations = [{ year: 2026, cap: 2_000_000, cash: 3_000_000 }];
  assert.equal(check(args, question).ok, false);
});

test('ambiguous repeated current values and silently removed prior budget are rejected', () => {
  assert.ok(hasGap(check(conversion(), 'Convert $6 million for Paulson Adebo. Set the conversion to $8 million.'), 'conversion_amount', 'AMBIGUOUS_FIELD_VALUE'));
  const prior = fixture(); const next = structuredClone(prior); delete next.budget;
  assert.ok(hasGap(check(next, 'Keep those exact illustrative terms and recalculate.', prior), 'budget', 'PRIOR_BUDGET_REMOVED'));
});

test('dossier-style player IDs match the same literal player name in current and prior text', () => {
  const prior = conversion(6_000_000, 'nfl:NYG:paulson-adebo');
  assert.equal(check(prior, 'Calculate a 2026 post-June salary conversion of $6 million for Paulson Adebo').ok, true);
  assert.equal(check(conversion(8_000_000, 'Paulson Adebo'), 'Increase the conversion to $8 million.', prior).ok, true);
});
