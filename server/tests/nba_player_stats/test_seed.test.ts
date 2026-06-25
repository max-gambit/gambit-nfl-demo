import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { parseAdvancedStatsWorkbook, workbookParserTestInternals } from '../../src/nba_player_stats/workbook.js';
import {
  buildNbaPlayerStatsSeed,
} from '../../src/nba_player_stats/build_reviewed_snapshot.js';
import {
  buildPlayerStatTeamDetail,
  groupCurrentPlayerStatRows,
  validateNbaPlayerStatsSeed,
  type CurrentPlayerStatViewRow,
  type NbaPlayerStatsSeed,
} from '../../src/nba_player_stats/seed.js';
import type { NbaRosterSeed } from '../../src/nba_rosters/seed.js';

const fixturePath = fileURLToPath(new URL('./fixtures/advanced_stats_fixture.xlsx', import.meta.url));

test('parses reviewed workbook headers, notes, glossary, and numeric stat rows', async () => {
  const workbook = await parseAdvancedStatsWorkbook(fixturePath);

  assert.equal(workbook.rows.length, 3);
  assert.equal(workbook.headers.length, 24);
  assert.equal(workbook.metadata.season, '2025-26');
  assert.equal(workbook.metadata.season_type, 'Regular Season');
  assert.equal(workbook.metadata.source, 'Fixture workbook');
  assert.equal(workbook.glossary['GP / MP'], 'Games played / total minutes played');
  assert.equal(workbook.rows[0].true_shooting_pct, 0.61);
  assert.equal(workbook.rows[1].position, null);
  assert.equal(workbook.rows[1].age, 24);
});

test('workbook parser keeps self-closing blank cells aligned by Excel reference', () => {
  const rows = workbookParserTestInternals.parseSheetXml(
    '<worksheet><sheetData><row r="2"><c r="A2" t="str"><v>Seth Curry</v></c><c r="B2" t="str"><v>GSW</v></c><c r="C2"/><c r="D2" t="n"><v>35</v></c></row></sheetData></worksheet>',
    [],
  );

  assert.equal(rows[1][0], 'Seth Curry');
  assert.equal(rows[1][1], 'GSW');
  assert.equal(rows[1][2], null);
  assert.equal(rows[1][3], 35);
});

test('builds seed with roster-linked and stats-only rows', async () => {
  const workbook = await parseAdvancedStatsWorkbook(fixturePath);
  const seed = await buildNbaPlayerStatsSeed({ workbook, rosterSeed: rosterFixture(), sourceUrl: 'attached://fixture.xlsx', expectedTeamCount: 2 });
  const summary = validateNbaPlayerStatsSeed(seed, { expectedTeamCount: 2, expectedRowCount: 3 });

  assert.equal(summary.team_count, 2);
  assert.equal(summary.row_count, 3);
  assert.equal(summary.matched_player_count, 2);
  assert.equal(summary.unmatched_player_count, 1);
  assert.deepEqual(summary.team_counts, { AAA: 2, BBB: 1 });
  assert.deepEqual(seed.rows.map((row) => row.match_status), ['roster-matched', 'stats-only', 'roster-matched']);
  assert.equal(seed.rows[1].nba_player_id, null);
});

test('rejects duplicate player-team stat rows', () => {
  const seed = playerStatsSeedFixture();
  assert.throws(
    () => validateNbaPlayerStatsSeed({ ...seed, rows: [...seed.rows, seed.rows[0]] }, { expectedTeamCount: 2 }),
    /duplicate row AAA:ada ace/,
  );
});

test('groups current rows and selects latest snapshot', () => {
  const rows: CurrentPlayerStatViewRow[] = [
    viewRow({ snapshotId: 'older', asOf: '2026-05-01', teamId: 'AAA', playerId: 101, playerName: 'Old Ace', normalized: 'old ace', order: 1 }),
    viewRow({ snapshotId: 'latest', asOf: '2026-05-04', teamId: 'AAA', playerId: 101, playerName: 'Ada Ace', normalized: 'ada ace', order: 1, net: 8.8, pie: 0.13 }),
    viewRow({ snapshotId: 'latest', asOf: '2026-05-04', teamId: 'AAA', playerId: null, playerName: 'Sid Season', normalized: 'sid season', order: 2, matchStatus: 'stats-only', net: -17, pie: 0.02 }),
    viewRow({ snapshotId: 'latest', asOf: '2026-05-04', teamId: 'BBB', playerId: 102, playerName: 'Ben Bolt', normalized: 'ben bolt', order: 1, net: 3, pie: 0.09 }),
  ];

  const grouped = groupCurrentPlayerStatRows(rows);
  assert.equal(grouped.snapshot?.id, 'latest');
  assert.equal(grouped.totals.team_count, 2);
  assert.equal(grouped.totals.player_stat_row_count, 3);
  assert.equal(grouped.totals.matched_player_count, 2);
  assert.equal(grouped.totals.stats_only_count, 1);
  assert.equal(grouped.teams[0].top_net_rating_player, 'Ada Ace');

  const detail = buildPlayerStatTeamDetail(rows.filter((row) => row.snapshot_id === 'latest' && row.team_id === 'AAA'));
  assert.equal(detail?.rows.length, 2);
  assert.equal(detail?.rows[1].match_status, 'stats-only');
});

function rosterFixture(): NbaRosterSeed {
  return {
    schema_version: 1,
    season: '2025-26',
    as_of_date: '2026-05-03',
    source_name: 'Fixture Roster',
    source_url: 'https://example.test/roster',
    retrieved_at: '2026-05-03T00:00:00.000Z',
    source_retrieved_from: 'https://example.test/roster',
    teams: [
      team('AAA', 1, 'Alpha Aces'),
      team('BBB', 2, 'Beta Bolts'),
    ],
    players: [
      player(101, 'Ada Ace'),
      player(102, 'Ben Bolt'),
    ],
    entries: [
      entry('AAA', 101, 1),
      entry('BBB', 102, 1),
    ],
    team_counts: { AAA: 1, BBB: 1 },
    notes: ['fixture'],
    source_meta: {},
  };
}

function playerStatsSeedFixture(): NbaPlayerStatsSeed {
  return {
    schema_version: 1,
    season: '2025-26',
    season_type: 'Regular Season',
    as_of_date: '2026-05-04',
    source_name: 'Fixture workbook',
    source_url: 'attached://fixture.xlsx',
    retrieved_at: '2026-05-04T00:00:00.000Z',
    teams: [team('AAA', 1, 'Alpha Aces'), team('BBB', 2, 'Beta Bolts')],
    rows: [
      statRow('AAA', 101, 'Ada Ace', 'ada ace', 'roster-matched', 1),
      statRow('BBB', 102, 'Ben Bolt', 'ben bolt', 'roster-matched', 1),
    ],
    notes: [{ label: 'Source', value: 'Fixture workbook' }],
    glossary: { 'TS%': 'True Shooting Percentage' },
    source_meta: {},
  };
}

function team(teamId: string, nbaTeamId: number, fullName: string) {
  const [city, ...rest] = fullName.split(' ');
  return {
    team_id: teamId,
    nba_team_id: nbaTeamId,
    abbreviation: teamId,
    city,
    name: rest.join(' '),
    full_name: fullName,
    conference: 'Test',
    division: 'Fixture',
  };
}

function player(id: number, fullName: string) {
  const [firstName, ...rest] = fullName.split(' ');
  return {
    nba_player_id: id,
    slug: fullName.toLowerCase().replaceAll(' ', '-'),
    full_name: fullName,
    first_name: firstName,
    last_name: rest.join(' '),
    position: 'G',
    height: '6-4',
    weight_lbs: 200,
    last_attended: 'Fixture U',
    country: 'USA',
    jersey_number: String(id).slice(-2),
    source_url: `https://example.test/player/${id}`,
    source_row: {},
  };
}

function entry(teamId: string, playerId: number, sourceOrder: number) {
  return {
    team_id: teamId,
    nba_player_id: playerId,
    season: '2025-26',
    source_order: sourceOrder,
    jersey_number: String(playerId).slice(-2),
    position: 'G',
    height: '6-4',
    weight_lbs: 200,
    last_attended: 'Fixture U',
    country: 'USA',
    source_url: `https://example.test/player/${playerId}`,
    source_row: {},
  };
}

function statRow(
  teamId: string,
  playerId: number | null,
  playerName: string,
  normalized: string,
  matchStatus: 'roster-matched' | 'stats-only',
  sourceOrder: number,
) {
  return {
    team_id: teamId,
    nba_player_id: playerId,
    player_name: playerName,
    player_name_normalized: normalized,
    source_order: sourceOrder,
    position: 'G',
    age: 26,
    games_played: 10,
    minutes: 200,
    points_per_game: 12.3,
    rebounds_per_game: 4.1,
    assists_per_game: 5.2,
    true_shooting_pct: 0.61,
    effective_fg_pct: 0.55,
    usage_pct: 0.22,
    three_point_attempt_rate: 0.4,
    free_throw_rate: 0.25,
    offensive_rebound_pct: 0.03,
    defensive_rebound_pct: 0.11,
    rebound_pct: 0.07,
    assist_pct: 0.3,
    turnover_pct: 9.1,
    offensive_rating: 118.2,
    defensive_rating: 109.4,
    net_rating: 8.8,
    player_impact_estimate: 0.13,
    defensive_win_shares: 1.25,
    match_status: matchStatus,
    source_row: { Player: playerName },
  };
}

function viewRow(args: {
  snapshotId: string;
  asOf: string;
  teamId: string;
  playerId: number | null;
  playerName: string;
  normalized: string;
  order: number;
  matchStatus?: 'roster-matched' | 'stats-only';
  net?: number;
  pie?: number;
}): CurrentPlayerStatViewRow {
  const { team_id: _teamId, ...row } = statRow(
    args.teamId,
    args.playerId,
    args.playerName,
    args.normalized,
    args.matchStatus ?? 'roster-matched',
    args.order,
  );

  return {
    snapshot_id: args.snapshotId,
    season: '2025-26',
    season_type: 'Regular Season',
    as_of_date: args.asOf,
    source_name: 'Fixture workbook',
    source_url: 'attached://fixture.xlsx',
    retrieved_at: `${args.asOf}T00:00:00.000Z`,
    snapshot_team_count: 2,
    snapshot_row_count: 3,
    snapshot_matched_player_count: 2,
    snapshot_unmatched_player_count: 1,
    snapshot_notes: [],
    snapshot_glossary: {},
    snapshot_source_meta: {},
    team_id: args.teamId,
    nba_team_id: args.teamId === 'AAA' ? 1 : 2,
    abbreviation: args.teamId,
    city: args.teamId === 'AAA' ? 'Alpha' : 'Beta',
    name: args.teamId === 'AAA' ? 'Aces' : 'Bolts',
    full_name: args.teamId === 'AAA' ? 'Alpha Aces' : 'Beta Bolts',
    conference: 'Test',
    division: 'Fixture',
    ...row,
    net_rating: args.net ?? 8.8,
    player_impact_estimate: args.pie ?? 0.13,
  };
}
