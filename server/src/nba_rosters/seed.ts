import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type {
  ListCurrentNbaRostersResponse,
  NbaRosterEntry,
  NbaRosterSnapshot,
  NbaRosterTeam,
  NbaTeam,
} from '@shared/types';

export const DEFAULT_NBA_ROSTER_SEED_PATH = fileURLToPath(
  new URL('../../../data/nba-rosters/2026-06-12.nba-official.json', import.meta.url),
);

export interface NbaRosterSeedTeam extends NbaTeam {}

export interface NbaRosterSeedPlayer {
  nba_player_id: number;
  slug: string | null;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  height: string | null;
  weight_lbs: number | null;
  last_attended: string | null;
  country: string | null;
  jersey_number: string | null;
  source_url: string | null;
  source_row: Record<string, unknown>;
}

export interface NbaRosterSeedEntry {
  team_id: string;
  nba_player_id: number;
  season: string;
  source_order: number;
  jersey_number: string | null;
  position: string | null;
  height: string | null;
  weight_lbs: number | null;
  last_attended: string | null;
  country: string | null;
  source_url: string | null;
  source_row: Record<string, unknown>;
}

export interface NbaRosterSeed {
  schema_version: 1;
  season: string;
  as_of_date: string;
  source_name: string;
  source_url: string;
  retrieved_at: string;
  source_retrieved_from: string;
  teams: NbaRosterSeedTeam[];
  players: NbaRosterSeedPlayer[];
  entries: NbaRosterSeedEntry[];
  team_counts: Record<string, number>;
  notes: string[];
  source_meta: Record<string, unknown>;
}

export interface NbaRosterSeedSummary {
  season: string;
  as_of_date: string;
  team_count: number;
  player_count: number;
  entry_count: number;
  team_counts: Record<string, number>;
}

export interface CurrentRosterViewRow {
  snapshot_id: string;
  season: string;
  as_of_date: string;
  source_name: string;
  source_url: string;
  retrieved_at: string;
  snapshot_team_count: number;
  snapshot_player_count: number;
  snapshot_notes: string | null;
  snapshot_source_meta: Record<string, unknown> | null;
  team_id: string;
  nba_team_id: number;
  abbreviation: string;
  city: string;
  name: string;
  full_name: string;
  conference: string | null;
  division: string | null;
  official_roster_count: number;
  nba_player_id: number;
  player_slug: string | null;
  player_full_name: string;
  first_name: string | null;
  last_name: string | null;
  source_order: number;
  jersey_number: string | null;
  position: string | null;
  height: string | null;
  weight_lbs: number | null;
  last_attended: string | null;
  country: string | null;
  player_source_url: string | null;
  entry_source_url: string | null;
  source_row: Record<string, unknown> | null;
}

export async function loadNbaRosterSeed(path = DEFAULT_NBA_ROSTER_SEED_PATH): Promise<NbaRosterSeed> {
  const raw = await readFile(path, 'utf8');
  const parsed = JSON.parse(raw) as NbaRosterSeed;
  validateNbaRosterSeed(parsed);
  return parsed;
}

export function summarizeNbaRosterSeed(seed: NbaRosterSeed): NbaRosterSeedSummary {
  const teamCounts: Record<string, number> = {};
  for (const entry of seed.entries) {
    teamCounts[entry.team_id] = (teamCounts[entry.team_id] ?? 0) + 1;
  }
  return {
    season: seed.season,
    as_of_date: seed.as_of_date,
    team_count: seed.teams.length,
    player_count: seed.players.length,
    entry_count: seed.entries.length,
    team_counts: teamCounts,
  };
}

export function validateNbaRosterSeed(
  seed: NbaRosterSeed,
  opts: { expectedTeamCount?: number } = {},
): NbaRosterSeedSummary {
  if (seed.schema_version !== 1) {
    throw new Error(`unsupported NBA roster seed schema_version=${String(seed.schema_version)}`);
  }
  if (!seed.season || !seed.as_of_date || !seed.source_name || !seed.source_url) {
    throw new Error('NBA roster seed is missing required snapshot metadata');
  }

  const teams = new Set(seed.teams.map((team) => team.team_id));
  const players = new Set(seed.players.map((player) => player.nba_player_id));
  if (teams.size !== seed.teams.length) throw new Error('NBA roster seed has duplicate teams');
  if (players.size !== seed.players.length) throw new Error('NBA roster seed has duplicate players');
  const expectedTeamCount = opts.expectedTeamCount ?? 30;
  if (teams.size !== expectedTeamCount) {
    throw new Error(`NBA roster seed expected ${expectedTeamCount} teams, found ${teams.size}`);
  }

  const seenEntries = new Set<string>();
  const counts: Record<string, number> = {};
  for (const entry of seed.entries) {
    if (!teams.has(entry.team_id)) {
      throw new Error(`NBA roster seed entry references unknown team ${entry.team_id}`);
    }
    if (!players.has(entry.nba_player_id)) {
      throw new Error(`NBA roster seed entry references unknown player ${entry.nba_player_id}`);
    }
    const key = `${entry.team_id}:${entry.nba_player_id}`;
    if (seenEntries.has(key)) {
      throw new Error(`NBA roster seed has duplicate roster entry ${key}`);
    }
    seenEntries.add(key);
    counts[entry.team_id] = (counts[entry.team_id] ?? 0) + 1;
  }

  for (const team of seed.teams) {
    const actual = counts[team.team_id] ?? 0;
    const expected = seed.team_counts[team.team_id];
    if (expected !== actual) {
      throw new Error(`NBA roster seed count mismatch for ${team.team_id}: expected ${expected}, got ${actual}`);
    }
    if (actual === 0) {
      throw new Error(`NBA roster seed has no active entries for ${team.team_id}`);
    }
  }

  return summarizeNbaRosterSeed(seed);
}

export async function clearGeneratedUserContent(): Promise<{ deleted: Record<string, number | null>; storage_objects: number }> {
  const { db } = await import('../db/client.js');
  const deleted: Record<string, number | null> = {};
  const artifacts = await db.from('artifacts').select('id, storage_url');
  if (artifacts.error) {
    console.warn('[seed] artifact lookup failed before cleanup:', artifacts.error.message);
  }

  const storagePaths = (artifacts.data ?? [])
    .map((row) => storagePathFromUrl((row as { storage_url: string | null }).storage_url))
    .filter((path): path is string => Boolean(path));

  if (storagePaths.length > 0) {
    const storage = await db.storage.from('artifacts').remove(storagePaths);
    if (storage.error) {
      console.warn('[seed] artifact storage cleanup skipped:', storage.error.message);
    }
  }

  const deletionPlan: { table: string; column: string }[] = [
    { table: 'bookmarks', column: 'brief_id' },
    { table: 'monitors', column: 'id' },
    { table: 'projects', column: 'id' },
    { table: 'artifacts', column: 'id' },
    { table: 'agent_runs', column: 'id' },
    { table: 'chat_turns', column: 'id' },
    { table: 'brief_options', column: 'id' },
    { table: 'brief_sources', column: 'id' },
    { table: 'briefs', column: 'id' },
    { table: 'sessions', column: 'id' },
  ];

  for (const item of deletionPlan) {
    const res = await db.from(item.table).delete({ count: 'exact' }).not(item.column, 'is', null);
    if (res.error) throw new Error(`delete ${item.table} failed: ${res.error.message}`);
    deleted[item.table] = res.count ?? null;
  }

  return { deleted, storage_objects: storagePaths.length };
}

export async function seedNbaRosters(seed: NbaRosterSeed): Promise<NbaRosterSeedSummary & { snapshot_id: string }> {
  const { db } = await import('../db/client.js');
  const summary = validateNbaRosterSeed(seed);

  const teams = await db
    .from('nba_teams')
    .upsert(seed.teams, { onConflict: 'team_id' });
  if (teams.error) throw new Error(`nba_teams upsert failed: ${teams.error.message}`);

  const players = await db
    .from('nba_players')
    .upsert(seed.players, { onConflict: 'nba_player_id' });
  if (players.error) throw new Error(`nba_players upsert failed: ${players.error.message}`);

  const snapshotRow = {
    season: seed.season,
    as_of_date: seed.as_of_date,
    source_name: seed.source_name,
    source_url: seed.source_url,
    retrieved_at: seed.retrieved_at,
    team_count: summary.team_count,
    player_count: summary.entry_count,
    notes: seed.notes.join('\n'),
    source_meta: {
      ...seed.source_meta,
      source_retrieved_from: seed.source_retrieved_from,
      team_counts: seed.team_counts,
    },
  };

  const snapshot = await db
    .from('nba_roster_snapshots')
    .upsert(snapshotRow, { onConflict: 'season,as_of_date,source_name' })
    .select()
    .single();
  if (snapshot.error || !snapshot.data) {
    throw new Error(`nba_roster_snapshots upsert failed: ${snapshot.error?.message ?? 'no row returned'}`);
  }

  const snapshotId = (snapshot.data as { id: string }).id;
  const cleared = await db.from('nba_roster_entries').delete().eq('snapshot_id', snapshotId);
  if (cleared.error) throw new Error(`nba_roster_entries cleanup failed: ${cleared.error.message}`);

  const entries = seed.entries.map((entry) => ({ ...entry, snapshot_id: snapshotId }));
  for (const chunk of chunks(entries, 250)) {
    const inserted = await db.from('nba_roster_entries').insert(chunk);
    if (inserted.error) throw new Error(`nba_roster_entries insert failed: ${inserted.error.message}`);
  }

  return { ...summary, snapshot_id: snapshotId };
}

export function groupCurrentRosterRows(rows: CurrentRosterViewRow[]): ListCurrentNbaRostersResponse {
  if (rows.length === 0) {
    return { snapshot: null, teams: [], totals: { team_count: 0, player_count: 0 } };
  }

  const latestKey = rows
    .map((row) => ({
      id: row.snapshot_id,
      asOf: row.as_of_date,
      retrieved: row.retrieved_at,
    }))
    .sort((a, b) => compareSnapshotKeys(b, a))[0];

  const latestRows = rows.filter((row) => row.snapshot_id === latestKey.id);
  const first = latestRows[0];
  const snapshot: NbaRosterSnapshot = {
    id: first.snapshot_id,
    season: first.season,
    as_of_date: first.as_of_date,
    source_name: first.source_name,
    source_url: first.source_url,
    retrieved_at: first.retrieved_at,
    team_count: first.snapshot_team_count,
    player_count: first.snapshot_player_count,
    notes: first.snapshot_notes,
    source_meta: first.snapshot_source_meta ?? {},
  };

  const teams = new Map<string, NbaRosterTeam>();
  for (const row of latestRows) {
    if (!teams.has(row.team_id)) {
      teams.set(row.team_id, {
        team: {
          team_id: row.team_id,
          nba_team_id: row.nba_team_id,
          abbreviation: row.abbreviation,
          city: row.city,
          name: row.name,
          full_name: row.full_name,
          conference: row.conference,
          division: row.division,
        },
        official_roster_count: row.official_roster_count,
        players: [],
      });
    }
    const team = teams.get(row.team_id)!;
    const player = {
      nba_player_id: row.nba_player_id,
      slug: row.player_slug,
      full_name: row.player_full_name,
      first_name: row.first_name,
      last_name: row.last_name,
      position: row.position,
      height: row.height,
      weight_lbs: row.weight_lbs,
      last_attended: row.last_attended,
      country: row.country,
      jersey_number: row.jersey_number,
      source_url: row.player_source_url,
      source_row: row.source_row ?? {},
    };
    const entry: NbaRosterEntry = {
      snapshot_id: row.snapshot_id,
      team_id: row.team_id,
      nba_player_id: row.nba_player_id,
      season: row.season,
      source_order: row.source_order,
      jersey_number: row.jersey_number,
      position: row.position,
      height: row.height,
      weight_lbs: row.weight_lbs,
      last_attended: row.last_attended,
      country: row.country,
      source_url: row.entry_source_url,
      source_row: row.source_row ?? {},
      player,
    };
    team.players.push(entry);
  }

  const rosterTeams = Array.from(teams.values())
    .sort((a, b) => a.team.abbreviation.localeCompare(b.team.abbreviation))
    .map((team) => ({
      ...team,
      players: team.players.sort((a, b) => a.source_order - b.source_order),
    }));

  return {
    snapshot,
    teams: rosterTeams,
    totals: {
      team_count: rosterTeams.length,
      player_count: rosterTeams.reduce((sum, team) => sum + team.players.length, 0),
    },
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

function storagePathFromUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const marker = '/artifacts/';
    const index = url.pathname.indexOf(marker);
    if (index >= 0) return decodeURIComponent(url.pathname.slice(index + marker.length));
  } catch {
    // Fall through: storage_url may already be a bucket-relative path.
  }
  return value.replace(/^artifacts\//, '').replace(/^\/+/, '') || null;
}
