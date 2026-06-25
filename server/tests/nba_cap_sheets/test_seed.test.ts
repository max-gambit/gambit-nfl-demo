import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCapSheetDetail,
  groupCapSheetSummaries,
  validateNbaCapSheetSeed,
  type CurrentCapSheetMetricRow,
  type CurrentCapSheetPlayerRowRecord,
  type CurrentCapSheetSalaryCellRow,
  type CurrentCapSheetSectionRow,
  type CurrentCapSheetViewRow,
  type NbaCapSheetSeed,
} from '../../src/nba_cap_sheets/seed.js';

const fixture: NbaCapSheetSeed = {
  schema_version: 1,
  season: '2025-26',
  as_of_date: '2026-05-03',
  source_name: 'Fixture cap sheet',
  source_url: 'data/fixture.json',
  retrieved_at: '2026-05-03T12:00:00.000Z',
  source_policy: {
    mode: 'gated_public_refresh',
    default_seed: 'reviewed_snapshot',
    notes: ['fixture'],
  },
  teams: [
    team('AAA', 1, 'Alpha Aces'),
    team('BBB', 2, 'Beta Bolts'),
  ],
  cap_sheets: [
    sheet('AAA', [
      playerRow('aaa-1', 101, 'Ada Ace', 1, 1000000),
      playerRow('aaa-2', 102, 'Ben Bolt', 2, null),
    ]),
    sheet('BBB', [playerRow('bbb-1', 201, 'Cy Center', 1, 2000000)]),
  ],
  notes: ['fixture'],
  source_meta: { fixture: true },
};

test('validates all team cap sheets and salary cells', () => {
  const summary = validateNbaCapSheetSeed(fixture, { expectedTeamCount: 2 });
  assert.equal(summary.team_count, 2);
  assert.equal(summary.player_row_count, 3);
  assert.equal(summary.salary_cell_count, 6);
  assert.equal(summary.source_needed_section_count, 2);
});

test('rejects missing or duplicate cap sheets', () => {
  assert.throws(
    () => validateNbaCapSheetSeed({ ...fixture, cap_sheets: [fixture.cap_sheets[0]] }, { expectedTeamCount: 2 }),
    /expected 2 cap sheets/,
  );
  assert.throws(
    () => validateNbaCapSheetSeed({ ...fixture, cap_sheets: [fixture.cap_sheets[0], fixture.cap_sheets[0]] }, { expectedTeamCount: 2 }),
    /duplicate team sheets/,
  );
});

test('groups current cap sheet summaries with source-needed counts', () => {
  const grouped = groupCapSheetSummaries([
    viewRow('latest', 'AAA', 'Alpha Aces', ['cash_trades']),
    viewRow('latest', 'BBB', 'Beta Bolts', ['draft_rights', 'injury_report']),
  ]);
  assert.equal(grouped.snapshot?.id, 'latest');
  assert.equal(grouped.totals.team_count, 2);
  assert.equal(grouped.totals.source_needed_section_count, 3);
  assert.deepEqual(grouped.teams.map((team) => team.team.team_id), ['AAA', 'BBB']);
});

test('builds team detail and attaches salary cells to player rows', () => {
  const detail = buildCapSheetDetail({
    sheet: viewRow('latest', 'AAA', 'Alpha Aces', ['cash_trades']),
    metrics: [metricRow('payroll', 1)],
    playerRows: [playerRecord('aaa-1', 'Ada Ace')],
    salaryCells: [
      salaryCell('aaa-1', '2025-26', 1000000),
      salaryCell('aaa-1', '2026-27', null),
    ],
    sections: [sectionRow('cash_trades', 'Cash In Trades')],
    roster: null,
  });
  assert.equal(detail.cap_sheet?.player_rows[0].salary_cells.length, 2);
  assert.equal(detail.cap_sheet?.player_rows[0].salary_cells[0].amount, 1000000);
  assert.equal(detail.cap_sheet?.sections[0].source_status, 'source-needed');
});

function team(teamId: string, nbaTeamId: number, fullName: string) {
  const [city, ...name] = fullName.split(' ');
  return {
    team_id: teamId,
    nba_team_id: nbaTeamId,
    abbreviation: teamId,
    city,
    name: name.join(' '),
    full_name: fullName,
    conference: 'Test',
    division: 'Fixture',
  };
}

function sheet(teamId: string, rows: ReturnType<typeof playerRow>[]) {
  return {
    team_id: teamId,
    official_roster_count: rows.length,
    cap_status: 'captured',
    tax_status: 'Source needed',
    apron_status: 'Source needed',
    payroll_amount: null,
    source_status: 'captured' as const,
    missing_sections: ['cash_trades'],
    source_refs: [{
      name: 'Fixture',
      url: 'https://example.test',
      source_type: 'reviewed_snapshot' as const,
      retrieved_at: '2026-05-03T12:00:00.000Z',
      terms_status: 'reviewed' as const,
      robots_status: 'unknown' as const,
      notes: [],
    }],
    metrics: [{
      key: 'payroll',
      label: 'Payroll',
      value: 'Source needed',
      amount: null,
      source_status: 'source-needed' as const,
      source_url: null,
      note: null,
    }],
    player_rows: rows,
    sections: [{
      key: 'cash_trades',
      title: 'Cash In Trades',
      source_status: 'source-needed' as const,
      source_url: null,
      notes: ['fixture missing'],
      rows: [{ status: 'Source needed' }],
    }],
    source_meta: {},
  };
}

function playerRow(id: string, playerId: number, name: string, order: number, amount: number | null) {
  return {
    id,
    nba_player_id: playerId,
    player_name: name,
    source_order: order,
    position: 'G',
    age: null,
    dob: null,
    yos: null,
    roster_status: 'standard',
    fa_status: null,
    fa_year: null,
    bird_rights: null,
    restrictions: [],
    how_acquired: null,
    agent: null,
    total_amount: amount,
    source_status: amount == null ? 'source-needed' as const : 'captured' as const,
    source_url: 'https://example.test/player',
    source_data: {},
    salary_cells: [
      {
        season: '2025-26',
        amount,
        label: amount == null ? 'Source needed' : '$1,000,000',
        option_type: null,
        is_guaranteed: amount != null,
        source_status: amount == null ? 'source-needed' as const : 'captured' as const,
        source_url: amount == null ? null : 'https://example.test/player',
        source_data: {},
      },
      {
        season: '2026-27',
        amount: null,
        label: 'Source needed',
        option_type: null,
        is_guaranteed: null,
        source_status: 'source-needed' as const,
        source_url: null,
        source_data: {},
      },
    ],
  };
}

function viewRow(snapshotId: string, teamId: string, fullName: string, missingSections: string[]): CurrentCapSheetViewRow {
  return {
    snapshot_id: snapshotId,
    season: '2025-26',
    as_of_date: '2026-05-03',
    source_name: 'Fixture',
    source_url: 'data/fixture.json',
    retrieved_at: '2026-05-03T12:00:00.000Z',
    snapshot_team_count: 2,
    snapshot_notes: 'fixture',
    snapshot_source_meta: {},
    team_id: teamId,
    nba_team_id: teamId === 'AAA' ? 1 : 2,
    abbreviation: teamId,
    city: fullName.split(' ')[0],
    name: fullName.split(' ').slice(1).join(' '),
    full_name: fullName,
    conference: 'Test',
    division: 'Fixture',
    official_roster_count: 2,
    cap_status: 'captured',
    tax_status: 'Source needed',
    apron_status: 'Source needed',
    payroll_amount: null,
    source_status: 'captured',
    missing_sections: missingSections,
    source_refs: [],
    source_meta: {},
    created_at: '2026-05-03T12:00:00.000Z',
  };
}

function metricRow(key: string, sortOrder: number): CurrentCapSheetMetricRow {
  return {
    snapshot_id: 'latest',
    team_id: 'AAA',
    metric_key: key,
    label: 'Payroll',
    value: '$1',
    amount: 1,
    source_status: 'captured',
    source_url: 'https://example.test',
    note: null,
    sort_order: sortOrder,
  };
}

function playerRecord(id: string, name: string): CurrentCapSheetPlayerRowRecord {
  return {
    id,
    snapshot_id: 'latest',
    team_id: 'AAA',
    nba_player_id: 101,
    player_name: name,
    source_order: 1,
    position: 'G',
    age: null,
    dob: null,
    yos: null,
    roster_status: 'standard',
    fa_status: null,
    fa_year: null,
    bird_rights: null,
    restrictions: [],
    how_acquired: null,
    agent: null,
    total_amount: 1000000,
    source_status: 'captured',
    source_url: 'https://example.test/player',
    source_data: {},
  };
}

function salaryCell(rowId: string, season: string, amount: number | null): CurrentCapSheetSalaryCellRow {
  return {
    player_row_id: rowId,
    snapshot_id: 'latest',
    team_id: 'AAA',
    season,
    amount,
    label: amount == null ? 'Source needed' : '$1,000,000',
    option_type: null,
    is_guaranteed: amount != null,
    source_status: amount == null ? 'source-needed' : 'captured',
    source_url: amount == null ? null : 'https://example.test/player',
    source_data: {},
  };
}

function sectionRow(key: string, title: string): CurrentCapSheetSectionRow {
  return {
    snapshot_id: 'latest',
    team_id: 'AAA',
    section_key: key,
    title,
    source_status: 'source-needed',
    source_url: null,
    notes: ['fixture'],
    rows: [{ status: 'Source needed' }],
    sort_order: 1,
  };
}
