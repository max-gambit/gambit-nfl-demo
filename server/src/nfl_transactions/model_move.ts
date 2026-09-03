import type {
  NflPositionMarketGroup,
  NflSellerMoveComparable,
  NflSellerMoveOptionsResponse,
  NflSellerMoveRequest,
  NflSellerMoveResponse,
} from '@shared/types';
import {
  isExactNflCapRow,
  nflDepthEffect,
  nflDepthEvidence,
} from '../nfl_decision/cap_roster.js';
import {
  loadCurrentNflTeamDataWithMode,
  type NflCapRow,
  type NflDemoSeed,
} from '../nfl_data/seed.js';
import type {
  NflTransactionMarketEvent,
  NflTransactionMarketSnapshot,
  NflTransactionTradeAsset,
} from './analyze.js';
import { loadCurrentNflTransactionMarketSnapshot } from './seed.js';

const POSITION_GROUPS = new Set<NflPositionMarketGroup>([
  'QB', 'RB', 'WR', 'TE', 'OT', 'IOL', 'EDGE', 'IDL', 'LB', 'CB', 'S', 'ST',
]);
const MINIMUM_MARKET_SAMPLE = 5;
const COMPARABLE_LIMIT = 5;

interface HistoricalPickReturn {
  event: NflTransactionMarketEvent;
  pick_year: number;
  pick_round: number;
  pick_delay_years: number;
  compensation_summary: string;
  source_ref_id: string;
}

export async function getNflSellerMoveOptions(
  teamId: string,
  positionGroups: NflPositionMarketGroup[],
): Promise<NflSellerMoveOptionsResponse> {
  const [loaded, snapshot] = await Promise.all([
    loadCurrentNflTeamDataWithMode(teamId),
    loadCurrentNflTransactionMarketSnapshot(),
  ]);
  requireDatabaseBackedContracts(loaded.source_mode);
  return buildNflSellerMoveOptions(loaded.seed, teamId, positionGroups, snapshot);
}

export function buildNflSellerMoveOptions(
  seed: NflDemoSeed,
  teamId: string,
  positionGroups: NflPositionMarketGroup[],
  snapshot: NflTransactionMarketSnapshot,
): NflSellerMoveOptionsResponse {
  const normalizedTeam = teamId.toUpperCase();
  if (normalizedTeam !== 'NYG') throw new Error('seller-side move analysis is available for NYG only');
  const requestedGroups = uniquePositionGroups(positionGroups);
  const activePlayerIds = new Set(
    seed.roster_entries
      .filter((row) => row.team_id === normalizedTeam && row.roster_status === 'active')
      .map((row) => row.player_id),
  );
  const capYear = Number.parseInt(seed.season, 10);
  if (!Number.isInteger(capYear)) throw new Error('current contract season is unavailable');
  const players = seed.cap_rows.filter((row) => row.team_id === normalizedTeam).flatMap((row) => {
    const metric = seed.player_metrics.find((candidate) => candidate.team_id === normalizedTeam && candidate.player_id === row.player_id);
    const positionGroup = currentPlayerPosition(row.player_name, row.position, snapshot, metric);
    if (
      !row.player_id
      || !positionGroup
      || !requestedGroups.includes(positionGroup)
      || !activePlayerIds.has(row.player_id)
      || !hasCompletePostJuneTradeRow(row)
      || !row.source_url
    ) return [];
    return [{
      team_id: normalizedTeam,
      player_id: row.player_id,
      player_name: row.player_name,
      listed_position: row.position,
      position_group: positionGroup,
      cap_year: capYear,
      contract_as_of_date: seed.as_of_date,
      contract_source_url: row.source_url,
    }];
  }).sort((left, right) => left.player_name.localeCompare(right.player_name));

  return {
    schema_version: 'nfl_seller_move_options.v1',
    team_id: normalizedTeam,
    current_year: capYear,
    contract_as_of_date: seed.as_of_date,
    positions: requestedGroups.map((positionGroup) => ({
      position_group: positionGroup,
      players: players.filter((player) => player.position_group === positionGroup),
    })),
  };
}

export async function modelNflSellerMove(input: NflSellerMoveRequest): Promise<NflSellerMoveResponse> {
  const [teamData, snapshot] = await Promise.all([
    loadCurrentNflTeamDataWithMode(input.team_id),
    loadCurrentNflTransactionMarketSnapshot(),
  ]);
  requireDatabaseBackedContracts(teamData.source_mode);
  return calculateNflSellerMove(input, teamData.seed, snapshot);
}

/** Pure seller-side calculation for focused tests and live route use. */
export function calculateNflSellerMove(
  input: NflSellerMoveRequest,
  seed: NflDemoSeed,
  snapshot: NflTransactionMarketSnapshot,
  generatedAt: Date | string = new Date(),
): NflSellerMoveResponse {
  validateRequest(input, seed, snapshot);
  const teamId = input.team_id.toUpperCase();
  const playerRow = seed.cap_rows.find((row) => row.team_id === teamId && row.player_id === input.player_id);
  if (!playerRow || !playerRow.player_id || !hasCompletePostJuneTradeRow(playerRow) || !playerRow.source_url) {
    throw new Error('selected player does not have a complete current Giants contract row');
  }
  const rosterRow = seed.roster_entries.find((row) => row.team_id === teamId && row.player_id === input.player_id);
  if (!rosterRow || rosterRow.roster_status !== 'active') throw new Error('selected player is not on the current active Giants roster');
  const metric = seed.player_metrics.find((row) => row.team_id === teamId && row.player_id === input.player_id);
  const normalizedPosition = currentPlayerPosition(playerRow.player_name, playerRow.position, snapshot, metric);
  if (normalizedPosition !== input.position_group) throw new Error('selected player does not match the selected position group');

  const currentYear = Number.parseInt(seed.season, 10);
  const returns = historicalPickReturns(input, snapshot);
  const sortedReturns = [...returns].sort(compareHistoricalReturns);
  const proposal = {
    pick_year: input.pick_year,
    pick_round: input.pick_round,
    pick_delay_years: input.pick_year - currentYear,
  };
  const supported = sortedReturns.length >= MINIMUM_MARKET_SAMPLE;
  const strongerBoundary = supported ? quantile(sortedReturns, 0.25) : null;
  const weakerBoundary = supported ? quantile(sortedReturns, 0.75) : null;
  const range = !strongerBoundary || !weakerBoundary
    ? null
    : compareReturnValues(proposal, strongerBoundary) < 0
      ? 'above' as const
      : compareReturnValues(proposal, weakerBoundary) > 0
        ? 'below' as const
        : 'within' as const;
  const depthEffect = nflDepthEffect(metric);
  const depthEvidence = nflDepthEvidence(metric);
  const roleSourceUrl = depthEvidence.source_status === 'captured'
    ? seed.source_refs.find((source) => source.id.includes('snap_counts'))?.url ?? null
    : null;
  const nextYear = nextYearCapEffect(playerRow, currentYear);
  const relevantReturns = [...sortedReturns]
    .sort((left, right) => comparableDistance(proposal, left) - comparableDistance(proposal, right)
      || right.event.event_year - left.event.event_year
      || left.event.player_name.localeCompare(right.event.player_name))
    .slice(0, COMPARABLE_LIMIT);
  const sources = sourceRefsForReturns(snapshot, relevantReturns);
  const limitations = [
    'The historical range uses only single-player trades where draft-pick compensation can be assigned to that player. Pick-swap deals and unresolved conditional picks are excluded.',
    'Pick value is compared by round and how many draft years away the pick was; no unpublished club trade chart is assumed.',
  ];
  if (!supported) limitations.unshift(`Only ${sortedReturns.length} usable ${input.position_group} trades were found; at least ${MINIMUM_MARKET_SAMPLE} are required for a range.`);
  if (!nextYear) limitations.push('The loaded contract row does not support a next-year cap effect, so none is shown.');
  if (depthEvidence.source_status !== 'captured') limitations.push('The public role data is incomplete; the depth consequence needs football review.');

  return {
    schema_version: 'nfl_seller_move.v1',
    generated_at: normalizeGeneratedAt(generatedAt),
    status: supported ? 'supported' : 'insufficient_evidence',
    proposal: {
      source: 'user_entered',
      pick_year: input.pick_year,
      pick_round: input.pick_round,
      pick_day: pickDay(input.pick_round),
      label: `${input.pick_year} round ${input.pick_round} pick (Day ${pickDay(input.pick_round)})`,
    },
    player: {
      team_id: teamId,
      player_id: playerRow.player_id,
      player_name: playerRow.player_name,
      listed_position: playerRow.position,
      position_group: input.position_group,
      contract_as_of_date: seed.as_of_date,
    },
    market: {
      range,
      range_label: marketRangeLabel(range, input.position_group, proposal, strongerBoundary, weakerBoundary),
      sample_size: sortedReturns.length,
      cohort_label: `${input.market_scope.start_year}–${input.market_scope.end_year}${input.market_scope.include_ytd ? ' including YTD' : ''} single-player ${input.position_group} trades with seller-side draft picks`,
      middle_range: strongerBoundary && weakerBoundary ? {
        stronger_pick: pickLabel(strongerBoundary.pick_year, strongerBoundary.pick_round),
        weaker_pick: pickLabel(weakerBoundary.pick_year, weakerBoundary.pick_round),
      } : null,
      method: 'The middle historical range is the 25th through 75th percentile of seller returns. Each trade is ranked by the strongest seller-received pick in the package: round first, then how many draft years away the pick was. The full received pick package remains visible on each comparable.',
    },
    cap: {
      accounting_timing: `Trade processed after June 1, ${currentYear}`,
      current_year: currentYear,
      current_cap_number_dollars: playerRow.cap_number_2026!,
      current_year_cap_space_created_dollars: playerRow.post_june_1_trade_savings_2026!,
      current_year_dead_money_dollars: playerRow.post_june_1_trade_dead_money_2026!,
      next_year: nextYear,
      contract_source_url: playerRow.source_url,
      calculation: `${formatDollars(playerRow.cap_number_2026!)} current cap charge minus ${formatDollars(playerRow.post_june_1_trade_dead_money_2026!)} current dead money equals ${formatDollars(playerRow.post_june_1_trade_savings_2026!)} in current cap space.`,
    },
    depth: {
      consequence: depthConsequence(depthEffect),
      label: depthLabel(depthEffect),
      basis: depthEvidence.basis,
      source_url: roleSourceUrl,
    },
    comparables: relevantReturns.map((row) => comparableFromReturn(row, snapshot, proposal)),
    sources,
    limitations,
  };
}

function validateRequest(input: NflSellerMoveRequest, seed: NflDemoSeed, snapshot: NflTransactionMarketSnapshot): void {
  if (!input || typeof input !== 'object') throw new Error('request body required');
  if (input.team_id?.toUpperCase() !== 'NYG') throw new Error('seller-side move analysis is available for NYG only');
  if (!POSITION_GROUPS.has(input.position_group)) throw new Error('position_group is unsupported');
  if (!Number.isInteger(input.pick_round) || input.pick_round < 1 || input.pick_round > 7) throw new Error('pick_round must be an integer from 1 through 7');
  const currentYear = Number.parseInt(seed.season, 10);
  if (!Number.isInteger(input.pick_year) || input.pick_year <= currentYear || input.pick_year > currentYear + 3) {
    throw new Error(`pick_year must be between ${currentYear + 1} and ${currentYear + 3}`);
  }
  if (input.market_scope?.snapshot_id !== snapshot.snapshot_id) throw new Error('the historical market result is no longer current; rerun the market question');
  if (!Number.isInteger(input.market_scope.start_year) || !Number.isInteger(input.market_scope.end_year) || input.market_scope.start_year > input.market_scope.end_year) {
    throw new Error('market_scope year range is invalid');
  }
}

function historicalPickReturns(input: NflSellerMoveRequest, snapshot: NflTransactionMarketSnapshot): HistoricalPickReturn[] {
  const assetsByTrade = groupAssetsByTrade(snapshot.trade_assets ?? []);
  return snapshot.events.flatMap((event) => {
    if (
      event.transaction_type !== 'trade'
      || event.position_group !== input.position_group
      || event.identity_confidence !== 'matched'
      || event.trade_player_asset_count !== 1
      || !event.from_team_id
      || !event.to_team_id
      || event.event_year < input.market_scope.start_year
      || event.event_year > input.market_scope.end_year
      || (!input.market_scope.include_ytd && event.event_year > 2025)
      || (input.market_scope.team_ids.length > 0
        && !input.market_scope.team_ids.includes(event.from_team_id)
        && !input.market_scope.team_ids.includes(event.to_team_id))
    ) return [];
    const tradeId = readTradeId(event.raw_source_record);
    if (!tradeId) return [];
    const tradeAssets = assetsByTrade.get(tradeId) ?? [];
    const sellerSentPick = tradeAssets.some((asset) => asset.asset_type === 'draft_pick' && asset.gave_team_id === event.from_team_id);
    if (sellerSentPick) return [];
    const sellerPicks = tradeAssets
      .filter((asset) => asset.asset_type === 'draft_pick'
        && asset.received_team_id === event.from_team_id
        && asset.gave_team_id === event.to_team_id
        && asset.pick_season != null
        && asset.pick_round != null
        && !(asset.conditional === true && asset.pick_number == null)
        && asset.pick_round >= 1
        && asset.pick_round <= 7)
      .sort(comparePickAssets);
    const primary = sellerPicks[0];
    if (!primary?.pick_season || !primary.pick_round) return [];
    return [{
      event,
      pick_year: primary.pick_season,
      pick_round: primary.pick_round,
      pick_delay_years: primary.pick_season - event.event_year,
      compensation_summary: sellerPicks.map((asset) => `${asset.pick_season} R${asset.pick_round}${asset.conditional ? ' conditional' : ''}`).join(' + '),
      source_ref_id: primary.source_ref_id,
    }];
  });
}

function groupAssetsByTrade(assets: NflTransactionTradeAsset[]): Map<string, NflTransactionTradeAsset[]> {
  const grouped = new Map<string, NflTransactionTradeAsset[]>();
  for (const asset of assets) grouped.set(asset.trade_id, [...(grouped.get(asset.trade_id) ?? []), asset]);
  return grouped;
}

function readTradeId(raw: Record<string, unknown> | null | undefined): string | null {
  const value = raw?.trade_id;
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null;
}

function comparePickAssets(left: NflTransactionTradeAsset, right: NflTransactionTradeAsset): number {
  return (left.pick_round ?? 99) - (right.pick_round ?? 99)
    || (left.pick_season ?? 9999) - (right.pick_season ?? 9999)
    || (left.pick_number ?? 999) - (right.pick_number ?? 999);
}

function compareHistoricalReturns(left: HistoricalPickReturn, right: HistoricalPickReturn): number {
  return compareReturnValues(left, right) || right.event.event_year - left.event.event_year;
}

function compareReturnValues(
  left: Pick<HistoricalPickReturn, 'pick_round' | 'pick_delay_years'>,
  right: Pick<HistoricalPickReturn, 'pick_round' | 'pick_delay_years'>,
): number {
  return left.pick_round - right.pick_round || left.pick_delay_years - right.pick_delay_years;
}

function comparableDistance(
  proposal: Pick<HistoricalPickReturn, 'pick_round' | 'pick_delay_years'>,
  row: HistoricalPickReturn,
): number {
  return Math.abs(proposal.pick_round - row.pick_round) * 100 + Math.abs(proposal.pick_delay_years - row.pick_delay_years) * 10;
}

function quantile(rows: HistoricalPickReturn[], percentile: number): HistoricalPickReturn {
  return rows[Math.round((rows.length - 1) * percentile)]!;
}

function comparableFromReturn(
  row: HistoricalPickReturn,
  snapshot: NflTransactionMarketSnapshot,
  proposal: Pick<HistoricalPickReturn, 'pick_round' | 'pick_delay_years'>,
): NflSellerMoveComparable {
  const source = snapshot.source_refs.find((candidate) => candidate.id === row.source_ref_id)
    ?? snapshot.source_refs.find((candidate) => row.event.source_ref_ids.includes(candidate.id));
  if (!source) throw new Error(`transaction source is missing for ${row.event.event_id}`);
  return {
    event_id: row.event.event_id,
    event_date: row.event.event_date,
    event_year: row.event.event_year,
    player_name: row.event.player_name,
    position_group: row.event.position_group!,
    from_team_id: row.event.from_team_id!,
    to_team_id: row.event.to_team_id!,
    pick_year: row.pick_year,
    pick_round: row.pick_round,
    pick_day: pickDay(row.pick_round),
    pick_delay_years: row.pick_delay_years,
    compensation_summary: row.compensation_summary,
    comparison_to_proposal: comparableRelationship(row, proposal),
    source_name: source.name,
    source_url: source.url,
  };
}

function comparableRelationship(
  row: Pick<HistoricalPickReturn, 'pick_round' | 'pick_delay_years'>,
  proposal: Pick<HistoricalPickReturn, 'pick_round' | 'pick_delay_years'>,
): NflSellerMoveComparable['comparison_to_proposal'] {
  const difference = compareReturnValues(row, proposal);
  return difference < 0 ? 'stronger' : difference > 0 ? 'weaker' : 'similar';
}

function sourceRefsForReturns(snapshot: NflTransactionMarketSnapshot, rows: HistoricalPickReturn[]) {
  const ids = new Set(rows.flatMap((row) => [row.source_ref_id, ...row.event.source_ref_ids]));
  return snapshot.source_refs.filter((source) => ids.has(source.id));
}

function hasCompletePostJuneTradeRow(row: NflCapRow): boolean {
  return isExactNflCapRow(row)
    && row.post_june_1_trade_dead_money_2026 != null
    && row.post_june_1_trade_savings_2026 != null
    && row.post_june_1_trade_dead_money_2026 >= 0
    && row.post_june_1_trade_savings_2026 >= 0
    && row.cap_number_2026! - row.post_june_1_trade_dead_money_2026 === row.post_june_1_trade_savings_2026;
}

function nextYearCapEffect(row: NflCapRow, currentYear: number): NflSellerMoveResponse['cap']['next_year'] {
  const contractYears = Array.isArray(row.source_data?.contract_years) ? row.source_data.contract_years : [];
  const next = contractYears.find((value) => isRecord(value) && Number(value.season) === currentYear + 1);
  if (!isRecord(next) || !Number.isInteger(next.cap_number)) return null;
  if (row.trade_dead_money_2026 == null || row.post_june_1_trade_dead_money_2026 == null) return null;
  const accelerated = row.trade_dead_money_2026 - row.post_june_1_trade_dead_money_2026;
  if (accelerated < 0) return null;
  const scheduled = Number(next.cap_number);
  return {
    year: currentYear + 1,
    scheduled_cap_dollars: scheduled,
    accelerated_dead_money_dollars: accelerated,
    cap_effect_dollars: scheduled - accelerated,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function currentPlayerPosition(
  playerName: string,
  position: string | null,
  snapshot: NflTransactionMarketSnapshot,
  metric?: NflDemoSeed['player_metrics'][number],
): NflPositionMarketGroup | null {
  const normalizedName = normalizePlayerName(playerName);
  const historicallyMatched = new Set(
    snapshot.events
      .filter((event) => event.identity_confidence === 'matched'
        && event.position_group != null
        && normalizePlayerName(event.player_name) === normalizedName)
      .map((event) => event.position_group!),
  );
  if (historicallyMatched.size === 1) return [...historicallyMatched][0]!;
  if (historicallyMatched.size > 1) return null;

  // nflverse's current Giants depth chart lists the club in a base 3-4 and
  // distinguishes the outside spots (SLB/WLB) from its inside linebackers.
  // Use that sourced role detail to map current edge defenders such as Kayvon
  // Thibodeaux instead of guessing from the roster's generic "LB" label.
  const qualityFlags = new Set(metric?.quality_flags ?? []);
  if (qualityFlags.has('depth_chart_group_base_3_4_d')
    && (qualityFlags.has('depth_chart_position_slb') || qualityFlags.has('depth_chart_position_wlb'))) {
    return 'EDGE';
  }

  const value = (position ?? '').toUpperCase();
  if (['QB'].includes(value)) return 'QB';
  if (['RB', 'FB', 'HB'].includes(value)) return 'RB';
  if (['WR'].includes(value)) return 'WR';
  if (['TE'].includes(value)) return 'TE';
  if (['T', 'OT'].includes(value)) return 'OT';
  if (['G', 'OG', 'C', 'IOL'].includes(value)) return 'IOL';
  if (['EDGE'].includes(value)) return 'EDGE';
  if (['DT', 'NT', 'IDL'].includes(value)) return 'IDL';
  if (['MLB', 'ILB'].includes(value)) return 'LB';
  if (['CB'].includes(value)) return 'CB';
  if (['S', 'FS', 'SS', 'SAF'].includes(value)) return 'S';
  if (['K', 'P', 'LS', 'ST'].includes(value)) return 'ST';
  return null;
}

function normalizePlayerName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function uniquePositionGroups(groups: NflPositionMarketGroup[]): NflPositionMarketGroup[] {
  const values = [...new Set(groups)].filter((group) => POSITION_GROUPS.has(group));
  if (!values.length) throw new Error('at least one historical position group is required');
  return values;
}

function pickDay(round: number): 1 | 2 | 3 {
  return round === 1 ? 1 : round <= 3 ? 2 : 3;
}

function pickLabel(year: number, round: number): string {
  return `${year} round ${round} (Day ${pickDay(round)})`;
}

function depthConsequence(value: ReturnType<typeof nflDepthEffect>): NflSellerMoveResponse['depth']['consequence'] {
  return value === 'high' ? 'major_role' : value === 'medium' ? 'meaningful_role' : value === 'low' ? 'limited_role' : 'needs_review';
}

function depthLabel(value: ReturnType<typeof nflDepthEffect>): string {
  return value === 'high' ? 'Major role to replace' : value === 'medium' ? 'Meaningful role to replace' : value === 'low' ? 'Limited current role' : 'Role impact needs football review';
}

function requireDatabaseBackedContracts(sourceMode: string): void {
  if (sourceMode !== 'supabase_current_views') throw new Error('current Giants contract rows are not available from the local database');
}

function normalizeGeneratedAt(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('generated_at is invalid');
  return date.toISOString();
}

function formatDollars(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function marketRangeLabel(
  range: NflSellerMoveResponse['market']['range'],
  position: NflPositionMarketGroup,
  proposal: Pick<HistoricalPickReturn, 'pick_round' | 'pick_delay_years'>,
  strongerBoundary: HistoricalPickReturn | null,
  weakerBoundary: HistoricalPickReturn | null,
): string {
  if (range == null) return 'Not enough comparable trades to set a historical range';
  if (range === 'within') return `Within the typical historical range for ${position}`;
  const boundary = range === 'above' ? strongerBoundary : weakerBoundary;
  if (!boundary) return `${capitalize(range)} the typical historical range for ${position}`;
  const roundGap = Math.abs(proposal.pick_round - boundary.pick_round);
  const distance = roundGap > 0
    ? `${roundGap} round${roundGap === 1 ? '' : 's'} ${range === 'above' ? 'stronger' : 'weaker'} than the edge of the middle range`
    : `${Math.abs(proposal.pick_delay_years - boundary.pick_delay_years)} draft year${Math.abs(proposal.pick_delay_years - boundary.pick_delay_years) === 1 ? '' : 's'} ${range === 'above' ? 'sooner' : 'later'} than the edge of the middle range`;
  return `${capitalize(range)} the typical historical range for ${position} · ${distance}`;
}
