import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { ProjectDetail, ProjectSourceBrief } from '@shared/types';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function routeBlock(source: string, routeSignature: string): string {
  const start = source.indexOf(routeSignature);
  assert.notEqual(start, -1, `missing route ${routeSignature}`);
  const next = source.indexOf('\nprojectRoutes.', start + routeSignature.length);
  return source.slice(start, next === -1 ? undefined : next);
}

test('projects migrations create cockpit persistence on top of linked source briefs', async () => {
  const baseMigration = await readFile(
    path.join(repoRoot, 'supabase/migrations/20260612000400_projects.sql'),
    'utf8',
  );
  const cockpitMigration = await readFile(
    path.join(repoRoot, 'supabase/migrations/20260612054103_robust_projects_cockpit.sql'),
    'utf8',
  );
  const scenarioMigration = await readFile(
    path.join(repoRoot, 'supabase/migrations/20260612070000_inbound_trade_scenario_library.sql'),
    'utf8',
  );

  assert.match(baseMigration, /create table if not exists projects/);
  assert.match(baseMigration, /create table if not exists project_briefs/);
  assert.match(baseMigration, /project_briefs_unique_project_brief unique \(project_id, brief_id\)/);
  assert.match(cockpitMigration, /alter table projects add column if not exists question text/);
  assert.match(cockpitMigration, /alter table projects add column if not exists active_step text not null default 'research'/);
  assert.match(cockpitMigration, /alter table projects add column if not exists package_status text not null default 'not_started'/);
  assert.match(cockpitMigration, /create table if not exists project_stage_notes/);
  assert.match(cockpitMigration, /constraint project_stage_notes_unique_step unique \(project_id, step\)/);
  assert.match(cockpitMigration, /create table if not exists project_tasks/);
  assert.match(cockpitMigration, /constraint project_tasks_source_check/);
  assert.match(cockpitMigration, /create table if not exists project_packages/);
  assert.match(cockpitMigration, /projects_status_check check \(status in/);
  assert.match(cockpitMigration, /'packaged'/);
  assert.match(cockpitMigration, /'ready'/);
  assert.match(cockpitMigration, /ranked_steps/);
  assert.match(cockpitMigration, /alter table project_stage_notes enable row level security/);
  assert.match(cockpitMigration, /Review the formal execution checklist: league check, owner approval, terms, call, medicals/);
  assert.match(scenarioMigration, /alter table projects add column if not exists workflow_type text not null default 'inbound_trade'/);
  assert.match(scenarioMigration, /alter table projects add column if not exists counterparty_context jsonb not null default/);
  assert.match(scenarioMigration, /create table if not exists project_trade_scenarios/);
  assert.match(scenarioMigration, /project_trade_scenarios_status_check check \(status in/);
  assert.match(scenarioMigration, /create table if not exists project_scenario_players/);
  assert.match(scenarioMigration, /project_scenario_players_direction_check check \(direction in/);
  assert.match(scenarioMigration, /idx_project_scenario_players_unique_player/);
  assert.match(scenarioMigration, /create table if not exists project_scenario_assets/);
  assert.match(scenarioMigration, /project_scenario_assets_type_check check \(asset_type in/);
  assert.match(scenarioMigration, /create table if not exists project_scenario_validations/);
  assert.match(scenarioMigration, /project_scenario_validations_unique_kind unique \(scenario_id, kind\)/);
  assert.match(scenarioMigration, /create table if not exists project_artifacts/);
  assert.match(scenarioMigration, /alter table project_trade_scenarios enable row level security/);
});

test('project scenario-scoped mutations validate scenario ownership', async () => {
  const routeSource = await readFile(path.join(repoRoot, 'server/src/routes/projects.ts'), 'utf8');
  const scenarioChildRoutes = [
    "projectRoutes.patch('/:id/scenarios/:scenarioId/players/:playerId'",
    "projectRoutes.delete('/:id/scenarios/:scenarioId/players/:playerId'",
    "projectRoutes.patch('/:id/scenarios/:scenarioId/assets/:assetId'",
    "projectRoutes.delete('/:id/scenarios/:scenarioId/assets/:assetId'",
    "projectRoutes.patch('/:id/scenarios/:scenarioId/validations/:kind'",
  ];

  for (const signature of scenarioChildRoutes) {
    const block = routeBlock(routeSource, signature);
    assert.match(block, /ensureScenarioBelongs\(projectId, scenarioId\)/, signature);
  }

  const createArtifact = routeBlock(routeSource, "projectRoutes.post('/:id/artifacts'");
  assert.match(createArtifact, /const scenarioId = body\.scenario_id \? body\.scenario_id\.trim\(\) : null/);
  assert.match(createArtifact, /ensureScenarioBelongs\(projectId, scenarioId\)/);

  const updateArtifact = routeBlock(routeSource, "projectRoutes.patch('/:id/artifacts/:artifactId'");
  assert.match(updateArtifact, /const scenarioId = body\.scenario_id \? body\.scenario_id\.trim\(\) : null/);
  assert.match(updateArtifact, /ensureScenarioBelongs\(projectId, scenarioId\)/);
});

test('demo seed resets projects and installs inbound trade scenario library examples', async () => {
  const rosterSeed = await readFile(path.join(repoRoot, 'server/src/nba_rosters/seed.ts'), 'utf8');
  const demoSeed = await readFile(path.join(repoRoot, 'server/src/db/seed-demo.ts'), 'utf8');

  assert.match(rosterSeed, /\{ table: 'projects', column: 'id' \}/);
  assert.match(demoSeed, /from\('projects'\)\.delete\(\{ count: 'exact' \}\)\.not\('id', 'is', null\)/);
  assert.match(demoSeed, /DEMO_PROJECT_IDS/);
  assert.match(demoSeed, /Inbound call smoke: Boston asks on Moody/);
  assert.match(demoSeed, /Charlotte checks Podziemski price/);
  assert.match(demoSeed, /Miami pressure-tests Melton defensive guard call/);
  assert.match(demoSeed, /Moody for Pritchard plus second-round value/);
  assert.match(demoSeed, /Podziemski for Tre Mann plus protected first framework/);
  assert.match(demoSeed, /Melton for Jaime Jaquez Jr\. decision packet/);
  assert.match(demoSeed, /Moody and Payton II for Pritchard plus Hauser/);
  assert.match(demoSeed, /Podziemski for Kon Knueppel youth swing/);
  assert.match(demoSeed, /Melton and Payton II for Davion Mitchell plus second/);
  assert.match(demoSeed, /project_trade_scenarios/);
  assert.match(demoSeed, /project_scenario_players/);
  assert.match(demoSeed, /project_scenario_validations/);
  assert.match(demoSeed, /project_packages/);
  assert.equal(demoSeed.match(/id: '91000000-/g)?.length, 18);
});

test('project helpers derive safe titles, validate stages, and seed workflow-aware tasks', async () => {
  process.env.SUPABASE_URL ??= 'http://localhost:54321';
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-key';
  const { defaultProjectTasks, deriveProjectTitle, isProjectStep } = await import('../../src/routes/projects.js');

  assert.equal(
    deriveProjectTitle({ thesis: 'Trade-deadline board', question: 'Should we move a pick?' }),
    'Trade-deadline board',
  );
  assert.equal(
    deriveProjectTitle({ thesis: null, question: 'Should we move a pick?' }, '  Owner packet  '),
    'Owner packet',
  );
  assert.equal(deriveProjectTitle({ thesis: null, question: 'x'.repeat(140) }).length, 120);
  assert.equal(isProjectStep('research'), true);
  assert.equal(isProjectStep('proposal'), true);
  assert.equal(isProjectStep('archive'), false);
  assert.deepEqual(
    [...new Set(defaultProjectTasks().map((task) => task.step))],
    ['research', 'validate', 'feedback', 'gm', 'proposal'],
  );
  assert.ok(defaultProjectTasks().some((task) => task.label.includes('counterparty/team context')));
  assert.ok(defaultProjectTasks().some((task) => task.label.includes('league check, owner approval')));
});

test('attach response marks duplicate source briefs without duplicating cockpit sources', async () => {
  process.env.SUPABASE_URL ??= 'http://localhost:54321';
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-key';
  const { buildAttachProjectBriefResponse } = await import('../../src/routes/projects.js');

  const projectBrief = {
    id: 'pb-1',
    project_id: 'project-1',
    brief_id: 'brief-1',
    step: 'research',
    sort_order: 0,
    created_at: '2026-06-12T00:00:00.000Z',
    updated_at: '2026-06-12T00:00:00.000Z',
    brief: {
      id: 'brief-1',
      question: 'Should we explore a Moody framework with Boston?',
      thesis: 'Explore only if Boston pays for salary and optionality.',
    },
  } as ProjectSourceBrief;
  const project: ProjectDetail = {
    project: {
      id: 'project-1',
      user_id: null,
      title: 'Moody inbound call',
      question: 'Should we explore a Moody framework with Boston?',
      objective: 'Narrow to a GM-ready recommendation.',
      workflow_type: 'inbound_trade',
      subject_team_id: 'GSW',
      counterparty_team_id: 'BOS',
      inbound_player_id: null,
      trigger_summary: 'Boston likes Moses Moody.',
      counterparty_context: {
        apron_level: 'below first apron',
        cap_room: 'tight',
        aims: 'contend',
        pressure: 'tax sensitive',
        job_security: 'stable',
        known_targets: 'wing depth',
        signals: 'negative salary trade language',
      },
      active_step: 'research',
      status: 'active',
      package_status: 'not_started',
      source_brief_id: 'brief-1',
      archived_at: null,
      created_at: '2026-06-12T00:00:00.000Z',
      updated_at: '2026-06-12T00:00:00.000Z',
    },
    source_briefs: [projectBrief],
    stage_notes: [],
    tasks: [],
    scenarios: [],
    artifacts: [],
    latest_package: null,
  };

  const response = buildAttachProjectBriefResponse(project, projectBrief, true);
  assert.equal(response.already_attached, true);
  assert.equal(response.project.source_briefs.length, 1);
  assert.equal(response.project_brief.id, 'pb-1');
});

test('diagnosis and package helpers preserve warnings and source refs', async () => {
  process.env.SUPABASE_URL ??= 'http://localhost:54321';
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-key';
  const { buildProjectDiagnosis, buildProjectPackage, buildStageWarnings } = await import('../../src/routes/projects.js');
  const detail: ProjectDetail = {
    project: {
      id: 'project-1',
      user_id: null,
      title: 'Moody inbound call',
      question: 'Should we explore a Moody framework with Boston?',
      objective: 'Validate scenario concepts and phone framing.',
      workflow_type: 'inbound_trade',
      subject_team_id: 'GSW',
      counterparty_team_id: 'BOS',
      inbound_player_id: 1630541,
      trigger_summary: 'Boston likes Moses Moody.',
      counterparty_context: {
        apron_level: 'below first apron',
        cap_room: 'tight',
        aims: 'contend now',
        pressure: 'tax savings',
        job_security: 'stable',
        known_targets: 'Moses Moody',
        signals: 'salary shedding',
      },
      active_step: 'proposal',
      status: 'active',
      package_status: 'stale',
      source_brief_id: 'brief-1',
      archived_at: null,
      created_at: '2026-06-12T00:00:00.000Z',
      updated_at: '2026-06-12T00:00:00.000Z',
    },
    source_briefs: [{
      id: 'pb-1',
      project_id: 'project-1',
      brief_id: 'brief-1',
      step: 'research',
      sort_order: 0,
      created_at: '2026-06-12T00:00:00.000Z',
      updated_at: '2026-06-12T00:00:00.000Z',
      brief: {
        id: 'brief-1',
        question: 'Should we extend the player before June 30?',
        thesis: 'Only at a below-market number.',
      },
    } as ProjectSourceBrief],
    stage_notes: [{
      id: 'note-1',
      project_id: 'project-1',
      step: 'proposal',
      body: 'Recommend holding unless price protects RFA backstop and poison pill risk.',
      ai_draft: '',
      citation_refs: [],
      created_at: '2026-06-12T00:00:00.000Z',
      updated_at: '2026-06-12T00:00:00.000Z',
    }],
    tasks: [{
      id: 'task-1',
      project_id: 'project-1',
      step: 'proposal',
      label: 'Generate or refresh the decision package with cited evidence and cap/tax impact.',
      required: true,
      completed_at: null,
      sort_order: 0,
      source: 'system',
      created_at: '2026-06-12T00:00:00.000Z',
      updated_at: '2026-06-12T00:00:00.000Z',
    }],
    scenarios: [{
      id: 'scenario-1',
      project_id: 'project-1',
      title: 'Moody for rotation guard',
      summary: 'Boston sends a guard and second-round value for Moody.',
      status: 'shortlisted',
      rank: 1,
      participating_teams: ['GSW', 'BOS'],
      notes: '',
      basketball_fit: 'Adds ball-handling.',
      risks: 'Salary source needs cross-check.',
      phone_framing: 'Would you consider something around Moody for a guard and seconds?',
      walk_away: 'No first-round value, no deal.',
      counter_range: 'Ask for two seconds; settle for one plus cash.',
      validation_summary: '',
      players: [{
        id: 'player-1',
        scenario_id: 'scenario-1',
        team_id: 'GSW',
        nba_player_id: 1630541,
        player_name: 'Moses Moody',
        direction: 'outgoing',
        salary_amount: 5822400,
        salary_source_status: 'captured',
        manual_override: false,
        stats_snapshot: null,
        created_at: '2026-06-12T00:00:00.000Z',
        updated_at: '2026-06-12T00:00:00.000Z',
      }, {
        id: 'player-2',
        scenario_id: 'scenario-1',
        team_id: 'BOS',
        nba_player_id: 123,
        player_name: 'Boston guard',
        direction: 'incoming',
        salary_amount: 6400000,
        salary_source_status: 'source-needed',
        manual_override: false,
        stats_snapshot: null,
        created_at: '2026-06-12T00:00:00.000Z',
        updated_at: '2026-06-12T00:00:00.000Z',
      }],
      assets: [],
      validations: [],
      created_at: '2026-06-12T00:00:00.000Z',
      updated_at: '2026-06-12T00:00:00.000Z',
    }],
    artifacts: [],
    latest_package: null,
  };

  assert.ok(buildStageWarnings(detail).some((warning) => warning.code === 'required_tasks_incomplete'));
  assert.equal(buildProjectDiagnosis(detail).readiness, 'low');
  const pkg = buildProjectPackage(detail);
  assert.equal(pkg.status, 'drafted');
  assert.equal(pkg.source_refs[0]?.brief_id, 'brief-1');
  assert.match(pkg.markdown, /Scenario Library/);
  assert.match(pkg.markdown, /Moody for rotation guard/);
  assert.match(pkg.markdown, /\[B1\]/);
});

test('scenario advisory validation counts only captured or manual salaries and flags source gaps', async () => {
  process.env.SUPABASE_URL ??= 'http://localhost:54321';
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-key';
  const { buildScenarioAdvisoryValidation } = await import('../../src/routes/projects.js');
  const validation = buildScenarioAdvisoryValidation({
    id: 'scenario-1',
    project_id: 'project-1',
    title: 'Two-player concept',
    summary: '',
    status: 'active',
    rank: 1,
    participating_teams: ['GSW', 'BOS'],
    notes: '',
    basketball_fit: '',
    risks: '',
    phone_framing: '',
    walk_away: '',
    counter_range: '',
    validation_summary: '',
    players: [{
      id: 'p1',
      scenario_id: 'scenario-1',
      team_id: 'GSW',
      nba_player_id: 1,
      player_name: 'Captured Warrior',
      direction: 'outgoing',
      salary_amount: 10000000,
      salary_source_status: 'captured',
      manual_override: false,
      stats_snapshot: null,
      created_at: '2026-06-12T00:00:00.000Z',
      updated_at: '2026-06-12T00:00:00.000Z',
    }, {
      id: 'p2',
      scenario_id: 'scenario-1',
      team_id: 'BOS',
      nba_player_id: 2,
      player_name: 'Source Needed Celtic',
      direction: 'incoming',
      salary_amount: 9000000,
      salary_source_status: 'source-needed',
      manual_override: false,
      stats_snapshot: null,
      created_at: '2026-06-12T00:00:00.000Z',
      updated_at: '2026-06-12T00:00:00.000Z',
    }, {
      id: 'p3',
      scenario_id: 'scenario-1',
      team_id: 'BOS',
      nba_player_id: 3,
      player_name: 'Manual Celtic',
      direction: 'incoming',
      salary_amount: 5000000,
      salary_source_status: 'source-needed',
      manual_override: true,
      stats_snapshot: null,
      created_at: '2026-06-12T00:00:00.000Z',
      updated_at: '2026-06-12T00:00:00.000Z',
    }],
    assets: [],
    validations: [],
    created_at: '2026-06-12T00:00:00.000Z',
    updated_at: '2026-06-12T00:00:00.000Z',
  });

  assert.equal(validation.status, 'source_needed');
  assert.equal(validation.details.outgoing_salary, 10000000);
  assert.equal(validation.details.incoming_salary, 5000000);
  assert.deepEqual(validation.details.source_gaps, ['Source Needed Celtic (BOS, incoming, source-needed)']);
});
