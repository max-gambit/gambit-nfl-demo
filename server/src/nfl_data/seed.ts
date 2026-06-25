import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const DEFAULT_NFL_DEMO_SEED_PATH = fileURLToPath(
  new URL('../../../data/nfl-demo/current.json', import.meta.url),
);

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
  guaranteed_remaining: number | null;
  dead_money_if_cut_2026: number | null;
  cut_savings_2026: number | null;
  restructure_savings_estimate_2026: number | null;
  tag_eligible_2027: boolean;
  contract_lever: string;
  source_url: string | null;
  source_status: string;
}

export interface NflPlayerMetricRow {
  team_id: string;
  player_id: string;
  player_name: string;
  position: string | null;
  snaps_2025: number | null;
  games_2025: number | null;
  availability_risk: string;
  role: string;
  value_tier: string;
  metric_note: string;
  source_url: string | null;
}

export interface NflSourceRef {
  id: string;
  name: string;
  url: string;
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
}

export interface NflDemoSummary {
  season: string;
  as_of_date: string;
  team_count: number;
  roster_row_count: number;
  cap_row_count: number;
  player_metric_row_count: number;
}

export async function loadNflDemoSeed(path = DEFAULT_NFL_DEMO_SEED_PATH): Promise<NflDemoSeed> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as NflDemoSeed;
  validateNflDemoSeed(parsed);
  return parsed;
}

export function validateNflDemoSeed(seed: NflDemoSeed): NflDemoSummary {
  if (seed.schema_version !== 1) throw new Error(`unsupported NFL demo seed schema_version=${String(seed.schema_version)}`);
  if (!seed.season || !seed.as_of_date || !seed.source_name || !seed.retrieved_at) {
    throw new Error('NFL demo seed is missing required snapshot metadata');
  }
  const teamIds = new Set(seed.teams.map((team) => team.team_id));
  if (teamIds.size !== 32) throw new Error(`NFL demo seed expected 32 teams, found ${teamIds.size}`);

  const rosterKeys = new Set<string>();
  for (const row of seed.roster_entries) {
    if (!teamIds.has(row.team_id)) throw new Error(`NFL roster row references unknown team ${row.team_id}`);
    const key = `${row.team_id}:${row.player_id}`;
    if (rosterKeys.has(key)) throw new Error(`NFL roster seed has duplicate row ${key}`);
    rosterKeys.add(key);
  }
  for (const teamId of teamIds) {
    if (!seed.roster_entries.some((row) => row.team_id === teamId)) {
      throw new Error(`NFL roster seed has no rows for ${teamId}`);
    }
    if (!seed.cap_rows.some((row) => row.team_id === teamId)) {
      throw new Error(`NFL cap seed has no rows for ${teamId}`);
    }
    if (!seed.player_metrics.some((row) => row.team_id === teamId)) {
      throw new Error(`NFL player metric seed has no rows for ${teamId}`);
    }
  }
  return summarizeNflDemoSeed(seed);
}

export function summarizeNflDemoSeed(seed: NflDemoSeed): NflDemoSummary {
  return {
    season: seed.season,
    as_of_date: seed.as_of_date,
    team_count: seed.teams.length,
    roster_row_count: seed.roster_entries.length,
    cap_row_count: seed.cap_rows.length,
    player_metric_row_count: seed.player_metrics.length,
  };
}

export function teamRows<T extends { team_id: string }>(rows: T[], teamId: string | null): T[] {
  const filtered = teamId ? rows.filter((row) => row.team_id === teamId) : rows;
  return filtered.slice().sort((a, b) => a.team_id.localeCompare(b.team_id));
}

export function groupNflTeams(seed: NflDemoSeed) {
  const rosterCounts = countByTeam(seed.roster_entries);
  const capCounts = countByTeam(seed.cap_rows);
  const metricCounts = countByTeam(seed.player_metrics);
  return {
    snapshot: snapshot(seed),
    teams: seed.teams.map((team) => ({
      ...team,
      roster_count: rosterCounts[team.team_id] ?? 0,
      cap_row_count: capCounts[team.team_id] ?? 0,
      player_metric_row_count: metricCounts[team.team_id] ?? 0,
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
    cap_rows: seed.cap_rows.filter((row) => row.team_id === teamId),
    player_metrics: seed.player_metrics.filter((row) => row.team_id === teamId),
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

function countByTeam(rows: Array<{ team_id: string }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.team_id] = (counts[row.team_id] ?? 0) + 1;
  return counts;
}
