import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type {
  ListCurrentNbaPlayerStatsResponse,
  NbaPlayerStatRow,
  NbaPlayerStatSnapshot,
  NbaPlayerStatTeamDetail,
  NbaPlayerStatTeamSummary,
  NbaTeam,
} from '@shared/types';

export const DEFAULT_NBA_PLAYER_STATS_SEED_PATH = fileURLToPath(
  new URL('../../../data/nba-player-stats/2026-05-04.nba-advanced-stats.json', import.meta.url),
);

export interface NbaPlayerStatsSeedNote {
  label: string;
  value: string | null;
}

export interface NbaPlayerStatsSeedRow {
  team_id: string;
  nba_player_id: number | null;
  player_name: string;
  player_name_normalized: string;
  source_order: number;
  position: string | null;
  age: number;
  games_played: number;
  minutes: number;
  points_per_game: number;
  rebounds_per_game: number;
  assists_per_game: number;
  true_shooting_pct: number;
  effective_fg_pct: number;
  usage_pct: number;
  three_point_attempt_rate: number;
  free_throw_rate: number;
  offensive_rebound_pct: number;
  defensive_rebound_pct: number;
  rebound_pct: number;
  assist_pct: number;
  turnover_pct: number;
  offensive_rating: number;
  defensive_rating: number;
  net_rating: number;
  player_impact_estimate: number;
  defensive_win_shares: number;
  match_status: 'roster-matched' | 'stats-only';
  source_row: Record<string, unknown>;
}

export interface NbaPlayerStatsSeed {
  schema_version: 1;
  season: string;
  season_type: string;
  as_of_date: string;
  source_name: string;
  source_url: string;
  retrieved_at: string;
  teams: NbaTeam[];
  rows: NbaPlayerStatsSeedRow[];
  notes: NbaPlayerStatsSeedNote[];
  glossary: Record<string, string>;
  source_meta: Record<string, unknown>;
}

export interface NbaPlayerStatsSeedSummary {
  season: string;
  season_type: string;
  as_of_date: string;
  team_count: number;
  row_count: number;
  matched_player_count: number;
  unmatched_player_count: number;
  team_counts: Record<string, number>;
}

export interface CurrentPlayerStatViewRow {
  snapshot_id: string;
  season: string;
  season_type: string;
  as_of_date: string;
  source_name: string;
  source_url: string;
  retrieved_at: string;
  snapshot_team_count: number;
  snapshot_row_count: number;
  snapshot_matched_player_count: number;
  snapshot_unmatched_player_count: number;
  snapshot_notes: NbaPlayerStatsSeedNote[] | null;
  snapshot_glossary: Record<string, string> | null;
  snapshot_source_meta: Record<string, unknown> | null;
  team_id: string;
  nba_team_id: number;
  abbreviation: string;
  city: string;
  name: string;
  full_name: string;
  conference: string | null;
  division: string | null;
  nba_player_id: number | null;
  player_name: string;
  player_name_normalized: string;
  source_order: number;
  position: string | null;
  age: number;
  games_played: number;
  minutes: number;
  points_per_game: number;
  rebounds_per_game: number;
  assists_per_game: number;
  true_shooting_pct: number;
  effective_fg_pct: number;
  usage_pct: number;
  three_point_attempt_rate: number;
  free_throw_rate: number;
  offensive_rebound_pct: number;
  defensive_rebound_pct: number;
  rebound_pct: number;
  assist_pct: number;
  turnover_pct: number;
  offensive_rating: number;
  defensive_rating: number;
  net_rating: number;
  player_impact_estimate: number;
  defensive_win_shares: number;
  match_status: 'roster-matched' | 'stats-only';
  source_row: Record<string, unknown> | null;
}

export async function loadNbaPlayerStatsSeed(path = DEFAULT_NBA_PLAYER_STATS_SEED_PATH): Promise<NbaPlayerStatsSeed> {
  const raw = await readFile(path, 'utf8');
  const parsed = JSON.parse(raw) as NbaPlayerStatsSeed;
  validateNbaPlayerStatsSeed(parsed);
  return parsed;
}

export function summarizeNbaPlayerStatsSeed(seed: NbaPlayerStatsSeed): NbaPlayerStatsSeedSummary {
  const teamCounts: Record<string, number> = {};
  let matched = 0;
  let unmatched = 0;
  for (const row of seed.rows) {
    teamCounts[row.team_id] = (teamCounts[row.team_id] ?? 0) + 1;
    if (row.match_status === 'roster-matched') matched += 1;
    if (row.match_status === 'stats-only') unmatched += 1;
  }
  return {
    season: seed.season,
    season_type: seed.season_type,
    as_of_date: seed.as_of_date,
    team_count: Object.keys(teamCounts).length,
    row_count: seed.rows.length,
    matched_player_count: matched,
    unmatched_player_count: unmatched,
    team_counts: teamCounts,
  };
}

export function validateNbaPlayerStatsSeed(
  seed: NbaPlayerStatsSeed,
  opts: { expectedTeamCount?: number; expectedRowCount?: number } = {},
): NbaPlayerStatsSeedSummary {
  if (seed.schema_version !== 1) {
    throw new Error(`unsupported NBA player stats seed schema_version=${String(seed.schema_version)}`);
  }
  if (!seed.season || !seed.season_type || !seed.as_of_date || !seed.source_name || !seed.source_url || !seed.retrieved_at) {
    throw new Error('NBA player stats seed is missing required snapshot metadata');
  }

  const teamIds = new Set(seed.teams.map((team) => team.team_id));
  if (teamIds.size !== seed.teams.length) throw new Error('NBA player stats seed has duplicate teams');
  const expectedTeamCount = opts.expectedTeamCount ?? 30;
  if (teamIds.size !== expectedTeamCount) {
    throw new Error(`NBA player stats seed expected ${expectedTeamCount} teams, found ${teamIds.size}`);
  }
  if (opts.expectedRowCount !== undefined && seed.rows.length !== opts.expectedRowCount) {
    throw new Error(`NBA player stats seed expected ${opts.expectedRowCount} rows, found ${seed.rows.length}`);
  }

  const seen = new Set<string>();
  for (const row of seed.rows) {
    if (!teamIds.has(row.team_id)) {
      throw new Error(`NBA player stats row references unknown team ${row.team_id}`);
    }
    if (!row.player_name || !row.player_name_normalized) {
      throw new Error('NBA player stats row is missing player name fields');
    }
    const key = `${row.team_id}:${row.player_name_normalized}`;
    if (seen.has(key)) throw new Error(`NBA player stats seed has duplicate row ${key}`);
    seen.add(key);
    if (row.match_status === 'roster-matched' && row.nba_player_id === null) {
      throw new Error(`NBA player stats matched row is missing nba_player_id for ${key}`);
    }
    if (row.match_status === 'stats-only' && row.nba_player_id !== null) {
      throw new Error(`NBA player stats-only row should not have nba_player_id for ${key}`);
    }
  }

  const summary = summarizeNbaPlayerStatsSeed(seed);
  if (summary.team_count !== expectedTeamCount) {
    throw new Error(`NBA player stats seed expected stats for ${expectedTeamCount} teams, found ${summary.team_count}`);
  }
  return summary;
}

export async function seedNbaPlayerStats(seed: NbaPlayerStatsSeed): Promise<NbaPlayerStatsSeedSummary & { snapshot_id: string }> {
  const { db } = await import('../db/client.js');
  const summary = validateNbaPlayerStatsSeed(seed);

  const teams = await db.from('nba_teams').upsert(seed.teams, { onConflict: 'team_id' });
  if (teams.error) throw new Error(`nba_teams upsert for player stats failed: ${teams.error.message}`);

  const snapshotRow = {
    season: seed.season,
    season_type: seed.season_type,
    as_of_date: seed.as_of_date,
    source_name: seed.source_name,
    source_url: seed.source_url,
    retrieved_at: seed.retrieved_at,
    team_count: summary.team_count,
    row_count: summary.row_count,
    matched_player_count: summary.matched_player_count,
    unmatched_player_count: summary.unmatched_player_count,
    notes: seed.notes,
    glossary: seed.glossary,
    source_meta: {
      ...seed.source_meta,
      team_counts: summary.team_counts,
    },
  };

  const snapshot = await db
    .from('nba_player_stat_snapshots')
    .upsert(snapshotRow, { onConflict: 'season,season_type,as_of_date,source_name' })
    .select()
    .single();
  if (snapshot.error || !snapshot.data) {
    throw new Error(`nba_player_stat_snapshots upsert failed: ${snapshot.error?.message ?? 'no row returned'}`);
  }

  const snapshotId = (snapshot.data as { id: string }).id;
  const cleared = await db.from('nba_player_stat_rows').delete().eq('snapshot_id', snapshotId);
  if (cleared.error) throw new Error(`nba_player_stat_rows cleanup failed: ${cleared.error.message}`);

  const rows = seed.rows.map((row) => ({ ...row, snapshot_id: snapshotId }));
  for (const chunk of chunks(rows, 250)) {
    const inserted = await db.from('nba_player_stat_rows').insert(chunk);
    if (inserted.error) throw new Error(`nba_player_stat_rows insert failed: ${inserted.error.message}`);
  }

  return { ...summary, snapshot_id: snapshotId };
}

export function groupCurrentPlayerStatRows(rows: CurrentPlayerStatViewRow[]): ListCurrentNbaPlayerStatsResponse {
  if (rows.length === 0) {
    return {
      snapshot: null,
      teams: [],
      totals: { team_count: 0, player_stat_row_count: 0, matched_player_count: 0, stats_only_count: 0 },
    };
  }

  const latestKey = rows
    .map((row) => ({ id: row.snapshot_id, asOf: row.as_of_date, retrieved: row.retrieved_at }))
    .sort((a, b) => compareSnapshotKeys(b, a))[0];
  const latestRows = rows.filter((row) => row.snapshot_id === latestKey.id);
  const snapshot = snapshotFromRow(latestRows[0]);
  const teams = buildTeamSummaries(latestRows);
  return {
    snapshot,
    teams,
    totals: {
      team_count: teams.length,
      player_stat_row_count: latestRows.length,
      matched_player_count: latestRows.filter((row) => row.match_status === 'roster-matched').length,
      stats_only_count: latestRows.filter((row) => row.match_status === 'stats-only').length,
    },
  };
}

export function buildPlayerStatTeamDetail(rows: CurrentPlayerStatViewRow[]): NbaPlayerStatTeamDetail | null {
  if (rows.length === 0) return null;
  const summary = buildTeamSummaries(rows)[0];
  return {
    summary,
    rows: rows
      .slice()
      .sort((a, b) => a.source_order - b.source_order)
      .map(statRowFromViewRow),
  };
}

export function statRowFromViewRow(row: CurrentPlayerStatViewRow): NbaPlayerStatRow {
  return {
    team_id: row.team_id,
    nba_player_id: row.nba_player_id,
    player_name: row.player_name,
    player_name_normalized: row.player_name_normalized,
    source_order: row.source_order,
    position: row.position,
    age: row.age,
    games_played: row.games_played,
    minutes: row.minutes,
    points_per_game: row.points_per_game,
    rebounds_per_game: row.rebounds_per_game,
    assists_per_game: row.assists_per_game,
    true_shooting_pct: row.true_shooting_pct,
    effective_fg_pct: row.effective_fg_pct,
    usage_pct: row.usage_pct,
    three_point_attempt_rate: row.three_point_attempt_rate,
    free_throw_rate: row.free_throw_rate,
    offensive_rebound_pct: row.offensive_rebound_pct,
    defensive_rebound_pct: row.defensive_rebound_pct,
    rebound_pct: row.rebound_pct,
    assist_pct: row.assist_pct,
    turnover_pct: row.turnover_pct,
    offensive_rating: row.offensive_rating,
    defensive_rating: row.defensive_rating,
    net_rating: row.net_rating,
    player_impact_estimate: row.player_impact_estimate,
    defensive_win_shares: row.defensive_win_shares,
    match_status: row.match_status,
    source_row: row.source_row ?? {},
  };
}

export function normalizePlayerName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[.'’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function snapshotFromRow(row: CurrentPlayerStatViewRow): NbaPlayerStatSnapshot {
  return {
    id: row.snapshot_id,
    season: row.season,
    season_type: row.season_type,
    as_of_date: row.as_of_date,
    source_name: row.source_name,
    source_url: row.source_url,
    retrieved_at: row.retrieved_at,
    team_count: row.snapshot_team_count,
    row_count: row.snapshot_row_count,
    matched_player_count: row.snapshot_matched_player_count,
    unmatched_player_count: row.snapshot_unmatched_player_count,
    notes: row.snapshot_notes ?? [],
    glossary: row.snapshot_glossary ?? {},
    source_meta: row.snapshot_source_meta ?? {},
  };
}

function buildTeamSummaries(rows: CurrentPlayerStatViewRow[]): NbaPlayerStatTeamSummary[] {
  const teams = new Map<string, CurrentPlayerStatViewRow[]>();
  for (const row of rows) {
    if (!teams.has(row.team_id)) teams.set(row.team_id, []);
    teams.get(row.team_id)!.push(row);
  }
  return Array.from(teams.entries())
    .map(([, teamRows]) => teamSummaryFromRows(teamRows))
    .sort((a, b) => a.team.abbreviation.localeCompare(b.team.abbreviation));
}

function teamSummaryFromRows(rows: CurrentPlayerStatViewRow[]): NbaPlayerStatTeamSummary {
  const first = rows[0];
  const sortedByNet = rows.slice().sort((a, b) => b.net_rating - a.net_rating);
  const sortedByPie = rows.slice().sort((a, b) => b.player_impact_estimate - a.player_impact_estimate);
  return {
    snapshot_id: first.snapshot_id,
    season: first.season,
    season_type: first.season_type,
    as_of_date: first.as_of_date,
    source_name: first.source_name,
    source_url: first.source_url,
    retrieved_at: first.retrieved_at,
    team: {
      team_id: first.team_id,
      nba_team_id: first.nba_team_id,
      abbreviation: first.abbreviation,
      city: first.city,
      name: first.name,
      full_name: first.full_name,
      conference: first.conference,
      division: first.division,
    },
    stat_row_count: rows.length,
    matched_player_count: rows.filter((row) => row.match_status === 'roster-matched').length,
    stats_only_count: rows.filter((row) => row.match_status === 'stats-only').length,
    top_net_rating_player: sortedByNet[0]?.player_name ?? null,
    top_net_rating: sortedByNet[0]?.net_rating ?? null,
    top_pie_player: sortedByPie[0]?.player_name ?? null,
    top_pie: sortedByPie[0]?.player_impact_estimate ?? null,
  };
}

function compareSnapshotKeys(
  a: { asOf: string; retrieved: string },
  b: { asOf: string; retrieved: string },
): number {
  const asOf = a.asOf.localeCompare(b.asOf);
  if (asOf !== 0) return asOf;
  return a.retrieved.localeCompare(b.retrieved);
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
