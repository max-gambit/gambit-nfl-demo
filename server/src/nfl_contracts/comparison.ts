import { buildNflContractScenario, calculateNflContractScenario, NFL_CONTRACT_CBA_URL } from './index.js';
import { validateNflContractScenarioArgs } from './validation.js';
import type { NflContractDossier, NflContractScenarioAnswer, NflContractScenarioArgs, NflContractScenarioResult, NflContractScenarioYear } from './types.js';

export type NflContractAlternativeId = 'hold' | 'acquire_without_funding' | 'requested';
export interface NflContractComparisonAlternative {
  id: NflContractAlternativeId;
  label: string;
  /** Null means no selected internal players and no new incoming obligations. */
  scenario_args: NflContractScenarioArgs | null;
  result: NflContractScenarioResult;
}
export interface NflContractComparisonYear {
  year: number;
  alternatives: Array<{
    alternative_id: NflContractAlternativeId;
    cap_charge: number | null;
    cap_room_change_vs_hold: number | null;
    cash_charge: number | null;
    /** Positive means additional annual cash; zero is an unchanged annual amount. */
    cash_change_vs_hold: number | null;
    dead_money: number | null;
    added_proration: number | null;
  }>;
}
export interface NflContractComparisonMechanism {
  id: string;
  cba_section: string;
  source_url: string;
  application: string;
  limitations: string;
}
export interface NflContractComparisonResult {
  schema_version: 1;
  summary: string;
  status: NflContractScenarioResult['status'];
  team_id: string;
  season: number;
  cohort: string[];
  alternatives: NflContractComparisonAlternative[];
  years: NflContractComparisonYear[];
  mechanisms: NflContractComparisonMechanism[];
  assumptions: string[];
}
export interface NflContractComparisonAnswer extends NflContractScenarioAnswer {
  comparison_args: NflContractScenarioArgs;
  comparison_result: NflContractComparisonResult;
}

const money = (value: number | null) => value == null ? 'Unknown' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
const difference = (left: number | null, right: number | null) => left == null || right == null ? null : left - right;
const zeroYear = (year: number): NflContractScenarioYear => ({ year, cap_before: 0, cap_after: 0, cap_relief: 0, cash_before: 0, cash_after: 0, cash_relief: 0, dead_money_after: 0, added_proration: 0 });
const unknownYear = (year: number): NflContractScenarioYear => ({ year, cap_before: null, cap_after: null, cap_relief: null, cash_before: null, cash_after: null, cash_relief: null, dead_money_after: null, added_proration: 0 });

function noNewObligations(args: NflContractScenarioArgs): NflContractScenarioResult {
  const after = args.budget ? args.budget.amount - args.budget.reserve : null;
  return {
    schema_version: 1, summary: 'No new obligations for the selected incoming players.', status: 'reported', team_id: args.team_id, season: args.season,
    moves: [], years: [zeroYear(args.season), zeroYear(args.season + 1)], issues: [], source_as_of: [],
    budget: args.budget ? { type: args.budget.type, before: args.budget.amount, reserve: args.budget.reserve, after_reserve: after, fits: after! >= 0, basis: 'user_supplied_available_amount' } : null,
    assumptions: ['This baseline assigns zero new obligations to the selected incoming players because no acquisition occurs. It does not assert a zero team payroll or cap ledger.'],
  };
}

function controllingMechanisms(args: NflContractScenarioArgs, requested: NflContractScenarioResult): NflContractComparisonMechanism[] {
  const mechanisms: NflContractComparisonMechanism[] = [];
  const rule = (id: string, section: string, application: string, limitations: string) => mechanisms.push({ id, cba_section: section, source_url: NFL_CONTRACT_CBA_URL, application, limitations });
  for (const [index, move] of args.moves.entries()) {
    const result = requested.moves[index];
    if (move.action === 'restructure') {
      const allocation = result.status === 'blocked' ? 'Allocation is blocked by the displayed input or evidence issue.' : result.years.filter(y => y.added_proration > 0).map(y => money(y.added_proration) + ' added in ' + y.year).join('; ') + '.';
      rule('salary_conversion_' + index, 'Article 13 §6(b)(i), printed p. 109',
        result.player_name + ': the model converts ' + money(move.conversion_amount!) + ' of same-year salary into a new signing bonus, allocated over the remaining modeled active contract years, up to five years. ' + allocation + ' June 1 does not change this straight-line conversion formula.',
        'The same-dollar conversion conserves the modeled annual cash amount; that is the scenario arithmetic, not a separate CBA cash exemption. This comparison does not calculate a change in guaranteed compensation; salary may already be guaranteed. Paid/unpaid salary, payment timing, consent, executed conversion rights and contract conditions remain unverified.');
      rule('minimum_salary_' + index, 'Article 26 §1, printed p. 171',
        'The calculator checks that the reported base salary after conversion remains at least the modeled credited-season minimum; when credited seasons are not supplied it uses the conservative 7+ tier. A failing floor check blocks the move.',
        'Credited seasons are not inferred from accrued seasons. This annual floor check does not establish transaction-date eligibility or all contract compliance.');
    }
    if (move.action === 'trade' || move.action === 'release') {
      rule('acceleration_' + index, 'Article 13 §6(b)(ii)(1)–(3), printed pp. 109–110',
        result.player_name + ': ' + (args.timing === 'post_june_1' ? 'after-June-1 removal or assignment generally places remaining future signing-bonus acceleration in the following League Year.' : 'on-or-before-June-1 removal or assignment generally accelerates remaining signing-bonus allocation into the current League Year.') + ' The displayed charges use reconciled public transaction columns and retain the resulting later-year charge.',
        'A future-year cap charge is not a cash payment. Guarantee, option, already-paid compensation, termination-pay and other contract terms can change the public-table result.');
    }
    if (move.action === 'acquire') {
      rule('incoming_bonus_' + index, 'Article 13 §6(b)(i) and §6(b)(ii)(3), printed pp. 109–110',
        result.player_name + ': the previous club’s signing bonus is excluded from the acquiring club’s Team Salary. A new signing bonus expressly supplied in this illustration is allocated to the acquiring club; original-team obligations are shown separately and excluded from its totals.',
        'Seller relief and original-team dead money are not an incoming price. The model requires complete remaining assigned compensation or complete explicit illustrative terms; player availability, trade price and unlisted terms remain unresolved.');
    }
  }
  return mechanisms;
}

/**
 * Every branch uses the same selected cohort and years. Incoming players have
 * zero new obligations in hold; internal funding players remain held in every
 * branch where their move is not selected. No full-team balance is inferred.
 */
export function calculateNflContractComparison(input: NflContractScenarioArgs, available?: NflContractDossier[]): NflContractComparisonResult {
  const args = validateNflContractScenarioArgs(input);
  if (!args.moves.some(m => m.action !== 'hold')) throw new Error('A contract comparison requires a requested alternative to hold. Supply the requested conversion, trade, release or acquisition once; hold is calculated automatically.');
  const requested = calculateNflContractScenario(args, available);
  const holdMoves = args.moves.filter(m => m.action !== 'acquire').map(m => ({ player_id: m.player_id, action: 'hold' as const }));
  const holdArgs = holdMoves.length ? { ...args, moves: holdMoves } : null;
  const alternatives: NflContractComparisonAlternative[] = [{
    id: 'hold', label: args.moves.some(m => m.action === 'acquire') ? 'Hold / no acquisition' : 'Hold',
    scenario_args: holdArgs, result: holdArgs ? calculateNflContractScenario(holdArgs, available) : noNewObligations(args),
  }];
  const hasAcquisition = args.moves.some(m => m.action === 'acquire');
  const hasFunding = args.moves.some(m => m.action !== 'acquire' && m.action !== 'hold');
  if (hasAcquisition && hasFunding) {
    const withoutFunding = { ...args, moves: args.moves.map(m => m.action === 'acquire' ? m : { player_id: m.player_id, action: 'hold' as const }) };
    alternatives.push({ id: 'acquire_without_funding', label: 'Acquisition without funding moves', scenario_args: withoutFunding, result: calculateNflContractScenario(withoutFunding, available) });
  }
  alternatives.push({ id: 'requested', label: hasAcquisition && hasFunding ? 'Acquisition + selected funding' : 'Requested moves', scenario_args: args, result: requested });
  const yearNumbers = [...new Set(alternatives.flatMap(a => a.result.years.map(y => y.year)))].sort((a, b) => a - b);
  // Only years beyond a complete schedule become zero. An incomplete branch
  // remains unknown even when another branch adds a later horizon year.
  for (const alternative of alternatives) alternative.result.years = yearNumbers.map(year => alternative.result.years.find(y => y.year === year) ?? (alternative.result.status === 'blocked' ? unknownYear(year) : zeroYear(year)));
  const years = yearNumbers.map(year => {
    const baseline = alternatives[0].result.years.find(y => y.year === year)!;
    return { year, alternatives: alternatives.map(alternative => {
      const row = alternative.result.years.find(y => y.year === year)!;
      return {
        alternative_id: alternative.id, cap_charge: row.cap_after, cap_room_change_vs_hold: difference(baseline.cap_after, row.cap_after), cash_charge: row.cash_after,
        // Annual change can be known even when absolute unpaid cash is unknown.
        cash_change_vs_hold: difference(baseline.cash_relief, row.cash_relief),
        dead_money: row.dead_money_after, added_proration: alternative.result.status === 'blocked' ? null : row.added_proration,
      };
    }) };
  });
  const current = years.find(y => y.year === args.season)!.alternatives.at(-1)!;
  const next = years.find(y => y.year === args.season + 1)!.alternatives.at(-1)!;
  const summary = requested.status === 'blocked'
    ? 'Hold and the requested alternative are shown together. The requested alternative is blocked; its aggregate cap/cash result and fit are unknown until the displayed issues are resolved.'
    : 'Compared with hold, the requested moves change ' + args.season + ' cap room by ' + money(current.cap_room_change_vs_hold) + ' and ' + (args.season + 1) + ' cap room by ' + money(next.cap_room_change_vs_hold) + '. Annual cash changes by ' + money(current.cash_change_vs_hold) + ' in ' + args.season + ' and ' + money(next.cash_change_vs_hold) + ' in ' + (args.season + 1) + ', under the displayed ' + requested.status + ' assumptions.';
  return {
    schema_version: 1, summary, status: requested.status, team_id: args.team_id, season: args.season, cohort: [...new Set(requested.moves.map(m => m.player_name))],
    alternatives, years, mechanisms: controllingMechanisms(args, requested),
    assumptions: [
      'Every alternative covers the same selected cohort and displayed years. Internal players are held unless their move is selected; an incoming player contributes zero new team obligations in the no-acquisition baseline.',
      'Positive cap-room change means relief; negative means additional cap used. Positive cash change means additional annual cash paid. Unknown absolute cash is not zero; a same-dollar conversion can still have a known zero annual cash change.',
      'All later reported contract and void years are retained. Added bonus allocation is a future cap obligation and is not a second payment of the signing bonus.',
      'These alternatives are arithmetic scenarios, not current executable cap room or a full team ledger. Public-reporting dates, incomplete terms and illustrative inputs remain explicit.',
    ],
  };
}

export async function buildNflContractComparison(input: NflContractScenarioArgs): Promise<NflContractComparisonAnswer> {
  const comparison = calculateNflContractComparison(input);
  const answer = await buildNflContractScenario(input);
  const refs = answer.sources.map(s => s.ref_index);
  const requested = comparison.alternatives.at(-1)!;
  const labels = comparison.alternatives.map(a => a.label);
  const tables: NflContractScenarioAnswer['body']['tables'] = [
    { title: 'Contract alternatives: cap, cash change and future allocation', columns: ['Year', 'Alternative', 'Cap charge', 'Cap room change vs hold (+ relief)', 'Annual cash change vs hold (+ paid)', 'Added bonus allocation'], rows: comparison.years.flatMap(y => y.alternatives.map((a, index) => [y.year, labels[index], money(a.cap_charge), money(a.cap_room_change_vs_hold), money(a.cash_change_vs_hold), money(a.added_proration)])), source_refs: refs },
    { title: 'Controlling CBA mechanism and scenario application', columns: ['CBA section', 'Application', 'Remaining conditions'], rows: comparison.mechanisms.map(m => [m.cba_section, m.application, m.limitations]), source_refs: refs },
    { title: 'Alternatives: annual cash, dead money and new bonus allocation', columns: ['Year', 'Alternative', 'Annual cash amount', 'Dead money', 'Added bonus allocation'], rows: comparison.years.flatMap(y => y.alternatives.map((a, index) => [y.year, labels[index], money(a.cash_charge), money(a.dead_money), money(a.added_proration)])), source_refs: refs },
  ];
  if (requested.result.budget) tables.splice(1, 0, { title: 'User-supplied budget and reserve by alternative', columns: ['Alternative', 'Status', 'Budget basis', 'Available before moves', 'Reserve', 'After moves and reserve', 'Fits on these assumptions'], rows: comparison.alternatives.map(a => {
    const budget = a.result.budget!;
    return [a.label, a.result.status, budget.type, money(budget.before), money(budget.reserve), money(budget.after_reserve), budget.fits == null ? 'Unknown' : budget.fits ? 'Yes, conditional on displayed inputs' : 'No'];
  }), source_refs: refs });
  const calculations = comparison.years.map(y => {
    const hold = y.alternatives[0], alternative = y.alternatives.at(-1)!;
    return { label: y.year + ' requested cap room change versus hold', formula: money(hold.cap_charge) + ' hold charge − ' + money(alternative.cap_charge) + ' requested charge', value: money(alternative.cap_room_change_vs_hold), source_refs: refs };
  });
  // Attach mechanisms to the same source bundle; no extra search round is needed.
  const cba = answer.sources.find(s => s.ref_index === 1)!;
  cba.data = { ...cba.data, comparison_mechanisms: comparison.mechanisms };
  answer.body.answer = comparison.summary;
  answer.body.tables = [...tables, ...answer.body.tables];
  answer.body.calculations = [...calculations, ...answer.body.calculations];
  answer.body.caveats = [...comparison.assumptions, ...answer.body.caveats];
  answer.body.key_findings = [
    ...comparison.mechanisms.map(m => ({ label: m.cba_section, body: m.application + ' ' + m.limitations, source_refs: refs })),
    ...answer.body.key_findings,
  ];
  return { ...answer, comparison_args: structuredClone(answer.scenario_args), comparison_result: comparison };
}
