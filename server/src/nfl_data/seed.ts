import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const DEFAULT_NFL_DEMO_SEED_PATH = fileURLToPath(
  new URL('../../../data/nfl-demo/current.json', import.meta.url),
);
export const DEFAULT_NFL_TEAM_CAP_SUMMARY_PATH = fileURLToPath(
  new URL('../../../data/nfl-demo/team-cap-summaries.current.json', import.meta.url),
);

export type NflSourceStatus = 'captured' | 'estimated' | 'source-needed' | 'not-available';
export type NflContractLedgerStatus = 'captured' | 'source-needed';
export type NflContractLedgerConfidence = 'captured' | 'derived' | 'estimated' | 'source-needed';
export type NflVoidYearsSourceStatus = 'captured' | 'derived' | 'source-needed' | 'not-available';
export type NflCurrentDataSourceMode = 'supabase_current_views' | 'checked_in_snapshot' | 'checked_in_snapshot_fallback';

export interface NflCurrentDataLoadResult {
  seed: NflDemoSeed;
  source_mode: NflCurrentDataSourceMode;
  fallback_reason: string | null;
}

let currentDataCache: { expires_at: number; value: NflCurrentDataLoadResult } | null = null;
let currentDataInFlight: Promise<NflCurrentDataLoadResult> | null = null;
const currentTeamDataCache = new Map<string, { expires_at: number; value: NflCurrentDataLoadResult }>();
const currentTeamDataInFlight = new Map<string, Promise<NflCurrentDataLoadResult>>();

export interface NflDemoTeam {
  team_id: string;
  abbreviation: string;
  full_name: string;
  conference: string | null;
  division: string | null;
  source_url: string | null;
}

export interface NflRosterEntry {
  team_id: string;
  player_id: string;
  player_name: string;
  position: string | null;
  age: number | null;
  roster_status: string;
  contract_status: string;
  source_order: number;
  source_url: string | null;
  source_note: string;
  jersey_number?: string | null;
  height_inches?: number | null;
  weight_lbs?: number | null;
  experience?: string | null;
  college?: string | null;
}

export interface NflCapRow {
  team_id: string;
  player_id: string | null;
  player_name: string;
  position: string | null;
  cap_number_2026: number | null;
  cash_due_2026: number | null;
  total_value_remaining: number | null;
  years_remaining: number | null;
  contract_end_year: number | null;
  contract_years_remaining: number | null;
  void_year_count: number | null;
  void_years_source_status: NflVoidYearsSourceStatus;
  guaranteed_remaining: number | null;
  dead_money_if_cut_2026: number | null;
  cut_savings_2026: number | null;
  post_june_1_dead_money_2026: number | null;
  post_june_1_cut_savings_2026: number | null;
  trade_dead_money_2026: number | null;
  trade_savings_2026: number | null;
  post_june_1_trade_dead_money_2026: number | null;
  post_june_1_trade_savings_2026: number | null;
  restructure_savings_estimate_2026: number | null;
  extension_savings_estimate_2026: number | null;
  contract_ledger_status: NflContractLedgerStatus;
  contract_ledger_confidence: NflContractLedgerConfidence;
  tag_eligible_2027: boolean;
  contract_lever: string;
  source_url: string | null;
  source_status: NflSourceStatus;
  source_order?: number;
  source_note?: string;
  source_data?: Record<string, unknown>;
}

export interface NflPlayerMetricRow {
  team_id: string;
  player_id: string;
  player_name: string;
  position: string | null;
  snaps_2025: number | null;
  offense_snaps_2025?: number | null;
  defense_snaps_2025?: number | null;
  special_teams_snaps_2025?: number | null;
  snap_share_2025?: number | null;
  games_2025: number | null;
  starts_2025?: number | null;
  passing_yards_2025?: number | null;
  rushing_yards_2025?: number | null;
  receiving_yards_2025?: number | null;
  scrimmage_yards_2025?: number | null;
  tackles_2025?: number | null;
  sacks_2025?: number | null;
  interceptions_2025?: number | null;
  touchdowns_2025?: number | null;
  availability_risk: string;
  role: string;
  value_tier: string;
  metric_note: string;
  metric_source_family?: string | null;
  metric_gap_reason?: string | null;
  metric_coverage_level?: 'strong' | 'directional' | 'gap';
  metric_confidence?: 'captured' | 'derived' | 'source-needed';
  metric_families?: string[];
  position_metric_summary?: string | null;
  position_metrics?: Record<string, unknown>;
  quality_flags?: string[];
  source_url: string | null;
  source_status?: 'captured' | 'roster-derived' | 'source-needed';
  source_data?: Record<string, unknown>;
}

export interface NflSourceRef {
  id: string;
  name: string;
  url: string;
}

export interface NflTeamCapSummary {
  team_id: string;
  season: string;
  as_of_date: string;
  current_cap_space_dollars: number;
  effective_cap_space_dollars: number | null;
  league_cap_dollars: number;
  applied_team_cap_dollars: number;
  carryover_dollars: number | null;
  adjustments_dollars: number | null;
  top_51_cap_spending_dollars: number;
  dead_money_dollars: number;
  accounting_basis: string;
  accounting_note: string;
  source_status: 'captured' | 'source-needed';
  source_urls: string[];
  source_content_sha256: Record<string, string>;
}

interface NflTeamCapSummarySnapshot {
  schema_version: 1;
  season: string;
  as_of_date: string;
  retrieved_at: string;
  summaries: NflTeamCapSummary[];
  source_refs: NflSourceRef[];
  limitations: string[];
}

export interface NflDemoSeed {
  schema_version: 1;
  season: string;
  as_of_date: string;
  source_name: string;
  source_url: string;
  retrieved_at: string;
  notes: string[];
  teams: NflDemoTeam[];
  roster_entries: NflRosterEntry[];
  cap_rows: NflCapRow[];
  player_metrics: NflPlayerMetricRow[];
  source_refs: NflSourceRef[];
  team_cap_summaries?: NflTeamCapSummary[];
}

export interface NflDemoSummary {
  season: string;
  as_of_date: string;
  team_count: number;
  roster_row_count: number;
  cap_row_count: number;
  player_metric_row_count: number;
  source_needed_cap_row_count: number;
  cap_row_parity: boolean;
}

export async function loadNflDemoSeed(path = DEFAULT_NFL_DEMO_SEED_PATH): Promise<NflDemoSeed> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as NflDemoSeed;
  const teamCapSnapshot = path === DEFAULT_NFL_DEMO_SEED_PATH
    ? await loadNflTeamCapSummarySnapshot()
    : null;
  const seed = teamCapSnapshot
    ? {
        ...parsed,
        team_cap_summaries: teamCapSnapshot.summaries,
        source_refs: mergeSourceRefs(parsed.source_refs, teamCapSnapshot.source_refs),
      }
    : parsed;
  validateNflDemoSeed(seed);
  return seed;
}

export async function loadNflTeamCapSummarySnapshot(
  path = DEFAULT_NFL_TEAM_CAP_SUMMARY_PATH,
): Promise<NflTeamCapSummarySnapshot> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as NflTeamCapSummarySnapshot;
  if (parsed.schema_version !== 1 || parsed.season !== '2026' || !parsed.as_of_date || !parsed.retrieved_at) {
    throw new Error('NFL team cap summary snapshot metadata is incomplete');
  }
  for (const row of parsed.summaries) validateTeamCapSummary(row);
  return parsed;
}

export async function loadCurrentNflData(): Promise<NflDemoSeed> {
  const loaded = await loadCurrentNflDataWithMode();
  if (loaded.source_mode === 'checked_in_snapshot_fallback') {
    console.warn('[nfl_data] DB-backed NFL data unavailable; falling back to checked-in snapshot', loaded.fallback_reason);
  }
  return loaded.seed;
}

export async function loadCurrentNflDataWithMode(): Promise<NflCurrentDataLoadResult> {
  if (currentDataCache && currentDataCache.expires_at > Date.now()) return currentDataCache.value;
  if (currentDataInFlight) return currentDataInFlight;
  currentDataInFlight = loadCurrentNflDataUncached();
  try {
    const value = await currentDataInFlight;
    currentDataCache = { expires_at: Date.now() + 30_000, value };
    return value;
  } finally {
    currentDataInFlight = null;
  }
}

async function loadCurrentNflDataUncached(): Promise<NflCurrentDataLoadResult> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      seed: await loadNflDemoSeed(),
      source_mode: 'checked_in_snapshot',
      fallback_reason: null,
    };
  }
  try {
    return {
      seed: await loadCurrentNflDataFromDb(),
      source_mode: 'supabase_current_views',
      fallback_reason: null,
    };
  } catch (error) {
    return {
      seed: await loadNflDemoSeed(),
      source_mode: 'checked_in_snapshot_fallback',
      fallback_reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function loadCurrentNflTeamDataWithMode(teamId: string): Promise<NflCurrentDataLoadResult> {
  const normalized = teamId.toUpperCase();
  const cached = currentTeamDataCache.get(normalized);
  if (cached && cached.expires_at > Date.now()) return cached.value;
  const inFlight = currentTeamDataInFlight.get(normalized);
  if (inFlight) return inFlight;
  const promise = loadCurrentNflTeamDataUncached(normalized);
  currentTeamDataInFlight.set(normalized, promise);
  try {
    const value = await promise;
    currentTeamDataCache.set(normalized, { expires_at: Date.now() + 30_000, value });
    return value;
  } finally {
    currentTeamDataInFlight.delete(normalized);
  }
}

async function loadCurrentNflTeamDataUncached(teamId: string): Promise<NflCurrentDataLoadResult> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { seed: filterSeedToTeam(await loadNflDemoSeed(), teamId), source_mode: 'checked_in_snapshot', fallback_reason: null };
  }
  try {
    return { seed: await loadCurrentNflTeamDataFromDb(teamId), source_mode: 'supabase_current_views', fallback_reason: null };
  } catch (error) {
    return { seed: filterSeedToTeam(await loadNflDemoSeed(), teamId), source_mode: 'checked_in_snapshot_fallback', fallback_reason: error instanceof Error ? error.message : String(error) };
  }
}

function filterSeedToTeam(seed: NflDemoSeed, teamId: string): NflDemoSeed {
  return { ...seed, teams: seed.teams.filter((row) => row.team_id === teamId), roster_entries: seed.roster_entries.filter((row) => row.team_id === teamId), cap_rows: seed.cap_rows.filter((row) => row.team_id === teamId), player_metrics: seed.player_metrics.filter((row) => row.team_id === teamId), team_cap_summaries: seed.team_cap_summaries?.filter((row) => row.team_id === teamId) };
}

export function validateNflDemoSeed(seed: NflDemoSeed): NflDemoSummary {
  if (seed.schema_version !== 1) throw new Error(`unsupported NFL demo seed schema_version=${String(seed.schema_version)}`);
  if (!seed.season || !seed.as_of_date || !seed.source_name || !seed.retrieved_at) {
    throw new Error('NFL demo seed is missing required snapshot metadata');
  }
  const teamIds = new Set(seed.teams.map((team) => team.team_id));
  if (teamIds.size !== 32) throw new Error(`NFL demo seed expected 32 teams, found ${teamIds.size}`);

  const rosterKeys = new Set<string>();
  const rosterPlayerKeys = new Set<string>();
  for (const row of seed.roster_entries) {
    if (!teamIds.has(row.team_id)) throw new Error(`NFL roster row references unknown team ${row.team_id}`);
    if (!row.player_id || !row.player_name || !row.roster_status || !row.contract_status) {
      throw new Error(`NFL roster row is incomplete for ${row.team_id}:${row.player_id}`);
    }
    const key = `${row.team_id}:${row.player_id}`;
    if (rosterKeys.has(key)) throw new Error(`NFL roster seed has duplicate row ${key}`);
    rosterKeys.add(key);
    rosterPlayerKeys.add(key);
  }

  const capKeys = new Set<string>();
  for (const row of seed.cap_rows) {
    if (!teamIds.has(row.team_id)) throw new Error(`NFL cap row references unknown team ${row.team_id}`);
    if (!row.player_id) continue;
    const key = `${row.team_id}:${row.player_id}`;
    if (capKeys.has(key)) throw new Error(`NFL cap seed has duplicate player row ${key}`);
    capKeys.add(key);
    if (!rosterPlayerKeys.has(key)) throw new Error(`NFL cap row ${key} is not on the official roster snapshot`);
    if (row.source_status === 'captured' && row.cap_number_2026 == null) {
      throw new Error(`captured NFL cap row ${key} is missing cap_number_2026`);
    }
    if (!row.contract_ledger_status || !row.contract_ledger_confidence) {
      throw new Error(`NFL cap row ${key} is missing contract ledger status/confidence`);
    }
    if (row.contract_years_remaining !== row.years_remaining) {
      throw new Error(`NFL cap row ${key} has years_remaining alias drift`);
    }
    if (
      row.source_status === 'captured'
      && row.cap_number_2026 != null
      && row.cap_number_2026 > 5_000_000
    ) {
      const missingLedgerFields = [
        ['dead_money_if_cut_2026', row.dead_money_if_cut_2026],
        ['cut_savings_2026', row.cut_savings_2026],
        ['post_june_1_dead_money_2026', row.post_june_1_dead_money_2026],
        ['post_june_1_cut_savings_2026', row.post_june_1_cut_savings_2026],
        ['trade_dead_money_2026', row.trade_dead_money_2026],
        ['trade_savings_2026', row.trade_savings_2026],
      ].filter(([, value]) => value == null).map(([field]) => field);
      if (missingLedgerFields.length > 0) {
        throw new Error(`high-cap NFL cap row ${key} is missing ledger fields: ${missingLedgerFields.join(', ')}`);
      }
      if (row.contract_ledger_confidence === 'source-needed') {
        throw new Error(`high-cap NFL cap row ${key} has source-needed contract ledger confidence`);
      }
    }
    if (row.source_status !== 'captured' && !row.source_note) {
      throw new Error(`NFL cap row ${key} needs source_note for ${row.source_status}`);
    }
  }

  for (const key of rosterPlayerKeys) {
    if (!capKeys.has(key)) throw new Error(`NFL roster player ${key} has no cap row`);
  }

  const metricKeys = new Set<string>();
  for (const row of seed.player_metrics) {
    if (!teamIds.has(row.team_id)) throw new Error(`NFL metric row references unknown team ${row.team_id}`);
    const key = `${row.team_id}:${row.player_id}`;
    if (metricKeys.has(key)) throw new Error(`NFL metric seed has duplicate player row ${key}`);
    metricKeys.add(key);
    if (!rosterPlayerKeys.has(key)) throw new Error(`NFL metric row ${key} is not on the official roster snapshot`);
    if ((row.source_status ?? 'roster-derived') !== 'captured' && !row.metric_gap_reason && (row.source_status ?? 'roster-derived') !== 'roster-derived') {
      throw new Error(`NFL metric row ${key} needs metric_gap_reason for ${row.source_status}`);
    }
  }

  for (const key of rosterPlayerKeys) {
    if (!metricKeys.has(key)) throw new Error(`NFL roster player ${key} has no metric row`);
  }

  for (const teamId of teamIds) {
    const rosterCount = seed.roster_entries.filter((row) => row.team_id === teamId).length;
    const capCount = seed.cap_rows.filter((row) => row.team_id === teamId && row.player_id).length;
    const metricCount = seed.player_metrics.filter((row) => row.team_id === teamId).length;
    if (rosterCount < 70) throw new Error(`NFL roster seed has implausibly few rows for ${teamId}: ${rosterCount}`);
    if (capCount !== rosterCount) {
      throw new Error(`NFL cap seed row parity failed for ${teamId}: roster=${rosterCount} cap=${capCount}`);
    }
    if (metricCount !== rosterCount) {
      throw new Error(`NFL metric seed row parity failed for ${teamId}: roster=${rosterCount} metrics=${metricCount}`);
    }
  }
  for (const row of seed.team_cap_summaries ?? []) {
    if (!teamIds.has(row.team_id)) throw new Error(`NFL team cap summary references unknown team ${row.team_id}`);
    validateTeamCapSummary(row);
  }
  return summarizeNflDemoSeed(seed);
}

export function summarizeNflDemoSeed(seed: NflDemoSeed): NflDemoSummary {
  const rosterRows = seed.roster_entries.length;
  const playerCapRows = seed.cap_rows.filter((row) => row.player_id).length;
  return {
    season: seed.season,
    as_of_date: seed.as_of_date,
    team_count: seed.teams.length,
    roster_row_count: rosterRows,
    cap_row_count: seed.cap_rows.length,
    player_metric_row_count: seed.player_metrics.length,
    source_needed_cap_row_count: seed.cap_rows.filter((row) => row.source_status === 'source-needed').length,
    cap_row_parity: playerCapRows === rosterRows,
  };
}

export async function seedNflDemoData(seed: NflDemoSeed): Promise<NflDemoSummary & {
  roster_snapshot_id: string;
  cap_snapshot_id: string;
  player_metric_snapshot_id: string;
}> {
  const { db } = await import('../db/client.js');
  const summary = validateNflDemoSeed(seed);

  await throwIfError(await db.from('nfl_teams').upsert(seed.teams, { onConflict: 'team_id' }), 'nfl_teams upsert');
  await throwIfError(await db.from('nfl_players').upsert(playersFromSeed(seed), { onConflict: 'player_id' }), 'nfl_players upsert');

  const rosterSnapshot = await db
    .from('nfl_roster_snapshots')
    .upsert(rosterCapSnapshotRow(seed, summary.roster_row_count), { onConflict: 'season,as_of_date,source_name' })
    .select('id')
    .single();
  if (rosterSnapshot.error || !rosterSnapshot.data) {
    throw new Error(`nfl_roster_snapshots upsert failed: ${rosterSnapshot.error?.message ?? 'no row returned'}`);
  }
  const rosterSnapshotId = (rosterSnapshot.data as { id: string }).id;
  await throwIfError(await db.from('nfl_roster_entries').delete().eq('snapshot_id', rosterSnapshotId), 'nfl_roster_entries cleanup');
  await insertChunks('nfl_roster_entries', seed.roster_entries.map((entry) => ({
    snapshot_id: rosterSnapshotId,
    team_id: entry.team_id,
    player_id: entry.player_id,
    season: seed.season,
    source_order: entry.source_order,
    jersey_number: entry.jersey_number ?? null,
    position: entry.position,
    age: entry.age,
    roster_status: entry.roster_status,
    contract_status: entry.contract_status,
    height_inches: entry.height_inches ?? null,
    weight_lbs: entry.weight_lbs ?? null,
    experience: entry.experience ?? null,
    college: entry.college ?? null,
    source_url: entry.source_url,
    source_note: entry.source_note,
    source_row: entry,
  })));

  const capSnapshot = await db
    .from('nfl_cap_sheet_snapshots')
    .upsert(rosterCapSnapshotRow(seed, summary.roster_row_count), { onConflict: 'season,as_of_date,source_name' })
    .select('id')
    .single();
  if (capSnapshot.error || !capSnapshot.data) {
    throw new Error(`nfl_cap_sheet_snapshots upsert failed: ${capSnapshot.error?.message ?? 'no row returned'}`);
  }
  const capSnapshotId = (capSnapshot.data as { id: string }).id;
  await throwIfError(await db.from('nfl_cap_sheet_salary_cells').delete().eq('snapshot_id', capSnapshotId), 'nfl_cap_sheet_salary_cells cleanup');
  await throwIfError(await db.from('nfl_cap_sheet_player_rows').delete().eq('snapshot_id', capSnapshotId), 'nfl_cap_sheet_player_rows cleanup');
  await throwIfError(await db.from('nfl_cap_sheets').delete().eq('snapshot_id', capSnapshotId), 'nfl_cap_sheets cleanup');
  await insertChunks('nfl_cap_sheets', teamCapSheetRows(seed, capSnapshotId));
  const capPlayerRows = capPlayerRowsFromSeed(seed, capSnapshotId);
  await insertChunks('nfl_cap_sheet_player_rows', capPlayerRows);
  await insertChunks('nfl_cap_sheet_salary_cells', capSalaryCellsFromPlayerRows(capPlayerRows, capSnapshotId));

  const metricSnapshot = await db
    .from('nfl_player_metric_snapshots')
    .upsert(metricSnapshotRow(seed, summary.player_metric_row_count), { onConflict: 'season,as_of_date,source_name' })
    .select('id')
    .single();
  if (metricSnapshot.error || !metricSnapshot.data) {
    throw new Error(`nfl_player_metric_snapshots upsert failed: ${metricSnapshot.error?.message ?? 'no row returned'}`);
  }
  const metricSnapshotId = (metricSnapshot.data as { id: string }).id;
  await throwIfError(await db.from('nfl_player_metric_rows').delete().eq('snapshot_id', metricSnapshotId), 'nfl_player_metric_rows cleanup');
  await insertChunks('nfl_player_metric_rows', seed.player_metrics.map((row) => ({
    snapshot_id: metricSnapshotId,
    team_id: row.team_id,
    player_id: row.player_id,
    player_name: row.player_name,
    position: row.position,
    snaps_2025: row.snaps_2025,
    offense_snaps_2025: row.offense_snaps_2025 ?? null,
    defense_snaps_2025: row.defense_snaps_2025 ?? null,
    special_teams_snaps_2025: row.special_teams_snaps_2025 ?? null,
    snap_share_2025: row.snap_share_2025 ?? null,
    games_2025: row.games_2025,
    starts_2025: row.starts_2025 ?? null,
    passing_yards_2025: row.passing_yards_2025 ?? null,
    rushing_yards_2025: row.rushing_yards_2025 ?? null,
    receiving_yards_2025: row.receiving_yards_2025 ?? null,
    scrimmage_yards_2025: row.scrimmage_yards_2025 ?? null,
    tackles_2025: row.tackles_2025 ?? null,
    sacks_2025: row.sacks_2025 ?? null,
    interceptions_2025: row.interceptions_2025 ?? null,
    touchdowns_2025: row.touchdowns_2025 ?? null,
    availability_risk: row.availability_risk,
    role: row.role,
    value_tier: row.value_tier,
    metric_note: row.metric_note,
    metric_source_family: row.metric_source_family ?? null,
    metric_gap_reason: row.metric_gap_reason ?? null,
    metric_coverage_level: row.metric_coverage_level ?? (row.source_status === 'captured' ? 'directional' : 'gap'),
    metric_confidence: row.metric_confidence ?? (row.source_status === 'captured' ? 'derived' : 'source-needed'),
    metric_families: row.metric_families ?? (row.metric_source_family ? row.metric_source_family.split('+') : []),
    position_metric_summary: row.position_metric_summary ?? null,
    position_metrics: objectRecord(row.position_metrics),
    quality_flags: row.quality_flags ?? [],
    source_url: row.source_url,
    source_status: row.source_status ?? 'roster-derived',
    source_data: row,
  })));

  return {
    ...summary,
    roster_snapshot_id: rosterSnapshotId,
    cap_snapshot_id: capSnapshotId,
    player_metric_snapshot_id: metricSnapshotId,
  };
}

export function groupNflTeams(seed: NflDemoSeed) {
  const rosterCounts = countByTeam(seed.roster_entries);
  const capCounts = countByTeam(seed.cap_rows.filter((row) => row.player_id));
  const metricCounts = countByTeam(seed.player_metrics);
  const sourceNeededCounts = countByTeam(seed.cap_rows.filter((row) => row.player_id && row.source_status === 'source-needed'));
  return {
    snapshot: snapshot(seed),
    teams: seed.teams.map((team) => ({
      ...team,
      roster_count: rosterCounts[team.team_id] ?? 0,
      cap_row_count: capCounts[team.team_id] ?? 0,
      player_metric_row_count: metricCounts[team.team_id] ?? 0,
      source_needed_cap_row_count: sourceNeededCounts[team.team_id] ?? 0,
    })),
    totals: summarizeNflDemoSeed(seed),
  };
}

export function nflTeamDetail(seed: NflDemoSeed, teamId: string) {
  const team = seed.teams.find((row) => row.team_id === teamId) ?? null;
  if (!team) return null;
  return {
    snapshot: snapshot(seed),
    team,
    roster_entries: seed.roster_entries.filter((row) => row.team_id === teamId).sort((a, b) => a.source_order - b.source_order),
    cap_rows: seed.cap_rows.filter((row) => row.team_id === teamId).sort((a, b) => (a.source_order ?? 9999) - (b.source_order ?? 9999)),
    player_metrics: seed.player_metrics.filter((row) => row.team_id === teamId),
    team_cap_summary: seed.team_cap_summaries?.find((row) => row.team_id === teamId) ?? null,
    source_refs: seed.source_refs,
    notes: seed.notes,
  };
}

export function snapshot(seed: NflDemoSeed) {
  return {
    season: seed.season,
    as_of_date: seed.as_of_date,
    source_name: seed.source_name,
    source_url: seed.source_url,
    retrieved_at: seed.retrieved_at,
    notes: seed.notes,
  };
}

function rosterCapSnapshotRow(seed: NflDemoSeed, playerCount: number) {
  return {
    season: seed.season,
    as_of_date: seed.as_of_date,
    source_name: seed.source_name,
    source_url: seed.source_url,
    retrieved_at: seed.retrieved_at,
    team_count: seed.teams.length,
    player_count: playerCount,
    notes: seed.notes.join('\n'),
    source_meta: {
      source_refs: seed.source_refs,
      source_needed_cap_row_count: seed.cap_rows.filter((row) => row.source_status === 'source-needed').length,
      estimated_cap_row_count: seed.cap_rows.filter((row) => row.source_status === 'estimated').length,
      contract_ledger_status_counts: countByField(seed.cap_rows.filter((row) => row.player_id), 'contract_ledger_status'),
      contract_ledger_confidence_counts: countByField(seed.cap_rows.filter((row) => row.player_id), 'contract_ledger_confidence'),
    },
  };
}

function metricSnapshotRow(seed: NflDemoSeed, rowCount: number) {
  return {
    season: seed.season,
    as_of_date: seed.as_of_date,
    source_name: seed.source_name,
    source_url: seed.source_url,
    retrieved_at: seed.retrieved_at,
    team_count: seed.teams.length,
    row_count: rowCount,
    notes: seed.notes.join('\n'),
    source_meta: {
      source_refs: seed.source_refs,
      source_needed_cap_row_count: seed.cap_rows.filter((row) => row.source_status === 'source-needed').length,
      metric_source_status_counts: countByField(seed.player_metrics, 'source_status'),
    },
  };
}

function playersFromSeed(seed: NflDemoSeed) {
  return seed.roster_entries.map((entry) => {
    const [firstName, ...lastParts] = entry.player_name.split(' ');
    return {
      player_id: entry.player_id,
      player_name: entry.player_name,
      first_name: firstName || null,
      last_name: lastParts.join(' ') || null,
      position: entry.position,
      jersey_number: entry.jersey_number ?? null,
      height_inches: entry.height_inches ?? null,
      weight_lbs: entry.weight_lbs ?? null,
      experience: entry.experience ?? null,
      college: entry.college ?? null,
      source_url: entry.source_url,
      source_row: entry,
    };
  });
}

function teamCapSheetRows(seed: NflDemoSeed, snapshotId: string) {
  return seed.teams.map((team) => {
    const rosterRows = seed.roster_entries.filter((row) => row.team_id === team.team_id);
    const playerRows = seed.cap_rows.filter((row) => row.team_id === team.team_id && row.player_id);
    const teamSummary = seed.team_cap_summaries?.find((row) => row.team_id === team.team_id) ?? null;
    const sourceNeededCount = playerRows.filter((row) => row.source_status === 'source-needed').length;
    const estimatedCount = playerRows.filter((row) => row.source_status === 'estimated').length;
    return {
      snapshot_id: snapshotId,
      team_id: team.team_id,
      official_roster_count: rosterRows.length,
      player_cap_row_count: playerRows.length,
      source_needed_count: sourceNeededCount,
      total_cap_number_2026: sumNullable(playerRows.map((row) => row.cap_number_2026)),
      total_restructure_savings_2026: sumNullable(playerRows.map((row) => row.restructure_savings_estimate_2026)),
      total_cut_savings_2026: sumNullable(playerRows.map((row) => row.cut_savings_2026)),
      current_cap_space_2026: teamSummary?.current_cap_space_dollars ?? null,
      effective_cap_space_2026: teamSummary?.effective_cap_space_dollars ?? null,
      league_cap_2026: teamSummary?.league_cap_dollars ?? null,
      applied_team_cap_2026: teamSummary?.applied_team_cap_dollars ?? null,
      carryover_2026: teamSummary?.carryover_dollars ?? null,
      adjustments_2026: teamSummary?.adjustments_dollars ?? null,
      top_51_cap_spending_2026: teamSummary?.top_51_cap_spending_dollars ?? null,
      dead_money_2026: teamSummary?.dead_money_dollars ?? null,
      cap_accounting_basis: teamSummary?.accounting_basis ?? null,
      cap_summary_as_of_date: teamSummary?.as_of_date ?? null,
      cap_summary_source_urls: teamSummary?.source_urls ?? [],
      source_status: sourceNeededCount === 0 && estimatedCount === 0 ? 'captured' : 'partial',
      source_refs: seed.source_refs,
      source_meta: {
        roster_count: rosterRows.length,
        cap_row_count: playerRows.length,
        estimated_cap_row_count: estimatedCount,
        ...(teamSummary ? {
          team_cap_summary: {
            season: teamSummary.season,
            accounting_note: teamSummary.accounting_note,
            source_status: teamSummary.source_status,
            source_content_sha256: teamSummary.source_content_sha256,
          },
        } : {}),
      },
    };
  });
}

function capPlayerRowsFromSeed(seed: NflDemoSeed, snapshotId: string) {
  return seed.cap_rows
    .filter((row) => row.player_id)
    .map((row) => ({
      id: `${snapshotId}:${row.team_id}:${row.player_id}`,
      snapshot_id: snapshotId,
      team_id: row.team_id,
      player_id: row.player_id,
      player_name: row.player_name,
      source_order: row.source_order ?? 9999,
      position: row.position,
      cap_number_2026: row.cap_number_2026,
      cash_due_2026: row.cash_due_2026,
      total_value_remaining: row.total_value_remaining,
      years_remaining: row.years_remaining,
      contract_end_year: row.contract_end_year,
      contract_years_remaining: row.contract_years_remaining,
      void_year_count: row.void_year_count,
      void_years_source_status: row.void_years_source_status,
      guaranteed_remaining: row.guaranteed_remaining,
      dead_money_if_cut_2026: row.dead_money_if_cut_2026,
      cut_savings_2026: row.cut_savings_2026,
      post_june_1_dead_money_2026: row.post_june_1_dead_money_2026,
      post_june_1_cut_savings_2026: row.post_june_1_cut_savings_2026,
      trade_dead_money_2026: row.trade_dead_money_2026,
      trade_savings_2026: row.trade_savings_2026,
      post_june_1_trade_dead_money_2026: row.post_june_1_trade_dead_money_2026,
      post_june_1_trade_savings_2026: row.post_june_1_trade_savings_2026,
      restructure_savings_estimate_2026: row.restructure_savings_estimate_2026,
      extension_savings_estimate_2026: row.extension_savings_estimate_2026,
      contract_ledger_status: row.contract_ledger_status,
      contract_ledger_confidence: row.contract_ledger_confidence,
      tag_eligible_2027: row.tag_eligible_2027,
      contract_lever: row.contract_lever,
      source_url: row.source_url,
      source_status: row.source_status,
      source_data: row.source_data ?? {},
    }));
}

function capSalaryCellsFromPlayerRows(
  rows: ReturnType<typeof capPlayerRowsFromSeed>,
  snapshotId: string,
): Record<string, unknown>[] {
  return rows.flatMap((row) => {
    const sourceData = objectRecord(row.source_data);
    const contractYears = Array.isArray(sourceData.contract_years)
      ? sourceData.contract_years.map(objectRecord).filter((value) => typeof value.season === 'string')
      : [];
    if (contractYears.length === 0) {
      return [{
        player_row_id: row.id,
        snapshot_id: snapshotId,
        team_id: row.team_id,
        season: '2026',
        amount: row.cap_number_2026,
        label: '2026 cap number',
        option_type: null,
        is_guaranteed: row.guaranteed_remaining != null ? row.guaranteed_remaining > 0 : null,
        source_status: row.source_status === 'captured' ? 'captured' : row.source_status === 'estimated' ? 'estimated' : 'source-needed',
        source_url: row.source_url,
        source_data: row.source_data,
      }];
    }
    return contractYears.map((contractYear) => {
      const season = String(contractYear.season);
      const guaranteed = numberRecordValue(contractYear.guaranteed_salary);
      return {
        player_row_id: row.id,
        snapshot_id: snapshotId,
        team_id: row.team_id,
        season,
        amount: numberRecordValue(contractYear.cap_number),
        label: `${season} cap number`,
        option_type: Boolean(contractYear.void_year_candidate) ? 'void_year_candidate' : null,
        is_guaranteed: guaranteed != null ? guaranteed > 0 : null,
        source_status: row.source_status === 'captured' ? 'captured' : row.source_status === 'estimated' ? 'estimated' : 'source-needed',
        source_url: typeof contractYear.source_url === 'string' ? contractYear.source_url : row.source_url,
        source_data: contractYear,
      };
    });
  });
}

async function loadCurrentNflDataFromDb(): Promise<NflDemoSeed> {
  const [teamRows, rosterRowsRaw, capRowsRaw, metricRowsRaw, capSheetRowsRaw] = await Promise.all([
    fetchAllRows('nfl_teams', [{ column: 'team_id' }]),
    fetchAllRows('nfl_current_roster_entries', [{ column: 'team_id' }, { column: 'source_order' }], {
      selectColumns: NFL_CURRENT_ROSTER_ENTRY_SELECT,
    }),
    fetchAllRows('nfl_current_cap_sheet_player_rows', [{ column: 'team_id' }, { column: 'source_order' }], {
      selectColumns: NFL_CURRENT_CAP_PLAYER_SELECT,
    }),
    fetchAllRows('nfl_current_player_metric_rows', [{ column: 'team_id' }, { column: 'player_name' }], {
      selectColumns: NFL_CURRENT_PLAYER_METRIC_SELECT,
    }),
    fetchAllRows('nfl_current_cap_sheets', [{ column: 'team_id' }], {
      selectColumns: NFL_CURRENT_CAP_SHEET_SELECT,
    }),
  ]);
  const rosterRows = rosterRowsRaw as CurrentNflRosterEntryRow[];
  if (rosterRows.length === 0) throw new Error('no current NFL roster rows found in Supabase current views');
  const first = rosterRows[0];
  const sourceMeta = objectRecord(first.snapshot_source_meta);
  const seed: NflDemoSeed = {
    schema_version: 1,
    season: first.season,
    as_of_date: first.as_of_date,
    source_name: first.source_name,
    source_url: first.source_url,
    retrieved_at: first.retrieved_at,
    notes: splitNotes(first.snapshot_notes),
    teams: (teamRows as NflDemoTeam[]).sort((a, b) => a.team_id.localeCompare(b.team_id)),
    roster_entries: rosterRows.map(dbRosterRowToSeed),
    cap_rows: (capRowsRaw as CurrentNflCapRow[]).map(dbCapRowToSeed),
    player_metrics: (metricRowsRaw as CurrentNflMetricRow[]).map(dbMetricRowToSeed),
    source_refs: Array.isArray(sourceMeta.source_refs) ? sourceMeta.source_refs as NflSourceRef[] : [],
    team_cap_summaries: (capSheetRowsRaw as CurrentNflCapSheetRow[]).flatMap(dbCapSheetRowToSummary),
  };
  validateDbSnapshotCoherence(rosterRows, capRowsRaw as CurrentNflCapRow[], metricRowsRaw as CurrentNflMetricRow[]);
  validateNflDemoSeed(seed);
  return seed;
}

async function loadCurrentNflTeamDataFromDb(teamId: string): Promise<NflDemoSeed> {
  const filter = [{ column: 'team_id', value: teamId }];
  const [teamRows, rosterRowsRaw, capRowsRaw, metricRowsRaw, capSheetRowsRaw] = await Promise.all([
    fetchAllRows('nfl_teams', [{ column: 'team_id' }], { filters: filter }),
    fetchAllRows('nfl_current_roster_entries', [{ column: 'source_order' }], { selectColumns: NFL_CURRENT_ROSTER_ENTRY_SELECT, filters: filter }),
    fetchAllRows('nfl_current_cap_sheet_player_rows', [{ column: 'source_order' }], { selectColumns: NFL_CURRENT_CAP_PLAYER_SELECT, filters: filter }),
    fetchAllRows('nfl_current_player_metric_rows', [{ column: 'player_name' }], { selectColumns: NFL_CURRENT_PLAYER_METRIC_SELECT, filters: filter }),
    fetchAllRows('nfl_current_cap_sheets', [{ column: 'team_id' }], { selectColumns: NFL_CURRENT_CAP_SHEET_SELECT, filters: filter }),
  ]);
  const rosterRows = rosterRowsRaw as CurrentNflRosterEntryRow[];
  const capRows = capRowsRaw as CurrentNflCapRow[];
  const metricRows = metricRowsRaw as CurrentNflMetricRow[];
  const first = rosterRows[0];
  if (!first || teamRows.length !== 1) throw new Error(`no current NFL rows found for ${teamId}`);
  validateDbSnapshotCoherence(rosterRows, capRows, metricRows);
  if (rosterRows.length !== capRows.length || rosterRows.length !== metricRows.length) {
    throw new Error(`current NFL ${teamId} views fail roster/cap/metric parity`);
  }
  const sourceMeta = objectRecord(first.snapshot_source_meta);
  return {
    schema_version: 1,
    season: first.season,
    as_of_date: first.as_of_date,
    source_name: first.source_name,
    source_url: first.source_url,
    retrieved_at: first.retrieved_at,
    notes: splitNotes(first.snapshot_notes),
    teams: teamRows as NflDemoTeam[],
    roster_entries: rosterRows.map(dbRosterRowToSeed),
    cap_rows: capRows.map(dbCapRowToSeed),
    player_metrics: metricRows.map(dbMetricRowToSeed),
    source_refs: Array.isArray(sourceMeta.source_refs) ? sourceMeta.source_refs as NflSourceRef[] : [],
    team_cap_summaries: (capSheetRowsRaw as CurrentNflCapSheetRow[]).flatMap(dbCapSheetRowToSummary),
  };
}

async function fetchAllRows(
  table: string,
  orderBy: Array<{ column: string; ascending?: boolean }>,
  options: { pageSize?: number; selectColumns?: string; filters?: Array<{ column: string; value: string }> } = {},
): Promise<unknown[]> {
  const { db } = await import('../db/client.js');
  const rows: unknown[] = [];
  const pageSize = options.pageSize ?? 1000;
  const selectColumns = options.selectColumns ?? '*';
  for (let offset = 0; ; offset += pageSize) {
    let query = db.from(table).select(selectColumns) as any;
    for (const filter of options.filters ?? []) query = query.eq(filter.column, filter.value);
    for (const order of orderBy) {
      query = query.order(order.column, { ascending: order.ascending ?? true });
    }
    const { data, error } = await query.range(offset, offset + pageSize - 1);
    if (error) throw new Error(`${table} query failed: ${error.message}`);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

const NFL_CURRENT_ROSTER_ENTRY_SELECT = [
  'snapshot_id',
  'season',
  'as_of_date',
  'source_name',
  'source_url',
  'retrieved_at',
  'snapshot_team_count',
  'snapshot_player_count',
  'snapshot_notes',
  'snapshot_source_meta',
  'team_id',
  'abbreviation',
  'full_name',
  'conference',
  'division',
  'official_roster_count',
  'player_id',
  'player_name',
  'source_order',
  'jersey_number',
  'position',
  'age',
  'roster_status',
  'contract_status',
  'height_inches',
  'weight_lbs',
  'experience',
  'college',
  'player_source_url',
  'entry_source_url',
  'source_note',
].join(',');

const NFL_CURRENT_CAP_PLAYER_SELECT = [
  'snapshot_id',
  'season',
  'as_of_date',
  'source_name',
  'snapshot_source_url',
  'retrieved_at',
  'snapshot_team_count',
  'snapshot_player_count',
  'snapshot_notes',
  'snapshot_source_meta',
  'team_id',
  'abbreviation',
  'full_name',
  'conference',
  'division',
  'id',
  'player_id',
  'player_name',
  'source_order',
  'position',
  'cap_number_2026',
  'cash_due_2026',
  'total_value_remaining',
  'years_remaining',
  'contract_end_year',
  'contract_years_remaining',
  'void_year_count',
  'void_years_source_status',
  'guaranteed_remaining',
  'dead_money_if_cut_2026',
  'cut_savings_2026',
  'post_june_1_dead_money_2026',
  'post_june_1_cut_savings_2026',
  'trade_dead_money_2026',
  'trade_savings_2026',
  'post_june_1_trade_dead_money_2026',
  'post_june_1_trade_savings_2026',
  'restructure_savings_estimate_2026',
  'extension_savings_estimate_2026',
  'contract_ledger_status',
  'contract_ledger_confidence',
  'tag_eligible_2027',
  'contract_lever',
  'source_url',
  'source_status',
  'source_data',
].join(',');

const NFL_CURRENT_CAP_SHEET_SELECT = [
  'season',
  'team_id',
  'current_cap_space_2026',
  'effective_cap_space_2026',
  'league_cap_2026',
  'applied_team_cap_2026',
  'carryover_2026',
  'adjustments_2026',
  'top_51_cap_spending_2026',
  'dead_money_2026',
  'cap_accounting_basis',
  'cap_summary_as_of_date',
  'cap_summary_source_urls',
  'source_meta',
].join(',');

const NFL_CURRENT_PLAYER_METRIC_SELECT = [
  'snapshot_id',
  'season',
  'as_of_date',
  'source_name',
  'snapshot_source_url',
  'retrieved_at',
  'snapshot_team_count',
  'snapshot_row_count',
  'snapshot_notes',
  'snapshot_source_meta',
  'team_id',
  'abbreviation',
  'full_name',
  'conference',
  'division',
  'player_id',
  'player_name',
  'position',
  'snaps_2025',
  'offense_snaps_2025',
  'defense_snaps_2025',
  'special_teams_snaps_2025',
  'snap_share_2025',
  'games_2025',
  'starts_2025',
  'passing_yards_2025',
  'rushing_yards_2025',
  'receiving_yards_2025',
  'scrimmage_yards_2025',
  'tackles_2025',
  'sacks_2025',
  'interceptions_2025',
  'touchdowns_2025',
  'availability_risk',
  'role',
  'value_tier',
  'metric_note',
  'metric_source_family',
  'metric_gap_reason',
  'source_url',
  'source_status',
  'metric_coverage_level',
  'metric_confidence',
  'metric_families',
  'position_metric_summary',
  'position_metrics',
  'quality_flags',
].join(',');

function validateDbSnapshotCoherence(
  rosterRows: CurrentNflRosterEntryRow[],
  capRows: CurrentNflCapRow[],
  metricRows: CurrentNflMetricRow[],
): void {
  const first = rosterRows[0];
  if (!first) throw new Error('no current NFL roster rows found in Supabase current views');
  for (const [label, rows] of [['roster', rosterRows], ['cap', capRows], ['metrics', metricRows]] as const) {
    if (rows.length === 0) throw new Error(`no current NFL ${label} rows found in Supabase current views`);
    for (const row of rows) {
      if (row.season !== first.season || row.as_of_date !== first.as_of_date || row.retrieved_at !== first.retrieved_at) {
        throw new Error(`current NFL ${label} view is not coherent with the roster snapshot`);
      }
    }
  }
}

function dbRosterRowToSeed(row: CurrentNflRosterEntryRow): NflRosterEntry {
  return {
    team_id: row.team_id,
    player_id: row.player_id,
    player_name: row.player_name,
    position: row.position,
    age: row.age,
    roster_status: row.roster_status,
    contract_status: row.contract_status,
    source_order: row.source_order,
    source_url: row.entry_source_url ?? row.player_source_url,
    source_note: row.source_note,
    jersey_number: row.jersey_number,
    height_inches: row.height_inches,
    weight_lbs: row.weight_lbs,
    experience: row.experience,
    college: row.college,
  };
}

function dbCapRowToSeed(row: CurrentNflCapRow): NflCapRow {
  return {
    team_id: row.team_id,
    player_id: row.player_id,
    player_name: row.player_name,
    position: row.position,
    cap_number_2026: row.cap_number_2026,
    cash_due_2026: row.cash_due_2026,
    total_value_remaining: row.total_value_remaining,
    years_remaining: row.years_remaining,
    contract_end_year: row.contract_end_year,
    contract_years_remaining: row.contract_years_remaining,
    void_year_count: row.void_year_count,
    void_years_source_status: row.void_years_source_status,
    guaranteed_remaining: row.guaranteed_remaining,
    dead_money_if_cut_2026: row.dead_money_if_cut_2026,
    cut_savings_2026: row.cut_savings_2026,
    post_june_1_dead_money_2026: row.post_june_1_dead_money_2026,
    post_june_1_cut_savings_2026: row.post_june_1_cut_savings_2026,
    trade_dead_money_2026: row.trade_dead_money_2026,
    trade_savings_2026: row.trade_savings_2026,
    post_june_1_trade_dead_money_2026: row.post_june_1_trade_dead_money_2026,
    post_june_1_trade_savings_2026: row.post_june_1_trade_savings_2026,
    restructure_savings_estimate_2026: row.restructure_savings_estimate_2026,
    extension_savings_estimate_2026: row.extension_savings_estimate_2026,
    contract_ledger_status: row.contract_ledger_status,
    contract_ledger_confidence: row.contract_ledger_confidence,
    tag_eligible_2027: row.tag_eligible_2027,
    contract_lever: row.contract_lever,
    source_url: row.source_url,
    source_status: row.source_status,
    source_order: row.source_order,
    source_data: objectRecord(row.source_data),
    source_note: row.source_status === 'source-needed'
      ? 'Cap row exists for roster parity; public contract fields need review.'
      : row.source_status === 'estimated'
        ? 'Estimated low-cap/offseason contract placeholder; use for completeness, not exact legal modeling.'
        : 'Captured from public cap table.',
  };
}

function dbMetricRowToSeed(row: CurrentNflMetricRow): NflPlayerMetricRow {
  return {
    team_id: row.team_id,
    player_id: row.player_id,
    player_name: row.player_name,
    position: row.position,
    snaps_2025: row.snaps_2025,
    offense_snaps_2025: row.offense_snaps_2025,
    defense_snaps_2025: row.defense_snaps_2025,
    special_teams_snaps_2025: row.special_teams_snaps_2025,
    snap_share_2025: row.snap_share_2025,
    games_2025: row.games_2025,
    starts_2025: row.starts_2025,
    passing_yards_2025: row.passing_yards_2025,
    rushing_yards_2025: row.rushing_yards_2025,
    receiving_yards_2025: row.receiving_yards_2025,
    scrimmage_yards_2025: row.scrimmage_yards_2025,
    tackles_2025: row.tackles_2025,
    sacks_2025: row.sacks_2025,
    interceptions_2025: row.interceptions_2025,
    touchdowns_2025: row.touchdowns_2025,
    availability_risk: row.availability_risk,
    role: row.role,
    value_tier: row.value_tier,
    metric_note: row.metric_note,
    metric_source_family: row.metric_source_family,
    metric_gap_reason: row.metric_gap_reason,
    metric_coverage_level: row.metric_coverage_level,
    metric_confidence: row.metric_confidence,
    metric_families: arrayOfStrings(row.metric_families),
    position_metric_summary: row.position_metric_summary,
    position_metrics: objectRecord(row.position_metrics),
    quality_flags: arrayOfStrings(row.quality_flags),
    source_url: row.source_url,
    source_status: row.source_status,
    source_data: objectRecord(row.source_data),
  };
}

function dbCapSheetRowToSummary(row: CurrentNflCapSheetRow): NflTeamCapSummary[] {
  if (
    row.current_cap_space_2026 == null
    || row.league_cap_2026 == null
    || row.applied_team_cap_2026 == null
    || row.top_51_cap_spending_2026 == null
    || row.dead_money_2026 == null
    || !row.cap_summary_as_of_date
    || !row.cap_accounting_basis
  ) return [];
  const meta = objectRecord(row.source_meta);
  const summaryMeta = objectRecord(meta.team_cap_summary);
  const summary: NflTeamCapSummary = {
    team_id: row.team_id,
    season: typeof summaryMeta.season === 'string'
      ? summaryMeta.season
      : row.season.match(/\b20\d{2}\b/)?.[0] ?? row.season,
    as_of_date: row.cap_summary_as_of_date,
    current_cap_space_dollars: row.current_cap_space_2026,
    effective_cap_space_dollars: row.effective_cap_space_2026,
    league_cap_dollars: row.league_cap_2026,
    applied_team_cap_dollars: row.applied_team_cap_2026,
    carryover_dollars: row.carryover_2026,
    adjustments_dollars: row.adjustments_2026,
    top_51_cap_spending_dollars: row.top_51_cap_spending_2026,
    dead_money_dollars: row.dead_money_2026,
    accounting_basis: row.cap_accounting_basis,
    accounting_note: typeof summaryMeta.accounting_note === 'string' ? summaryMeta.accounting_note : '',
    source_status: summaryMeta.source_status === 'captured' ? 'captured' : 'source-needed',
    source_urls: arrayOfStrings(row.cap_summary_source_urls),
    source_content_sha256: objectRecord(summaryMeta.source_content_sha256) as Record<string, string>,
  };
  validateTeamCapSummary(summary);
  return [summary];
}

interface CurrentNflRosterEntryRow extends NflRosterEntry {
  season: string;
  as_of_date: string;
  source_name: string;
  source_url: string;
  retrieved_at: string;
  snapshot_notes: string | null;
  snapshot_source_meta: unknown;
  entry_source_url: string | null;
  player_source_url: string | null;
}

interface CurrentNflCapRow extends NflCapRow {
  source_order: number;
  season: string;
  as_of_date: string;
  retrieved_at: string;
}

interface CurrentNflMetricRow extends Omit<NflPlayerMetricRow, 'source_data' | 'metric_families' | 'position_metrics' | 'quality_flags'> {
  season: string;
  as_of_date: string;
  retrieved_at: string;
  source_status: 'captured' | 'roster-derived' | 'source-needed';
  metric_families: unknown;
  position_metrics: unknown;
  quality_flags: unknown;
  source_data: unknown;
}

interface CurrentNflCapSheetRow {
  season: string;
  team_id: string;
  current_cap_space_2026: number | null;
  effective_cap_space_2026: number | null;
  league_cap_2026: number | null;
  applied_team_cap_2026: number | null;
  carryover_2026: number | null;
  adjustments_2026: number | null;
  top_51_cap_spending_2026: number | null;
  dead_money_2026: number | null;
  cap_accounting_basis: string | null;
  cap_summary_as_of_date: string | null;
  cap_summary_source_urls: unknown;
  source_meta: unknown;
}

function arrayOfStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

async function insertChunks(table: string, rows: Record<string, unknown>[], size = 250) {
  const { db } = await import('../db/client.js');
  for (const chunk of chunks(rows, size)) {
    const inserted = await db.from(table).insert(chunk);
    if (inserted.error) throw new Error(`${table} insert failed: ${inserted.error.message}`);
  }
}

function chunks<T>(rows: T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < rows.length; index += size) output.push(rows.slice(index, index + size));
  return output;
}

async function throwIfError(result: { error: { message: string } | null }, label: string) {
  if (result.error) throw new Error(`${label} failed: ${result.error.message}`);
}

function countByTeam(rows: Array<{ team_id: string }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.team_id] = (counts[row.team_id] ?? 0) + 1;
  return counts;
}

function countByField<T extends object>(rows: T[], field: keyof T): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const value = String(row[field] ?? 'unknown');
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function sumNullable(values: Array<number | null | undefined>): number | null {
  const captured = values.filter((value): value is number => typeof value === 'number');
  if (captured.length === 0) return null;
  return captured.reduce((sum, value) => sum + value, 0);
}

function splitNotes(notes: string | null | undefined): string[] {
  return notes ? notes.split('\n').filter(Boolean) : [];
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberRecordValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function mergeSourceRefs(left: NflSourceRef[], right: NflSourceRef[]): NflSourceRef[] {
  const byId = new Map<string, NflSourceRef>();
  for (const source of [...left, ...right]) byId.set(source.id, source);
  return [...byId.values()];
}

function validateTeamCapSummary(row: NflTeamCapSummary): void {
  if (!row.team_id || !row.season || !/^\d{4}-\d{2}-\d{2}$/.test(row.as_of_date)) {
    throw new Error('NFL team cap summary metadata is incomplete');
  }
  const required = [
    row.current_cap_space_dollars,
    row.league_cap_dollars,
    row.applied_team_cap_dollars,
    row.top_51_cap_spending_dollars,
    row.dead_money_dollars,
  ];
  if (required.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error(`NFL team cap summary has invalid dollar values for ${row.team_id}`);
  }
  for (const value of [row.effective_cap_space_dollars, row.carryover_dollars, row.adjustments_dollars]) {
    if (value != null && !Number.isSafeInteger(value)) {
      throw new Error(`NFL team cap summary has invalid optional dollar values for ${row.team_id}`);
    }
  }
  if (row.top_51_cap_spending_dollars + row.dead_money_dollars + row.current_cap_space_dollars !== row.applied_team_cap_dollars) {
    throw new Error(`NFL team cap summary does not reconcile for ${row.team_id}`);
  }
  if (!row.accounting_basis || !row.accounting_note || row.source_urls.length < 2 || row.source_urls.some((url) => !/^https:\/\//.test(url))) {
    throw new Error(`NFL team cap summary sources are incomplete for ${row.team_id}`);
  }
}
