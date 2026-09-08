import assert from 'node:assert/strict';
import test from 'node:test';
import { buildNflContractScenario, calculateNflContractScenario, getNflContractDossier, getNflContractDossierCoverage, validateNflContractScenarioArgs } from '../../src/nfl_contracts/index.js';
import type { NflContractScenarioArgs, NflIllustrativeContractTerms, NflIllustrativeContractYear } from '../../src/nfl_contracts/index.js';

const input = (player: string, action: NflContractScenarioArgs['moves'][number]['action'], changes: Partial<NflContractScenarioArgs> = {}): NflContractScenarioArgs => ({ schema_version: 1, team_id: 'NYG', season: 2026, timing: 'post_june_1', moves: [{ player_id: player, action }], ...changes });
const year = (result: ReturnType<typeof calculateNflContractScenario>, year: number) => result.years.find(y => y.year === year)!;
const illustrativeYear = (year: number, changes: Partial<NflIllustrativeContractYear> = {}): NflIllustrativeContractYear => ({ year, kind: 'active', base_salary: 0, other_cash: 0, incentives_cap_charge: 0, incentives_cash: 0, guaranteed_salary: 0, guaranteed_other_cash: 0, salary_paid_by_prior_team: 0, other_cash_paid_by_prior_team: 0, ...changes });
const terms = (): NflIllustrativeContractTerms => ({ basis: 'user_supplied_illustrative', label: 'Explicit test input, not an actual offer', user_input: 'Assume an $8m new signing bonus across 2026–2029, two active years and two void years, with the complete yearly inputs below.', terms_complete: true, signing_bonus: 8_000_000, guarantee_note: '2026 base fully guaranteed; $2m of 2027 base guaranteed; no other guarantees. New signing bonus fully guaranteed.', years: [
  illustrativeYear(2026, { base_salary: 6_000_000, other_cash: 1_000_000, guaranteed_salary: 4_000_000, salary_paid_by_prior_team: 2_000_000, other_cash_paid_by_prior_team: 250_000 }),
  illustrativeYear(2027, { base_salary: 9_000_000, other_cash: 1_000_000, guaranteed_salary: 2_000_000, incentives_cap_charge: 500_000, incentives_cash: 750_000 }),
  illustrativeYear(2028, { kind: 'void' }), illustrativeYear(2029, { kind: 'void' }),
], prior_team_obligations: [{ year: 2026, cap: 3_000_000, cash: 2_250_000 }, { year: 2027, cap: 6_000_000, cash: 0 }] });
const acquisition = (): NflContractScenarioArgs => input('Christian Kirk', 'acquire', { moves: [{ player_id: 'Christian Kirk', action: 'acquire', illustrative_terms: terms() }] });

test('eight dossiers retain bounded provenance and distinguish current contract from roster status', () => {
  const coverage = getNflContractDossierCoverage();
  assert.equal(coverage.length, 8);
  assert.equal(coverage.find(d => d.player_name === 'Christian Kirk')?.roster_status_as_of_snapshot, 'rsr');
  assert.ok(coverage.every(d => d.availability === 'not_established'));
  const slayton = getNflContractDossier('Darius Slayton')!;
  assert.equal(slayton.source_status, 'source_conflict');
  assert.equal(slayton.reported_years.length, 0);
  assert.ok(slayton.source_tables.find(t => t.section === 'Contract History')?.rows.some(r => r.includes('2025') && r.includes('Terminated')));
  assert.ok(slayton.source_tables.find(t => t.section === 'Dead Money History')?.rows.some(r => r.includes('2027') && r.includes('$3,000,000')));
  assert.match(slayton.source_sha256, /^[a-f0-9]{64}$/);
});

test('negative pre-June relief survives, and post-June timing moves future tail once', () => {
  const pre = calculateNflContractScenario(input('Brian Burns', 'trade', { timing: 'pre_june_1' }));
  assert.equal(year(pre, 2026).cap_relief, -34_366_667); // 21,383,333 - 55,750,000
  assert.equal(year(pre, 2027).cap_after, 0);
  const post = calculateNflContractScenario(input('Brian Burns', 'trade'));
  assert.equal(year(post, 2026).cap_after, 18_583_333);
  assert.equal(year(post, 2026).cap_relief, 2_800_000);
  assert.equal(year(post, 2027).cap_after, 37_166_667);
  assert.equal(year(post, 2027).cap_relief, 6_916_666);
  assert.equal(year(post, 2028).cap_after, 0);
  assert.equal(year(post, 2028).cap_relief, 44_083_334);
  assert.equal(pre.years.reduce((a, y) => a + y.cap_after!, 0), post.years.reduce((a, y) => a + y.cap_after!, 0));
  assert.equal(post.status, 'conditional');
});

test('release guarantees preserve negative relief and cannot be silently omitted', () => {
  const release = calculateNflContractScenario(input('Andrew Thomas', 'release'));
  assert.equal(year(release, 2026).cap_after, 18_387_250);
  assert.equal(year(release, 2026).cap_relief, -5_355_294);
  const d = getNflContractDossier('Andrew Thomas')!;
  d.reported_years.find(y => y.year === 2027)!.fields['Guaranteed Salary'] = null;
  const missing = calculateNflContractScenario(input('Andrew Thomas', 'release'), [d]);
  assert.equal(missing.status, 'blocked');
  assert.ok(missing.issues.some(i => i.code === 'GUARANTEES_MISSING'));
  assert.equal(year(missing, 2026).cap_relief, null);
});

test('an inconsistent reported transaction or missing future cap cannot become exact savings', () => {
  const d = getNflContractDossier('Brian Burns')!;
  d.reported_years.find(y => y.year === 2026)!.reported_savings.june_1_trade! += 1;
  assert.equal(calculateNflContractScenario(input('Brian Burns', 'trade'), [d]).status, 'blocked');
  const missing = getNflContractDossier('Brian Burns')!;
  missing.reported_years.find(y => y.year === 2028)!.fields['Cap Number'] = null;
  assert.ok(calculateNflContractScenario(input('Brian Burns', 'trade'), [missing]).issues.some(i => i.code === 'FUTURE_BASELINE_GAP'));
});

test('source conflict blocks hold and transactions without mutating the saved roster', () => {
  for (const action of ['hold', 'trade', 'release', 'restructure'] as const) {
    const args = input('Darius Slayton', action);
    if (action === 'restructure') args.moves[0].conversion_amount = 1_000_000;
    const result = calculateNflContractScenario(args);
    assert.equal(result.status, 'blocked');
    assert.ok(result.issues.some(i => i.code === 'SOURCE_CONFLICT'));
  }
});

test('actual incoming cap is unknown while original-team obligations remain separate', () => {
  const result = calculateNflContractScenario(input('Courtland Sutton', 'acquire', { budget: { type: 'cap', amount: 20_000_000, reserve: 2_000_000 } }));
  assert.equal(result.status, 'blocked');
  assert.equal(year(result, 2026).cap_after, null);
  assert.equal(year(result, 2026).dead_money_after, null);
  assert.equal(result.moves[0].years.find(y => y.year === 2026)?.dead_money_after, null);
  assert.equal(result.budget?.fits, null);
  assert.equal(result.moves[0].original_team_obligations.find(y => y.year === 2026)?.cap, 6_075_000);
  assert.equal(result.moves[0].original_team_obligations.find(y => y.year === 2027)?.cap, 15_850_000);
  assert.ok(result.issues.some(i => i.code === 'INCOMING_TERMS_INCOMPLETE'));
});

test('void years come from explicit player-page labels and retain the reported future hold charges', () => {
  const d = getNflContractDossier('Jakobi Meyers')!;
  assert.deepEqual(d.reported_years.filter(y => y.is_void).map(y => y.year), [2029, 2030]);
  const result = calculateNflContractScenario(input('Jakobi Meyers', 'hold', { team_id: 'JAX' }));
  assert.equal(year(result, 2029).cap_before, 7_280_000);
  assert.equal(year(result, 2029).dead_money_after, 7_280_000);
  assert.equal(year(result, 2030).cap_before, 0);
  assert.equal(year(result, 2029).cap_relief, 0);
});

test('Adebo conversion changes two years equally with no annual cash savings', () => {
  const args = input('Paulson Adebo', 'restructure', { moves: [{ player_id: 'Paulson Adebo', action: 'restructure', conversion_amount: 8_000_000, unpaid_salary_available: 10_000_000, credited_seasons: 5 }] });
  const result = calculateNflContractScenario(args);
  assert.equal(year(result, 2026).cap_before, 24_199_390);
  assert.equal(year(result, 2026).cap_after, 20_199_390);
  assert.equal(year(result, 2026).cap_relief, 4_000_000);
  assert.equal(year(result, 2027).cap_after, 24_317_037);
  assert.equal(year(result, 2027).cap_relief, -4_000_000);
  assert.equal(year(result, 2026).cash_relief, 0);
  assert.equal(result.years.reduce((a, y) => a + y.cap_relief!, 0), 0);
  args.moves[0].conversion_amount = 4_000_000;
  const changed = calculateNflContractScenario(args);
  assert.equal(year(changed, 2026).cap_relief, 2_000_000);
  assert.equal(year(changed, 2027).cap_relief, -2_000_000);
});

test('conversions enforce unpaid compensation, salary floor, and remaining contract years', () => {
  const lowUnpaid = input('Paulson Adebo', 'restructure', { moves: [{ player_id: 'Paulson Adebo', action: 'restructure', conversion_amount: 8_000_000, unpaid_salary_available: 5_000_000 }] });
  assert.ok(calculateNflContractScenario(lowUnpaid).issues.some(i => i.code === 'UNPAID_SALARY_LIMIT'));
  const lowBase = input('Brian Burns', 'restructure', { moves: [{ player_id: 'Brian Burns', action: 'restructure', conversion_amount: 500_000 }] });
  assert.ok(calculateNflContractScenario(lowBase).issues.some(i => i.code === 'SALARY_FLOOR'));
  const oneYear = input('Jon Runyan', 'restructure', { moves: [{ player_id: 'Jon Runyan', action: 'restructure', conversion_amount: 2_000_000 }] });
  assert.ok(calculateNflContractScenario(oneYear).issues.some(i => i.code === 'NO_RESTRUCTURE_SPREAD'));
});

test('duplicate aliases, incompatible moves, and protected players block aggregate counting', () => {
  const duplicate = input('Brian Burns', 'trade', { moves: [{ player_id: 'Brian Burns', action: 'trade' }, { player_id: 'nfl:NYG:brian-burns', action: 'hold' }], budget: { type: 'cap', amount: 20_000_000, reserve: 0 } });
  const result = calculateNflContractScenario(duplicate);
  assert.equal(result.status, 'blocked');
  assert.equal(year(result, 2026).cap_relief, null);
  assert.equal(result.budget?.fits, null);
  assert.ok(result.moves.every(m => m.issues.some(i => i.code === 'DUPLICATE_OR_INCOMPATIBLE_MOVES')));
  assert.equal(calculateNflContractScenario(input('Brian Burns', 'trade', { protected_player_ids: ['Brian Burns'] })).status, 'blocked');
  assert.equal(calculateNflContractScenario(input('Brian Burns', 'hold', { protected_player_ids: ['Brian Burns'] })).status, 'reported');
});

test('illustrative acquisition independently calculates incoming cash, guarantees, prior-team and void-year obligations', () => {
  const result = calculateNflContractScenario(acquisition());
  // 2026: unpaid base 4m + unpaid other .75m + new bonus proration 2m.
  assert.equal(year(result, 2026).cap_after, 6_750_000);
  assert.equal(year(result, 2026).cash_after, 12_750_000); // 4 + .75 + entire new 8
  assert.equal(year(result, 2027).cap_after, 12_500_000); // 9 + 1 + .5 + 2
  assert.equal(year(result, 2027).cash_after, 10_750_000); // 9 + 1 + .75
  assert.equal(year(result, 2028).cap_after, 4_000_000); // remaining two allocations accelerate once
  assert.equal(year(result, 2029).cap_after, 0);
  assert.equal(result.moves[0].guarantees[0].salary, 4_000_000);
  assert.equal(result.moves[0].guarantees[0].other_cash, 8_000_000);
  assert.equal(result.moves[0].original_team_obligations[1].cap, 6_000_000);
  assert.equal(result.years.reduce((a, y) => a + y.added_proration, 0), 8_000_000);
  assert.equal(result.status, 'illustrative');
});

test('changed user compensation recalculates different current and following year effects', () => {
  const args = acquisition();
  const t = args.moves[0].illustrative_terms!;
  t.signing_bonus = 4_000_000;
  t.years[0].base_salary = 8_000_000;
  t.years[1].base_salary = 12_000_000;
  const result = calculateNflContractScenario(args);
  assert.equal(year(result, 2026).cap_after, 7_750_000); // 6 + .75 + 1
  assert.equal(year(result, 2027).cap_after, 14_500_000); // 12 + 1 + .5 + 1
  assert.equal(year(result, 2028).cap_after, 2_000_000);
  assert.equal(year(result, 2026).cash_after, 10_750_000);
});

test('outstanding guarantees are explicit and are not reduced again by prior payments', () => {
  const args = acquisition();
  args.moves[0].illustrative_terms!.years[0].guaranteed_salary = 1_000_000;
  assert.equal(calculateNflContractScenario(args).moves[0].guarantees[0].salary, 1_000_000);
  args.moves[0].illustrative_terms!.years[0].guaranteed_salary = 5_000_000;
  assert.throws(() => calculateNflContractScenario(args), /outstanding guarantees/);
});

test('cap and cash budgets use net selected-move changes with reserve and preserve unknown cash', () => {
  const args = acquisition();
  args.budget = { type: 'cap', amount: 8_000_000, reserve: 2_000_000 };
  args.moves.push({ player_id: 'Paulson Adebo', action: 'restructure', conversion_amount: 8_000_000 });
  const result = calculateNflContractScenario(args);
  assert.equal(year(result, 2026).cap_relief, -2_750_000);
  assert.equal(result.budget?.after_reserve, 3_250_000);
  assert.equal(result.budget?.fits, true);
  args.budget.type = 'cash';
  assert.equal(calculateNflContractScenario(args).budget?.after_reserve, -6_750_000);
  assert.equal(calculateNflContractScenario(args).budget?.fits, false);
  const actualCash = calculateNflContractScenario(input('Jon Runyan', 'release', { budget: { type: 'cash', amount: 0, reserve: 0 } }));
  assert.equal(actualCash.budget?.after_reserve, null);
  assert.equal(actualCash.budget?.fits, null);
});

test('illustrative validation refuses missing guarantees, invented fields, paid-over-total, nonconsecutive years, and void cash', () => {
  const badGuarantee = acquisition() as any;
  delete badGuarantee.moves[0].illustrative_terms.years[1].guaranteed_salary;
  assert.throws(() => validateNflContractScenarioArgs(badGuarantee), /guaranteed_salary/);
  const badPaid = acquisition();
  badPaid.moves[0].illustrative_terms!.years[0].salary_paid_by_prior_team = 7_000_000;
  assert.throws(() => validateNflContractScenarioArgs(badPaid), /paid amounts/);
  const badVoid = acquisition();
  badVoid.moves[0].illustrative_terms!.years[2].base_salary = 1;
  assert.throws(() => validateNflContractScenarioArgs(badVoid), /void years/);
  const badYear = acquisition();
  badYear.moves[0].illustrative_terms!.years[1].year = 2028;
  assert.throws(() => validateNflContractScenarioArgs(badYear), /consecutive/);
  assert.throws(() => validateNflContractScenarioArgs({ ...input('Brian Burns', 'trade'), latest_cap_space: 99 }), /unsupported/);
  assert.throws(() => validateNflContractScenarioArgs(input('Brian Burns', 'trade', { season: 2030 })), /final-CBA-year/);
});

test('wrong-team relief and own-team acquisition cannot enter a NYG package', () => {
  assert.ok(calculateNflContractScenario(input('Courtland Sutton', 'trade')).issues.some(i => i.code === 'WRONG_TEAM'));
  const own = acquisition(); own.moves[0].player_id = 'Brian Burns';
  assert.ok(calculateNflContractScenario(own).issues.some(i => i.code === 'ALREADY_ON_TEAM'));
});

test('facts answer is serializable, includes source-owned tables and calculations, and does not mutate arguments', async () => {
  const args = acquisition(); const original = structuredClone(args);
  const answer = await buildNflContractScenario(args);
  assert.deepEqual(args, original);
  assert.equal(answer.body.language_policy, 'facts_only_v1');
  assert.ok(answer.body.tables.some(t => t.title.includes('original-team obligations')));
  assert.ok(answer.body.calculations.some(c => c.label.includes('2028')));
  assert.deepEqual(JSON.parse(JSON.stringify(answer.scenario_args)), original);
  assert.equal(answer.scenario_result.years[0].cap_after, 6_750_000);
  assert.ok(answer.sources.some(s => JSON.stringify(s.data).includes('Explicit test input')));
});


test('revised illustrative terms display current amounts while original wording stays provenance', async () => {
  const args = acquisition();
  args.moves[0].player_id = 'Example Receiver';
  args.moves[0].illustrative_terms!.user_input = 'Original proposal: 2027 base salary $9 million.';
  args.moves[0].illustrative_terms!.years[1].base_salary = 4_500_000;
  const answer = await buildNflContractScenario(args);
  assert.match(answer.body.caveats.join(' '), /2027 active: base salary \$4,500,000/);
  assert.match(answer.body.caveats.join(' '), /Original user input, retained as provenance/);
  const data = answer.sources[1].data as {source_url: string | null; rows: Array<{k: string; v: string}>};
  assert.equal(data.source_url, null);
  assert.match(data.rows.filter(row => row.k === 'Current illustrative terms').map(row => row.v).join(' '), /2027 active: base salary \$4,500,000/);
});
