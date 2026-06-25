import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AppDataRequiredError,
  buildCurrentNbaEvidence,
  currentNbaEvidenceScopeForQuestion,
  currentNbaEvidenceToDataAnalystTrace,
  defaultNbaEvidenceTeamId,
  extractNbaTeamIds,
  hasCurrentNbaEvidenceTrigger,
  requiresCurrentNbaEvidence,
  reserveGeneratedSourceRefs,
  type CurrentNbaEvidenceContextTeam,
  type CurrentNbaEvidenceDataSource,
} from '../../src/claude/nba_evidence.js';
import type {
  CurrentCapSheetPlayerRowRecord,
  CurrentCapSheetSalaryCellRow,
  CurrentCapSheetViewRow,
} from '../../src/nba_cap_sheets/seed.js';
import type { CurrentPlayerStatViewRow } from '../../src/nba_player_stats/seed.js';
import type { CurrentRosterViewRow } from '../../src/nba_rosters/seed.js';

const REPRO_PROMPT = "I'm the boston celtics. Analyze potential three team trade possibilities between ATL, BOS and MIL that see Giannis ending up in Boston.";

test('NBA transaction prompts require current app evidence and extract involved teams', () => {
  assert.equal(requiresCurrentNbaEvidence(REPRO_PROMPT), true);
  assert.deepEqual(extractNbaTeamIds(REPRO_PROMPT), ['BOS', 'ATL', 'MIL']);
  assert.equal(currentNbaEvidenceScopeForQuestion(REPRO_PROMPT), 'transaction_full');
});

test('NBA roster prompts trigger roster-only evidence', () => {
  for (const prompt of [
    'Do we still have Jonathan Kuminga?',
    'Who do we have at guard?',
    'What is our depth chart at center?',
    'Starting lineup for Golden State?',
    'Who are the current Warriors players?',
  ]) {
    assert.equal(hasCurrentNbaEvidenceTrigger(prompt), true, prompt);
    assert.equal(currentNbaEvidenceScopeForQuestion(prompt), 'roster_only', prompt);
  }
});

test('default NBA evidence team is hardcoded to Warriors for this setup', () => {
  assert.equal(defaultNbaEvidenceTeamId({
    GAMBIT_DEFAULT_TEAM_ID: 'ATL',
    CONTEXT_GRAPH_DEFAULT_TEAM_ID: 'ATL',
    VITE_ONBOARDING_TEAM_ID: 'ATL',
  }), 'GSW');
});

test('current NBA evidence pack includes current app rows and Giannis on MIL', async () => {
  const evidence = await buildCurrentNbaEvidence(REPRO_PROMPT, {
    dataSource: fixtureDataSource(),
  });

  assert.ok(evidence);
  assert.deepEqual(evidence.team_ids, ['BOS', 'ATL', 'MIL']);
  assert.match(evidence.systemBlock, /CURRENT NBA APP EVIDENCE/);
  assert.match(evidence.systemBlock, /Giannis Antetokounmpo/);
  assert.match(evidence.systemBlock, /\[5\] ANALYST_DATA - MIL current app data/);
  assert.equal(evidence.sources[4].kind, 'ANALYST_DATA');
  assert.equal(evidence.sources[4].title, 'Current NBA app data - MIL - Milwaukee Bucks');
  assert.deepEqual((evidence.sources[4].data as { current_nba_evidence: { roster_player_names: string[] } }).current_nba_evidence.roster_player_names, [
    'Giannis Antetokounmpo',
    'Myles Turner',
  ]);
});

test('current NBA evidence fails loudly when required app data is missing', async () => {
  await assert.rejects(
    () => buildCurrentNbaEvidence(REPRO_PROMPT, {
      dataSource: fixtureDataSource({ salaryCells: fixtureSalaryCells().filter((row) => row.team_id !== 'MIL') }),
    }),
    (error) => error instanceof AppDataRequiredError && /MIL cap salary cells/.test(error.message),
  );
});

test('roster-only evidence succeeds without cap sheets, salary cells, or stats', async () => {
  const evidence = await buildCurrentNbaEvidence('Who do we have at guard?', {
    teamIds: ['BOS'],
    scope: 'roster_only',
    dataSource: fixtureDataSource({
      capSheetRows: [],
      capPlayerRows: [],
      salaryCells: [],
      playerStats: [],
      contextTeams: [],
    }),
  });

  assert.ok(evidence);
  assert.equal(evidence.scope, 'roster_only');
  assert.deepEqual(evidence.team_ids, ['BOS']);
  assert.match(evidence.systemBlock, /Use current app roster rows as the authority/);
  assert.match(evidence.systemBlock, /app roster snapshot does not verify coaching depth-chart order/);
  assert.match(evidence.systemBlock, /Current roster \(2\): Jayson Tatum; Jaylen Brown/);
  assert.doesNotMatch(evidence.systemBlock, /Team cap:/);
  assert.equal(evidence.sources[0].updated_at, '2026-05-03');

  const trace = currentNbaEvidenceToDataAnalystTrace(evidence, 'toolu_preload');
  assert.equal(trace.tool_name, 'query_nba_data');
  assert.equal(trace.datasets[0].dataset_id, 'nba_rosters_current');
  assert.deepEqual(trace.datasets[0].team_ids, ['BOS']);
  assert.equal(trace.datasets[0].row_count, 2);
});

test('context graph roster conflicts are caveated and excluded from current-team evidence', async () => {
  const evidence = await buildCurrentNbaEvidence(REPRO_PROMPT, {
    dataSource: fixtureDataSource({
      contextTeams: fixtureContextTeams().map((team) => (
        team.team_id === 'ATL'
          ? { ...team, source_roster_names: ['Kristaps Porzingis', 'Dyson Daniels'] }
          : team
      )),
    }),
  });

  assert.ok(evidence);
  assert.deepEqual(evidence.conflicts, [{
    team_id: 'ATL',
    source: 'context_graph_roster',
    names: ['Kristaps Porzingis'],
  }]);
  assert.match(evidence.systemBlock, /Context roster conflicts excluded from current-team evidence: Kristaps Porzingis/);
  assert.match(evidence.systemBlock, /Current roster \(2\): Dyson Daniels; Jalen Johnson/);
  assert.doesNotMatch(evidence.systemBlock, /Current roster \(2\): Kristaps Porzingis/);
});

test('generated sources are moved after reserved evidence refs', () => {
  const sources = reserveGeneratedSourceRefs([
    { ref_index: 1, kind: 'NEWS', source: 'MODEL', title: 'Model source 1', updated_at: null, data: null },
    { ref_index: 9, kind: 'NEWS', source: 'MODEL', title: 'Model source 9', updated_at: null, data: null },
  ], 6);

  assert.deepEqual(sources.map((source) => source.ref_index), [7, 9]);
});

function fixtureDataSource(overrides: Partial<{
  rosterRows: CurrentRosterViewRow[];
  capSheetRows: CurrentCapSheetViewRow[];
  capPlayerRows: CurrentCapSheetPlayerRowRecord[];
  salaryCells: CurrentCapSheetSalaryCellRow[];
  playerStats: CurrentPlayerStatViewRow[];
  contextTeams: CurrentNbaEvidenceContextTeam[];
}> = {}): CurrentNbaEvidenceDataSource {
  const rows = {
    rosterRows: overrides.rosterRows ?? fixtureRosterRows(),
    capSheetRows: overrides.capSheetRows ?? fixtureCapSheets(),
    capPlayerRows: overrides.capPlayerRows ?? fixtureCapPlayers(),
    salaryCells: overrides.salaryCells ?? fixtureSalaryCells(),
    playerStats: overrides.playerStats ?? fixtureStats(),
    contextTeams: overrides.contextTeams ?? fixtureContextTeams(),
  };
  return {
    rosterRows: async (teamIds) => rows.rosterRows.filter((row) => teamIds.includes(row.team_id)),
    capSheetRows: async (teamIds) => rows.capSheetRows.filter((row) => teamIds.includes(row.team_id)),
    capPlayerRows: async (teamIds) => rows.capPlayerRows.filter((row) => teamIds.includes(row.team_id)),
    salaryCells: async (teamIds) => rows.salaryCells.filter((row) => teamIds.includes(row.team_id)),
    playerStats: async (teamIds) => rows.playerStats.filter((row) => teamIds.includes(row.team_id)),
    contextTeams: async (teamIds) => rows.contextTeams.filter((row) => teamIds.includes(row.team_id)),
  };
}

function fixtureRosterRows(): CurrentRosterViewRow[] {
  return [
    rosterRow('BOS', 'Boston Celtics', 'Jayson Tatum', 1),
    rosterRow('BOS', 'Boston Celtics', 'Jaylen Brown', 2),
    rosterRow('ATL', 'Atlanta Hawks', 'Dyson Daniels', 1),
    rosterRow('ATL', 'Atlanta Hawks', 'Jalen Johnson', 2),
    rosterRow('MIL', 'Milwaukee Bucks', 'Giannis Antetokounmpo', 1),
    rosterRow('MIL', 'Milwaukee Bucks', 'Myles Turner', 2),
  ];
}

function fixtureCapSheets(): CurrentCapSheetViewRow[] {
  return [
    capSheet('BOS', 'Boston Celtics', 212000000),
    capSheet('ATL', 'Atlanta Hawks', 187000000),
    capSheet('MIL', 'Milwaukee Bucks', 195000000),
  ];
}

function fixtureCapPlayers(): CurrentCapSheetPlayerRowRecord[] {
  return [
    capPlayer('BOS', 'bos-tatum', 'Jayson Tatum', 1, 280000000),
    capPlayer('BOS', 'bos-brown', 'Jaylen Brown', 2, 230800000),
    capPlayer('ATL', 'atl-daniels', 'Dyson Daniels', 1, 100000000),
    capPlayer('ATL', 'atl-johnson', 'Jalen Johnson', 2, 150000000),
    capPlayer('MIL', 'mil-giannis', 'Giannis Antetokounmpo', 1, 175369698),
    capPlayer('MIL', 'mil-turner', 'Myles Turner', 2, 107000000),
  ];
}

function fixtureSalaryCells(): CurrentCapSheetSalaryCellRow[] {
  return [
    salaryCell('BOS', 'bos-tatum', '2026-27', 60500000),
    salaryCell('BOS', 'bos-brown', '2026-27', 36200000),
    salaryCell('ATL', 'atl-daniels', '2026-27', 25000000),
    salaryCell('ATL', 'atl-johnson', '2026-27', 30000000),
    salaryCell('MIL', 'mil-giannis', '2026-27', 58456566),
    salaryCell('MIL', 'mil-turner', '2026-27', 26750000),
  ];
}

function fixtureStats(): CurrentPlayerStatViewRow[] {
  return [
    statRow('BOS', 'Jayson Tatum', 1),
    statRow('BOS', 'Jaylen Brown', 2),
    statRow('ATL', 'Dyson Daniels', 1),
    statRow('ATL', 'Jalen Johnson', 2),
    statRow('MIL', 'Giannis Antetokounmpo', 1),
    statRow('MIL', 'Myles Turner', 2),
  ];
}

function fixtureContextTeams(): CurrentNbaEvidenceContextTeam[] {
  return [
    contextTeam('BOS', 'Boston Celtics', ['Jayson Tatum', 'Jaylen Brown']),
    contextTeam('ATL', 'Atlanta Hawks', ['Dyson Daniels', 'Jalen Johnson']),
    contextTeam('MIL', 'Milwaukee Bucks', ['Giannis Antetokounmpo', 'Myles Turner']),
  ];
}

function rosterRow(teamId: string, fullName: string, playerName: string, sourceOrder: number): CurrentRosterViewRow {
  return {
    snapshot_id: 'roster-snapshot',
    season: '2025-26',
    as_of_date: '2026-05-03',
    source_name: 'Fixture roster',
    source_url: 'data/fixture-rosters.json',
    retrieved_at: '2026-05-03T12:00:00.000Z',
    snapshot_team_count: 30,
    snapshot_player_count: 500,
    snapshot_notes: null,
    snapshot_source_meta: {},
    team_id: teamId,
    nba_team_id: sourceOrder,
    abbreviation: teamId,
    city: fullName.split(' ')[0],
    name: fullName.split(' ').slice(1).join(' '),
    full_name: fullName,
    conference: 'Eastern',
    division: 'Fixture',
    official_roster_count: 2,
    nba_player_id: sourceOrder,
    player_slug: playerName.toLowerCase().replaceAll(' ', '-'),
    player_full_name: playerName,
    first_name: playerName.split(' ')[0],
    last_name: playerName.split(' ').slice(1).join(' '),
    source_order: sourceOrder,
    jersey_number: String(sourceOrder),
    position: 'F',
    height: '6-8',
    weight_lbs: 220,
    last_attended: 'Fixture',
    country: 'USA',
    player_source_url: 'https://example.test/player',
    entry_source_url: 'https://example.test/entry',
    source_row: {},
  };
}

function capSheet(teamId: string, fullName: string, payrollAmount: number): CurrentCapSheetViewRow {
  return {
    snapshot_id: 'cap-snapshot',
    season: '2025-26',
    as_of_date: '2026-05-03',
    source_name: 'Fixture cap sheet',
    source_url: 'data/fixture-cap.json',
    retrieved_at: '2026-05-03T12:00:00.000Z',
    snapshot_team_count: 30,
    snapshot_notes: null,
    snapshot_source_meta: {},
    team_id: teamId,
    nba_team_id: 1,
    abbreviation: teamId,
    city: fullName.split(' ')[0],
    name: fullName.split(' ').slice(1).join(' '),
    full_name: fullName,
    conference: 'Eastern',
    division: 'Fixture',
    official_roster_count: 2,
    cap_status: 'above_cap',
    tax_status: 'tax',
    apron_status: 'first_apron',
    payroll_amount: payrollAmount,
    source_status: 'captured',
    missing_sections: [],
    source_refs: [],
    source_meta: {},
    created_at: '2026-05-03T12:00:00.000Z',
  };
}

function capPlayer(teamId: string, id: string, playerName: string, sourceOrder: number, totalAmount: number): CurrentCapSheetPlayerRowRecord {
  return {
    id,
    snapshot_id: 'cap-snapshot',
    team_id: teamId,
    nba_player_id: sourceOrder,
    player_name: playerName,
    source_order: sourceOrder,
    position: 'F',
    age: 30,
    dob: null,
    yos: null,
    roster_status: 'standard',
    fa_status: null,
    fa_year: null,
    bird_rights: 'full',
    restrictions: [],
    how_acquired: null,
    agent: null,
    total_amount: totalAmount,
    source_status: 'captured',
    source_url: 'https://example.test/cap',
    source_data: {},
  };
}

function salaryCell(teamId: string, playerRowId: string, season: string, amount: number): CurrentCapSheetSalaryCellRow {
  return {
    player_row_id: playerRowId,
    snapshot_id: 'cap-snapshot',
    team_id: teamId,
    season,
    amount,
    label: `$${amount}`,
    option_type: null,
    is_guaranteed: true,
    source_status: 'captured',
    source_url: 'https://example.test/cap',
    source_data: {},
  };
}

function statRow(teamId: string, playerName: string, sourceOrder: number): CurrentPlayerStatViewRow {
  return {
    snapshot_id: 'stats-snapshot',
    season: '2025-26',
    season_type: 'Regular Season',
    as_of_date: '2026-05-04',
    source_name: 'Fixture stats',
    source_url: 'data/fixture-stats.json',
    retrieved_at: '2026-05-04T12:00:00.000Z',
    snapshot_team_count: 30,
    snapshot_row_count: 500,
    snapshot_matched_player_count: 480,
    snapshot_unmatched_player_count: 20,
    snapshot_notes: [],
    snapshot_glossary: {},
    snapshot_source_meta: {},
    team_id: teamId,
    nba_team_id: 1,
    abbreviation: teamId,
    city: 'Fixture',
    name: 'Team',
    full_name: `${teamId} Team`,
    conference: 'Eastern',
    division: 'Fixture',
    nba_player_id: sourceOrder,
    player_name: playerName,
    player_name_normalized: playerName.toLowerCase().replaceAll(' ', '-'),
    source_order: sourceOrder,
    position: 'F',
    age: 30,
    games_played: 60,
    minutes: 1800,
    points_per_game: 20,
    rebounds_per_game: 8,
    assists_per_game: 5,
    true_shooting_pct: 0.61,
    effective_fg_pct: 0.55,
    usage_pct: 0.28,
    three_point_attempt_rate: 0.3,
    free_throw_rate: 0.4,
    offensive_rebound_pct: 0.05,
    defensive_rebound_pct: 0.18,
    rebound_pct: 0.12,
    assist_pct: 0.2,
    turnover_pct: 10,
    offensive_rating: 118,
    defensive_rating: 110,
    net_rating: 8,
    player_impact_estimate: 15,
    defensive_win_shares: 3,
    match_status: 'roster-matched',
    source_row: {},
  };
}

function contextTeam(teamId: string, name: string, sourceRosterNames: string[]): CurrentNbaEvidenceContextTeam {
  return {
    team_id: teamId,
    name,
    validation_status: 'pass',
    source_as_of_date: '2026-05-02',
    source_last_updated: '2026-05-04T00:00:00.000Z',
    strategic_posture: 'contend_now',
    trade_dna: 'aggressive',
    near_term_priorities: ['trade'],
    relationship_notes: ['trade_partner:test'],
    source_roster_names: sourceRosterNames,
  };
}
