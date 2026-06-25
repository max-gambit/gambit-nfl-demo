import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NbaTeam } from '@shared/types';
import { loadNbaRosterSeed, type NbaRosterSeed } from '../nba_rosters/seed.js';
import { parseAdvancedStatsWorkbook, type ParsedAdvancedStatsWorkbook } from './workbook.js';
import {
  normalizePlayerName,
  validateNbaPlayerStatsSeed,
  type NbaPlayerStatsSeed,
  type NbaPlayerStatsSeedRow,
} from './seed.js';

export const DEFAULT_NBA_PLAYER_STATS_OUTPUT_PATH = fileURLToPath(
  new URL('../../../data/nba-player-stats/2026-05-04.nba-advanced-stats.json', import.meta.url),
);

const DEFAULT_SOURCE_URL = 'attached://nba_2025-26_advanced_stats.xlsx';

export async function buildNbaPlayerStatsSeed(args: {
  workbook: ParsedAdvancedStatsWorkbook;
  rosterSeed: NbaRosterSeed;
  sourceUrl?: string;
  expectedTeamCount?: number;
}): Promise<NbaPlayerStatsSeed> {
  const playersById = new Map(args.rosterSeed.players.map((player) => [player.nba_player_id, player]));
  const rosterByTeamAndName = new Map<string, number>();
  for (const entry of args.rosterSeed.entries) {
    const player = playersById.get(entry.nba_player_id);
    if (!player) throw new Error(`missing roster player ${entry.nba_player_id}`);
    rosterByTeamAndName.set(`${entry.team_id}:${normalizePlayerName(player.full_name)}`, entry.nba_player_id);
  }

  const rows: NbaPlayerStatsSeedRow[] = args.workbook.rows.map((row, index) => {
    const normalized = normalizePlayerName(row.player_name);
    const nbaPlayerId = rosterByTeamAndName.get(`${row.team_id}:${normalized}`) ?? null;
    return {
      ...row,
      nba_player_id: nbaPlayerId,
      player_name_normalized: normalized,
      source_order: index + 1,
      match_status: nbaPlayerId === null ? 'stats-only' : 'roster-matched',
    };
  });

  const seed: NbaPlayerStatsSeed = {
    schema_version: 1,
    season: args.workbook.metadata.season,
    season_type: args.workbook.metadata.season_type,
    as_of_date: args.workbook.metadata.pulled,
    source_name: args.workbook.metadata.source,
    source_url: args.sourceUrl ?? DEFAULT_SOURCE_URL,
    retrieved_at: `${args.workbook.metadata.pulled}T00:00:00.000Z`,
    teams: args.rosterSeed.teams as NbaTeam[],
    rows,
    notes: args.workbook.notes_rows,
    glossary: args.workbook.glossary,
    source_meta: {
      workbook_title: args.workbook.metadata.title,
      players_included: args.workbook.metadata.players_included,
      season_label: args.workbook.metadata.season_label,
      headers: args.workbook.headers,
      source_kind: 'reviewed_attached_workbook',
      source_url: args.sourceUrl ?? DEFAULT_SOURCE_URL,
    },
  };
  validateNbaPlayerStatsSeed(seed, { expectedTeamCount: args.expectedTeamCount });
  return seed;
}

async function main() {
  const workbookPath = process.argv[2] ?? process.env.NBA_PLAYER_STATS_XLSX_PATH;
  const outputPath = process.argv[3] ?? process.env.NBA_PLAYER_STATS_OUTPUT_PATH ?? DEFAULT_NBA_PLAYER_STATS_OUTPUT_PATH;
  if (!workbookPath) {
    throw new Error('Usage: npm --prefix server run build:nba-player-stats -- /absolute/path/to/nba_2025-26_advanced_stats.xlsx');
  }

  const [workbook, rosterSeed] = await Promise.all([
    parseAdvancedStatsWorkbook(workbookPath),
    loadNbaRosterSeed(),
  ]);
  const seed = await buildNbaPlayerStatsSeed({ workbook, rosterSeed });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(seed, null, 2)}\n`);
  const matched = seed.rows.filter((row) => row.match_status === 'roster-matched').length;
  const statsOnly = seed.rows.length - matched;
  console.log(`wrote ${outputPath}`);
  console.log(`rows=${seed.rows.length} matched=${matched} stats_only=${statsOnly}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
