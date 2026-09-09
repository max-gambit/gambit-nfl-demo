import captured from '../../../data/nfl-contract-scenarios/dossiers.json';
import { factualBody } from '@shared/nflFacts';
import { validateNflContractScenarioArgs } from './validation.js';
import type { NflContractDossier, NflContractMoveResult, NflContractScenarioAnswer, NflContractScenarioArgs, NflContractScenarioIssue, NflContractScenarioMove, NflContractScenarioResult, NflContractScenarioYear } from './types.js';

export * from './types.js';
export {validateNflScenarioInputProvenance} from './input_provenance.js';
export type {NflScenarioInputProvenanceContext,NflScenarioInputProvenanceGap,NflScenarioInputProvenanceResult} from './input_provenance.js';
export { validateNflContractScenarioArgs, validateIllustrativeTerms } from './validation.js';
export { NFL_CONTRACT_SCENARIO_TOOL_SCHEMA, NFL_CONTRACT_COMPARISON_TOOL_SCHEMA, NFL_CONTRACT_COMPARISON_TOOL_DESCRIPTION, nflContractComparisonTool } from './tool_schema.js';
export { buildNflContractComparison, calculateNflContractComparison } from './comparison.js';
export type { NflContractComparisonAnswer, NflContractComparisonResult, NflContractComparisonAlternative, NflContractComparisonYear, NflContractComparisonMechanism, NflContractAlternativeId } from './comparison.js';

export const NFL_CONTRACT_CBA_URL = 'https://nflpaweb.blob.core.windows.net/website/PDFs/CBA/March-15-2020-NFL-NFLPA-Collective-Bargaining-Agreement-Final-Executed-Copy.pdf';
const dossiers = captured.dossiers as NflContractDossier[];
const normalized = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');
const money = (v: number | null) => v == null ? 'Unknown' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);
const sum = (values: Array<number | null>): number | null => values.some(v => v == null) ? null : values.reduce<number>((a, b) => a + b!, 0);
const subtract = (a: number | null, b: number | null) => a == null || b == null ? null : a - b;

export function getNflContractDossier(playerIdOrName: string): NflContractDossier | null {
  const row = dossiers.find(d => normalized(d.player_id) === normalized(playerIdOrName) || normalized(d.player_name) === normalized(playerIdOrName));
  return row ? structuredClone(row) : null;
}

export function getNflContractDossierCoverage() {
  return dossiers.map(d => ({ player_id: d.player_id, player_name: d.player_name, team_id: d.team_id, roster_status_as_of_snapshot: d.roster_status_as_of_snapshot, source_status: d.source_status, conflicts: [...d.conflicts], availability: d.availability, source_url: d.source_url, inspected_at: d.inspected_at, contract_years: d.reported_years.map(y => ({ year: y.year, is_void: y.is_void })) }));
}

/** Describe the validated current schedule; literal original wording is provenance only. */
export function describeNflIllustrativeTerms(move: NflContractScenarioMove): string[] {
  const terms = move.illustrative_terms;
  if (!terms) return [];
  return [
    `${move.player_id} · current illustrative terms: signing bonus ${money(terms.signing_bonus)}.`,
    ...terms.years.map(y => `${y.year} ${y.kind}: base salary ${money(y.base_salary)}; outstanding guaranteed salary ${money(y.guaranteed_salary)}; other cash ${money(y.other_cash)}; guaranteed other cash ${money(y.guaranteed_other_cash)}; incentive cap/cash ${money(y.incentives_cap_charge)} / ${money(y.incentives_cash)}; prior-team salary/other payments ${money(y.salary_paid_by_prior_team)} / ${money(y.other_cash_paid_by_prior_team)}.`),
    ...terms.prior_team_obligations.map(y => `${y.year} separate prior-team obligations: cap ${money(y.cap)}; cash ${money(y.cash)}.`),
  ];
}

function emptyYear(year: number, before: number | null = 0, after: number | null = 0): NflContractScenarioYear {
  return { year, cap_before: before, cap_after: after, cap_relief: subtract(before, after), cash_before: null, cash_after: null, cash_relief: null, dead_money_after: 0, added_proration: 0 };
}

function issue(code: string, message: string, player_id?: string, severity: NflContractScenarioIssue['severity'] = 'blocked'): NflContractScenarioIssue {
  return { code, severity, ...(player_id ? { player_id } : {}), message };
}

function baseMove(move: NflContractScenarioMove, d: NflContractDossier | null): NflContractMoveResult {
  return { player_id: d?.player_id ?? move.player_id, player_name: d?.player_name ?? move.player_id, original_team_id: d?.team_id ?? null, action: move.action, status: 'reported', years: [], original_team_obligations: [], reported_contract_years: d?.reported_years ?? [], guarantees: [], issues: [], assumptions: [], source_url: d?.source_url ?? null, source_as_of: d?.inspected_at ?? null };
}

function blocked(result: NflContractMoveResult, season: number, code: string, message: string): NflContractMoveResult {
  result.status = 'blocked';
  result.issues.push(issue(code, message, result.player_id));
  const years = new Set([season, season + 1, ...result.reported_contract_years.filter(y => y.year >= season).map(y => y.year)]);
  result.years = [...years].sort().map(y => ({...emptyYear(y, null, null),dead_money_after:null}));
  return result;
}

/** Conservative veteran floor if credited seasons are not supplied. */
function salaryFloor(season: number, creditedSeasons?: number) {
  const index = creditedSeasons == null ? 5 : Math.min(creditedSeasons, 7) >= 7 ? 5 : creditedSeasons >= 4 ? 4 : creditedSeasons;
  return [885_000, 1_005_000, 1_075_000, 1_145_000, 1_215_000, 1_300_000][index] + (season - 2026) * 45_000;
}

/** Integer-dollar straight-line allocation with a final-year rounding remainder. */
function allocate(amount: number, count: number) {
  const per = Math.floor(amount / count);
  return Array.from({ length: count }, (_, i) => i === count - 1 ? amount - per * (count - 1) : per);
}

function illustrativeMove(move: NflContractScenarioMove, args: NflContractScenarioArgs, d: NflContractDossier | null): NflContractMoveResult {
  const result = baseMove(move, d);
  const terms = move.illustrative_terms!;
  const allocations = allocate(terms.signing_bonus, terms.years.length);
  let voided = false;
  result.status = 'illustrative';
  result.years = terms.years.map((y, i) => {
    let proration = allocations[i];
    if (y.kind === 'void') {
      proration = voided ? 0 : allocations.slice(i).reduce((a, b) => a + b, 0);
      voided = true;
    }
    const salary = y.base_salary - y.salary_paid_by_prior_team;
    const other = y.other_cash - y.other_cash_paid_by_prior_team;
    const cap = salary + other + y.incentives_cap_charge + proration;
    const cash = salary + other + y.incentives_cash + (i === 0 ? terms.signing_bonus : 0);
    result.guarantees.push({ year: y.year, salary: y.guaranteed_salary, other_cash: y.guaranteed_other_cash + (i === 0 ? terms.signing_bonus : 0) });
    return { ...emptyYear(y.year, 0, cap), cash_before: 0, cash_after: cash, cash_relief: -cash, dead_money_after: y.kind === 'void' ? proration : 0, added_proration: proration };
  });
  if (!result.years.some(y => y.year === args.season + 1)) result.years.push({ ...emptyYear(args.season + 1), cash_before: 0, cash_after: 0, cash_relief: 0 });
  result.original_team_obligations = structuredClone(terms.prior_team_obligations);
  result.assumptions = [
    ...describeNflIllustrativeTerms(move),
    `Original user input, retained as provenance; subsequent changes are reflected in the current terms above: ${terms.user_input}`,
    `Guarantees supplied by the user: ${terms.guarantee_note}`,
    'The supplied schedule is the entire modeled compensation. Other cash is non-prorated; incentives have separately supplied cap and cash amounts. No options, deferred compensation, escalators, conditional vesting, or unlisted obligations are inferred.',
    'The acquiring team pays the new signing bonus in the scenario year. Each supplied void year is an eligible proration year; the first void occurs before June 1 and accelerates the remaining new bonus into that year.',
    'Prior-team payments reduce only the assigned current-year salary/other cash. Prior-team cap and cash obligations are listed separately and excluded from the acquiring-team totals.',
    'Illustrative guarantee inputs are the explicitly supplied outstanding guarantees after prior-team payments. No allocation of prior payments to guaranteed versus unguaranteed compensation is inferred.',
    'This is an arithmetic illustration of the supplied terms; it establishes neither an actual contract offer nor player availability or minimum-salary compliance.',
  ];
  if (d?.source_status === 'source_conflict') result.issues.push(issue('SOURCE_CONFLICT_ILLUSTRATION_ONLY', d.conflicts.join(' '), result.player_id, 'conditional'));
  return result;
}

function calculateMove(move: NflContractScenarioMove, args: NflContractScenarioArgs, available: NflContractDossier[]): NflContractMoveResult {
  const d = available.find(d => normalized(d.player_id) === normalized(move.player_id) || normalized(d.player_name) === normalized(move.player_id)) ?? null;
  const result = baseMove(move, d);
  if (args.protected_player_ids?.some(id => normalized(id) === normalized(move.player_id) || (d && (normalized(id) === normalized(d.player_id) || normalized(id) === normalized(d.player_name)))) && move.action !== 'hold') return blocked(result, args.season, 'PROTECTED_PLAYER', 'The move conflicts with the protected-player constraint.');
  if (move.action === 'acquire' && move.illustrative_terms) {
    if (d?.team_id === args.team_id) return blocked(result, args.season, 'ALREADY_ON_TEAM', 'The dossier already associates this player with the scenario team; an acquisition would duplicate the baseline.');
    return illustrativeMove(move, args, d);
  }
  if (!d) return blocked(result, args.season, 'DOSSIER_NOT_FOUND', 'No reviewed deep contract dossier matches this player. An acquisition can use complete explicit illustrative terms.');
  if (d.source_status === 'source_conflict') return blocked(result, args.season, 'SOURCE_CONFLICT', `${d.conflicts.join(' ')} No active-contract savings are calculated until the conflict is resolved.`);
  if (move.action !== 'acquire' && move.action !== 'hold' && d.team_id !== args.team_id) return blocked(result, args.season, 'WRONG_TEAM', `This is a ${d.team_id} contract; ${args.team_id} cannot count that club's outgoing relief as its own.`);
  const row = d.reported_years.find(y => y.year === args.season);
  if (!row || row.is_void || row.fields['Cap Number'] == null) return blocked(result, args.season, 'NO_ACTIVE_YEAR', 'No active reported contract row supports this transaction year.');
  const contractYears = d.reported_years.filter(y => y.year >= args.season).sort((a, b) => a.year - b.year);
  if (contractYears.some((y, i) => y.fields['Cap Number'] == null || y.year !== args.season + i)) return blocked(result, args.season, 'FUTURE_BASELINE_GAP', 'The reported contract-year baseline has missing cap amounts or a year gap; it cannot be treated as zero.');
  const years = [...new Set([args.season, args.season + 1, ...contractYears.map(y => y.year)])].sort();
  result.guarantees = contractYears.map(y => ({ year: y.year, salary: y.fields['Guaranteed Salary'] ?? null, other_cash: null }));
  result.assumptions.push('Contract amounts are OverTheCap public reporting inspected at the displayed source time, not an executed club contract. Roster association is from the saved roster; current availability is not established.',
    `${args.timing === 'post_june_1' ? 'After June 1' : 'On or before June 1'} is a hypothetical accounting window. It does not establish which salary, bonuses or incentives have been earned or paid.`,
    'Reported guarantee-salary columns are shown per year and are not summed into a claim about fully guaranteed money remaining. Offsets, vesting, injury protection and termination pay require the contract.');
  if (move.action === 'acquire') {
    const seller = calculateMove({ ...move, action: 'trade' }, { ...args, team_id: d.team_id }, available);
    result.original_team_obligations = seller.years.map(y => ({ year: y.year, cap: y.cap_after, cash: null }));
    return blocked(result, args.season, 'INCOMING_TERMS_INCOMPLETE', 'The original-team cap charge and seller savings are not the acquiring-team charge. Supply the remaining assigned compensation, paid/unpaid amounts, bonuses, guarantees and incentives, or fully detailed user-supplied illustrative terms.');
  }
  if (move.action === 'hold') {
    // A non-team hold is an inspection of that player's original contract, not a NYG baseline addition.
    if (d.team_id !== args.team_id) return blocked(result, args.season, 'WRONG_TEAM', `Use team_id ${d.team_id} to model holding this original contract; acquisition obligations require separate terms.`);
    result.years = years.map(year => {
      const sourceYear = contractYears.find(y => y.year === year);
      const value = sourceYear?.fields['Cap Number'] ?? 0;
      return { ...emptyYear(year, value, value), cash_relief: 0, dead_money_after: sourceYear?.is_void ? value : 0 };
    });
    return result;
  }
  result.status = 'conditional';
  result.issues.push(issue('PAYMENT_TIMING_UNVERIFIED', 'Public full-year fields do not establish transaction-date unpaid compensation; this is conditional accounting, not executable cap room.', d.player_id, 'conditional'));
  if (move.action === 'restructure') {
    const baseSalary = row.fields['Base Salary'];
    const activeYears = contractYears.filter(y => !y.is_void);
    if (baseSalary == null) return blocked(result, args.season, 'BASE_SALARY_MISSING', 'A salary conversion requires a reported base-salary component.');
    if (activeYears.length < 2) return blocked(result, args.season, 'NO_RESTRUCTURE_SPREAD', 'One remaining active year provides no simple salary-conversion cap relief. Adding years is outside this model.');
    if (contractYears.some(y => y.is_void)) return blocked(result, args.season, 'RESTRUCTURE_VOID_TERMS', 'This simple conversion requires active years only; existing void/option terms need an individually reviewed allocation.');
    const floor = salaryFloor(args.season, move.credited_seasons);
    if (move.conversion_amount! > Math.max(0, baseSalary - floor)) return blocked(result, args.season, 'SALARY_FLOOR', `The conversion exceeds reported base salary less the ${money(floor)} ${move.credited_seasons == null ? 'conservative 7+ credited-season' : 'supplied credited-season'} annual minimum floor.`);
    if (move.unpaid_salary_available != null && (move.unpaid_salary_available > baseSalary || move.conversion_amount! > move.unpaid_salary_available)) return blocked(result, args.season, 'UNPAID_SALARY_LIMIT', 'The conversion exceeds supplied unpaid salary or the supplied amount exceeds the reported salary.');
    const period = activeYears.slice(0, 5);
    const allocation = allocate(move.conversion_amount!, period.length);
    result.years = years.map(year => {
      const prior = contractYears.find(y => y.year === year)?.fields['Cap Number'] ?? 0;
      const i = period.findIndex(y => y.year === year);
      const added = i < 0 ? 0 : allocation[i];
      return { ...emptyYear(year, prior, prior + added - (year === args.season ? move.conversion_amount! : 0)), cash_relief: 0, added_proration: added };
    });
    result.assumptions.push(`Convert ${money(move.conversion_amount!)} of unpaid base salary to a signing bonus over ${period.length} existing active years; preserve annual total cash and existing guarantees, bonuses and proration. The new bonus is fully guaranteed.`,
      `Annual salary floor: ${money(floor)}. ${move.credited_seasons == null ? 'The highest veteran tier is used conservatively because credited seasons were not supplied.' : `Credited seasons supplied: ${move.credited_seasons}.`}`,
      `Unpaid salary available: ${move.unpaid_salary_available == null ? 'unknown; conversion requires confirmation before execution' : money(move.unpaid_salary_available)}. Contract permission, consent and remaining weekly minimum salary still require review.`);
    result.issues.push(issue('CONVERSION_GUARANTEE_EFFECT', 'If converted salary was previously unguaranteed, its guarantee treatment may change. This calculation does not establish a change in guaranteed compensation; salary may already be guaranteed. Existing guarantees are not removed, and the displayed guarantee column is the original reported contract context.', d.player_id, 'conditional'));
    return result;
  }
  const pre = move.action === 'trade' ? 'trade' : 'cut';
  const post = move.action === 'trade' ? 'june_1_trade' : 'june_1_cut';
  const key = args.timing === 'post_june_1' ? post : pre;
  const currentDead = row.reported_dead[key];
  const preDead = row.reported_dead[pre];
  const postDead = row.reported_dead[post];
  const relief = row.reported_savings[key];
  if (currentDead == null || preDead == null || postDead == null || relief == null || currentDead < 0 || preDead < postDead || row.fields['Cap Number']! - currentDead !== relief) return blocked(result, args.season, 'TRANSACTION_ARITHMETIC_GAP', 'Reported transaction columns are missing or fail cap minus dead-money reconciliation.');
  if (move.action === 'release' && contractYears.some(y => !y.is_void && y.fields['Guaranteed Salary'] == null)) return blocked(result, args.season, 'GUARANTEES_MISSING', 'A release cannot assume missing salary guarantees are zero.');
  const tail = args.timing === 'post_june_1' ? preDead - postDead : 0;
  result.years = years.map(year => {
    const before = contractYears.find(y => y.year === year)?.fields['Cap Number'] ?? 0;
    const after = year === args.season ? currentDead : year === args.season + 1 ? tail : 0;
    return { ...emptyYear(year, before, after), dead_money_after: after };
  });
  result.assumptions.push(`Current-year charge uses the reported ${key} column. Under the same public-table assumptions, next-year carry is ${money(tail)}; it is derived from pre/post transaction dead-money columns, not from an invented cash or guarantee allocation.`,
    'Reported future hold rows are the comparison baseline, including reported void-year cap charges. Existing unamortized charges remain with the original team; the same charge is counted once.',
    'Paid bonuses, option-exercise status, incentive treatment and guarantee/termination obligations can change the reported transaction columns. No acquiring-team cost or current spendable team balance is inferred.');
  if (move.action === 'release') result.issues.push(issue('RELEASE_GUARANTEE_TIMING', 'The public release columns embed guarantee assumptions; payment schedule, offsets, injury guarantees and termination-pay eligibility remain unverified.', d.player_id, 'conditional'));
  return result;
}

export function calculateNflContractScenario(input: NflContractScenarioArgs, available: NflContractDossier[] = dossiers): NflContractScenarioResult {
  const args = validateNflContractScenarioArgs(input);
  const results = args.moves.map(move => calculateMove(move, args, available));
  const counts = new Map<string, number>();
  for (const result of results) counts.set(normalized(result.player_id), (counts.get(normalized(result.player_id)) ?? 0) + 1);
  for (const result of results) if (counts.get(normalized(result.player_id))! > 1) blocked(result, args.season, 'DUPLICATE_OR_INCOMPATIBLE_MOVES', 'A player appears more than once. Hold, trade, release, restructure and acquisition cannot be combined or counted twice in the same scenario.');
  const allYears = [...new Set([args.season, args.season + 1, ...results.flatMap(m => m.years.map(y => y.year))])].sort();
  const fields = ['cap_before', 'cap_after', 'cap_relief', 'cash_before', 'cash_after', 'cash_relief', 'dead_money_after'] as const;
  const years = allYears.map(year => {
    const result = emptyYear(year);
    // A present null is missing evidence; a year after the complete schedule is zero.
    for (const field of fields) result[field] = sum(results.map(m => { const y = m.years.find(y => y.year === year); return y ? y[field] : m.status === 'blocked' ? null : 0; }));
    result.added_proration = results.reduce((total, m) => total + (m.years.find(y => y.year === year)?.added_proration ?? 0), 0);
    return result;
  });
  const issues = results.flatMap(m => m.issues);
  const status = results.some(m => m.status === 'blocked') ? 'blocked' : results.some(m => m.status === 'conditional') ? 'conditional' : results.some(m => m.status === 'illustrative') ? 'illustrative' : 'reported';
  const current = years.find(y => y.year === args.season)!;
  const effect = args.budget?.type === 'cash' ? current.cash_relief : current.cap_relief;
  const budgetAfter = args.budget && effect != null ? args.budget.amount + effect - args.budget.reserve : null;
  const budget = args.budget ? { type: args.budget.type, before: args.budget.amount, reserve: args.budget.reserve, after_reserve: budgetAfter, fits: status === 'blocked' || budgetAfter == null ? null : budgetAfter >= 0, basis: 'user_supplied_available_amount' as const } : null;
  const summary = status === 'blocked' ? `This scenario has ${issues.filter(i => i.severity === 'blocked').length} blocking input or evidence issue(s); a complete cap result is unavailable.`
    : `${args.team_id}: ${money(current.cap_relief)} of ${args.season} cap ${current.cap_relief != null && current.cap_relief < 0 ? 'relief (additional cap used)' : 'relief'} under ${status === 'illustrative' ? 'explicit illustrative user terms' : 'the displayed public-reporting assumptions'}. ${money(years.find(y => y.year === args.season + 1)?.cap_relief ?? null)} of relief in ${args.season + 1}.`;
  return { schema_version: 1, summary, status, team_id: args.team_id, season: args.season, moves: results, years, budget, issues, assumptions: [...new Set(results.flatMap(m => m.assumptions))], source_as_of: [...new Set(results.flatMap(m => m.source_as_of ? [m.source_as_of] : []))] };
}

export async function buildNflContractScenario(input: NflContractScenarioArgs): Promise<NflContractScenarioAnswer> {
  const args = validateNflContractScenarioArgs(input);
  const result = calculateNflContractScenario(args);
  const sources: NflContractScenarioAnswer['sources'] = [{ ref_index: 1, kind: 'CBA', source: 'NFL–NFLPA executed 2020 CBA', title: 'Article 13 §6(b): proration and acceleration; Article 26 §1: salary floors', updated_at: '2020-03-15', data: { source_url: NFL_CONTRACT_CBA_URL, contribution: 'Signing-bonus proration, June 1 timing, original-team bonus treatment, and veteran salary floors. Printed pp. 109–110 and 171; inspected September 8, 2026.' } }];
  const tables: NflContractScenarioAnswer['body']['tables'] = [];
  const calculations: NflContractScenarioAnswer['body']['calculations'] = [];
  for (const move of result.moves) {
    const ref = sources.length + 1;
    const d = getNflContractDossier(move.player_id);
    sources.push({ ref_index: ref, kind: 'CAP', source: move.action === 'acquire' && args.moves.find(m => normalized(m.player_id) === normalized(move.player_id) || normalized(m.player_id) === normalized(move.player_name))?.illustrative_terms ? 'User-supplied illustrative terms and public contract context' : 'OverTheCap public contract reporting', title: `${move.player_name} · ${move.action} · ${move.status}`, updated_at: move.source_as_of ?? new Date().toISOString().slice(0, 10), data: { source_url: move.source_url, contribution: 'Reported contract rows or explicit illustrative inputs; no verified availability or executed terms.', rows: [{ k: 'Source status', v: d?.source_status ?? 'User illustration' }, { k: 'Inspected', v: move.source_as_of ?? 'User supplied' }, { k: 'Content SHA-256', v: d?.source_sha256 ?? 'Not applicable' }, ...describeNflIllustrativeTerms(args.moves.find(m => normalized(m.player_id) === normalized(move.player_id) || normalized(m.player_id) === normalized(move.player_name))!).map(v => ({ k: 'Current illustrative terms', v })), ...move.issues.map(i => ({ k: i.code, v: i.message }))], reported_years: move.reported_contract_years, source_tables: d?.source_tables ?? [], illustrative_terms: args.moves.find(m => normalized(m.player_id) === normalized(move.player_id) || normalized(m.player_id) === normalized(move.player_name))?.illustrative_terms ?? null } });
    tables.push({ title: `${move.player_name}: ${move.action} (${move.status})`, columns: ['Year', 'Hold cap', 'Scenario cap', 'Cap relief', 'Scenario cash', 'Dead money', 'Added bonus allocation'], rows: move.years.map(y => [y.year, money(y.cap_before), money(y.cap_after), money(y.cap_relief), money(y.cash_after), money(y.dead_money_after), money(y.added_proration)]), source_refs: [1, ref] });
    if (move.reported_contract_years.length) tables.push({ title: `${move.player_name}: reported contract components`, columns: ['Year', 'Year kind', 'Base salary', 'Signing allocation', 'Option allocation', 'Reported guaranteed salary', 'Reported hold cap', 'Trigger'], rows: move.reported_contract_years.map(y => [y.year, y.is_void ? 'Void' : 'Active contract year', money(y.fields['Base Salary'] ?? null), money(y.fields['Prorated Signing Bonus'] ?? y.fields['Prorated Bonus Signing'] ?? null), money(y.fields['Prorated Bonus Option'] ?? null), money(y.fields['Guaranteed Salary'] ?? null), money(y.fields['Cap Number'] ?? null), y.year_annotation]), source_refs: [ref] });
    if (move.original_team_obligations.length) tables.push({ title: `${move.player_name}: original-team obligations excluded from ${args.team_id} totals`, columns: ['Year', 'Original-team cap', 'Original-team cash'], rows: move.original_team_obligations.map(y => [y.year, money(y.cap), money(y.cash)]), source_refs: [1, ref] });
    if (move.status !== 'blocked') for (const y of move.years) calculations.push({ label: `${move.player_name} ${y.year} cap relief`, formula: `${money(y.cap_before)} hold cap − ${money(y.cap_after)} scenario cap`, value: money(y.cap_relief), source_refs: [1, ref] });
  }
  tables.push({ title: `${args.team_id}: selected moves combined`, columns: ['Year', 'Hold cap', 'Scenario cap', 'Cap relief', 'Cash relief'], rows: result.years.map(y => [y.year, money(y.cap_before), money(y.cap_after), money(y.cap_relief), money(y.cash_relief)]), source_refs: sources.map(s => s.ref_index) });
  if (result.budget) calculations.push({ label: `User ${result.budget.type} budget after reserve`, formula: `${money(result.budget.before)} available + scenario ${result.budget.type} relief − ${money(result.budget.reserve)} reserve`, value: money(result.budget.after_reserve), source_refs: sources.map(s => s.ref_index) });
  return { scenario_args: args, scenario_result: result, sources, body: factualBody({ answer: result.summary, key_findings: result.issues.map(i => ({ label: i.code, body: i.message, source_refs: sources.map(s => s.ref_index) })), tables, calculations, caveats: [...result.assumptions, 'These totals cover only the selected moves, not a complete team cap ledger. Budget amounts and reserves are user inputs; cap room and cash budget are different.', 'The model does not price extensions, guarantee negotiations, player consent, trade compensation, replacement players, roster displacement, or current transaction eligibility. A blocked move makes aggregate fit unknown.'], followups: ['Compare the same moves before and after June 1.', 'Change the conversion amount and recalculate future cap charges.', 'Provide complete illustrative incoming terms, including paid compensation and guarantees.'] }) };
}
