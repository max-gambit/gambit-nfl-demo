import type {
  NflMarketDirection,
  NflPositionMarketGroup,
  NflPositionMarketTrend,
  NflTradeCompensationBand,
  NflTransactionComparable,
  NflTransactionMarketAnalysis,
  NflTransactionMarketRequest,
  NflTransactionMarketResolvedQuery,
  NflTransactionMarketSignal,
  NflTransactionMarketSourceRef,
  NflTransactionMarketStatus,
  NflTransactionMarketYearPoint,
  NflTransactionType,
} from '@shared/types';

const DEFAULT_START_YEAR = 2016;
const DEFAULT_END_YEAR = 2025;
const CURRENT_YTD_YEAR = 2026;
const EARLIEST_SUPPORTED_YEAR = 1994;

const POSITION_GROUPS: readonly NflPositionMarketGroup[] = [
  'QB', 'RB', 'WR', 'TE', 'OT', 'IOL', 'EDGE', 'IDL', 'LB', 'CB', 'S', 'ST',
];

const MATERIAL_TRANSACTION_TYPES: readonly NflTransactionType[] = [
  'trade', 'free_agent_signing', 're_signing', 'extension', 'tag', 'waiver_claim', 'release',
];

const CONTRACT_TRANSACTION_TYPES = new Set<NflTransactionType>([
  'free_agent_signing', 're_signing', 'extension', 'tag',
]);

const ALL_TRANSACTION_TYPES = new Set<NflTransactionType>([
  ...MATERIAL_TRANSACTION_TYPES, 'other',
]);

const ANALYSIS_MODES = new Set<NflTransactionMarketRequest['analysis_mode']>([
  'ten_year_trend', 'period_comparison', 'comparables', 'recent_influence',
]);

const ALL_POSITION_GROUPS = new Set<NflPositionMarketGroup>(POSITION_GROUPS);
const ALL_COMPENSATION_BANDS = new Set<NflTradeCompensationBand>([
  'round_1', 'rounds_2_3', 'rounds_4_7', 'player_only', 'unknown',
]);

type IdentityConfidence = NflTransactionComparable['identity_confidence'];

/**
 * A single player-level material move. Trade rows must state the total number
 * of player assets in the whole deal before compensation can be allocated to
 * the row. Dollar fields are deliberately integer-only.
 */
export interface NflTransactionMarketEvent {
  event_id: string;
  event_year: number;
  event_date: string | null;
  date_precision: 'day' | 'year';
  transaction_type: NflTransactionType;
  player_id: string | null;
  player_name: string;
  position_group: NflPositionMarketGroup | null;
  from_team_id: string | null;
  to_team_id: string | null;
  contract_value_dollars: number | null;
  contract_apy_dollars: number | null;
  guaranteed_dollars: number | null;
  /** Optional event-local cap, checked against a snapshot cap row when both exist. */
  league_cap_dollars?: number | null;
  /** Pick rounds returning for the player side of a trade. */
  compensation_pick_rounds?: number[];
  compensation_includes_player?: boolean;
  /** Total player assets on both sides of the trade. Exactly one is allocable. */
  trade_player_asset_count?: number | null;
  /** Optional governed upstream band; raw pick rounds take precedence. */
  compensation_band?: NflTradeCompensationBand | null;
  compensation_summary: string | null;
  identity_confidence: IdentityConfidence;
  source_ref_ids: string[];
}

export interface NflTransactionRosterPlayerSeason {
  year: number;
  team_id: string | null;
  position_group: NflPositionMarketGroup;
  roster_player_seasons: number;
  source_ref_ids?: string[];
}

export interface NflTransactionLeagueCap {
  year: number;
  league_cap_dollars: number;
  source_ref_ids?: string[];
}

export interface NflTransactionMarketSnapshot {
  snapshot_id: string;
  events: NflTransactionMarketEvent[];
  roster_player_seasons: NflTransactionRosterPlayerSeason[];
  league_caps: NflTransactionLeagueCap[];
  source_refs: NflTransactionMarketSourceRef[];
}

export type LoadNflTransactionMarketSnapshot = () => Promise<NflTransactionMarketSnapshot>;

export interface NflTransactionMarketThresholds {
  supported_identity_basis_points: number;
  directional_identity_basis_points: number;
  minimum_events_overall: number;
  minimum_events_per_period: number;
  minimum_allocable_trades_per_period: number;
  minimum_priced_contracts_per_period: number;
  flat_relative_change_basis_points: number;
}

export const DEFAULT_NFL_TRANSACTION_MARKET_THRESHOLDS: Readonly<NflTransactionMarketThresholds> = {
  supported_identity_basis_points: 9_500,
  directional_identity_basis_points: 8_500,
  minimum_events_overall: 20,
  minimum_events_per_period: 5,
  minimum_allocable_trades_per_period: 5,
  minimum_priced_contracts_per_period: 10,
  flat_relative_change_basis_points: 500,
};

export interface AnalyzeNflTransactionMarketOptions {
  snapshot?: NflTransactionMarketSnapshot;
  loadSnapshot?: LoadNflTransactionMarketSnapshot;
  generatedAt?: Date | string;
  thresholds?: Partial<NflTransactionMarketThresholds>;
}

export interface AnalyzeNflTransactionMarketSnapshotOptions {
  generatedAt?: Date | string;
  thresholds?: Partial<NflTransactionMarketThresholds>;
}

/** Async boundary for production snapshot injection. The calculation below it is pure. */
export async function analyzeNflTransactionMarket(
  request: NflTransactionMarketRequest,
  options: AnalyzeNflTransactionMarketOptions,
): Promise<NflTransactionMarketAnalysis> {
  if (options.snapshot && options.loadSnapshot) {
    throw new Error('Provide snapshot or loadSnapshot, not both');
  }
  const snapshot = options.snapshot ?? await options.loadSnapshot?.();
  if (!snapshot) throw new Error('An NFL transaction-market snapshot loader is required');
  return analyzeNflTransactionMarketSnapshot(request, snapshot, options);
}

export function createNflTransactionMarketAnalyzer(loader: LoadNflTransactionMarketSnapshot) {
  return (
    request: NflTransactionMarketRequest,
    options: Omit<AnalyzeNflTransactionMarketOptions, 'snapshot' | 'loadSnapshot'> = {},
  ) => analyzeNflTransactionMarket(request, { ...options, loadSnapshot: loader });
}

/** Pure deterministic calculation for a frozen snapshot, request, clock, and thresholds. */
export function analyzeNflTransactionMarketSnapshot(
  request: NflTransactionMarketRequest,
  snapshot: NflTransactionMarketSnapshot,
  options: AnalyzeNflTransactionMarketSnapshotOptions = {},
): NflTransactionMarketAnalysis {
  validateSnapshot(snapshot);
  const query = resolveNflTransactionMarketQuery(request);
  const thresholds = resolveThresholds(options.thresholds);
  const generatedAt = normalizeGeneratedAt(options.generatedAt, snapshot);
  const capByYear = leagueCapMap(snapshot);
  const leagueEvents = snapshot.events.filter((event) => matchesLeagueScope(event, query));
  const cohortEvents = leagueEvents.filter((event) => matchesCohort(event, query));
  const yearlySeries = buildYearlySeries(snapshot, query, leagueEvents, cohortEvents, capByYear);
  const positionTrends = query.position_groups.map((position) => buildPositionTrend(
    position, snapshot, query, leagueEvents, cohortEvents, capByYear, thresholds,
  ));
  const coverage = buildCoverage(snapshot, query, cohortEvents, capByYear);
  const comparables = [...cohortEvents]
    .sort((a, b) => compareComparableEvents(a, b, query, capByYear))
    .slice(0, query.max_comparables)
    .map((event) => comparableFromEvent(event, capByYear));
  const influentialTransactions = buildInfluentialTransactions(
    snapshot, query, leagueEvents, cohortEvents, capByYear,
  ).slice(0, query.max_comparables);
  const status = analysisStatus(positionTrends);

  return {
    schema_version: 'nfl_transaction_market.v1',
    analysis_id: analysisId(snapshot, query, thresholds),
    generated_at: generatedAt,
    snapshot_id: snapshot.snapshot_id,
    status,
    query,
    coverage,
    methodology: methodology(query, thresholds),
    yearly_series: yearlySeries,
    position_trends: positionTrends,
    comparables,
    influential_transactions: influentialTransactions,
    source_refs: usedSourceRefs(snapshot, query, cohortEvents),
    limitations: limitations(snapshot, query, cohortEvents, capByYear, status),
  };
}

export function resolveNflTransactionMarketQuery(
  request: NflTransactionMarketRequest,
): NflTransactionMarketResolvedQuery {
  if (!request || typeof request !== 'object') throw new Error('request body required');
  if (!ANALYSIS_MODES.has(request.analysis_mode)) throw new Error('analysis_mode is unsupported');
  const includeYtd = request.include_ytd === true;
  const startYear = request.start_year ?? DEFAULT_START_YEAR;
  let endYear = request.end_year ?? (includeYtd ? CURRENT_YTD_YEAR : DEFAULT_END_YEAR);
  assertYear(startYear, 'start_year');
  assertYear(endYear, 'end_year');
  if (!includeYtd && endYear === CURRENT_YTD_YEAR) endYear = DEFAULT_END_YEAR;
  if (startYear >= endYear) {
    throw new Error('transaction-market analysis requires at least two ordered league years');
  }
  if (includeYtd && endYear !== CURRENT_YTD_YEAR) {
    throw new Error(`include_ytd requires end_year ${CURRENT_YTD_YEAR}`);
  }

  const comparisonYear = request.comparison_year ?? null;
  if (comparisonYear != null) {
    assertYear(comparisonYear, 'comparison_year');
    if (comparisonYear < startYear || comparisonYear >= endYear) {
      throw new Error('comparison_year must fall between start_year and the year before end_year');
    }
  }

  const positionGroups = canonicalValues(
    request.position_groups,
    POSITION_GROUPS,
    ALL_POSITION_GROUPS,
    'position_groups',
  );
  const transactionTypes = canonicalValues(
    request.transaction_types,
    MATERIAL_TRANSACTION_TYPES,
    ALL_TRANSACTION_TYPES,
    'transaction_types',
  );
  const teamIds = [...new Set((request.team_ids ?? [])
    .map((team) => team.trim().toUpperCase())
    .filter(Boolean))].sort();
  const maxComparables = request.max_comparables ?? 12;
  if (!Number.isSafeInteger(maxComparables) || maxComparables < 1 || maxComparables > 50) {
    throw new Error('max_comparables must be an integer from 1 through 50');
  }

  const [baselineYears, recentYears] = resolvePeriods(
    startYear, endYear, request.analysis_mode, comparisonYear,
  );
  return {
    analysis_mode: request.analysis_mode,
    start_year: startYear,
    end_year: endYear,
    baseline_years: baselineYears,
    recent_years: recentYears,
    comparison_year: comparisonYear,
    team_ids: teamIds,
    position_groups: positionGroups,
    transaction_types: transactionTypes,
    include_ytd: includeYtd,
    max_comparables: maxComparables,
  };
}

function resolvePeriods(
  startYear: number,
  endYear: number,
  mode: NflTransactionMarketRequest['analysis_mode'],
  comparisonYear: number | null,
): [[number, number], [number, number]] {
  if (comparisonYear != null) {
    return [[startYear, comparisonYear], [comparisonYear + 1, endYear]];
  }
  if (mode === 'period_comparison') {
    const midpoint = Math.floor((startYear + endYear) / 2);
    return [[startYear, midpoint], [midpoint + 1, endYear]];
  }
  const available = endYear - startYear + 1;
  const window = Math.min(3, Math.floor(available / 2));
  return [[startYear, startYear + window - 1], [endYear - window + 1, endYear]];
}

function buildYearlySeries(
  snapshot: NflTransactionMarketSnapshot,
  query: NflTransactionMarketResolvedQuery,
  leagueEvents: NflTransactionMarketEvent[],
  cohortEvents: NflTransactionMarketEvent[],
  capByYear: ReadonlyMap<number, number>,
): NflTransactionMarketYearPoint[] {
  const points: NflTransactionMarketYearPoint[] = [];
  for (let year = query.start_year; year <= query.end_year; year += 1) {
    const leagueCount = leagueEvents.filter((event) => event.event_year === year).length;
    for (const position of query.position_groups) {
      const events = cohortEvents.filter((event) => event.event_year === year && event.position_group === position);
      const playerSeasons = rosterDenominator(snapshot, query, year, position);
      const contractPrices = events.map((event) => contractApyCapBasisPoints(event, capByYear))
        .filter(isNumber);
      points.push({
        year,
        position_group: position,
        event_count: events.length,
        roster_player_seasons: playerSeasons,
        mobility_per_100_basis_points: rateBasisPoints(events.length, playerSeasons),
        transaction_share_basis_points: rateBasisPoints(events.length, leagueCount),
        trade_count: events.filter((event) => event.transaction_type === 'trade').length,
        median_contract_apy_cap_basis_points: medianInteger(contractPrices),
      });
    }
  }
  return points;
}

function buildPositionTrend(
  position: NflPositionMarketGroup,
  snapshot: NflTransactionMarketSnapshot,
  query: NflTransactionMarketResolvedQuery,
  leagueEvents: NflTransactionMarketEvent[],
  cohortEvents: NflTransactionMarketEvent[],
  capByYear: ReadonlyMap<number, number>,
  thresholds: Readonly<NflTransactionMarketThresholds>,
): NflPositionMarketTrend {
  const events = cohortEvents.filter((event) => event.position_group === position);
  const baselineEvents = events.filter((event) => inPeriod(event.event_year, query.baseline_years));
  const recentEvents = events.filter((event) => inPeriod(event.event_year, query.recent_years));
  const baselineLeagueCount = leagueEvents.filter((event) => inPeriod(event.event_year, query.baseline_years)).length;
  const recentLeagueCount = leagueEvents.filter((event) => inPeriod(event.event_year, query.recent_years)).length;
  const baselineDenominator = periodRosterDenominator(snapshot, query, position, query.baseline_years);
  const recentDenominator = periodRosterDenominator(snapshot, query, position, query.recent_years);

  const mobility = buildStandardSignal({
    baselineValue: rateBasisPoints(baselineEvents.length, baselineDenominator),
    recentValue: rateBasisPoints(recentEvents.length, recentDenominator),
    baselineEvents,
    recentEvents,
    overallEvents: events,
    minimumOverall: thresholds.minimum_events_overall,
    minimumPerPeriod: thresholds.minimum_events_per_period,
    unit: 'events_per_100_player_seasons',
    label: 'Mobility',
    thresholds,
    detail: `Roster denominators are ${baselineDenominator} and ${recentDenominator} player-seasons.`,
  });
  const transactionShare = buildStandardSignal({
    baselineValue: rateBasisPoints(baselineEvents.length, baselineLeagueCount),
    recentValue: rateBasisPoints(recentEvents.length, recentLeagueCount),
    baselineEvents,
    recentEvents,
    overallEvents: events,
    minimumOverall: thresholds.minimum_events_overall,
    minimumPerPeriod: thresholds.minimum_events_per_period,
    unit: 'transaction_share_basis_points',
    label: 'League material-move share',
    thresholds,
    detail: `League move denominators are ${baselineLeagueCount} and ${recentLeagueCount} events.`,
  });
  const contractPrice = buildContractSignal(events, baselineEvents, recentEvents, capByYear, thresholds);
  const tradeCompensation = buildCompensationSignal(events, baselineEvents, recentEvents, thresholds);
  const classification = classifySignals([mobility, transactionShare, contractPrice, tradeCompensation]);

  return {
    position_group: position,
    status: classification.status,
    direction: classification.direction,
    event_count: events.length,
    mobility,
    transaction_share: transactionShare,
    contract_price: contractPrice,
    trade_compensation: tradeCompensation,
  };
}

interface StandardSignalArgs {
  baselineValue: number | null;
  recentValue: number | null;
  baselineEvents: NflTransactionMarketEvent[];
  recentEvents: NflTransactionMarketEvent[];
  overallEvents: NflTransactionMarketEvent[];
  minimumOverall: number;
  minimumPerPeriod: number;
  unit: NflTransactionMarketSignal['unit'];
  label: string;
  thresholds: Readonly<NflTransactionMarketThresholds>;
  detail: string;
}

function buildStandardSignal(args: StandardSignalArgs): NflTransactionMarketSignal {
  const gate = signalGate(
    args.overallEvents,
    args.baselineEvents,
    args.recentEvents,
    args.minimumOverall,
    args.minimumPerPeriod,
    args.thresholds,
  );
  const comparable = args.baselineValue != null && args.recentValue != null;
  const status = comparable ? gate : 'insufficient_evidence';
  const direction = status === 'insufficient_evidence'
    ? 'insufficient_evidence'
    : numericDirection(args.baselineValue!, args.recentValue!, args.thresholds.flat_relative_change_basis_points);
  return {
    status,
    direction,
    baseline_value: args.baselineValue,
    recent_value: args.recentValue,
    relative_change_basis_points: comparable ? relativeChangeBasisPoints(args.baselineValue!, args.recentValue!) : null,
    sample_size: args.baselineEvents.length + args.recentEvents.length,
    unit: args.unit,
    explanation: `${args.label} uses ${args.baselineEvents.length} baseline and ${args.recentEvents.length} recent observations. ${args.detail} Exact identity coverage is ${formatBps(identityBasisPoints(args.baselineEvents))} and ${formatBps(identityBasisPoints(args.recentEvents))}.`,
  };
}

function buildContractSignal(
  allEvents: NflTransactionMarketEvent[],
  baselineEvents: NflTransactionMarketEvent[],
  recentEvents: NflTransactionMarketEvent[],
  capByYear: ReadonlyMap<number, number>,
  thresholds: Readonly<NflTransactionMarketThresholds>,
): NflTransactionMarketSignal {
  const allPriced = allEvents.filter((event) => contractApyCapBasisPoints(event, capByYear) != null);
  const baselinePriced = baselineEvents.filter((event) => contractApyCapBasisPoints(event, capByYear) != null);
  const recentPriced = recentEvents.filter((event) => contractApyCapBasisPoints(event, capByYear) != null);
  const baselineGuarantees = baselineEvents.filter((event) => guaranteedShareBasisPoints(event) != null);
  const recentGuarantees = recentEvents.filter((event) => guaranteedShareBasisPoints(event) != null);
  const baselineValue = medianInteger(baselinePriced.map((event) => contractApyCapBasisPoints(event, capByYear)!).filter(isNumber));
  const recentValue = medianInteger(recentPriced.map((event) => contractApyCapBasisPoints(event, capByYear)!).filter(isNumber));
  const baselineGuarantee = medianInteger(baselineGuarantees.map((event) => guaranteedShareBasisPoints(event)!).filter(isNumber));
  const recentGuarantee = medianInteger(recentGuarantees.map((event) => guaranteedShareBasisPoints(event)!).filter(isNumber));
  const apyGate = signalGate(
    allPriced,
    baselinePriced, recentPriced,
    thresholds.minimum_priced_contracts_per_period * 2,
    thresholds.minimum_priced_contracts_per_period,
    thresholds,
  );
  const guaranteeGate = signalGate(
    allEvents.filter((event) => guaranteedShareBasisPoints(event) != null),
    baselineGuarantees, recentGuarantees,
    thresholds.minimum_priced_contracts_per_period * 2,
    thresholds.minimum_priced_contracts_per_period,
    thresholds,
  );
  const hasApyComparison = baselineValue != null && recentValue != null;
  let status: NflTransactionMarketStatus = hasApyComparison ? apyGate : 'insufficient_evidence';
  if (status === 'supported' && guaranteeGate !== 'supported') status = 'directional';
  const apyDirection: NflMarketDirection = status === 'insufficient_evidence'
    ? 'insufficient_evidence'
    : numericDirection(baselineValue!, recentValue!, thresholds.flat_relative_change_basis_points);
  const guaranteeDirection = guaranteeGate === 'insufficient_evidence' || baselineGuarantee == null || recentGuarantee == null
    ? null
    : numericDirection(baselineGuarantee, recentGuarantee, thresholds.flat_relative_change_basis_points);
  const contractDirections: NflMarketDirection[] = [apyDirection];
  if (guaranteeDirection !== null) contractDirections.push(guaranteeDirection);
  const conflicts = directionalConflict(contractDirections);
  if (conflicts && status !== 'insufficient_evidence') status = 'directional';
  const direction: NflMarketDirection = status === 'insufficient_evidence'
    ? 'insufficient_evidence'
    : conflicts ? 'mixed' : apyDirection;
  const guaranteeDetail = baselineGuarantee == null || recentGuarantee == null
    ? 'Guaranteed-share medians are unavailable for one or both periods.'
    : `Median guaranteed share is ${formatBps(baselineGuarantee)} then ${formatBps(recentGuarantee)}.`;
  return {
    status,
    direction,
    baseline_value: baselineValue,
    recent_value: recentValue,
    relative_change_basis_points: hasApyComparison ? relativeChangeBasisPoints(baselineValue!, recentValue!) : null,
    sample_size: baselinePriced.length + recentPriced.length,
    unit: 'apy_cap_basis_points',
    explanation: `Contract price is the median APY divided by that league year's integer-dollar cap, using ${baselinePriced.length} baseline and ${recentPriced.length} recent contracts. ${guaranteeDetail}`,
  };
}

function buildCompensationSignal(
  allEvents: NflTransactionMarketEvent[],
  baselineEvents: NflTransactionMarketEvent[],
  recentEvents: NflTransactionMarketEvent[],
  thresholds: Readonly<NflTransactionMarketThresholds>,
): NflTransactionMarketSignal {
  const allTrades = allEvents.filter((event) => allocableCompensationBand(event) != null);
  const baselineTrades = baselineEvents.filter((event) => allocableCompensationBand(event) != null);
  const recentTrades = recentEvents.filter((event) => allocableCompensationBand(event) != null);
  const baselineMix = compensationMix(baselineTrades);
  const recentMix = compensationMix(recentTrades);
  return buildStandardSignal({
    baselineValue: premiumCompensationShare(baselineMix),
    recentValue: premiumCompensationShare(recentMix),
    baselineEvents: baselineTrades,
    recentEvents: recentTrades,
    overallEvents: allTrades,
    minimumOverall: thresholds.minimum_allocable_trades_per_period * 2,
    minimumPerPeriod: thresholds.minimum_allocable_trades_per_period,
    unit: 'compensation_band_mix',
    label: 'Trade compensation',
    thresholds,
    detail: `Baseline bands: ${formatCompensationMix(baselineMix)}. Recent bands: ${formatCompensationMix(recentMix)}. The compared statistic is the round 1 plus rounds 2–3 share; multi-player and unknown allocations are excluded.`,
  });
}

function classifySignals(signals: NflTransactionMarketSignal[]): {
  status: NflTransactionMarketStatus;
  direction: NflMarketDirection;
} {
  const usable = signals.filter((signal) => signal.status !== 'insufficient_evidence');
  if (usable.length === 0) return { status: 'insufficient_evidence', direction: 'insufficient_evidence' };
  if (usable.some((signal) => signal.direction === 'mixed') || directionalConflict(usable.map((signal) => signal.direction))) {
    return { status: 'directional', direction: 'mixed' };
  }
  const supported = usable.filter((signal) => signal.status === 'supported');
  for (const direction of ['growing', 'shrinking'] as const) {
    if (supported.filter((signal) => signal.direction === direction).length >= 2) {
      return { status: 'supported', direction };
    }
  }
  if (supported.filter((signal) => signal.direction === 'flat').length >= 2
    && usable.every((signal) => signal.direction === 'flat')) {
    return { status: 'supported', direction: 'flat' };
  }
  const nonFlat = usable.find((signal) => signal.direction === 'growing' || signal.direction === 'shrinking');
  return { status: 'directional', direction: nonFlat?.direction ?? 'flat' };
}

function buildCoverage(
  snapshot: NflTransactionMarketSnapshot,
  query: NflTransactionMarketResolvedQuery,
  events: NflTransactionMarketEvent[],
  capByYear: ReadonlyMap<number, number>,
): NflTransactionMarketAnalysis['coverage'] {
  const typeCoverage: Partial<Record<NflTransactionType, number>> = {};
  for (const event of events) typeCoverage[event.transaction_type] = (typeCoverage[event.transaction_type] ?? 0) + 1;
  const matched = events.filter((event) => event.identity_confidence === 'matched').length;
  const dated = events.map((event) => event.event_date).filter(isString).sort();
  return {
    event_count: events.length,
    trade_count: events.filter((event) => event.transaction_type === 'trade').length,
    contract_count: events.filter((event) => CONTRACT_TRANSACTION_TYPES.has(event.transaction_type)).length,
    roster_player_seasons: query.position_groups.reduce((total, position) => (
      total + periodRosterDenominator(snapshot, query, position, [query.start_year, query.end_year])
    ), 0),
    matched_position_count: matched,
    position_match_basis_points: events.length === 0 ? 0 : Math.round((matched / events.length) * 10_000),
    allocable_trade_count: events.filter((event) => allocableCompensationBand(event) != null).length,
    priced_contract_count: events.filter((event) => contractApyCapBasisPoints(event, capByYear) != null).length,
    latest_event_date: dated.at(-1) ?? null,
    type_coverage: typeCoverage,
  };
}

function buildInfluentialTransactions(
  snapshot: NflTransactionMarketSnapshot,
  query: NflTransactionMarketResolvedQuery,
  leagueEvents: NflTransactionMarketEvent[],
  cohortEvents: NflTransactionMarketEvent[],
  capByYear: ReadonlyMap<number, number>,
): NflTransactionComparable[] {
  const recentEvents = cohortEvents.filter((event) => inPeriod(event.event_year, query.recent_years));
  const originalByPosition = new Map(query.position_groups.map((position) => [
    position,
    recentStatistics(position, snapshot, query, leagueEvents, cohortEvents, capByYear),
  ]));
  return recentEvents.flatMap((event) => {
    if (!event.position_group) return [];
    const withoutLeague = leagueEvents.filter((candidate) => candidate.event_id !== event.event_id);
    const withoutCohort = cohortEvents.filter((candidate) => candidate.event_id !== event.event_id);
    const original = originalByPosition.get(event.position_group);
    if (!original) return [];
    const removed = recentStatistics(event.position_group, snapshot, query, withoutLeague, withoutCohort, capByYear);
    const deltas = (Object.keys(original) as Array<keyof RecentStatistics>).flatMap((key) => {
      const before = original[key];
      const after = removed[key];
      return before == null || after == null ? [] : [{ key, delta: Math.abs(before - after) }];
    }).sort((a, b) => b.delta - a.delta || a.key.localeCompare(b.key));
    const largest = deltas[0];
    if (!largest || largest.delta === 0) return [];
    return [comparableFromEvent(event, capByYear, largest.delta,
      `Removing this observation changes the ${statisticLabel(largest.key)} recent-period statistic by ${largest.delta} basis points. This is leave-one-out statistical sensitivity, not a causal estimate.`)];
  }).sort((a, b) => (
    (b.influence_basis_points ?? 0) - (a.influence_basis_points ?? 0)
    || b.event_year - a.event_year
    || (b.event_date ?? '').localeCompare(a.event_date ?? '')
    || a.event_id.localeCompare(b.event_id)
  ));
}

interface RecentStatistics {
  mobility: number | null;
  transaction_share: number | null;
  contract_price: number | null;
  trade_compensation: number | null;
}

function recentStatistics(
  position: NflPositionMarketGroup,
  snapshot: NflTransactionMarketSnapshot,
  query: NflTransactionMarketResolvedQuery,
  leagueEvents: NflTransactionMarketEvent[],
  cohortEvents: NflTransactionMarketEvent[],
  capByYear: ReadonlyMap<number, number>,
): RecentStatistics {
  const events = cohortEvents.filter((event) => event.position_group === position && inPeriod(event.event_year, query.recent_years));
  const leagueCount = leagueEvents.filter((event) => inPeriod(event.event_year, query.recent_years)).length;
  const denom = periodRosterDenominator(snapshot, query, position, query.recent_years);
  const contractPrices = events.map((event) => contractApyCapBasisPoints(event, capByYear)).filter(isNumber);
  const tradeMix = compensationMix(events.filter((event) => allocableCompensationBand(event) != null));
  return {
    mobility: rateBasisPoints(events.length, denom),
    transaction_share: rateBasisPoints(events.length, leagueCount),
    contract_price: medianInteger(contractPrices),
    trade_compensation: premiumCompensationShare(tradeMix),
  };
}

function comparableFromEvent(
  event: NflTransactionMarketEvent,
  capByYear: ReadonlyMap<number, number>,
  influenceBasisPoints: number | null = null,
  influenceExplanation: string | null = null,
): NflTransactionComparable {
  const band = allocableCompensationBand(event);
  const multiPlayer = event.transaction_type === 'trade'
    && event.trade_player_asset_count != null
    && event.trade_player_asset_count !== 1;
  const compensationSummary = multiPlayer
    ? [event.compensation_summary, 'Multi-player deal; compensation is not allocated per player.'].filter(isString).join(' ') || null
    : event.compensation_summary;
  return {
    event_id: event.event_id,
    event_year: event.event_year,
    event_date: event.event_date,
    date_precision: event.date_precision,
    transaction_type: event.transaction_type,
    player_id: event.player_id,
    player_name: event.player_name,
    position_group: event.position_group,
    from_team_id: event.from_team_id,
    to_team_id: event.to_team_id,
    contract_value_dollars: event.contract_value_dollars,
    contract_apy_dollars: event.contract_apy_dollars,
    guaranteed_dollars: event.guaranteed_dollars,
    apy_cap_basis_points: contractApyCapBasisPoints(event, capByYear),
    compensation_band: band,
    compensation_summary: compensationSummary,
    identity_confidence: event.identity_confidence,
    influence_basis_points: influenceBasisPoints,
    influence_explanation: influenceExplanation,
    source_ref_ids: [...event.source_ref_ids].sort(),
  };
}

function compareComparableEvents(
  a: NflTransactionMarketEvent,
  b: NflTransactionMarketEvent,
  query: NflTransactionMarketResolvedQuery,
  capByYear: ReadonlyMap<number, number>,
): number {
  const aRecent = inPeriod(a.event_year, query.recent_years) ? 1 : 0;
  const bRecent = inPeriod(b.event_year, query.recent_years) ? 1 : 0;
  const identityRank: Record<IdentityConfidence, number> = { matched: 2, directional: 1, unmatched: 0 };
  const aPrice = contractApyCapBasisPoints(a, capByYear) != null || allocableCompensationBand(a) != null ? 1 : 0;
  const bPrice = contractApyCapBasisPoints(b, capByYear) != null || allocableCompensationBand(b) != null ? 1 : 0;
  return bRecent - aRecent
    || identityRank[b.identity_confidence] - identityRank[a.identity_confidence]
    || bPrice - aPrice
    || b.event_year - a.event_year
    || (b.event_date ?? '').localeCompare(a.event_date ?? '')
    || a.event_id.localeCompare(b.event_id);
}

function allocableCompensationBand(event: NflTransactionMarketEvent): NflTradeCompensationBand | null {
  if (event.transaction_type !== 'trade' || event.trade_player_asset_count !== 1) return null;
  const rounds = event.compensation_pick_rounds ?? [];
  if (rounds.some((round) => round === 1)) return 'round_1';
  if (rounds.some((round) => round === 2 || round === 3)) return 'rounds_2_3';
  if (rounds.some((round) => round >= 4 && round <= 7)) return 'rounds_4_7';
  if (event.compensation_includes_player === true) return 'player_only';
  return event.compensation_band && event.compensation_band !== 'unknown' ? event.compensation_band : null;
}

type CompensationMix = Record<NflTradeCompensationBand, number>;

function compensationMix(events: NflTransactionMarketEvent[]): CompensationMix {
  const mix: CompensationMix = { round_1: 0, rounds_2_3: 0, rounds_4_7: 0, player_only: 0, unknown: 0 };
  for (const event of events) {
    const band = allocableCompensationBand(event);
    if (band) mix[band] += 1;
  }
  return mix;
}

function premiumCompensationShare(mix: CompensationMix): number | null {
  const total = Object.values(mix).reduce((sum, count) => sum + count, 0);
  return rateBasisPoints(mix.round_1 + mix.rounds_2_3, total);
}

function formatCompensationMix(mix: CompensationMix): string {
  return `round 1=${mix.round_1}, rounds 2–3=${mix.rounds_2_3}, rounds 4–7=${mix.rounds_4_7}, player-only=${mix.player_only}`;
}

function contractApyCapBasisPoints(
  event: NflTransactionMarketEvent,
  capByYear: ReadonlyMap<number, number>,
): number | null {
  if (!CONTRACT_TRANSACTION_TYPES.has(event.transaction_type) || event.contract_apy_dollars == null) return null;
  const cap = event.league_cap_dollars ?? capByYear.get(event.event_year) ?? null;
  return cap == null || cap <= 0 ? null : Math.round((event.contract_apy_dollars / cap) * 10_000);
}

function guaranteedShareBasisPoints(event: NflTransactionMarketEvent): number | null {
  if (!CONTRACT_TRANSACTION_TYPES.has(event.transaction_type)
    || event.contract_value_dollars == null
    || event.contract_value_dollars <= 0
    || event.guaranteed_dollars == null) return null;
  return Math.round((event.guaranteed_dollars / event.contract_value_dollars) * 10_000);
}

function rosterDenominator(
  snapshot: NflTransactionMarketSnapshot,
  query: NflTransactionMarketResolvedQuery,
  year: number,
  position: NflPositionMarketGroup,
): number {
  const rows = snapshot.roster_player_seasons.filter((row) => row.year === year && row.position_group === position);
  if (query.team_ids.length > 0) {
    const selected = new Set(query.team_ids);
    return rows.filter((row) => row.team_id != null && selected.has(row.team_id.toUpperCase()))
      .reduce((sum, row) => sum + row.roster_player_seasons, 0);
  }
  const leagueRows = rows.filter((row) => row.team_id == null);
  const selectedRows = leagueRows.length > 0 ? leagueRows : rows.filter((row) => row.team_id != null);
  return selectedRows.reduce((sum, row) => sum + row.roster_player_seasons, 0);
}

function periodRosterDenominator(
  snapshot: NflTransactionMarketSnapshot,
  query: NflTransactionMarketResolvedQuery,
  position: NflPositionMarketGroup,
  period: readonly [number, number],
): number {
  let total = 0;
  for (let year = period[0]; year <= period[1]; year += 1) {
    total += rosterDenominator(snapshot, query, year, position);
  }
  return total;
}

function matchesLeagueScope(event: NflTransactionMarketEvent, query: NflTransactionMarketResolvedQuery): boolean {
  return event.event_year >= query.start_year
    && event.event_year <= query.end_year
    && query.transaction_types.includes(event.transaction_type);
}

function matchesCohort(event: NflTransactionMarketEvent, query: NflTransactionMarketResolvedQuery): boolean {
  if (!event.position_group || !query.position_groups.includes(event.position_group)) return false;
  if (query.team_ids.length === 0) return true;
  const selected = new Set(query.team_ids);
  return (event.from_team_id != null && selected.has(event.from_team_id.toUpperCase()))
    || (event.to_team_id != null && selected.has(event.to_team_id.toUpperCase()));
}

function signalGate(
  overallEvents: NflTransactionMarketEvent[],
  baselineEvents: NflTransactionMarketEvent[],
  recentEvents: NflTransactionMarketEvent[],
  minimumOverall: number,
  minimumPerPeriod: number,
  thresholds: Readonly<NflTransactionMarketThresholds>,
): NflTransactionMarketStatus {
  if (overallEvents.length < minimumOverall
    || baselineEvents.length < minimumPerPeriod
    || recentEvents.length < minimumPerPeriod) return 'insufficient_evidence';
  const identity = identityBasisPoints(overallEvents);
  if (identity >= thresholds.supported_identity_basis_points) return 'supported';
  if (identity >= thresholds.directional_identity_basis_points) return 'directional';
  return 'insufficient_evidence';
}

function identityBasisPoints(events: NflTransactionMarketEvent[]): number {
  if (events.length === 0) return 0;
  const matched = events.filter((event) => event.identity_confidence === 'matched').length;
  return Math.round((matched / events.length) * 10_000);
}

function numericDirection(
  baseline: number,
  recent: number,
  flatThreshold: number,
): Exclude<NflMarketDirection, 'mixed' | 'insufficient_evidence'> {
  if (baseline === 0) return recent === 0 ? 'flat' : 'growing';
  const change = relativeChangeBasisPoints(baseline, recent)!;
  if (Math.abs(change) <= flatThreshold) return 'flat';
  return change > 0 ? 'growing' : 'shrinking';
}

function directionalConflict(directions: NflMarketDirection[]): boolean {
  return directions.includes('growing') && directions.includes('shrinking');
}

function relativeChangeBasisPoints(baseline: number, recent: number): number | null {
  if (baseline === 0) return recent === 0 ? 0 : null;
  return Math.round(((recent - baseline) / Math.abs(baseline)) * 10_000);
}

function rateBasisPoints(numerator: number, denominator: number): number | null {
  return denominator <= 0 ? null : Math.round((numerator / denominator) * 10_000);
}

function medianInteger(values: number[]): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1
    ? ordered[midpoint]
    : Math.round((ordered[midpoint - 1] + ordered[midpoint]) / 2);
}

function leagueCapMap(snapshot: NflTransactionMarketSnapshot): ReadonlyMap<number, number> {
  return new Map(snapshot.league_caps.map((row) => [row.year, row.league_cap_dollars]));
}

function analysisStatus(trends: NflPositionMarketTrend[]): NflTransactionMarketStatus {
  const withEvents = trends.filter((trend) => trend.event_count > 0);
  if (withEvents.length === 0 || withEvents.every((trend) => trend.status === 'insufficient_evidence')) {
    return 'insufficient_evidence';
  }
  return withEvents.every((trend) => trend.status === 'supported') ? 'supported' : 'directional';
}

function methodology(
  query: NflTransactionMarketResolvedQuery,
  thresholds: Readonly<NflTransactionMarketThresholds>,
): NflTransactionMarketAnalysis['methodology'] {
  const teamScope = query.team_ids.length ? query.team_ids.join(', ') : 'leaguewide';
  return {
    cohort: `${query.start_year}–${query.end_year}; ${teamScope}; ${query.position_groups.join(', ')}; ${query.transaction_types.join(', ')}. Events must have an allocated position group; team filters match either side of a move.`,
    mobility: 'For each position and period, round(events / governed roster player-seasons × 10,000). The UI divides this integer by 100 to display events per 100 player-seasons. Missing or zero denominators remain null.',
    trade_price: 'Derive the highest returned pick band (round 1, rounds 2–3, rounds 4–7, or player-only) only when the whole trade contains exactly one player asset. Multi-player and unknown deals receive no per-player band.',
    contract_price: 'For contract events with integer dollars, calculate APY / that league year cap in basis points and guaranteed dollars / total value in basis points; compare period medians. Missing inputs remain unpriced.',
    classification: `A firm position direction requires at least two supported signals with the same non-flat direction (or two supported flat signals) and no growing-versus-shrinking or internally mixed signal. Changes within ${formatBps(thresholds.flat_relative_change_basis_points)} are flat; conflicts are mixed and directional, never collapsed into one score.`,
    influence: 'For each recent-period cohort event, remove that observation, recompute every reported recent statistic, and report the largest absolute basis-point movement. This is leave-one-out statistical sensitivity, not causation.',
    minimum_samples: `Position activity requires ${thresholds.minimum_events_overall} events overall and ${thresholds.minimum_events_per_period} in each comparison window. Trade price requires ${thresholds.minimum_allocable_trades_per_period} allocable trades per window; contract price requires ${thresholds.minimum_priced_contracts_per_period} priced contracts per window. Exact identity coverage of ${formatBps(thresholds.supported_identity_basis_points)} supports a firm result, ${formatBps(thresholds.directional_identity_basis_points)}–${formatBps(thresholds.supported_identity_basis_points - 1)} is directional, and lower coverage is insufficient.`,
  };
}

function limitations(
  snapshot: NflTransactionMarketSnapshot,
  query: NflTransactionMarketResolvedQuery,
  events: NflTransactionMarketEvent[],
  capByYear: ReadonlyMap<number, number>,
  status: NflTransactionMarketStatus,
): string[] {
  const result = [
    'This is a governed public-release demo snapshot with the attribution, coverage, and licensing caveats recorded on each source reference.',
  ];
  const missingDenominators = query.position_groups.reduce((count, position) => {
    let missing = 0;
    for (let year = query.start_year; year <= query.end_year; year += 1) {
      if (rosterDenominator(snapshot, query, year, position) === 0) missing += 1;
    }
    return count + missing;
  }, 0);
  if (missingDenominators > 0) result.push(`${missingDenominators} requested position-years have no roster denominator; mobility is null for those cells.`);
  const multiPlayer = events.filter((event) => event.transaction_type === 'trade'
    && event.trade_player_asset_count != null
    && event.trade_player_asset_count !== 1).length;
  if (multiPlayer > 0) result.push(`${multiPlayer} multi-player trade rows are excluded from per-player compensation bands.`);
  const unknownTradeAllocation = events.filter((event) => event.transaction_type === 'trade'
    && event.trade_player_asset_count == null).length;
  if (unknownTradeAllocation > 0) result.push(`${unknownTradeAllocation} trade rows lack a whole-deal player count and are excluded from per-player compensation bands.`);
  const unallocatedPositions = snapshot.events.filter((event) => matchesLeagueScope(event, query)
    && event.position_group == null
    && (query.team_ids.length === 0
      || (event.from_team_id != null && query.team_ids.includes(event.from_team_id.toUpperCase()))
      || (event.to_team_id != null && query.team_ids.includes(event.to_team_id.toUpperCase())))).length;
  if (unallocatedPositions > 0) result.push(`${unallocatedPositions} in-scope events lack an allocated position group and are excluded from position numerators.`);
  const identityGaps = events.filter((event) => event.identity_confidence !== 'matched').length;
  if (identityGaps > 0) result.push(`${identityGaps} cohort events lack exact identity matches and lower the applicable evidence gates.`);
  const yearlyCounts = Array.from({ length: query.end_year - query.start_year + 1 }, (_, index) => {
    const year = query.start_year + index;
    return { year, count: events.filter((event) => event.event_year === year).length };
  });
  const typicalYearCount = medianInteger(yearlyCounts.map((row) => row.count));
  const undercoveredYears = typicalYearCount == null || typicalYearCount === 0
    ? []
    : yearlyCounts.filter((row) => row.count * 4 < typicalYearCount * 3);
  if (undercoveredYears.length > 0) result.push(`Event counts are materially lower than the period median in ${undercoveredYears.map((row) => row.year).join(', ')}; comparisons using those years may reflect source coverage as well as market behavior.`);
  const unpricedContracts = events.filter((event) => CONTRACT_TRANSACTION_TYPES.has(event.transaction_type)
    && contractApyCapBasisPoints(event, capByYear) == null).length;
  if (unpricedContracts > 0) result.push(`${unpricedContracts} contract events lack an integer APY or league-cap denominator and are excluded from contract-price medians.`);
  if (query.include_ytd) result.push(`${CURRENT_YTD_YEAR} is labeled year-to-date context and is not treated as a completed league year.`);
  if (status !== 'supported') result.push('At least one requested position is sparse, identity-limited, single-signal, or conflicting; no firm overall market direction is asserted.');
  if (snapshot.source_refs.length === 0) result.push('No governed source references were attached to this snapshot.');
  return result;
}

function usedSourceRefs(
  snapshot: NflTransactionMarketSnapshot,
  query: NflTransactionMarketResolvedQuery,
  events: NflTransactionMarketEvent[],
): NflTransactionMarketSourceRef[] {
  const ids = new Set(events.flatMap((event) => event.source_ref_ids));
  for (const row of snapshot.roster_player_seasons) {
    if (row.year < query.start_year || row.year > query.end_year || !query.position_groups.includes(row.position_group)) continue;
    if (query.team_ids.length > 0 && (row.team_id == null || !query.team_ids.includes(row.team_id.toUpperCase()))) continue;
    for (const id of row.source_ref_ids ?? []) ids.add(id);
  }
  for (const row of snapshot.league_caps) {
    if (row.year < query.start_year || row.year > query.end_year) continue;
    for (const id of row.source_ref_ids ?? []) ids.add(id);
  }
  const selected = ids.size === 0
    ? snapshot.source_refs
    : snapshot.source_refs.filter((source) => ids.has(source.id));
  return [...selected].sort((a, b) => a.id.localeCompare(b.id));
}

function analysisId(
  snapshot: NflTransactionMarketSnapshot,
  query: NflTransactionMarketResolvedQuery,
  thresholds: Readonly<NflTransactionMarketThresholds>,
): string {
  const eventSignature = [...snapshot.events]
    .sort((a, b) => a.event_id.localeCompare(b.event_id))
    .map((event) => [event.event_id, event.event_year, event.event_date, event.date_precision,
      event.transaction_type, event.player_id, event.position_group, event.from_team_id, event.to_team_id,
      event.identity_confidence, event.contract_value_dollars, event.contract_apy_dollars,
      event.guaranteed_dollars, event.league_cap_dollars, event.trade_player_asset_count,
      [...(event.compensation_pick_rounds ?? [])].sort((a, b) => a - b),
      event.compensation_includes_player, event.compensation_band]);
  const rosterSignature = [...snapshot.roster_player_seasons]
    .sort((a, b) => a.year - b.year || (a.team_id ?? '').localeCompare(b.team_id ?? '') || a.position_group.localeCompare(b.position_group))
    .map((row) => [row.year, row.team_id, row.position_group, row.roster_player_seasons]);
  const capSignature = [...snapshot.league_caps].sort((a, b) => a.year - b.year)
    .map((row) => [row.year, row.league_cap_dollars]);
  const hash = fnv1a(JSON.stringify([
    snapshot.snapshot_id, query, thresholds, eventSignature, rosterSignature, capSignature,
  ]));
  return `nfl-market-${hash}`;
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function validateSnapshot(snapshot: NflTransactionMarketSnapshot): void {
  if (!snapshot || typeof snapshot !== 'object' || !snapshot.snapshot_id?.trim()) throw new Error('snapshot_id required');
  if (!Array.isArray(snapshot.events) || !Array.isArray(snapshot.roster_player_seasons)
    || !Array.isArray(snapshot.league_caps) || !Array.isArray(snapshot.source_refs)) {
    throw new Error('snapshot event, denominator, cap, and source collections are required');
  }
  const sourceIds = new Set<string>();
  for (const source of snapshot.source_refs) {
    if (!source.id || sourceIds.has(source.id)) throw new Error(`duplicate or empty source reference ${source.id}`);
    if (!/^https?:\/\//.test(source.url)) throw new Error(`source reference ${source.id} requires an HTTP URL`);
    if (!/^[a-f0-9]{64}$/i.test(source.checksum_sha256)) throw new Error(`source reference ${source.id} requires a SHA-256 checksum`);
    if (!Number.isFinite(Date.parse(source.retrieved_at))) throw new Error(`source reference ${source.id} has invalid retrieved_at`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(source.as_of_date)) throw new Error(`source reference ${source.id} has invalid as_of_date`);
    sourceIds.add(source.id);
  }
  const eventIds = new Set<string>();
  for (const event of snapshot.events) {
    if (!event.event_id || eventIds.has(event.event_id)) throw new Error(`duplicate or empty event_id ${event.event_id}`);
    eventIds.add(event.event_id);
    assertYear(event.event_year, `event ${event.event_id} year`);
    if (!ALL_TRANSACTION_TYPES.has(event.transaction_type)) throw new Error(`unsupported transaction type on ${event.event_id}`);
    if (event.position_group != null && !ALL_POSITION_GROUPS.has(event.position_group)) throw new Error(`unsupported position group on ${event.event_id}`);
    if (!['matched', 'directional', 'unmatched'].includes(event.identity_confidence)) throw new Error(`unsupported identity confidence on ${event.event_id}`);
    if (!event.player_name?.trim()) throw new Error(`player_name required on ${event.event_id}`);
    if (event.date_precision !== 'day' && event.date_precision !== 'year') throw new Error(`unsupported date precision on ${event.event_id}`);
    if (event.date_precision === 'day' && event.event_date == null) throw new Error(`day precision requires event_date on ${event.event_id}`);
    if (event.event_date != null && !isIsoDate(event.event_date)) throw new Error(`invalid event_date on ${event.event_id}`);
    if (event.event_date != null && Number(event.event_date.slice(0, 4)) !== event.event_year) throw new Error(`event_date year mismatch on ${event.event_id}`);
    for (const [field, value] of [
      ['contract_value_dollars', event.contract_value_dollars],
      ['contract_apy_dollars', event.contract_apy_dollars],
      ['guaranteed_dollars', event.guaranteed_dollars],
      ['league_cap_dollars', event.league_cap_dollars],
    ] as const) assertOptionalNonNegativeInteger(value, `${field} on ${event.event_id}`);
    if (event.league_cap_dollars === 0) throw new Error(`league_cap_dollars on ${event.event_id} must be positive`);
    if (event.contract_value_dollars != null && event.guaranteed_dollars != null
      && event.guaranteed_dollars > event.contract_value_dollars) throw new Error(`guaranteed dollars exceed contract value on ${event.event_id}`);
    if (event.trade_player_asset_count != null
      && (!Number.isSafeInteger(event.trade_player_asset_count) || event.trade_player_asset_count < 1)) throw new Error(`invalid trade player count on ${event.event_id}`);
    if (event.compensation_pick_rounds?.some((round) => !Number.isSafeInteger(round) || round < 1 || round > 7)) throw new Error(`invalid pick round on ${event.event_id}`);
    if (event.compensation_band != null && !ALL_COMPENSATION_BANDS.has(event.compensation_band)) throw new Error(`invalid compensation band on ${event.event_id}`);
    validateSourceIds(event.source_ref_ids, sourceIds, event.event_id);
  }

  const rosterKeys = new Set<string>();
  for (const row of snapshot.roster_player_seasons) {
    assertYear(row.year, 'roster denominator year');
    if (!ALL_POSITION_GROUPS.has(row.position_group)) throw new Error('unsupported roster denominator position');
    if (row.team_id != null && !row.team_id.trim()) throw new Error('roster denominator team_id cannot be empty');
    if (!Number.isSafeInteger(row.roster_player_seasons) || row.roster_player_seasons < 0) throw new Error('roster_player_seasons must be a non-negative integer');
    const key = `${row.year}:${row.team_id?.toUpperCase() ?? '*'}:${row.position_group}`;
    if (rosterKeys.has(key)) throw new Error(`duplicate roster denominator ${key}`);
    rosterKeys.add(key);
    validateSourceIds(row.source_ref_ids ?? [], sourceIds, key);
  }
  const capYears = new Set<number>();
  for (const row of snapshot.league_caps) {
    assertYear(row.year, 'league cap year');
    if (!Number.isSafeInteger(row.league_cap_dollars) || row.league_cap_dollars <= 0) throw new Error('league_cap_dollars must be a positive integer');
    if (capYears.has(row.year)) throw new Error(`duplicate league cap year ${row.year}`);
    capYears.add(row.year);
    validateSourceIds(row.source_ref_ids ?? [], sourceIds, String(row.year));
  }
  const capMap = leagueCapMap(snapshot);
  for (const event of snapshot.events) {
    const snapshotCap = capMap.get(event.event_year);
    if (event.league_cap_dollars != null && snapshotCap != null && event.league_cap_dollars !== snapshotCap) {
      throw new Error(`event and snapshot league caps conflict for ${event.event_id}`);
    }
  }
}

function validateSourceIds(ids: string[], known: Set<string>, row: string): void {
  if (!Array.isArray(ids)) throw new Error(`source_ref_ids must be an array on ${row}`);
  if (new Set(ids).size !== ids.length) throw new Error(`source_ref_ids contains duplicates on ${row}`);
  for (const id of ids) if (!known.has(id)) throw new Error(`unknown source reference ${id} on ${row}`);
}

function resolveThresholds(
  overrides: Partial<NflTransactionMarketThresholds> | undefined,
): Readonly<NflTransactionMarketThresholds> {
  const thresholds = { ...DEFAULT_NFL_TRANSACTION_MARKET_THRESHOLDS, ...overrides };
  for (const [key, value] of Object.entries(thresholds)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${key} must be a non-negative integer`);
  }
  if (thresholds.supported_identity_basis_points > 10_000
    || thresholds.directional_identity_basis_points > thresholds.supported_identity_basis_points) {
    throw new Error('transaction-market thresholds are inconsistent');
  }
  return thresholds;
}

function normalizeGeneratedAt(
  value: Date | string | undefined,
  snapshot: NflTransactionMarketSnapshot,
): string {
  const deterministicFallback = snapshot.source_refs.map((source) => source.retrieved_at).sort().at(-1)
    ?? snapshot.events.map((event) => event.event_date).filter(isString).sort().at(-1)?.concat('T00:00:00.000Z')
    ?? '1970-01-01T00:00:00.000Z';
  const input = value ?? deterministicFallback;
  const date = input instanceof Date ? new Date(input.getTime()) : new Date(input);
  if (!Number.isFinite(date.getTime())) throw new Error('generatedAt must be a valid date');
  return date.toISOString();
}

function canonicalValues<T extends string>(
  requested: T[] | undefined,
  defaults: readonly T[],
  allowed: ReadonlySet<T>,
  label: string,
): T[] {
  const values = requested?.length ? new Set(requested) : new Set(defaults);
  for (const value of values) if (!allowed.has(value)) throw new Error(`${label} contains unsupported value ${value}`);
  return defaults.filter((value) => values.has(value)).concat(
    [...values].filter((value) => !defaults.includes(value)).sort(),
  );
}

function assertYear(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < EARLIEST_SUPPORTED_YEAR || value > CURRENT_YTD_YEAR) {
    throw new Error(`${label} must be an integer from ${EARLIEST_SUPPORTED_YEAR} through ${CURRENT_YTD_YEAR}`);
  }
}

function assertOptionalNonNegativeInteger(value: number | null | undefined, label: string): void {
  if (value != null && (!Number.isSafeInteger(value) || value < 0)) throw new Error(`${label} must be a non-negative integer dollar amount`);
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function inPeriod(year: number, period: readonly [number, number]): boolean {
  return year >= period[0] && year <= period[1];
}

function formatBps(value: number): string {
  return `${(value / 100).toFixed(1)}%`;
}

function statisticLabel(key: keyof RecentStatistics): string {
  return ({
    mobility: 'mobility',
    transaction_share: 'transaction-share',
    contract_price: 'contract-price',
    trade_compensation: 'trade-compensation',
  } satisfies Record<keyof RecentStatistics, string>)[key];
}

function isNumber(value: number | null): value is number {
  return value != null;
}

function isString(value: string | null): value is string {
  return value != null && value.length > 0;
}

function isDirection(value: NflMarketDirection | null): value is NflMarketDirection {
  return value != null;
}
