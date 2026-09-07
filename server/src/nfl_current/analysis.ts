import type { BriefSource, DataAnalysisBriefBody } from '@shared/types';
import { loadCapObservationAnswer } from './cap_observation.js';
import { teamIdsFromQuestion } from '../nfl_transactions/question.js';
import {
  loadCurrentNflTeamDataWithMode,
  type NflCapRow,
  type NflCurrentDataLoadResult,
  type NflDemoSeed,
  type NflPlayerMetricRow,
} from '../nfl_data/seed.js';

export type NflCurrentQuestionKind = 'cap_space' | 'cap_reconciliation' | 'starting_cornerbacks' | 'largest_cap_hits' | 'wide_receiver_contracts';

export interface PreparedNflCurrentAnswer {
  body: DataAnalysisBriefBody;
  sources: Array<Omit<BriefSource, 'id' | 'brief_id'>>;
}

export type LoadCurrentNflTeam = (teamId: string) => Promise<NflCurrentDataLoadResult>;

export function classifyNflCurrentQuestion(question: string): NflCurrentQuestionKind | null {
  const value = question.trim();
  if (teamIdsFromQuestion(value).some(id => id !== 'NYG')) return null;
  if (/\b(?:top[- ]?51|full roster|reconcile|reconciliation)\b/i.test(value) && /\b(?:cap|accounting|figure|number|include|reconcile)\b/i.test(value)) return 'cap_reconciliation';
  if (!/\b(?:giants|nyg)\b/i.test(value)) return null;
  const conditionalMove = /\b(?:cut(?:s|ting)?|releas(?:e|ed|ing)|trad(?:e|ed|ing)|mov(?:e|ed|ing)|waiv(?:e|ed|ing)|restructur(?:e|ed|ing)|extend(?:ed|ing)?|sign(?:ed|ing)?)\b/i.test(value)
    && /\b(?:if|would|could|after|before|save|create|clear|gain|lose|change|increase|decrease)\b/i.test(value);
  if (!conditionalMove && /\b(?:how much|what(?:'s| is))\b.*\b(?:cap space|cap room)\b|\b(?:cap space|cap room)\b.*\b(?:how much|what(?:'s| is))\b/i.test(value)) {
    return 'cap_space';
  }
  if (/\b(?:starting|starters?|first[- ]team)\b.*\b(?:cornerbacks?|corners?|cbs?)\b|\b(?:cornerbacks?|corners?|cbs?)\b.*\b(?:starting|starters?|first[- ]team)\b/i.test(value)) {
    return 'starting_cornerbacks';
  }
  if (/\b(?:largest|highest|biggest|top)\b.*\b(?:2026\s+)?cap hits?\b|\bcap hits?\b.*\b(?:largest|highest|biggest|top)\b/i.test(value)) {
    return 'largest_cap_hits';
  }
  if (
    /\b(?:show|list|display|give me)\b/i.test(value)
    && /\b(?:wide receivers?|receivers?|wrs?)\b/i.test(value)
    && /\b(?:contracts?|cap hits?|cap numbers?|salar(?:y|ies))\b/i.test(value)
    && !isHistoricalQuestion(value)
  ) {
    return 'wide_receiver_contracts';
  }
  return null;
}

function isHistoricalQuestion(value: string): boolean {
  return /\b(?:historical|history|trend|trends)\b/i.test(value)
    || /\b(?:over|across|during)\s+(?:the\s+)?(?:last|past)\s+(?:\d+\s+years?|decade)\b/i.test(value)
    || /\b(?:since|before|after|from)\s+20\d{2}\b/i.test(value)
    || /\bbetween\s+20\d{2}\s+and\s+20\d{2}\b/i.test(value)
    || /\b(?:compare|compared|versus|vs\.?)\b.*\b20\d{2}\b/i.test(value)
    || /\b20\d{2}\s*(?:-|–|—|to|through)\s*20\d{2}\b/i.test(value);
}

export async function buildNflCurrentAnswer(
  kind: NflCurrentQuestionKind,
  options: { loadTeam?: LoadCurrentNflTeam } = {},
): Promise<PreparedNflCurrentAnswer> {
  if ((kind === 'cap_space' || kind === 'cap_reconciliation') && !options.loadTeam) {
    const captured = await loadCapObservationAnswer();
    if (captured) return captured;
  }
  let loaded: NflCurrentDataLoadResult;
  try {
    loaded = await (options.loadTeam ?? loadCurrentNflTeamDataWithMode)('NYG');
  } catch {
    return unavailableCurrentAnswer(kind);
  }
  if (loaded.source_mode !== 'supabase_current_views') {
    return unavailableCurrentAnswer(kind);
  }
  if (loaded.seed.teams.length !== 1 || loaded.seed.teams[0]?.team_id !== 'NYG') {
    return unavailableCurrentAnswer(kind);
  }
  switch (kind) {
    case 'cap_space': return capSpaceAnswer(loaded.seed);
    case 'cap_reconciliation': return capReconciliationAnswer(loaded.seed);
    case 'starting_cornerbacks': return startingCornerbacksAnswer(loaded.seed);
    case 'largest_cap_hits': return largestCapHitsAnswer(loaded.seed);
    case 'wide_receiver_contracts': return wideReceiverContractsAnswer(loaded.seed);
  }
}

function capReconciliationAnswer(seed: NflDemoSeed): PreparedNflCurrentAnswer {
  const result = capSpaceAnswer(seed);
  const summary = seed.team_cap_summaries?.find(row => row.team_id === 'NYG' && row.season === '2026');
  result.body.answer = summary
    ? `The saved ${readableDate(summary.as_of_date)} figure uses ${summary.accounting_basis}, not a reconciled in-season total for September 10. The loaded sources do not provide every active-roster, practice-squad, reserve-list and league adjustment needed to produce that total.`
    : 'A reconciled in-season Giants cap total is not available in the loaded sources.';
  result.body.key_findings.unshift({ label: 'Reconciliation status', body: 'Not reconciled. No current full-roster cap figure is being inferred from the offseason Top 51 total.', source_refs: result.sources.map(source => source.ref_index) });
  result.body.caveats.unshift('The roster refresh date and the cap accounting date are separate. A later roster refresh does not update the cap total.');
  return result;
}

function capSpaceAnswer(seed: NflDemoSeed): PreparedNflCurrentAnswer {
  const summary = seed.team_cap_summaries?.find((row) => row.team_id === 'NYG' && row.season === '2026');
  if (!summary || summary.source_status !== 'captured') return unavailableCurrentAnswer('cap_space');
  const asOf = readableDate(summary.as_of_date);
  const capSpaceSource = sourceRef(seed, 'overthecap_2026_cap_space_20260903');
  const calculatorSource = sourceRef(seed, 'overthecap_nyg_calculator_20260903');
  const leagueSource = sourceRef(seed, 'nfl_official_2026_salary_cap');
  return {
    body: {
      kind: 'data_analysis',
      answer: `The saved public cap table records ${money(summary.current_cap_space_dollars)} in 2026 cap space as of ${asOf}, under offseason Top 51 accounting. Over The Cap applies a ${money(summary.applied_team_cap_dollars)} team salary cap, with ${money(summary.top_51_cap_spending_dollars)} in Top 51 active spending and ${money(summary.dead_money_dollars)} in dead money.`,
      key_findings: [
        {
          label: 'Recorded 2026 room',
          body: `${money(summary.current_cap_space_dollars)} under ${summary.accounting_basis.toLowerCase()} as of ${asOf}.`,
          source_refs: [1],
        },
        {
          label: 'Team accounting baseline',
          body: `${money(summary.applied_team_cap_dollars)} applied team cap with ${money(summary.dead_money_dollars)} in dead money.`,
          source_refs: [2],
        },
        {
          label: 'League baseline',
          body: `The official 2026 league salary cap is ${money(summary.league_cap_dollars)} before club-specific carryover and adjustments.`,
          source_refs: [3],
        },
      ],
      tables: [],
      calculations: [{
        label: 'Recorded Top 51 cap space',
        formula: `${money(summary.applied_team_cap_dollars)} applied team cap − ${money(summary.top_51_cap_spending_dollars)} Top 51 spending − ${money(summary.dead_money_dollars)} dead money`,
        value: money(summary.current_cap_space_dollars),
        source_refs: [1, 2],
      }],
      caveats: [`This is an offseason Top 51 figure and can change with transactions or league accounting updates. The current public pages expose the applied team cap but do not separately publish the Giants' carryover and other adjustments, so those two component fields remain unavailable rather than inferred.`],
      followups: [],
    },
    sources: [
      {
        ref_index: 1,
        kind: 'CAP',
        source: 'Over The Cap',
        title: 'Giants 2026 cap-space table',
        updated_at: summary.as_of_date,
        data: {
          source_url: capSpaceSource?.url ?? summary.source_urls[0],
          authority_label: 'Current public team cap table',
          contribution: `Establishes New York's ${money(summary.current_cap_space_dollars)} current cap-space figure and its Top 51 active-spending total.`,
          current_team_cap_summary: true,
          rows: [
            { k: 'As of', v: asOf },
            { k: 'Current 2026 cap space', v: money(summary.current_cap_space_dollars) },
            { k: 'Top 51 active spending', v: money(summary.top_51_cap_spending_dollars) },
            { k: 'Dead money', v: money(summary.dead_money_dollars) },
          ],
        },
      },
      {
        ref_index: 2,
        kind: 'CAP',
        source: 'Over The Cap',
        title: 'Giants 2026 cap calculator',
        updated_at: summary.as_of_date,
        data: {
          source_url: calculatorSource?.url ?? summary.source_urls[1],
          authority_label: 'Current public team cap calculator',
          contribution: `Establishes the ${money(summary.applied_team_cap_dollars)} applied team cap, ${money(summary.dead_money_dollars)} existing dead money, and offseason Top 51 accounting basis.`,
          current_team_cap_calculation: true,
          rows: [
            { k: 'Applied team cap', v: money(summary.applied_team_cap_dollars) },
            { k: 'Accounting', v: summary.accounting_basis },
            { k: 'Carryover and adjustments', v: 'Not separately published on the loaded current pages' },
          ],
        },
      },
      {
        ref_index: 3,
        kind: 'RULE',
        source: 'NFL Football Operations',
        title: '2026 league salary cap',
        updated_at: '2026 season',
        data: {
          source_url: leagueSource?.url ?? summary.source_urls[2],
          authority_label: 'Official league source',
          contribution: `Establishes the ${money(summary.league_cap_dollars)} 2026 league salary cap before club-specific carryover and adjustments.`,
          current_league_cap: true,
          rows: [{ k: '2026 league salary cap', v: money(summary.league_cap_dollars) }],
        },
      },
    ],
  };
}

function largestCapHitsAnswer(seed: NflDemoSeed): PreparedNflCurrentAnswer {
  const activeIds = new Set(seed.roster_entries
    .filter((row) => row.team_id === 'NYG' && row.roster_status === 'active')
    .map((row) => row.player_id));
  const rows = seed.cap_rows
    .filter((row) => row.team_id === 'NYG' && row.player_id && activeIds.has(row.player_id) && row.cap_number_2026 != null && row.source_url && supportedCapRow(row))
    .sort((left, right) => right.cap_number_2026! - left.cap_number_2026! || left.player_name.localeCompare(right.player_name))
    .slice(0, 5);
  if (rows.length === 0) return unavailableCurrentAnswer('largest_cap_hits');
  const asOf = readableDate(seed.as_of_date);
  return {
    body: {
      kind: 'data_analysis',
      answer: rows.map((row, index) => `${index + 1}. ${row.player_name} — ${money(row.cap_number_2026!)}`).join('; ') + `. These are the largest loaded Giants 2026 cap hits as of ${asOf}.`,
      key_findings: [],
      tables: [{
        title: 'Largest Giants 2026 cap hits',
        columns: ['Rank', 'Player', 'Position', '2026 cap hit'],
        rows: rows.map((row, index) => [index + 1, row.player_name, row.position ?? '—', money(row.cap_number_2026!)]),
        source_refs: rows.map((_, index) => index + 1),
      }],
      calculations: [],
      caveats: [`Active-roster contract rows in the current public cap sheet as of ${asOf}; this is a cap-hit ranking, not a ranking of salary, cash, or trade value.`],
      followups: [],
    },
    sources: rows.map((row, index) => contractSource(row, seed.as_of_date, index + 1)),
  };
}

function wideReceiverContractsAnswer(seed: NflDemoSeed): PreparedNflCurrentAnswer {
  const activeIds = new Set(seed.roster_entries
    .filter((row) => row.team_id === 'NYG' && row.roster_status === 'active' && row.position === 'WR')
    .map((row) => row.player_id));
  const rows = seed.cap_rows
    .filter((row) => (
      row.team_id === 'NYG'
      && row.player_id
      && activeIds.has(row.player_id)
      && row.position === 'WR'
      && row.cap_number_2026 != null
      && row.source_url
      && supportedCapRow(row)
    ))
    .sort((left, right) => right.cap_number_2026! - left.cap_number_2026! || left.player_name.localeCompare(right.player_name));
  if (rows.length === 0) return unavailableCurrentAnswer('wide_receiver_contracts');

  const asOf = readableDate(seed.as_of_date);
  const totalCapHit = rows.reduce((sum, row) => sum + row.cap_number_2026!, 0);
  return {
    body: {
      kind: 'data_analysis',
      answer: `The loaded Giants roster has ${rows.length} active wide receivers with supported contract rows. Their combined 2026 cap hit is ${money(totalCapHit)} as of ${asOf}.`,
      key_findings: [],
      tables: [{
        title: 'Current Giants wide receiver contracts',
        columns: ['Player', '2026 cap hit', 'Years remaining', 'Guaranteed remaining'],
        rows: rows.map((row) => [
          row.player_name,
          money(row.cap_number_2026!),
          row.contract_years_remaining == null ? 'Not available' : row.contract_years_remaining,
          moneyOrUnavailable(row.guaranteed_remaining),
        ]),
        source_refs: rows.map((_, index) => index + 1),
      }],
      calculations: [{
        label: 'Combined 2026 cap hit',
        formula: rows.map((row) => money(row.cap_number_2026!)).join(' + '),
        value: money(totalCapHit),
        source_refs: rows.map((_, index) => index + 1),
      }],
      caveats: [`This includes active Giants wide receivers with supported rows in the current public cap sheet as of ${asOf}. Unpublished contract fields are shown as unavailable rather than estimated.`],
      followups: [],
    },
    sources: rows.map((row, index) => positionContractSource(row, seed.as_of_date, index + 1)),
  };
}

function startingCornerbacksAnswer(seed: NflDemoSeed): PreparedNflCurrentAnswer {
  const activeCorners = seed.roster_entries.filter((row) => (
    row.team_id === 'NYG'
    && row.roster_status === 'active'
    && (row.position === 'CB' || row.position === 'DB')
  ));
  if (activeCorners.length === 0) return unavailableCurrentAnswer('starting_cornerbacks');
  const metricsByPlayer = new Map(seed.player_metrics.map((row) => [row.player_id, row]));
  const explicit = activeCorners.filter((row) => isExplicitStartingCorner(metricsByPlayer.get(row.player_id)));
  const workingGroup = [...activeCorners].sort((a, b) => a.player_name.localeCompare(b.player_name));
  const asOf = readableDate(seed.as_of_date);
  const explicitNames = explicit.map((row) => row.player_name);
  const nflSource = sourceRef(seed, 'nfl_official_rosters');
  const depthSource = sourceRef(seed, 'nflverse_depth_charts_2026');
  const statsSource = sourceRef(seed, 'nflverse_snap_counts_2025');
  const answer = explicitNames.length > 0
    ? `${joinNames(explicitNames)} ${explicitNames.length === 1 ? 'is' : 'are'} explicitly listed first at a defensive corner position in the loaded depth chart. The source does not establish a complete current starting group.`
    : 'The loaded public depth chart does not identify a complete current first-team Giants cornerback group.';
  return {
    body: {
      kind: 'data_analysis',
      answer: `${answer} Sources are current through ${asOf}.`,
      key_findings: [
        {
          label: 'Current roster',
          body: `${activeCorners.length} active Giants corners were considered.`,
          source_refs: [1],
        },
        {
          label: 'Depth-chart certainty',
          body: explicitNames.length > 0
            ? `${joinNames(explicitNames)} has an explicit first-at-position depth-chart marker; no additional starters are inferred.`
            : 'The current depth-chart source does not provide a complete first-team cornerback group.',
          source_refs: [2],
        },
        {
          label: 'Recorded usage',
          body: 'The table shows recorded 2025 snap and start history; it does not assign a current role.',
          source_refs: [3],
        },
      ],
      tables: [{
        title: 'All loaded active cornerbacks, alphabetical',
        columns: ['Player', 'Recorded 2025 usage'],
        rows: workingGroup.map((row) => [row.player_name, roleSummary(metricsByPlayer.get(row.player_id))]),
        source_refs: [1, 2, 3],
      }],
      calculations: [],
      caveats: ['A club-issued depth chart can change week to week. A starter is not inferred where the public depth chart lacks an explicit designation.'],
      followups: [],
    },
    sources: [
      {
        ref_index: 1,
        kind: 'ROSTER',
        source: 'NFL.com',
        title: 'Current Giants cornerback roster',
        updated_at: seed.as_of_date,
        data: {
          source_url: nflSource?.url ?? seed.teams[0]?.source_url,
          authority_label: 'Official team roster',
          contribution: 'Confirms which cornerbacks are on the current active Giants roster.',
          current_team_roster: true,
          rows: [
            { k: 'As of', v: asOf },
            { k: 'Active cornerbacks considered', v: activeCorners.map((row) => row.player_name).join(', ') },
          ],
        },
      },
      {
        ref_index: 2,
        kind: 'ANALYST_DATA',
        source: 'nflverse',
        title: 'Current defensive depth chart',
        updated_at: seed.as_of_date,
        data: {
          source_url: depthSource?.url,
          authority_label: 'Public depth-chart feed',
          contribution: explicitNames.length > 0
            ? `Explicitly lists ${joinNames(explicitNames)} first at a defensive corner spot; it does not supply a complete starting group.`
            : 'Does not supply a complete current first-team cornerback group for New York.',
          current_team_depth: true,
          rows: [
            { k: 'As of', v: asOf },
            { k: 'Explicit first-at-position cornerbacks', v: explicitNames.length ? explicitNames.join(', ') : 'None in the loaded rows' },
          ],
        },
      },
      {
        ref_index: 3,
        kind: 'STATS',
        source: 'nflverse',
        title: 'Recent role and snap history',
        updated_at: '2025 season',
        data: {
          source_url: statsSource?.url,
          authority_label: 'Public snap and start data',
          contribution: 'Records historical usage without assigning a current starting role.',
          current_team_role_history: true,
          rows: workingGroup.map((row) => {
            const metric = metricsByPlayer.get(row.player_id);
            return { k: row.player_name, v: roleSummary(metric) };
          }),
        },
      },
    ],
  };
}

function contractSource(row: NflCapRow, asOfDate: string, refIndex: number): Omit<BriefSource, 'id' | 'brief_id'> {
  return {
    ref_index: refIndex,
    kind: 'CONTRACT',
    source: 'OverTheCap',
    title: `${row.player_name} — 2026 cap hit`,
    updated_at: asOfDate,
    data: {
      source_url: row.source_url,
      authority_label: 'Public player contract source',
      contribution: `Establishes ${row.player_name}'s ${money(row.cap_number_2026!)} 2026 cap hit used in the ranking.`,
      current_team_contract: true,
      rows: [
        { k: 'As of', v: readableDate(asOfDate) },
        { k: 'Player', v: row.player_name },
        { k: '2026 cap hit', v: money(row.cap_number_2026!) },
        { k: 'Contract confidence', v: confidenceLabel(row.contract_ledger_confidence) },
      ],
    },
  };
}

function positionContractSource(row: NflCapRow, asOfDate: string, refIndex: number): Omit<BriefSource, 'id' | 'brief_id'> {
  return {
    ref_index: refIndex,
    kind: 'CONTRACT',
    source: 'OverTheCap',
    title: `${row.player_name} — current contract`,
    updated_at: asOfDate,
    data: {
      source_url: row.source_url,
      authority_label: 'Public player contract source',
      contribution: `Establishes the contract figures shown for ${row.player_name}.`,
      current_team_contract: true,
      current_position_contract_group: 'WR',
      rows: [
        { k: 'As of', v: readableDate(asOfDate) },
        { k: 'Player', v: row.player_name },
        { k: 'Position', v: row.position ?? 'WR' },
        { k: '2026 cap hit', v: money(row.cap_number_2026!) },
        { k: 'Contract terms', v: row.contract_years_remaining == null ? 'Not available' : `${row.contract_years_remaining} year${row.contract_years_remaining === 1 ? '' : 's'} remaining` },
        { k: 'Guaranteed remaining', v: moneyOrUnavailable(row.guaranteed_remaining) },
        { k: 'Contract confidence', v: confidenceLabel(row.contract_ledger_confidence) },
      ],
    },
  };
}

function supportedCapRow(row: NflCapRow): boolean {
  return row.source_status === 'captured'
    && (row.contract_ledger_confidence === 'captured' || row.contract_ledger_confidence === 'derived');
}

function isExplicitStartingCorner(metric: NflPlayerMetricRow | undefined): boolean {
  if (!metric || metric.source_status !== 'captured' || metric.position_metrics?.depth_chart_pos_rank !== 1) return false;
  const flags = new Set(metric.quality_flags ?? []);
  return [...flags].some((flag) => /^depth_chart_position_(?:lcb|rcb|nb|cb)$/.test(flag));
}

function roleSummary(metric: NflPlayerMetricRow | undefined): string {
  if (!metric) return 'no recent snap record';
  const parts = [
    metric.starts_2025 != null ? `${metric.starts_2025} starts` : null,
    metric.defense_snaps_2025 != null ? `${metric.defense_snaps_2025} defensive snaps` : null,
  ].filter((value): value is string => Boolean(value));
  return parts.length ? parts.join(', ') : 'no recent defensive snap total';
}

function unavailableCurrentAnswer(kind: NflCurrentQuestionKind): PreparedNflCurrentAnswer {
  const subject = kind === 'cap_space'
    ? 'current Giants cap information'
    : kind === 'starting_cornerbacks'
      ? 'current Giants roster and depth-chart information'
      : 'current Giants contract information';
  return {
    body: {
      kind: 'data_analysis',
      answer: `I cannot answer that reliably because the ${subject} is not available from the local database right now.`,
      key_findings: [],
      tables: [],
      calculations: [],
      caveats: ['No current figure, ranking, or lineup is being inferred from an older fallback file.'],
      followups: [],
    },
    sources: [],
  };
}

function sourceRef(seed: NflDemoSeed, id: string) {
  return seed.source_refs.find((source) => source.id === id) ?? null;
}

function confidenceLabel(value: NflCapRow['contract_ledger_confidence']): string {
  if (value === 'captured') return 'Directly priced in the current cap file';
  if (value === 'derived') return 'Calculated from the loaded contract schedule';
  return 'Needs source review';
}

function money(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

function moneyOrUnavailable(value: number | null): string {
  return value == null ? 'Not available' : money(value);
}

function readableDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, day)));
}

function joinNames(names: string[]): string {
  if (names.length < 2) return names[0] ?? 'no player';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}`;
}
