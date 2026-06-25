import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCandidateProjectScenarioSeed,
  buildCandidateScenario,
  candidateOutgoingNames,
} from '@shared/candidateScenario';
import type {
  BriefOptionMoveCandidate,
  NbaCapSheet,
  NbaCapSheetPlayerRow,
} from '@shared/types';

test('candidate scenario computes symmetric two-team salary deltas', () => {
  const subject = mockSheet('GSW', 'Golden State Warriors', 200_000_000, [
    player('Moses Moody', 13_000_000),
    player('Gary Payton II', 3_000_000),
  ]);
  const target = mockSheet('SAC', 'Sacramento Kings', 180_000_000, [
    player("De'Andre Hunter", 25_000_000),
  ]);

  const scenario = buildCandidateScenario({
    label: "De'Andre Hunter via Moody-led match",
    subject_team_id: 'GSW',
    target_player_names: ["De'Andre Hunter"],
    target_team_id: 'SAC',
    target_team_name: 'Sacramento Kings',
    outgoing_player_names: ['Moses Moody', 'Gary Payton II'],
    outgoing_package: 'Moses Moody + Gary Payton II',
    salary_match: 'Known salary swap.',
    basketball_fit: 'Wing upgrade.',
    cost: 'Two rotation players.',
    constraints: 'Legal verdict still manual.',
    evidence_refs: [1],
  }, { subjectTeamId: 'GSW', subjectSheet: subject, targetSheet: target });

  assert.equal(scenario.subject.known_salary_out, 16_000_000);
  assert.equal(scenario.subject.known_salary_in, 25_000_000);
  assert.equal(scenario.subject.net_salary_delta, 9_000_000);
  assert.equal(scenario.subject.payroll_after, 209_000_000);
  assert.equal(scenario.target.known_salary_out, 25_000_000);
  assert.equal(scenario.target.known_salary_in, 16_000_000);
  assert.equal(scenario.target.net_salary_delta, -9_000_000);
  assert.equal(scenario.target.payroll_after, 171_000_000);
});

test('candidate scenario flags unresolved filler in the outgoing package', () => {
  const subject = mockSheet('GSW', 'Golden State Warriors', 200_000_000, [
    player('Moses Moody', 13_000_000),
  ]);
  const target = mockSheet('CLE', 'Cleveland Cavaliers', 185_000_000, [
    player('Max Strus', 14_800_000),
  ]);

  const scenario = buildCandidateScenario(candidate({
    target_player_names: ['Max Strus'],
    target_team_id: 'CLE',
    outgoing_player_names: ['Moses Moody'],
    outgoing_package: 'Moses Moody + minimum filler',
  }), { subjectTeamId: 'GSW', subjectSheet: subject, targetSheet: target });

  assert(scenario.flags.some((flag) => /unresolved filler/i.test(flag)));
});

test('candidate scenario shows source-needed when salary cells are missing', () => {
  const subject = mockSheet('GSW', 'Golden State Warriors', 200_000_000, [
    player('Moses Moody', 13_000_000),
  ]);
  const target = mockSheet('NOP', 'New Orleans Pelicans', 170_000_000, [
    player('Saddiq Bey', null),
  ]);

  const scenario = buildCandidateScenario(candidate({
    target_player_names: ['Saddiq Bey'],
    target_team_id: 'NOP',
    outgoing_player_names: ['Moses Moody'],
    outgoing_package: 'Moses Moody',
  }), { subjectTeamId: 'GSW', subjectSheet: subject, targetSheet: target });

  assert.equal(scenario.subject.known_salary_in, 0);
  assert(scenario.subject.receives.some((player) => player.salary_label === 'Source needed'));
  assert(scenario.flags.some((flag) => /Saddiq Bey salary is source-needed/i.test(flag)));
});

test('old candidate fallback resolves exact full player names only', () => {
  const subject = mockSheet('GSW', 'Golden State Warriors', 200_000_000, [
    player('Moses Moody', 13_000_000),
  ]);

  assert.deepEqual(candidateOutgoingNames(candidate({
    outgoing_player_names: undefined,
    outgoing_package: 'Moses Moody plus filler',
  }), subject), ['Moses Moody']);

  assert.deepEqual(candidateOutgoingNames(candidate({
    outgoing_player_names: undefined,
    outgoing_package: 'Moody plus filler',
  }), subject), []);
});

test('candidate project scenario seed uses only structured player names for row creation', () => {
  const subject = mockSheet('GSW', 'Golden State Warriors', 200_000_000, [
    player('Moses Moody', 13_000_000),
  ]);
  const target = mockSheet('BOS', 'Boston Celtics', 180_000_000, [
    player('Payton Pritchard', 7_000_000),
  ]);

  const seed = buildCandidateProjectScenarioSeed(
    {
      id: 'option-1',
      brief_id: 'brief-1',
      ref_index: 4,
      title: 'Low-risk guard trade',
      subtitle: null,
      type_kind: 'trade',
      path_kind: 'trade',
      net_cap_num: 1,
      net_cap_label: '+$1.0M',
      epm: '+0.8',
      cba_section: 'Salary matching',
      timing: 'deadline',
      src_count: 2,
      likelihood_kind: 'plausible',
      likelihood_pct: 40,
      spark: [],
      details: null,
    },
    {
      decision_question: 'Should we call Boston?',
      why_this: 'Specific guard path.',
      upside: 'Adds ball-handling.',
      downside: 'Costs wing depth.',
      required_moves: ['Confirm salary match.'],
      blockers: ['Trade Builder verdict pending.'],
      watch_triggers: [],
      next_step: 'Call counterpart.',
      evidence_refs: [2],
    },
    candidate({
      target_player_names: ['Payton Pritchard'],
      target_team_id: 'BOS',
      outgoing_player_names: undefined,
      outgoing_package: 'Moses Moody plus filler',
      cost: 'Second-round value.',
      constraints: 'Internal cap sheet not checked.',
    }),
    [2, 7],
    { subjectTeamId: 'GSW', subjectSheet: subject, targetSheet: target },
  );

  assert.equal(seed.create.title, 'Payton Pritchard · BOS');
  assert.equal(seed.players.length, 1);
  assert.equal(seed.players[0]?.direction, 'incoming');
  assert.equal(seed.players[0]?.player_name, 'Payton Pritchard');
  assert.match(seed.update.notes ?? '', /Source option: \[4\] Low-risk guard trade/);
  assert.match(seed.update.notes ?? '', /Evidence refs: \[2\] \[7\]/);
  assert.match(seed.update.notes ?? '', /Source gaps:/);
  assert.match(seed.update.validation_summary ?? '', /Seeded from strategic option \[4\]/);
});

function candidate(overrides: Partial<BriefOptionMoveCandidate>): BriefOptionMoveCandidate {
  return {
    label: 'Candidate',
    subject_team_id: 'GSW',
    target_player_names: ['Target Player'],
    target_team_id: 'TGT',
    target_team_name: 'Target Team',
    outgoing_player_names: ['Moses Moody'],
    outgoing_package: 'Moses Moody',
    salary_match: 'Salary match pending.',
    basketball_fit: 'Fit.',
    cost: 'Cost.',
    constraints: 'Constraints.',
    evidence_refs: [1],
    ...overrides,
  };
}

function mockSheet(
  teamId: string,
  fullName: string,
  payroll: number | null,
  rows: NbaCapSheetPlayerRow[],
): NbaCapSheet {
  return {
    summary: {
      snapshot_id: 'snapshot',
      season: '2025-26',
      as_of_date: '2026-06-12',
      source_name: 'Test',
      source_url: '',
      retrieved_at: '2026-06-12T00:00:00.000Z',
      team: {
        team_id: teamId,
        nba_team_id: 1,
        abbreviation: teamId,
        city: fullName,
        name: fullName,
        full_name: fullName,
        conference: null,
        division: null,
      },
      official_roster_count: rows.length,
      cap_status: 'over_cap',
      tax_status: 'tax',
      apron_status: 'first_apron',
      payroll_amount: payroll,
      source_status: 'captured',
      missing_sections: [],
      missing_section_count: 0,
      source_refs: [],
    },
    source_refs: [],
    metrics: [
      metric('payroll', payroll),
      metric('luxury_tax', 187_895_000),
      metric('first_apron', 195_945_000),
      metric('second_apron', 207_824_000),
    ],
    player_rows: rows,
    player_stats: [],
    sections: [],
    roster: null,
  };
}

function metric(key: string, amount: number | null) {
  return {
    key,
    label: key,
    value: amount == null ? 'Source needed' : String(amount),
    amount,
    source_status: amount == null ? 'source-needed' as const : 'captured' as const,
    source_url: null,
    note: null,
  };
}

function player(name: string, salary: number | null): NbaCapSheetPlayerRow {
  return {
    id: name.toLowerCase().replace(/\s+/g, '-'),
    nba_player_id: null,
    player_name: name,
    source_order: 1,
    position: null,
    age: null,
    dob: null,
    yos: null,
    roster_status: null,
    fa_status: null,
    fa_year: null,
    bird_rights: null,
    restrictions: [],
    how_acquired: null,
    agent: null,
    total_amount: null,
    source_status: salary == null ? 'source-needed' : 'captured',
    source_url: null,
    source_data: {},
    salary_cells: salary == null ? [] : [{
      season: '2025-26',
      amount: salary,
      label: `$${(salary / 1_000_000).toFixed(1)}M`,
      option_type: null,
      is_guaranteed: null,
      source_status: 'captured',
      source_url: null,
      source_data: {},
    }],
  };
}
