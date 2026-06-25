import test from 'node:test';
import assert from 'node:assert/strict';
import {
  groupCurrentRosterRows,
  summarizeNbaRosterSeed,
  validateNbaRosterSeed,
  type CurrentRosterViewRow,
  type NbaRosterSeed,
} from '../../src/nba_rosters/seed.js';

const SEASON = '2025-26';

const fixture: NbaRosterSeed = {
  schema_version: 1,
  season: SEASON,
  as_of_date: '2026-05-03',
  source_name: 'Fixture League Roster',
  source_url: 'https://example.test/players',
  retrieved_at: '2026-05-03T12:00:00.000Z',
  source_retrieved_from: 'https://example.test/players',
  teams: [
    {
      team_id: 'AAA',
      nba_team_id: 1,
      abbreviation: 'AAA',
      city: 'Alpha',
      name: 'Aces',
      full_name: 'Alpha Aces',
      conference: 'East',
      division: 'Test',
    },
    {
      team_id: 'BBB',
      nba_team_id: 2,
      abbreviation: 'BBB',
      city: 'Beta',
      name: 'Bolts',
      full_name: 'Beta Bolts',
      conference: 'West',
      division: 'Test',
    },
  ],
  players: [
    player(101, 'Ada Ace', 'ada-ace'),
    player(102, 'Ben Bolt', 'ben-bolt'),
    player(103, 'Cy Center', 'cy-center'),
  ],
  entries: [
    entry('AAA', 101, 1),
    entry('AAA', 102, 2),
    entry('BBB', 103, 1),
  ],
  team_counts: { AAA: 2, BBB: 1 },
  notes: ['fixture'],
  source_meta: { parser: 'fixture' },
};

test('summarizes team and player counts from the seed fixture', () => {
  const summary = validateNbaRosterSeed(fixture, { expectedTeamCount: 2 });
  assert.deepEqual(summary.team_counts, { AAA: 2, BBB: 1 });
  assert.equal(summary.team_count, 2);
  assert.equal(summary.player_count, 3);
  assert.equal(summary.entry_count, 3);
});

test('rejects duplicate player rows and duplicate roster entries', () => {
  assert.throws(
    () => validateNbaRosterSeed({ ...fixture, players: [...fixture.players, fixture.players[0]] }, { expectedTeamCount: 2 }),
    /duplicate players/,
  );

  assert.throws(
    () => validateNbaRosterSeed({ ...fixture, entries: [...fixture.entries, fixture.entries[0]], team_counts: { AAA: 3, BBB: 1 } }, { expectedTeamCount: 2 }),
    /duplicate roster entry AAA:101/,
  );
});

test('reports official roster counts without forcing 15 players', () => {
  const summary = summarizeNbaRosterSeed(fixture);
  assert.equal(summary.team_counts.AAA, 2);
  assert.equal(summary.team_counts.BBB, 1);
});

test('groups current roster rows from the latest snapshot only', () => {
  const rows: CurrentRosterViewRow[] = [
    viewRow({ snapshotId: 'older', asOf: '2026-04-01', retrieved: '2026-04-01T10:00:00.000Z', teamId: 'AAA', playerId: 101, playerName: 'Old Player', sourceOrder: 1 }),
    viewRow({ snapshotId: 'latest', asOf: '2026-05-03', retrieved: '2026-05-03T12:00:00.000Z', teamId: 'AAA', playerId: 101, playerName: 'Ada Ace', sourceOrder: 2 }),
    viewRow({ snapshotId: 'latest', asOf: '2026-05-03', retrieved: '2026-05-03T12:00:00.000Z', teamId: 'AAA', playerId: 102, playerName: 'Ben Bolt', sourceOrder: 1 }),
  ];

  const grouped = groupCurrentRosterRows(rows);
  assert.equal(grouped.snapshot?.id, 'latest');
  assert.equal(grouped.totals.team_count, 1);
  assert.equal(grouped.totals.player_count, 2);
  assert.deepEqual(grouped.teams[0].players.map((p) => p.player.full_name), ['Ben Bolt', 'Ada Ace']);
});

function player(id: number, fullName: string, slug: string) {
  const [firstName, ...rest] = fullName.split(' ');
  return {
    nba_player_id: id,
    slug,
    full_name: fullName,
    first_name: firstName,
    last_name: rest.join(' '),
    position: 'G',
    height: '6-4',
    weight_lbs: 200,
    last_attended: 'Fixture U',
    country: 'USA',
    jersey_number: String(id).slice(-2),
    source_url: `https://example.test/player/${id}/${slug}`,
    source_row: { PERSON_ID: id },
  };
}

function entry(teamId: string, playerId: number, sourceOrder: number) {
  return {
    team_id: teamId,
    nba_player_id: playerId,
    season: SEASON,
    source_order: sourceOrder,
    jersey_number: String(playerId).slice(-2),
    position: 'G',
    height: '6-4',
    weight_lbs: 200,
    last_attended: 'Fixture U',
    country: 'USA',
    source_url: `https://example.test/player/${playerId}`,
    source_row: { PERSON_ID: playerId },
  };
}

function viewRow(args: {
  snapshotId: string;
  asOf: string;
  retrieved: string;
  teamId: string;
  playerId: number;
  playerName: string;
  sourceOrder: number;
}): CurrentRosterViewRow {
  return {
    snapshot_id: args.snapshotId,
    season: SEASON,
    as_of_date: args.asOf,
    source_name: 'Fixture',
    source_url: 'https://example.test/players',
    retrieved_at: args.retrieved,
    snapshot_team_count: 1,
    snapshot_player_count: 2,
    snapshot_notes: 'fixture',
    snapshot_source_meta: {},
    team_id: args.teamId,
    nba_team_id: 1,
    abbreviation: args.teamId,
    city: 'Alpha',
    name: 'Aces',
    full_name: 'Alpha Aces',
    conference: 'East',
    division: 'Test',
    official_roster_count: 2,
    nba_player_id: args.playerId,
    player_slug: args.playerName.toLowerCase().replaceAll(' ', '-'),
    player_full_name: args.playerName,
    first_name: args.playerName.split(' ')[0],
    last_name: args.playerName.split(' ').slice(1).join(' '),
    source_order: args.sourceOrder,
    jersey_number: String(args.playerId).slice(-2),
    position: 'G',
    height: '6-4',
    weight_lbs: 200,
    last_attended: 'Fixture U',
    country: 'USA',
    player_source_url: `https://example.test/player/${args.playerId}`,
    entry_source_url: `https://example.test/player/${args.playerId}`,
    source_row: { PERSON_ID: args.playerId },
  };
}
