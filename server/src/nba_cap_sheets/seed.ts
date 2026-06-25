import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type {
  GetCurrentNbaCapSheetResponse,
  ListCurrentNbaCapSheetsResponse,
  NbaCapSheet,
  NbaCapSheetMetric,
  NbaCapSheetPlayerRow,
  NbaCapSheetSalaryCell,
  NbaCapSheetSection,
  NbaCapSheetSnapshot,
  NbaCapSheetSourceRef,
  NbaCapSheetTeamSummary,
  NbaRosterEntry,
  NbaRosterTeam,
  NbaTeam,
} from '@shared/types';
import { statRowFromViewRow, type CurrentPlayerStatViewRow } from '../nba_player_stats/seed.js';

export const DEFAULT_NBA_CAP_SHEET_SEED_PATH = fileURLToPath(
  new URL('../../../data/nba-cap-sheets/2026-05-03.public-sources.json', import.meta.url),
);

export interface NbaCapSheetSeed {
  schema_version: 1;
  season: string;
  as_of_date: string;
  source_name: string;
  source_url: string;
  retrieved_at: string;
  source_policy: {
    mode: 'gated_public_refresh';
    default_seed: 'reviewed_snapshot';
    notes: string[];
  };
  teams: NbaTeam[];
  cap_sheets: NbaCapSheetSeedTeam[];
  notes: string[];
  source_meta: Record<string, unknown>;
}

export interface NbaCapSheetSeedTeam {
  team_id: string;
  official_roster_count: number;
  cap_status: string;
  tax_status: string;
  apron_status: string;
  payroll_amount: number | null;
  source_status: 'captured' | 'source-needed' | 'not-available';
  missing_sections: string[];
  source_refs: NbaCapSheetSourceRef[];
  metrics: NbaCapSheetMetric[];
  player_rows: NbaCapSheetPlayerRow[];
  sections: NbaCapSheetSection[];
  source_meta: Record<string, unknown>;
}

export interface NbaCapSheetSeedSummary {
  season: string;
  as_of_date: string;
  team_count: number;
  player_row_count: number;
  salary_cell_count: number;
  source_needed_section_count: number;
}

export interface CurrentCapSheetViewRow {
  snapshot_id: string;
  season: string;
  as_of_date: string;
  source_name: string;
  source_url: string;
  retrieved_at: string;
  snapshot_team_count: number;
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
  cap_status: string;
  tax_status: string;
  apron_status: string;
  payroll_amount: number | null;
  source_status: 'captured' | 'source-needed' | 'not-available';
  missing_sections: string[] | null;
  source_refs: NbaCapSheetSourceRef[] | null;
  source_meta: Record<string, unknown> | null;
  created_at: string;
}

export interface CurrentCapSheetMetricRow {
  snapshot_id: string;
  team_id: string;
  metric_key: string;
  label: string;
  value: string;
  amount: number | null;
  source_status: 'captured' | 'source-needed' | 'not-available' | 'not-applicable';
  source_url: string | null;
  note: string | null;
  sort_order: number;
}

export interface CurrentCapSheetPlayerRowRecord {
  id: string;
  snapshot_id: string;
  team_id: string;
  nba_player_id: number | null;
  player_name: string;
  source_order: number;
  position: string | null;
  age: number | null;
  dob: string | null;
  yos: string | null;
  roster_status: string | null;
  fa_status: string | null;
  fa_year: string | null;
  bird_rights: string | null;
  restrictions: string[] | null;
  how_acquired: string | null;
  agent: string | null;
  total_amount: number | null;
  source_status: 'captured' | 'source-needed' | 'not-available';
  source_url: string | null;
  source_data: Record<string, unknown> | null;
}

export interface CurrentCapSheetSalaryCellRow {
  player_row_id: string;
  snapshot_id: string;
  team_id: string;
  season: string;
  amount: number | null;
  label: string | null;
  option_type: string | null;
  is_guaranteed: boolean | null;
  source_status: 'captured' | 'source-needed' | 'not-available' | 'not-applicable';
  source_url: string | null;
  source_data: Record<string, unknown> | null;
}

export interface CurrentCapSheetSectionRow {
  snapshot_id: string;
  team_id: string;
  section_key: string;
  title: string;
  source_status: 'captured' | 'source-needed' | 'not-available' | 'not-applicable';
  source_url: string | null;
  notes: string[] | null;
  rows: Record<string, unknown>[] | null;
  sort_order: number;
}

export async function loadNbaCapSheetSeed(path = DEFAULT_NBA_CAP_SHEET_SEED_PATH): Promise<NbaCapSheetSeed> {
  const raw = await readFile(path, 'utf8');
  const parsed = JSON.parse(raw) as NbaCapSheetSeed;
  validateNbaCapSheetSeed(parsed);
  return parsed;
}

export function validateNbaCapSheetSeed(
  seed: NbaCapSheetSeed,
  opts: { expectedTeamCount?: number } = {},
): NbaCapSheetSeedSummary {
  if (seed.schema_version !== 1) {
    throw new Error(`unsupported NBA cap sheet seed schema_version=${String(seed.schema_version)}`);
  }
  if (!seed.season || !seed.as_of_date || !seed.source_name || !seed.source_url || !seed.retrieved_at) {
    throw new Error('NBA cap sheet seed is missing required snapshot metadata');
  }

  const expectedTeamCount = opts.expectedTeamCount ?? 30;
  const teamIds = new Set(seed.teams.map((team) => team.team_id));
  if (teamIds.size !== seed.teams.length) throw new Error('NBA cap sheet seed has duplicate teams');
  if (teamIds.size !== expectedTeamCount) {
    throw new Error(`NBA cap sheet seed expected ${expectedTeamCount} teams, found ${teamIds.size}`);
  }

  const sheetIds = new Set(seed.cap_sheets.map((sheet) => sheet.team_id));
  if (sheetIds.size !== seed.cap_sheets.length) throw new Error('NBA cap sheet seed has duplicate team sheets');
  if (sheetIds.size !== expectedTeamCount) {
    throw new Error(`NBA cap sheet seed expected ${expectedTeamCount} cap sheets, found ${sheetIds.size}`);
  }

  let playerRowCount = 0;
  let salaryCellCount = 0;
  let sourceNeededSectionCount = 0;
  for (const sheet of seed.cap_sheets) {
    if (!teamIds.has(sheet.team_id)) {
      throw new Error(`NBA cap sheet references unknown team ${sheet.team_id}`);
    }
    if (!Array.isArray(sheet.player_rows) || sheet.player_rows.length === 0) {
      throw new Error(`NBA cap sheet has no player salary rows for ${sheet.team_id}`);
    }
    const playerRowIds = new Set<string>();
    for (const row of sheet.player_rows) {
      if (!row.id) throw new Error(`NBA cap sheet player row missing id for ${sheet.team_id}`);
      if (playerRowIds.has(row.id)) throw new Error(`NBA cap sheet duplicate player row ${row.id}`);
      playerRowIds.add(row.id);
      if (!Array.isArray(row.salary_cells) || row.salary_cells.length === 0) {
        throw new Error(`NBA cap sheet player row ${row.id} has no salary cells`);
      }
      salaryCellCount += row.salary_cells.length;
    }
    playerRowCount += sheet.player_rows.length;
    sourceNeededSectionCount += sheet.sections.filter((section) => section.source_status === 'source-needed').length;
  }

  return {
    season: seed.season,
    as_of_date: seed.as_of_date,
    team_count: seed.cap_sheets.length,
    player_row_count: playerRowCount,
    salary_cell_count: salaryCellCount,
    source_needed_section_count: sourceNeededSectionCount,
  };
}

export async function seedNbaCapSheets(seed: NbaCapSheetSeed): Promise<NbaCapSheetSeedSummary & { snapshot_id: string }> {
  const { db } = await import('../db/client.js');
  const summary = validateNbaCapSheetSeed(seed);

  const teams = await db.from('nba_teams').upsert(seed.teams, { onConflict: 'team_id' });
  if (teams.error) throw new Error(`nba_teams upsert for cap sheets failed: ${teams.error.message}`);

  const snapshotRow = {
    season: seed.season,
    as_of_date: seed.as_of_date,
    source_name: seed.source_name,
    source_url: seed.source_url,
    retrieved_at: seed.retrieved_at,
    team_count: summary.team_count,
    notes: seed.notes.join('\n'),
    source_meta: {
      ...seed.source_meta,
      source_policy: seed.source_policy,
    },
  };

  const snapshot = await db
    .from('nba_cap_sheet_snapshots')
    .upsert(snapshotRow, { onConflict: 'season,as_of_date,source_name' })
    .select()
    .single();
  if (snapshot.error || !snapshot.data) {
    throw new Error(`nba_cap_sheet_snapshots upsert failed: ${snapshot.error?.message ?? 'no row returned'}`);
  }

  const snapshotId = (snapshot.data as { id: string }).id;
  for (const table of [
    'nba_cap_sheet_salary_cells',
    'nba_cap_sheet_player_rows',
    'nba_cap_sheet_metrics',
    'nba_cap_sheet_sections',
    'nba_cap_sheets',
  ]) {
    const cleared = await db.from(table).delete().eq('snapshot_id', snapshotId);
    if (cleared.error) throw new Error(`${table} cleanup failed: ${cleared.error.message}`);
  }

  const sheets = seed.cap_sheets.map((sheet) => ({
    snapshot_id: snapshotId,
    team_id: sheet.team_id,
    official_roster_count: sheet.official_roster_count,
    cap_status: sheet.cap_status,
    tax_status: sheet.tax_status,
    apron_status: sheet.apron_status,
    payroll_amount: sheet.payroll_amount,
    source_status: sheet.source_status,
    missing_sections: sheet.missing_sections,
    source_refs: sheet.source_refs,
    source_meta: sheet.source_meta,
  }));
  await insertChunks('nba_cap_sheets', sheets, 100);

  const metrics = seed.cap_sheets.flatMap((sheet) => sheet.metrics.map((metric, index) => ({
    snapshot_id: snapshotId,
    team_id: sheet.team_id,
    metric_key: metric.key,
    label: metric.label,
    value: metric.value,
    amount: metric.amount,
    source_status: metric.source_status,
    source_url: metric.source_url,
    note: metric.note ?? null,
    sort_order: index + 1,
  })));
  await insertChunks('nba_cap_sheet_metrics', metrics, 250);

  const playerRows = seed.cap_sheets.flatMap((sheet) => sheet.player_rows.map((row) => ({
    id: row.id,
    snapshot_id: snapshotId,
    team_id: sheet.team_id,
    nba_player_id: row.nba_player_id,
    player_name: row.player_name,
    source_order: row.source_order,
    position: row.position,
    age: row.age,
    dob: row.dob,
    yos: row.yos,
    roster_status: row.roster_status,
    fa_status: row.fa_status,
    fa_year: row.fa_year,
    bird_rights: row.bird_rights,
    restrictions: row.restrictions,
    how_acquired: row.how_acquired,
    agent: row.agent,
    total_amount: row.total_amount,
    source_status: row.source_status,
    source_url: row.source_url,
    source_data: row.source_data,
  })));
  await insertChunks('nba_cap_sheet_player_rows', playerRows, 250);

  const salaryCells = seed.cap_sheets.flatMap((sheet) => sheet.player_rows.flatMap((row) => row.salary_cells.map((cell) => ({
    player_row_id: row.id,
    snapshot_id: snapshotId,
    team_id: sheet.team_id,
    season: cell.season,
    amount: cell.amount,
    label: cell.label,
    option_type: cell.option_type,
    is_guaranteed: cell.is_guaranteed,
    source_status: cell.source_status,
    source_url: cell.source_url,
    source_data: cell.source_data,
  }))));
  await insertChunks('nba_cap_sheet_salary_cells', salaryCells, 500);

  const sections = seed.cap_sheets.flatMap((sheet) => sheet.sections.map((section, index) => ({
    snapshot_id: snapshotId,
    team_id: sheet.team_id,
    section_key: section.key,
    title: section.title,
    source_status: section.source_status,
    source_url: section.source_url,
    notes: section.notes,
    rows: section.rows,
    sort_order: index + 1,
  })));
  await insertChunks('nba_cap_sheet_sections', sections, 200);

  return { ...summary, snapshot_id: snapshotId };
}

export function groupCapSheetSummaries(rows: CurrentCapSheetViewRow[]): ListCurrentNbaCapSheetsResponse {
  if (rows.length === 0) {
    return { snapshot: null, teams: [], totals: { team_count: 0, player_row_count: 0, source_needed_section_count: 0 } };
  }

  const first = rows[0];
  const snapshot = snapshotFromRow(first);
  const teams = rows.map(teamSummaryFromRow).sort((a, b) => a.team.abbreviation.localeCompare(b.team.abbreviation));

  return {
    snapshot,
    teams,
    totals: {
      team_count: teams.length,
      player_row_count: 0,
      source_needed_section_count: teams.reduce((sum, team) => sum + team.missing_section_count, 0),
    },
  };
}

export function buildCapSheetDetail(args: {
  sheet: CurrentCapSheetViewRow;
  metrics: CurrentCapSheetMetricRow[];
  playerRows: CurrentCapSheetPlayerRowRecord[];
  salaryCells: CurrentCapSheetSalaryCellRow[];
  sections: CurrentCapSheetSectionRow[];
  roster: NbaRosterTeam | null;
  playerStats?: CurrentPlayerStatViewRow[];
}): GetCurrentNbaCapSheetResponse {
  const snapshot = snapshotFromRow(args.sheet);
  const playerStats = (args.playerStats ?? [])
    .slice()
    .sort((a, b) => a.source_order - b.source_order)
    .map(statRowFromViewRow);
  const statsByPlayerId = new Map(playerStats
    .filter((row) => row.nba_player_id !== null)
    .map((row) => [row.nba_player_id!, row]));
  const statsByName = new Map(playerStats.map((row) => [row.player_name_normalized, row]));
  const cellsByRow = new Map<string, NbaCapSheetSalaryCell[]>();
  for (const cell of args.salaryCells) {
    if (!cellsByRow.has(cell.player_row_id)) cellsByRow.set(cell.player_row_id, []);
    cellsByRow.get(cell.player_row_id)!.push({
      season: cell.season,
      amount: cell.amount,
      label: cell.label,
      option_type: cell.option_type,
      is_guaranteed: cell.is_guaranteed,
      source_status: cell.source_status,
      source_url: cell.source_url,
      source_data: cell.source_data ?? {},
    });
  }

  const playerRows = args.playerRows
    .sort((a, b) => a.source_order - b.source_order)
    .map((row): NbaCapSheetPlayerRow => ({
      id: row.id,
      nba_player_id: row.nba_player_id,
      player_name: row.player_name,
      source_order: row.source_order,
      position: row.position,
      age: row.age,
      dob: row.dob,
      yos: row.yos,
      roster_status: row.roster_status,
      fa_status: row.fa_status,
      fa_year: row.fa_year,
      bird_rights: row.bird_rights,
      restrictions: row.restrictions ?? [],
      how_acquired: row.how_acquired,
      agent: row.agent,
      total_amount: row.total_amount,
      source_status: row.source_status,
      source_url: row.source_url,
      source_data: row.source_data ?? {},
      salary_cells: (cellsByRow.get(row.id) ?? []).sort((a, b) => a.season.localeCompare(b.season)),
      stats: (row.nba_player_id !== null ? statsByPlayerId.get(row.nba_player_id) : null)
        ?? statsByName.get(normalizePlayerName(row.player_name))
        ?? null,
    }));

  const roster = args.roster
    ? {
      ...args.roster,
      players: args.roster.players.map((entry) => ({
        ...entry,
        stats: statsByPlayerId.get(entry.nba_player_id)
          ?? statsByName.get(normalizePlayerName(entry.player.full_name))
          ?? null,
      })),
    }
    : null;

  const capSheet: NbaCapSheet = {
    summary: teamSummaryFromRow(args.sheet),
    source_refs: args.sheet.source_refs ?? [],
    metrics: args.metrics
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((metric): NbaCapSheetMetric => ({
        key: metric.metric_key,
        label: metric.label,
        value: metric.value,
        amount: metric.amount,
        source_status: metric.source_status,
        source_url: metric.source_url,
        note: metric.note,
      })),
    player_rows: playerRows,
    player_stats: playerStats,
    sections: args.sections
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((section): NbaCapSheetSection => ({
        key: section.section_key,
        title: section.title,
        source_status: section.source_status,
        source_url: section.source_url,
        notes: section.notes ?? [],
        rows: section.rows ?? [],
      })),
    roster,
  };

  return { snapshot, cap_sheet: capSheet };
}

function normalizePlayerName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[.'’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function groupRosterTeam(rows: NbaRosterEntry[], team: NbaTeam, officialRosterCount: number): NbaRosterTeam {
  return {
    team,
    official_roster_count: officialRosterCount,
    players: rows.sort((a, b) => a.source_order - b.source_order),
  };
}

function snapshotFromRow(row: CurrentCapSheetViewRow): NbaCapSheetSnapshot {
  return {
    id: row.snapshot_id,
    season: row.season,
    as_of_date: row.as_of_date,
    source_name: row.source_name,
    source_url: row.source_url,
    retrieved_at: row.retrieved_at,
    team_count: row.snapshot_team_count,
    notes: row.snapshot_notes,
    source_meta: row.snapshot_source_meta ?? {},
  };
}

function teamSummaryFromRow(row: CurrentCapSheetViewRow): NbaCapSheetTeamSummary {
  const team = {
    team_id: row.team_id,
    nba_team_id: row.nba_team_id,
    abbreviation: row.abbreviation,
    city: row.city,
    name: row.name,
    full_name: row.full_name,
    conference: row.conference,
    division: row.division,
  };
  return {
    snapshot_id: row.snapshot_id,
    season: row.season,
    as_of_date: row.as_of_date,
    source_name: row.source_name,
    source_url: row.source_url,
    retrieved_at: row.retrieved_at,
    team,
    official_roster_count: row.official_roster_count,
    cap_status: row.cap_status,
    tax_status: row.tax_status,
    apron_status: row.apron_status,
    payroll_amount: row.payroll_amount,
    source_status: row.source_status,
    missing_sections: row.missing_sections ?? [],
    missing_section_count: (row.missing_sections ?? []).length,
    source_refs: row.source_refs ?? [],
  };
}

async function insertChunks(table: string, rows: Record<string, unknown>[], size: number): Promise<void> {
  if (rows.length === 0) return;
  const { db } = await import('../db/client.js');
  for (const chunk of chunks(rows, size)) {
    const inserted = await db.from(table).insert(chunk);
    if (inserted.error) throw new Error(`${table} insert failed: ${inserted.error.message}`);
  }
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
