import { Hono } from 'hono';
import { PROJECT_STEP_DEFINITIONS } from '@shared/types';
import { db } from '../db/client.js';
import type {
  AdvanceProjectRequest,
  AttachProjectBriefRequest,
  Brief,
  CreateProjectRequest,
  CreateProjectArtifactRequest,
  CreateProjectScenarioAssetRequest,
  CreateProjectScenarioPlayerRequest,
  CreateProjectTradeScenarioRequest,
  CreateProjectTaskRequest,
  DeleteProjectArtifactResponse,
  DeleteProjectScenarioAssetResponse,
  DeleteProjectScenarioPlayerResponse,
  Project,
  ProjectArtifact,
  ProjectArtifactType,
  ProjectBrief,
  ProjectCounterpartyContext,
  ProjectDiagnosis,
  ProjectDetail,
  ProjectPackage,
  ProjectPackageSection,
  ProjectPackageSourceRef,
  ProjectSalarySourceStatus,
  ProjectScenarioAsset,
  ProjectScenarioAssetType,
  ProjectScenarioPlayer,
  ProjectScenarioPlayerDirection,
  ProjectScenarioValidation,
  ProjectScenarioValidationKind,
  ProjectScenarioValidationStatus,
  ProjectSourceBrief,
  ProjectStageNote,
  ProjectStageWarning,
  ProjectStatus,
  ProjectStepId,
  ProjectSummary,
  ProjectTask,
  ProjectTaskSource,
  ProjectTradeScenarioDetail,
  ProjectTradeScenarioStatus,
  ProjectWorkflowType,
  UpdateProjectArtifactRequest,
  UpdateProjectRequest,
  UpdateProjectScenarioAssetRequest,
  UpdateProjectScenarioPlayerRequest,
  UpdateProjectScenarioValidationRequest,
  UpdateProjectTradeScenarioRequest,
  UpdateProjectTaskRequest,
} from '@shared/types';

export const projectRoutes = new Hono();

const STAGE_IDS = PROJECT_STEP_DEFINITIONS.map((step) => step.id);
const STEP_RANK: Record<ProjectStepId, number> = {
  research: 1,
  validate: 2,
  feedback: 3,
  gm: 4,
  proposal: 5,
};

const DEFAULT_STAGE_NOTES: Record<ProjectStepId, string> = {
  research: 'Classify the decision trigger and track: inbound trade call, outbound trade target, free-agency path, extension, or cap-driven roster need. Capture counterparty/team context, spending threshold, roster need, early target list, and linked source briefs.',
  validate: 'Validate cap/CBA fidelity before the recommendation hardens: apron distance, salary matching, exceptions, deadlines, PCMS/Trade Builder timing, independent cap sheet cross-checks, and scenario cascade risk.',
  feedback: 'Capture cross-department feedback from analytics, scouting/front office, medical/performance, player development, coaching, cap/legal, and any independent scenario comparisons.',
  gm: 'Prepare the GM review packet: 3-4 strongest concepts, decision question, soft outreach framing, walk-away/counter ranges, designated negotiators, objections, and revision asks.',
  proposal: 'Draft the decision package: recommended action, source-backed evidence, cap/tax impact, risks, formal execution checklist, ownership/league approval needs, and next steps.',
};

const DEFAULT_COUNTERPARTY_CONTEXT: ProjectCounterpartyContext = {
  apron_level: '',
  cap_room: '',
  aims: '',
  pressure: '',
  job_security: '',
  known_targets: '',
  signals: '',
};

export interface ProjectTaskTemplate {
  step: ProjectStepId;
  label: string;
  required: boolean;
  sort_order: number;
}

export function defaultProjectTasks(): ProjectTaskTemplate[] {
  return [
    { step: 'research', label: 'Name the trigger, decision track, and desired basketball outcome.', required: true, sort_order: 0 },
    { step: 'research', label: 'Capture counterparty/team context: apron level, aims, pressure, known targets, and signals.', required: true, sort_order: 1 },
    { step: 'research', label: 'Link source briefs or notes with the core evidence and unanswered questions.', required: true, sort_order: 2 },
    { step: 'validate', label: 'Cross-check cap/CBA math against the internal cap sheet and external builder output.', required: true, sort_order: 0 },
    { step: 'validate', label: 'Model scenario cascade risk, deadlines, PCMS timing, and hard-cap exposure.', required: true, sort_order: 1 },
    { step: 'validate', label: 'Identify evidence or number changes that would flip the recommendation.', required: false, sort_order: 2 },
    { step: 'feedback', label: 'Capture analytics, scouting/front office, coaching, medical/performance, and cap/legal feedback.', required: true, sort_order: 0 },
    { step: 'feedback', label: 'Compare independent scenario work and separate consensus from unresolved disagreement.', required: true, sort_order: 1 },
    { step: 'gm', label: 'Narrow to the 3-4 strongest concepts or one binary recommendation.', required: true, sort_order: 0 },
    { step: 'gm', label: 'Record walk-away price, counter ranges, outreach framing, and negotiator/approval constraints.', required: true, sort_order: 1 },
    { step: 'proposal', label: 'Generate or refresh the decision package with cited evidence and cap/tax impact.', required: true, sort_order: 0 },
    { step: 'proposal', label: 'Review the formal execution checklist: league check, owner approval, terms, call, medicals.', required: true, sort_order: 1 },
  ];
}

projectRoutes.get('/', async (c) => {
  const projects = await loadProjectSummaries();
  if (projects instanceof Error) return c.json({ error: 'load_projects_failed', detail: projects.message }, 500);
  return c.json({ projects });
});

projectRoutes.get('/:id', async (c) => {
  const detail = await loadProjectDetail(c.req.param('id'));
  if (detail instanceof Error) return c.json({ error: 'load_project_failed', detail: detail.message }, 500);
  if (!detail) return c.json({ error: 'project_not_found' }, 404);
  return c.json({ project: detail });
});

projectRoutes.post('/', async (c) => {
  let body: Partial<CreateProjectRequest> & { brief_id?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const normalized = await normalizeCreateProjectInput(body);
  if (normalized instanceof Error) return c.json({ error: 'load_brief_failed', detail: normalized.message }, 500);
  if (normalized.status !== 200) return c.json({ error: normalized.error }, normalized.status);

  const insert = await db
    .from('projects')
    .insert({
      title: normalized.input.title,
      question: normalized.input.question,
      objective: normalized.input.objective,
      workflow_type: normalized.input.workflow_type ?? 'inbound_trade',
      subject_team_id: normalized.input.subject_team_id ?? 'GSW',
      counterparty_team_id: normalized.input.counterparty_team_id ?? null,
      inbound_player_id: normalized.input.inbound_player_id ?? null,
      trigger_summary: normalized.input.trigger_summary ?? '',
      counterparty_context: normalizeCounterpartyContext(normalized.input.counterparty_context),
      active_step: 'research',
      status: 'active',
      package_status: 'not_started',
      source_brief_id: normalized.input.source_brief_id ?? null,
    })
    .select('*')
    .single();

  if (insert.error || !insert.data) {
    return c.json({ error: 'create_project_failed', detail: insert.error?.message }, 500);
  }

  const project = normalizeProject(insert.data);
  const seed = await seedProjectWorkspace(project.id, normalized.sourceBrief ?? null);
  if (seed instanceof Error) return c.json({ error: 'seed_project_failed', detail: seed.message }, 500);

  if (normalized.input.source_brief_id) {
    const attach = await attachBrief(project.id, normalized.input.source_brief_id);
    if (attach instanceof Error) return c.json({ error: 'attach_brief_failed', detail: attach.message }, 500);
  }

  const detail = await loadProjectDetail(project.id);
  if (detail instanceof Error) return c.json({ error: 'load_project_failed', detail: detail.message }, 500);
  if (!detail) return c.json({ error: 'project_not_found' }, 404);
  return c.json({ project: detail }, 201);
});

projectRoutes.patch('/:id', async (c) => {
  const projectId = c.req.param('id');
  let body: UpdateProjectRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const updates: Partial<Project> = {};
  if (typeof body.title === 'string') {
    const title = body.title.trim();
    if (!title) return c.json({ error: 'title_required' }, 400);
    updates.title = title.slice(0, 120);
  }
  if (typeof body.question === 'string') {
    const question = body.question.trim();
    if (!question) return c.json({ error: 'question_required' }, 400);
    updates.question = question;
  }
  if (typeof body.objective === 'string') updates.objective = body.objective.trim();
  if (body.workflow_type !== undefined) {
    if (!isProjectWorkflowType(body.workflow_type)) return c.json({ error: 'invalid_workflow_type' }, 400);
    updates.workflow_type = body.workflow_type;
  }
  if (typeof body.subject_team_id === 'string') {
    const teamId = body.subject_team_id.trim().toUpperCase();
    if (!teamId) return c.json({ error: 'subject_team_required' }, 400);
    updates.subject_team_id = teamId.slice(0, 6);
  }
  if (body.counterparty_team_id !== undefined) {
    updates.counterparty_team_id = typeof body.counterparty_team_id === 'string' && body.counterparty_team_id.trim()
      ? body.counterparty_team_id.trim().toUpperCase().slice(0, 6)
      : null;
  }
  if (body.inbound_player_id !== undefined) {
    updates.inbound_player_id = typeof body.inbound_player_id === 'number' && Number.isFinite(body.inbound_player_id)
      ? Math.trunc(body.inbound_player_id)
      : null;
  }
  if (typeof body.trigger_summary === 'string') updates.trigger_summary = body.trigger_summary.trim();
  if (body.counterparty_context !== undefined) updates.counterparty_context = normalizeCounterpartyContext(body.counterparty_context);
  if (body.active_step !== undefined) {
    if (!isProjectStep(body.active_step)) return c.json({ error: 'invalid_step' }, 400);
    updates.active_step = body.active_step;
  }
  if (body.status !== undefined) {
    if (!isProjectStatus(body.status)) return c.json({ error: 'invalid_status' }, 400);
    updates.status = body.status;
    updates.archived_at = body.status === 'archived' ? new Date().toISOString() : null;
  }

  const update = await db
    .from('projects')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', projectId)
    .select('*')
    .single();
  if (update.error || !update.data) return c.json({ error: 'update_project_failed', detail: update.error?.message }, 500);

  if (updates.title || updates.question || updates.objective) await markPackageStale(projectId);
  const detail = await loadProjectDetail(projectId);
  if (detail instanceof Error) return c.json({ error: 'load_project_failed', detail: detail.message }, 500);
  if (!detail) return c.json({ error: 'project_not_found' }, 404);
  return c.json({ project: detail });
});

projectRoutes.post('/:id/briefs', async (c) => {
  const projectId = c.req.param('id');
  let body: AttachProjectBriefRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  if (!body.brief_id) return c.json({ error: 'brief_id_required' }, 400);

  const existing = await db
    .from('project_briefs')
    .select('*, brief:briefs(*)')
    .eq('project_id', projectId)
    .eq('brief_id', body.brief_id)
    .maybeSingle();
  if (existing.error) return c.json({ error: 'load_project_brief_failed', detail: existing.error.message }, 500);

  const projectBrief = existing.data
    ? normalizeProjectSourceBrief(existing.data)
    : await attachBrief(projectId, body.brief_id);
  if (projectBrief instanceof Error) return c.json({ error: 'attach_brief_failed', detail: projectBrief.message }, 500);

  await markPackageStale(projectId);
  const project = await loadProjectDetail(projectId);
  if (project instanceof Error) return c.json({ error: 'load_project_failed', detail: project.message }, 500);
  if (!project) return c.json({ error: 'project_not_found' }, 404);

  return c.json(buildAttachProjectBriefResponse(project, projectBrief, !!existing.data));
});

projectRoutes.patch('/:id/stages/:step/note', async (c) => {
  const projectId = c.req.param('id');
  const step = c.req.param('step');
  if (!isProjectStep(step)) return c.json({ error: 'invalid_step' }, 400);

  let body: { body?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  if (typeof body.body !== 'string') return c.json({ error: 'body_required' }, 400);

  const note = await upsertStageNote(projectId, step, body.body);
  if (note instanceof Error) return c.json({ error: 'update_stage_note_failed', detail: note.message }, 500);
  await markPackageStale(projectId);

  const project = await loadProjectDetail(projectId);
  if (project instanceof Error) return c.json({ error: 'load_project_failed', detail: project.message }, 500);
  if (!project) return c.json({ error: 'project_not_found' }, 404);
  return c.json({ project, note });
});

projectRoutes.post('/:id/tasks', async (c) => {
  const projectId = c.req.param('id');
  let body: CreateProjectTaskRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  if (!isProjectStep(body.step)) return c.json({ error: 'invalid_step' }, 400);
  if (typeof body.label !== 'string' || !body.label.trim()) return c.json({ error: 'label_required' }, 400);

  const insert = await db
    .from('project_tasks')
    .insert({
      project_id: projectId,
      step: body.step,
      label: body.label.trim().slice(0, 240),
      required: body.required ?? false,
      sort_order: body.sort_order ?? 100,
      source: 'user',
    })
    .select('*')
    .single();
  if (insert.error || !insert.data) return c.json({ error: 'create_task_failed', detail: insert.error?.message }, 500);

  await markPackageStale(projectId);
  const project = await loadProjectDetail(projectId);
  if (project instanceof Error) return c.json({ error: 'load_project_failed', detail: project.message }, 500);
  if (!project) return c.json({ error: 'project_not_found' }, 404);
  return c.json({ project, task: normalizeProjectTask(insert.data) }, 201);
});

projectRoutes.patch('/:id/tasks/:taskId', async (c) => {
  const projectId = c.req.param('id');
  const taskId = c.req.param('taskId');
  let body: UpdateProjectTaskRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.label === 'string') {
    if (!body.label.trim()) return c.json({ error: 'label_required' }, 400);
    updates.label = body.label.trim().slice(0, 240);
  }
  if (typeof body.completed === 'boolean') updates.completed_at = body.completed ? new Date().toISOString() : null;

  const update = await db
    .from('project_tasks')
    .update(updates)
    .eq('project_id', projectId)
    .eq('id', taskId)
    .select('*')
    .single();
  if (update.error || !update.data) return c.json({ error: 'update_task_failed', detail: update.error?.message }, 500);

  await markPackageStale(projectId);
  const project = await loadProjectDetail(projectId);
  if (project instanceof Error) return c.json({ error: 'load_project_failed', detail: project.message }, 500);
  if (!project) return c.json({ error: 'project_not_found' }, 404);
  return c.json({ project, task: normalizeProjectTask(update.data) });
});

projectRoutes.delete('/:id/tasks/:taskId', async (c) => {
  const projectId = c.req.param('id');
  const taskId = c.req.param('taskId');
  const del = await db
    .from('project_tasks')
    .delete()
    .eq('project_id', projectId)
    .eq('id', taskId);
  if (del.error) return c.json({ error: 'delete_task_failed', detail: del.error.message }, 500);

  await markPackageStale(projectId);
  const project = await loadProjectDetail(projectId);
  if (project instanceof Error) return c.json({ error: 'load_project_failed', detail: project.message }, 500);
  if (!project) return c.json({ error: 'project_not_found' }, 404);
  return c.json({ project });
});

projectRoutes.post('/:id/scenarios', async (c) => {
  const projectId = c.req.param('id');
  let body: CreateProjectTradeScenarioRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  if (typeof body.title !== 'string' || !body.title.trim()) return c.json({ error: 'title_required' }, 400);
  if (body.status !== undefined && !isScenarioStatus(body.status)) return c.json({ error: 'invalid_scenario_status' }, 400);

  const project = await loadProjectDetail(projectId);
  if (project instanceof Error) return c.json({ error: 'load_project_failed', detail: project.message }, 500);
  if (!project) return c.json({ error: 'project_not_found' }, 404);

  const rank = typeof body.rank === 'number' && Number.isFinite(body.rank)
    ? Math.trunc(body.rank)
    : nextScenarioRank(project);
  const participatingTeams = cleanTeamIds(body.participating_teams?.length
    ? body.participating_teams
    : [project.project.subject_team_id, project.project.counterparty_team_id].filter(Boolean) as string[]);
  const insert = await db
    .from('project_trade_scenarios')
    .insert({
      project_id: projectId,
      title: body.title.trim().slice(0, 160),
      summary: typeof body.summary === 'string' ? body.summary.trim() : '',
      status: body.status ?? 'active',
      rank,
      participating_teams: participatingTeams,
    })
    .select('*')
    .single();
  if (insert.error || !insert.data) return c.json({ error: 'create_scenario_failed', detail: insert.error?.message }, 500);

  await markPackageStale(projectId);
  const detail = await loadProjectDetail(projectId);
  if (detail instanceof Error) return c.json({ error: 'load_project_failed', detail: detail.message }, 500);
  const scenario = detail?.scenarios.find((item) => item.id === String(insert.data.id));
  if (!detail || !scenario) return c.json({ error: 'scenario_not_found' }, 404);
  return c.json({ project: detail, scenario }, 201);
});

projectRoutes.patch('/:id/scenarios/:scenarioId', async (c) => {
  const projectId = c.req.param('id');
  const scenarioId = c.req.param('scenarioId');
  let body: UpdateProjectTradeScenarioRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.title === 'string') {
    const title = body.title.trim();
    if (!title) return c.json({ error: 'title_required' }, 400);
    updates.title = title.slice(0, 160);
  }
  for (const field of ['summary', 'notes', 'basketball_fit', 'risks', 'phone_framing', 'walk_away', 'counter_range', 'validation_summary'] as const) {
    if (typeof body[field] === 'string') updates[field] = body[field]!.trim();
  }
  if (body.status !== undefined) {
    if (!isScenarioStatus(body.status)) return c.json({ error: 'invalid_scenario_status' }, 400);
    updates.status = body.status;
  }
  if (body.rank !== undefined) {
    if (typeof body.rank !== 'number' || !Number.isFinite(body.rank)) return c.json({ error: 'invalid_rank' }, 400);
    updates.rank = Math.trunc(body.rank);
  }
  if (body.participating_teams !== undefined) updates.participating_teams = cleanTeamIds(body.participating_teams);

  const update = await db
    .from('project_trade_scenarios')
    .update(updates)
    .eq('project_id', projectId)
    .eq('id', scenarioId)
    .select('*')
    .single();
  if (update.error || !update.data) return c.json({ error: 'update_scenario_failed', detail: update.error?.message }, 500);

  await markPackageStale(projectId);
  const response = await loadScenarioResponse(projectId, scenarioId);
  if (response instanceof Error) return c.json({ error: 'load_project_failed', detail: response.message }, 500);
  if (!response) return c.json({ error: 'scenario_not_found' }, 404);
  return c.json(response);
});

projectRoutes.post('/:id/scenarios/:scenarioId/duplicate', async (c) => {
  const projectId = c.req.param('id');
  const scenarioId = c.req.param('scenarioId');
  const detail = await loadProjectDetail(projectId);
  if (detail instanceof Error) return c.json({ error: 'load_project_failed', detail: detail.message }, 500);
  if (!detail) return c.json({ error: 'project_not_found' }, 404);
  const source = detail.scenarios.find((scenario) => scenario.id === scenarioId);
  if (!source) return c.json({ error: 'scenario_not_found' }, 404);

  const insert = await db
    .from('project_trade_scenarios')
    .insert({
      project_id: projectId,
      title: `Copy of ${source.title}`.slice(0, 160),
      summary: source.summary,
      status: 'active',
      rank: nextScenarioRank(detail),
      participating_teams: source.participating_teams,
      notes: source.notes,
      basketball_fit: source.basketball_fit,
      risks: source.risks,
      phone_framing: source.phone_framing,
      walk_away: source.walk_away,
      counter_range: source.counter_range,
    })
    .select('*')
    .single();
  if (insert.error || !insert.data) return c.json({ error: 'duplicate_scenario_failed', detail: insert.error?.message }, 500);
  const newScenarioId = String(insert.data.id);

  if (source.players.length > 0) {
    const players = source.players.map((player) => ({
      scenario_id: newScenarioId,
      team_id: player.team_id,
      nba_player_id: player.nba_player_id,
      player_name: player.player_name,
      direction: player.direction,
      salary_amount: player.salary_amount,
      salary_source_status: player.salary_source_status,
      manual_override: player.manual_override,
      stats_snapshot: player.stats_snapshot,
    }));
    const playerInsert = await db.from('project_scenario_players').insert(players);
    if (playerInsert.error) return c.json({ error: 'duplicate_scenario_players_failed', detail: playerInsert.error.message }, 500);
  }
  if (source.assets.length > 0) {
    const assets = source.assets.map((asset) => ({
      scenario_id: newScenarioId,
      asset_type: asset.asset_type,
      label: asset.label,
      direction: asset.direction,
      team_id: asset.team_id,
      amount: asset.amount,
      notes: asset.notes,
    }));
    const assetInsert = await db.from('project_scenario_assets').insert(assets);
    if (assetInsert.error) return c.json({ error: 'duplicate_scenario_assets_failed', detail: assetInsert.error.message }, 500);
  }

  await markPackageStale(projectId);
  const response = await loadScenarioResponse(projectId, newScenarioId);
  if (response instanceof Error) return c.json({ error: 'load_project_failed', detail: response.message }, 500);
  if (!response) return c.json({ error: 'scenario_not_found' }, 404);
  return c.json(response, 201);
});

projectRoutes.post('/:id/scenarios/:scenarioId/players', async (c) => {
  const projectId = c.req.param('id');
  const scenarioId = c.req.param('scenarioId');
  let body: CreateProjectScenarioPlayerRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  if (!isScenarioDirection(body.direction)) return c.json({ error: 'invalid_player_direction' }, 400);
  if (typeof body.player_name !== 'string' || !body.player_name.trim()) return c.json({ error: 'player_name_required' }, 400);
  if (typeof body.team_id !== 'string' || !body.team_id.trim()) return c.json({ error: 'team_id_required' }, 400);
  if (body.salary_source_status !== undefined && !isSalarySourceStatus(body.salary_source_status)) return c.json({ error: 'invalid_salary_source_status' }, 400);

  const belongs = await ensureScenarioBelongs(projectId, scenarioId);
  if (belongs instanceof Error) return c.json({ error: 'load_scenario_failed', detail: belongs.message }, 500);
  if (!belongs) return c.json({ error: 'scenario_not_found' }, 404);

  const duplicate = await loadExistingScenarioPlayer(scenarioId, body.team_id, body.nba_player_id ?? null, body.direction);
  if (duplicate instanceof Error) return c.json({ error: 'load_scenario_player_failed', detail: duplicate.message }, 500);
  if (duplicate) {
    const response = await loadScenarioResponse(projectId, scenarioId);
    if (response instanceof Error) return c.json({ error: 'load_project_failed', detail: response.message }, 500);
    if (!response) return c.json({ error: 'scenario_not_found' }, 404);
    return c.json({ ...response, player: duplicate });
  }

  const insert = await db
    .from('project_scenario_players')
    .insert({
      scenario_id: scenarioId,
      team_id: body.team_id.trim().toUpperCase(),
      nba_player_id: body.nba_player_id ?? null,
      player_name: body.player_name.trim().slice(0, 160),
      direction: body.direction,
      salary_amount: nullableNumber(body.salary_amount),
      salary_source_status: body.salary_source_status ?? 'source-needed',
      manual_override: body.manual_override ?? false,
      stats_snapshot: body.stats_snapshot ?? null,
    })
    .select('*')
    .single();
  if (insert.error || !insert.data) return c.json({ error: 'create_scenario_player_failed', detail: insert.error?.message }, 500);

  await markPackageStale(projectId);
  const response = await loadScenarioResponse(projectId, scenarioId);
  if (response instanceof Error) return c.json({ error: 'load_project_failed', detail: response.message }, 500);
  if (!response) return c.json({ error: 'scenario_not_found' }, 404);
  return c.json({ ...response, player: normalizeScenarioPlayer(insert.data) }, 201);
});

projectRoutes.patch('/:id/scenarios/:scenarioId/players/:playerId', async (c) => {
  const projectId = c.req.param('id');
  const scenarioId = c.req.param('scenarioId');
  const playerId = c.req.param('playerId');
  let body: UpdateProjectScenarioPlayerRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.player_name === 'string') {
    if (!body.player_name.trim()) return c.json({ error: 'player_name_required' }, 400);
    updates.player_name = body.player_name.trim().slice(0, 160);
  }
  if (body.direction !== undefined) {
    if (!isScenarioDirection(body.direction)) return c.json({ error: 'invalid_player_direction' }, 400);
    updates.direction = body.direction;
  }
  if (body.salary_amount !== undefined) updates.salary_amount = nullableNumber(body.salary_amount);
  if (body.salary_source_status !== undefined) {
    if (!isSalarySourceStatus(body.salary_source_status)) return c.json({ error: 'invalid_salary_source_status' }, 400);
    updates.salary_source_status = body.salary_source_status;
  }
  if (body.manual_override !== undefined) updates.manual_override = Boolean(body.manual_override);
  if (body.stats_snapshot !== undefined) updates.stats_snapshot = body.stats_snapshot;

  const belongs = await ensureScenarioBelongs(projectId, scenarioId);
  if (belongs instanceof Error) return c.json({ error: 'load_scenario_failed', detail: belongs.message }, 500);
  if (!belongs) return c.json({ error: 'scenario_not_found' }, 404);

  const update = await db
    .from('project_scenario_players')
    .update(updates)
    .eq('scenario_id', scenarioId)
    .eq('id', playerId)
    .select('*')
    .single();
  if (update.error || !update.data) return c.json({ error: 'update_scenario_player_failed', detail: update.error?.message }, 500);

  await markPackageStale(projectId);
  const response = await loadScenarioResponse(projectId, scenarioId);
  if (response instanceof Error) return c.json({ error: 'load_project_failed', detail: response.message }, 500);
  if (!response) return c.json({ error: 'scenario_not_found' }, 404);
  return c.json({ ...response, player: normalizeScenarioPlayer(update.data) });
});

projectRoutes.delete('/:id/scenarios/:scenarioId/players/:playerId', async (c) => {
  const projectId = c.req.param('id');
  const scenarioId = c.req.param('scenarioId');
  const playerId = c.req.param('playerId');
  const belongs = await ensureScenarioBelongs(projectId, scenarioId);
  if (belongs instanceof Error) return c.json({ error: 'load_scenario_failed', detail: belongs.message }, 500);
  if (!belongs) return c.json({ error: 'scenario_not_found' }, 404);

  const del = await db
    .from('project_scenario_players')
    .delete()
    .eq('scenario_id', scenarioId)
    .eq('id', playerId);
  if (del.error) return c.json({ error: 'delete_scenario_player_failed', detail: del.error.message }, 500);
  await markPackageStale(projectId);
  const project = await loadProjectDetail(projectId);
  if (project instanceof Error) return c.json({ error: 'load_project_failed', detail: project.message }, 500);
  if (!project) return c.json({ error: 'project_not_found' }, 404);
  return c.json({ project });
});

projectRoutes.post('/:id/scenarios/:scenarioId/assets', async (c) => {
  const projectId = c.req.param('id');
  const scenarioId = c.req.param('scenarioId');
  let body: CreateProjectScenarioAssetRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  if (!isScenarioAssetType(body.asset_type)) return c.json({ error: 'invalid_asset_type' }, 400);
  if (!isScenarioDirection(body.direction)) return c.json({ error: 'invalid_asset_direction' }, 400);
  if (typeof body.label !== 'string' || !body.label.trim()) return c.json({ error: 'label_required' }, 400);

  const belongs = await ensureScenarioBelongs(projectId, scenarioId);
  if (belongs instanceof Error) return c.json({ error: 'load_scenario_failed', detail: belongs.message }, 500);
  if (!belongs) return c.json({ error: 'scenario_not_found' }, 404);

  const insert = await db
    .from('project_scenario_assets')
    .insert({
      scenario_id: scenarioId,
      asset_type: body.asset_type,
      label: body.label.trim().slice(0, 200),
      direction: body.direction,
      team_id: body.team_id ? body.team_id.trim().toUpperCase() : null,
      amount: nullableNumber(body.amount),
      notes: body.notes?.trim() ?? '',
    })
    .select('*')
    .single();
  if (insert.error || !insert.data) return c.json({ error: 'create_scenario_asset_failed', detail: insert.error?.message }, 500);

  await markPackageStale(projectId);
  const response = await loadScenarioResponse(projectId, scenarioId);
  if (response instanceof Error) return c.json({ error: 'load_project_failed', detail: response.message }, 500);
  if (!response) return c.json({ error: 'scenario_not_found' }, 404);
  return c.json({ ...response, asset: normalizeScenarioAsset(insert.data) }, 201);
});

projectRoutes.patch('/:id/scenarios/:scenarioId/assets/:assetId', async (c) => {
  const projectId = c.req.param('id');
  const scenarioId = c.req.param('scenarioId');
  const assetId = c.req.param('assetId');
  let body: UpdateProjectScenarioAssetRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.asset_type !== undefined) {
    if (!isScenarioAssetType(body.asset_type)) return c.json({ error: 'invalid_asset_type' }, 400);
    updates.asset_type = body.asset_type;
  }
  if (typeof body.label === 'string') {
    if (!body.label.trim()) return c.json({ error: 'label_required' }, 400);
    updates.label = body.label.trim().slice(0, 200);
  }
  if (body.direction !== undefined) {
    if (!isScenarioDirection(body.direction)) return c.json({ error: 'invalid_asset_direction' }, 400);
    updates.direction = body.direction;
  }
  if (body.team_id !== undefined) updates.team_id = body.team_id ? body.team_id.trim().toUpperCase() : null;
  if (body.amount !== undefined) updates.amount = nullableNumber(body.amount);
  if (typeof body.notes === 'string') updates.notes = body.notes.trim();

  const belongs = await ensureScenarioBelongs(projectId, scenarioId);
  if (belongs instanceof Error) return c.json({ error: 'load_scenario_failed', detail: belongs.message }, 500);
  if (!belongs) return c.json({ error: 'scenario_not_found' }, 404);

  const update = await db
    .from('project_scenario_assets')
    .update(updates)
    .eq('scenario_id', scenarioId)
    .eq('id', assetId)
    .select('*')
    .single();
  if (update.error || !update.data) return c.json({ error: 'update_scenario_asset_failed', detail: update.error?.message }, 500);

  await markPackageStale(projectId);
  const response = await loadScenarioResponse(projectId, scenarioId);
  if (response instanceof Error) return c.json({ error: 'load_project_failed', detail: response.message }, 500);
  if (!response) return c.json({ error: 'scenario_not_found' }, 404);
  return c.json({ ...response, asset: normalizeScenarioAsset(update.data) });
});

projectRoutes.delete('/:id/scenarios/:scenarioId/assets/:assetId', async (c) => {
  const projectId = c.req.param('id');
  const scenarioId = c.req.param('scenarioId');
  const assetId = c.req.param('assetId');
  const belongs = await ensureScenarioBelongs(projectId, scenarioId);
  if (belongs instanceof Error) return c.json({ error: 'load_scenario_failed', detail: belongs.message }, 500);
  if (!belongs) return c.json({ error: 'scenario_not_found' }, 404);

  const del = await db.from('project_scenario_assets').delete().eq('scenario_id', scenarioId).eq('id', assetId);
  if (del.error) return c.json({ error: 'delete_scenario_asset_failed', detail: del.error.message }, 500);
  await markPackageStale(projectId);
  const project = await loadProjectDetail(projectId);
  if (project instanceof Error) return c.json({ error: 'load_project_failed', detail: project.message }, 500);
  if (!project) return c.json({ error: 'project_not_found' }, 404);
  return c.json({ project });
});

projectRoutes.patch('/:id/scenarios/:scenarioId/validations/:kind', async (c) => {
  const projectId = c.req.param('id');
  const scenarioId = c.req.param('scenarioId');
  const kind = c.req.param('kind');
  if (!isValidationKind(kind)) return c.json({ error: 'invalid_validation_kind' }, 400);
  let body: UpdateProjectScenarioValidationRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  if (!isValidationStatus(body.status)) return c.json({ error: 'invalid_validation_status' }, 400);

  const belongs = await ensureScenarioBelongs(projectId, scenarioId);
  if (belongs instanceof Error) return c.json({ error: 'load_scenario_failed', detail: belongs.message }, 500);
  if (!belongs) return c.json({ error: 'scenario_not_found' }, 404);

  const validation = await upsertScenarioValidation(scenarioId, {
    kind,
    status: body.status,
    summary: body.summary?.trim() ?? '',
    details: body.details ?? {},
    source_refs: [],
  });
  if (validation instanceof Error) return c.json({ error: 'update_scenario_validation_failed', detail: validation.message }, 500);
  await markPackageStale(projectId);

  const response = await loadScenarioResponse(projectId, scenarioId);
  if (response instanceof Error) return c.json({ error: 'load_project_failed', detail: response.message }, 500);
  if (!response) return c.json({ error: 'scenario_not_found' }, 404);
  return c.json({ ...response, validation });
});

projectRoutes.post('/:id/scenarios/:scenarioId/validate', async (c) => {
  const projectId = c.req.param('id');
  const scenarioId = c.req.param('scenarioId');
  const detail = await loadProjectDetail(projectId);
  if (detail instanceof Error) return c.json({ error: 'load_project_failed', detail: detail.message }, 500);
  if (!detail) return c.json({ error: 'project_not_found' }, 404);
  const scenario = detail.scenarios.find((item) => item.id === scenarioId);
  if (!scenario) return c.json({ error: 'scenario_not_found' }, 404);

  const advisory = buildScenarioAdvisoryValidation(scenario);
  const validation = await upsertScenarioValidation(scenarioId, advisory);
  if (validation instanceof Error) return c.json({ error: 'validate_scenario_failed', detail: validation.message }, 500);
  await db
    .from('project_trade_scenarios')
    .update({ validation_summary: advisory.summary, updated_at: new Date().toISOString() })
    .eq('project_id', projectId)
    .eq('id', scenarioId);
  await markPackageStale(projectId);

  const response = await loadScenarioResponse(projectId, scenarioId);
  if (response instanceof Error) return c.json({ error: 'load_project_failed', detail: response.message }, 500);
  if (!response) return c.json({ error: 'scenario_not_found' }, 404);
  return c.json({ ...response, validation });
});

projectRoutes.post('/:id/artifacts', async (c) => {
  const projectId = c.req.param('id');
  let body: CreateProjectArtifactRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  if (!isArtifactType(body.artifact_type)) return c.json({ error: 'invalid_artifact_type' }, 400);
  if (typeof body.title !== 'string' || !body.title.trim()) return c.json({ error: 'title_required' }, 400);
  const scenarioId = body.scenario_id ? body.scenario_id.trim() : null;
  if (scenarioId) {
    const belongs = await ensureScenarioBelongs(projectId, scenarioId);
    if (belongs instanceof Error) return c.json({ error: 'load_scenario_failed', detail: belongs.message }, 500);
    if (!belongs) return c.json({ error: 'scenario_not_found' }, 404);
  }

  const insert = await db
    .from('project_artifacts')
    .insert({
      project_id: projectId,
      scenario_id: scenarioId,
      artifact_type: body.artifact_type,
      title: body.title.trim().slice(0, 200),
      url: body.url?.trim() || null,
      notes: body.notes?.trim() ?? '',
      metadata: body.metadata ?? {},
    })
    .select('*')
    .single();
  if (insert.error || !insert.data) return c.json({ error: 'create_artifact_failed', detail: insert.error?.message }, 500);

  await markPackageStale(projectId);
  const project = await loadProjectDetail(projectId);
  if (project instanceof Error) return c.json({ error: 'load_project_failed', detail: project.message }, 500);
  if (!project) return c.json({ error: 'project_not_found' }, 404);
  return c.json({ project, artifact: normalizeArtifact(insert.data) }, 201);
});

projectRoutes.patch('/:id/artifacts/:artifactId', async (c) => {
  const projectId = c.req.param('id');
  const artifactId = c.req.param('artifactId');
  let body: UpdateProjectArtifactRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.artifact_type !== undefined) {
    if (!isArtifactType(body.artifact_type)) return c.json({ error: 'invalid_artifact_type' }, 400);
    updates.artifact_type = body.artifact_type;
  }
  if (typeof body.title === 'string') {
    if (!body.title.trim()) return c.json({ error: 'title_required' }, 400);
    updates.title = body.title.trim().slice(0, 200);
  }
  if (body.scenario_id !== undefined) {
    const scenarioId = body.scenario_id ? body.scenario_id.trim() : null;
    if (scenarioId) {
      const belongs = await ensureScenarioBelongs(projectId, scenarioId);
      if (belongs instanceof Error) return c.json({ error: 'load_scenario_failed', detail: belongs.message }, 500);
      if (!belongs) return c.json({ error: 'scenario_not_found' }, 404);
    }
    updates.scenario_id = scenarioId;
  }
  if (body.url !== undefined) updates.url = body.url?.trim() || null;
  if (typeof body.notes === 'string') updates.notes = body.notes.trim();
  if (body.metadata !== undefined) updates.metadata = body.metadata;

  const update = await db
    .from('project_artifacts')
    .update(updates)
    .eq('project_id', projectId)
    .eq('id', artifactId)
    .select('*')
    .single();
  if (update.error || !update.data) return c.json({ error: 'update_artifact_failed', detail: update.error?.message }, 500);
  await markPackageStale(projectId);

  const project = await loadProjectDetail(projectId);
  if (project instanceof Error) return c.json({ error: 'load_project_failed', detail: project.message }, 500);
  if (!project) return c.json({ error: 'project_not_found' }, 404);
  return c.json({ project, artifact: normalizeArtifact(update.data) });
});

projectRoutes.delete('/:id/artifacts/:artifactId', async (c) => {
  const projectId = c.req.param('id');
  const artifactId = c.req.param('artifactId');
  const del = await db.from('project_artifacts').delete().eq('project_id', projectId).eq('id', artifactId);
  if (del.error) return c.json({ error: 'delete_artifact_failed', detail: del.error.message }, 500);
  await markPackageStale(projectId);
  const project = await loadProjectDetail(projectId);
  if (project instanceof Error) return c.json({ error: 'load_project_failed', detail: project.message }, 500);
  if (!project) return c.json({ error: 'project_not_found' }, 404);
  return c.json({ project });
});

projectRoutes.post('/:id/advance', async (c) => {
  const projectId = c.req.param('id');
  let body: AdvanceProjectRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  if (!isProjectStep(body.step)) return c.json({ error: 'invalid_step' }, 400);

  const before = await loadProjectDetail(projectId);
  if (before instanceof Error) return c.json({ error: 'load_project_failed', detail: before.message }, 500);
  if (!before) return c.json({ error: 'project_not_found' }, 404);
  const warnings = buildStageWarnings(before, before.project.active_step);

  const update = await db
    .from('projects')
    .update({ active_step: body.step, updated_at: new Date().toISOString() })
    .eq('id', projectId)
    .select('*')
    .single();
  if (update.error || !update.data) return c.json({ error: 'advance_project_failed', detail: update.error?.message }, 500);

  await markPackageStale(projectId);
  const project = await loadProjectDetail(projectId);
  if (project instanceof Error) return c.json({ error: 'load_project_failed', detail: project.message }, 500);
  if (!project) return c.json({ error: 'project_not_found' }, 404);
  return c.json({ project, warnings });
});

projectRoutes.post('/:id/ai/seed', async (c) => {
  const projectId = c.req.param('id');
  const seed = await seedProjectWorkspace(projectId, null);
  if (seed instanceof Error) return c.json({ error: 'seed_project_failed', detail: seed.message }, 500);
  const project = await loadProjectDetail(projectId);
  if (project instanceof Error) return c.json({ error: 'load_project_failed', detail: project.message }, 500);
  if (!project) return c.json({ error: 'project_not_found' }, 404);
  return c.json({ project });
});

projectRoutes.post('/:id/ai/diagnose', async (c) => {
  const project = await loadProjectDetail(c.req.param('id'));
  if (project instanceof Error) return c.json({ error: 'load_project_failed', detail: project.message }, 500);
  if (!project) return c.json({ error: 'project_not_found' }, 404);
  return c.json({ diagnosis: buildProjectDiagnosis(project) });
});

projectRoutes.post('/:id/package/generate', async (c) => {
  const projectId = c.req.param('id');
  const detail = await loadProjectDetail(projectId);
  if (detail instanceof Error) return c.json({ error: 'load_project_failed', detail: detail.message }, 500);
  if (!detail) return c.json({ error: 'project_not_found' }, 404);

  const built = buildProjectPackage(detail);
  const insert = await db
    .from('project_packages')
    .insert({
      project_id: projectId,
      status: built.status,
      markdown: built.markdown,
      sections: built.sections,
      source_refs: built.source_refs,
      generated_at: new Date().toISOString(),
    })
    .select('*')
    .single();
  if (insert.error || !insert.data) return c.json({ error: 'generate_package_failed', detail: insert.error?.message }, 500);

  await db
    .from('projects')
    .update({
      package_status: built.status,
      status: built.status === 'ready' ? 'packaged' : detail.project.status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', projectId);

  const project = await loadProjectDetail(projectId);
  if (project instanceof Error) return c.json({ error: 'load_project_failed', detail: project.message }, 500);
  if (!project) return c.json({ error: 'project_not_found' }, 404);
  return c.json({ project, package: normalizeProjectPackage(insert.data) });
});

export function deriveProjectTitle(
  brief: Pick<Brief, 'thesis' | 'question'>,
  explicitTitle?: string | null,
): string {
  const candidate = explicitTitle?.trim() || brief.thesis?.trim() || brief.question.trim() || 'Untitled project';
  return candidate.slice(0, 120);
}

export function isProjectStep(value: unknown): value is ProjectStepId {
  return typeof value === 'string' && STAGE_IDS.includes(value as ProjectStepId);
}

export function buildAttachProjectBriefResponse(
  project: ProjectDetail,
  projectBrief: ProjectSourceBrief,
  alreadyAttached: boolean,
) {
  return {
    project,
    project_brief: project.source_briefs.find((item) => item.id === projectBrief.id) ?? projectBrief,
    already_attached: alreadyAttached,
  };
}

export function buildStageWarnings(project: ProjectDetail, step = project.project.active_step): ProjectStageWarning[] {
  const warnings: ProjectStageWarning[] = [];
  const note = project.stage_notes.find((item) => item.step === step);
  const requiredTasks = project.tasks.filter((task) => task.step === step && task.required);
  const incompleteRequired = requiredTasks.filter((task) => !task.completed_at);

  if (!note || !note.body.trim()) {
    warnings.push({ code: 'missing_stage_note', step, message: `${stepLabel(step)} needs a stage note before the package is fully defensible.` });
  }
  if (incompleteRequired.length > 0) {
    warnings.push({
      code: 'required_tasks_incomplete',
      step,
      message: `${incompleteRequired.length} required ${stepLabel(step)} checklist item${incompleteRequired.length === 1 ? '' : 's'} still open.`,
    });
  }
  if (project.source_briefs.length === 0) {
    warnings.push({ code: 'no_linked_briefs', message: 'No source briefs are linked to this project yet.' });
  }
  if (step === 'proposal' && project.project.package_status !== 'ready') {
    warnings.push({ code: 'package_not_ready', step, message: 'The decision package is not marked ready yet.' });
  }

  return warnings;
}

export function buildProjectDiagnosis(project: ProjectDetail): ProjectDiagnosis {
  const allWarnings = STAGE_IDS.flatMap((step) => buildStageWarnings(project, step));
  const incompleteRequired = project.tasks.filter((task) => task.required && !task.completed_at).length;
  const filledNotes = project.stage_notes.filter((note) => note.body.trim()).length;
  const activeScenarios = project.scenarios.filter((scenario) => scenario.status !== 'archived' && scenario.status !== 'collapsed');
  const scenarioGaps = buildScenarioGaps(project);
  const warningCount = allWarnings.length + scenarioGaps.length;
  const hasManualVerdicts = activeScenarios.some((scenario) => latestValidation(scenario, 'trade_builder'))
    && activeScenarios.some((scenario) => latestValidation(scenario, 'internal_cap_sheet'));
  const readiness = warningCount === 0 && activeScenarios.length > 0 && hasManualVerdicts
    ? 'high'
    : (activeScenarios.length > 0 && filledNotes >= 2 && incompleteRequired <= 4 ? 'medium' : 'low');
  const gaps = [...scenarioGaps, ...allWarnings.map((warning) => warning.message)];
  const nextActions = [
    activeScenarios.length === 0 ? 'Create at least one structured trade scenario before packaging.' : 'Run advisory validation on every live scenario after player rows change.',
    project.project.counterparty_team_id ? 'Fill any missing counterparty pressure, target, or signal fields before phone framing.' : 'Select the counterparty team for the inbound call.',
    hasManualVerdicts ? 'Shortlist the strongest concepts and refresh the scenario library report.' : 'Record Trade Builder and internal cap-sheet verdicts for the live concepts.',
  ];

  return {
    readiness,
    summary: readiness === 'high'
      ? 'The scenario library has live concepts, advisory checks, and the key manual validation fields needed for a phone-ready package.'
      : 'The scenario library still has operational gaps around scenario coverage, salary/source fidelity, or external validation.',
    gaps: gaps.length > 0 ? gaps : ['No major scenario-library gaps detected from current concepts and validation rows.'],
    next_actions: nextActions,
    warnings: allWarnings,
  };
}

export function buildProjectPackage(project: ProjectDetail): {
  status: Exclude<ProjectPackage['status'], 'stale'>;
  markdown: string;
  sections: ProjectPackageSection[];
  source_refs: ProjectPackageSourceRef[];
} {
  const diagnosis = buildProjectDiagnosis(project);
  const sourceRefs = project.source_briefs.map((item, index) => ({
    brief_id: item.brief_id,
    label: `[B${index + 1}] ${item.brief.thesis || item.brief.question || 'Source brief'}`,
  }));
  const scenarioRows = project.scenarios
    .slice()
    .sort((a, b) => a.rank - b.rank || a.updated_at.localeCompare(b.updated_at))
    .map((scenario) => {
      const outgoing = scenario.players.filter((player) => player.direction === 'outgoing').map(playerLabel).join(', ') || 'TBD';
      const incoming = scenario.players.filter((player) => player.direction === 'incoming').map(playerLabel).join(', ') || 'TBD';
      const app = validationLabel(latestValidation(scenario, 'app_advisory'));
      const tradeBuilder = validationLabel(latestValidation(scenario, 'trade_builder'));
      const internalSheet = validationLabel(latestValidation(scenario, 'internal_cap_sheet'));
      const totals = scenarioSalaryTotals(scenario);
      return `| ${scenario.rank || '-'} | ${scenario.title} | ${scenario.status} | ${outgoing} | ${incoming} | ${money(totals.delta)} | ${app} | ${tradeBuilder} | ${internalSheet} |`;
    });
  const scenarioTable = [
    '| Rank | Scenario | Status | Warriors outgoing | Warriors incoming | Salary delta | App check | Trade Builder | Internal sheet |',
    '| --- | --- | --- | --- | --- | ---: | --- | --- | --- |',
    ...(scenarioRows.length > 0 ? scenarioRows : ['| - | No scenarios yet | - | - | - | - | - | - | - |']),
  ].join('\n');
  const context = project.project.counterparty_context;
  const contextLines = [
    `Subject team: ${project.project.subject_team_id}`,
    `Counterparty: ${project.project.counterparty_team_id || 'TBD'}`,
    `Inbound player: ${project.project.inbound_player_id ?? 'TBD'}`,
    `Trigger: ${project.project.trigger_summary || project.project.question}`,
    `Apron/cap posture: ${context.apron_level || 'TBD'} ${context.cap_room ? `; ${context.cap_room}` : ''}`,
    `Aims/pressure/signals: ${[context.aims, context.pressure, context.job_security, context.known_targets, context.signals].filter(Boolean).join(' | ') || 'TBD'}`,
  ].join('\n');
  const sections: ProjectPackageSection[] = [
    { title: 'Inbound Call Context', body: contextLines, citation_refs: sourceRefs },
    { title: 'Scenario Library', body: scenarioTable, citation_refs: sourceRefs },
    { title: 'Operational Gaps', body: diagnosis.gaps.map((gap) => `- ${gap}`).join('\n') },
    { title: 'Phone Framing And Ranges', body: buildPhoneFramingSection(project) },
    { title: 'Artifacts And Sources', body: buildArtifactSection(project, sourceRefs), citation_refs: sourceRefs },
    {
      title: 'Secondary Stage Checklist',
      body: project.tasks
        .filter((task) => task.required && !task.completed_at)
        .map((task) => `- [ ] ${task.label}`)
        .join('\n') || 'No required checklist items remain open.',
    },
  ];
  const markdown = [
    `# ${project.project.title}`,
    '',
    ...sections.flatMap((section) => [`## ${section.title}`, '', section.body, '']),
    ...(sourceRefs.length > 0
      ? ['## Linked Sources', '', ...sourceRefs.map((ref) => `- ${ref.label}`), '']
      : ['## Linked Sources', '', 'No linked source briefs.', '']),
  ].join('\n');

  return {
    status: diagnosis.readiness === 'high' ? 'ready' : 'drafted',
    markdown,
    sections,
    source_refs: sourceRefs,
  };
}

export function buildScenarioAdvisoryValidation(scenario: ProjectTradeScenarioDetail): {
  kind: ProjectScenarioValidationKind;
  status: ProjectScenarioValidationStatus;
  summary: string;
  details: Record<string, unknown>;
  source_refs: ProjectPackageSourceRef[];
} {
  const totals = scenarioSalaryTotals(scenario);
  const gaps = scenario.players
    .filter((player) => !isSalaryUsable(player))
    .map((player) => `${player.player_name} (${player.team_id}, ${player.direction}, ${player.salary_source_status})`);
  const warnings: string[] = [];
  if (scenario.players.length === 0) warnings.push('No player rows captured yet.');
  if (totals.outgoing === 0) warnings.push('No outgoing Warriors-side salary captured.');
  if (totals.incoming === 0) warnings.push('No incoming salary captured.');
  if (gaps.length > 0) warnings.push(`${gaps.length} player salary row${gaps.length === 1 ? '' : 's'} need source/manual validation.`);
  const status: ProjectScenarioValidationStatus = gaps.length > 0
    ? 'source_needed'
    : warnings.length > 0 ? 'warning' : 'pass';
  const summary = [
    `Outgoing ${money(totals.outgoing)} / incoming ${money(totals.incoming)} / delta ${money(totals.delta)}.`,
    warnings.length > 0 ? warnings.join(' ') : 'Captured/manual salary rows have no source gaps in this advisory check.',
    'This is an app cross-check only; Trade Builder and internal cap sheet verdicts remain manual.',
  ].join(' ');

  return {
    kind: 'app_advisory',
    status,
    summary,
    details: {
      outgoing_salary: totals.outgoing,
      incoming_salary: totals.incoming,
      salary_delta: totals.delta,
      source_gaps: gaps,
      warning_count: warnings.length,
    },
    source_refs: scenario.players.map((player) => ({
      label: `${player.player_name} salary source: ${player.salary_source_status}${player.manual_override ? ' manual override' : ''}`,
    })),
  };
}

function buildScenarioGaps(project: ProjectDetail): string[] {
  const gaps: string[] = [];
  if (!project.project.counterparty_team_id) gaps.push('Counterparty team is not selected.');
  const context = project.project.counterparty_context;
  for (const [field, label] of [
    ['apron_level', 'counterparty apron/cap posture'],
    ['aims', 'counterparty aims'],
    ['signals', 'known signals'],
  ] as const) {
    if (!context[field].trim()) gaps.push(`Missing ${label}.`);
  }
  if (project.scenarios.length === 0) gaps.push('No structured trade scenarios have been captured.');
  for (const scenario of project.scenarios.filter((item) => item.status !== 'archived' && item.status !== 'collapsed')) {
    if (scenario.players.length === 0) gaps.push(`${scenario.title}: no player rows captured.`);
    if (!latestValidation(scenario, 'app_advisory')) gaps.push(`${scenario.title}: advisory app validation has not been run.`);
    if (!latestValidation(scenario, 'trade_builder')) gaps.push(`${scenario.title}: Trade Builder verdict is not recorded.`);
    if (!latestValidation(scenario, 'internal_cap_sheet')) gaps.push(`${scenario.title}: internal cap-sheet verdict is not recorded.`);
    if (!scenario.walk_away.trim() && !scenario.counter_range.trim()) gaps.push(`${scenario.title}: walk-away or counter range is not mapped.`);
    const advisory = latestValidation(scenario, 'app_advisory');
    if (advisory?.status === 'source_needed') gaps.push(`${scenario.title}: salary/source gaps remain in advisory validation.`);
  }
  return gaps;
}

function buildPhoneFramingSection(project: ProjectDetail): string {
  const rows = project.scenarios
    .filter((scenario) => scenario.status !== 'archived' && scenario.status !== 'collapsed')
    .sort((a, b) => a.rank - b.rank)
    .map((scenario) => [
      `### ${scenario.title}`,
      '',
      `Soft framing: ${scenario.phone_framing || 'TBD'}`,
      `Walk-away: ${scenario.walk_away || 'TBD'}`,
      `Counter range: ${scenario.counter_range || 'TBD'}`,
      `Risk: ${scenario.risks || 'TBD'}`,
    ].join('\n'));
  return rows.length > 0 ? rows.join('\n\n') : 'No live scenarios are ready for phone framing.';
}

function buildArtifactSection(project: ProjectDetail, sourceRefs: ProjectPackageSourceRef[]): string {
  const artifacts = project.artifacts.map((artifact) => {
    const url = artifact.url ? ` (${artifact.url})` : '';
    return `- ${artifact.title} — ${artifact.artifact_type}${url}${artifact.notes ? `: ${artifact.notes}` : ''}`;
  });
  const sources = sourceRefs.map((ref) => `- ${ref.label}`);
  return [
    artifacts.length > 0 ? artifacts.join('\n') : 'No Trade Builder PDFs, cap sheets, Slack/email notes, or intel artifacts linked yet.',
    sources.length > 0 ? ['Linked source briefs:', ...sources].join('\n') : 'No linked source briefs.',
  ].join('\n\n');
}

function scenarioSalaryTotals(scenario: ProjectTradeScenarioDetail): { outgoing: number; incoming: number; delta: number } {
  const totals = { outgoing: 0, incoming: 0, delta: 0 };
  for (const player of scenario.players) {
    if (!isSalaryUsable(player)) continue;
    if (player.direction === 'outgoing') totals.outgoing += player.salary_amount ?? 0;
    if (player.direction === 'incoming') totals.incoming += player.salary_amount ?? 0;
  }
  totals.delta = totals.incoming - totals.outgoing;
  return totals;
}

function isSalaryUsable(player: ProjectScenarioPlayer): boolean {
  if (typeof player.salary_amount !== 'number' || !Number.isFinite(player.salary_amount)) return false;
  return player.salary_source_status === 'captured'
    || player.salary_source_status === 'manual'
    || player.manual_override;
}

function latestValidation(
  scenario: ProjectTradeScenarioDetail,
  kind: ProjectScenarioValidationKind,
): ProjectScenarioValidation | null {
  return scenario.validations
    .filter((validation) => validation.kind === kind)
    .sort((a, b) => (b.validated_at ?? b.updated_at).localeCompare(a.validated_at ?? a.updated_at))[0] ?? null;
}

function validationLabel(validation: ProjectScenarioValidation | null): string {
  return validation ? validation.status.replace(/_/g, ' ') : 'missing';
}

function playerLabel(player: ProjectScenarioPlayer): string {
  const salary = typeof player.salary_amount === 'number' ? ` ${money(player.salary_amount)}` : '';
  const source = player.salary_source_status === 'captured' || player.manual_override ? '' : ` (${player.salary_source_status})`;
  return `${player.player_name}${salary}${source}`;
}

function money(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'TBD';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}K`;
  return `${sign}$${Math.round(abs)}`;
}

async function loadScenarioResponse(
  projectId: string,
  scenarioId: string,
): Promise<{ project: ProjectDetail; scenario: ProjectTradeScenarioDetail } | null | Error> {
  const project = await loadProjectDetail(projectId);
  if (project instanceof Error) return project;
  if (!project) return null;
  const scenario = project.scenarios.find((item) => item.id === scenarioId);
  if (!scenario) return null;
  return { project, scenario };
}

async function ensureScenarioBelongs(projectId: string, scenarioId: string): Promise<boolean | Error> {
  const res = await db
    .from('project_trade_scenarios')
    .select('id')
    .eq('project_id', projectId)
    .eq('id', scenarioId)
    .maybeSingle();
  if (res.error) return new Error(res.error.message);
  return Boolean(res.data);
}

async function loadExistingScenarioPlayer(
  scenarioId: string,
  teamId: string,
  nbaPlayerId: number | null,
  direction: ProjectScenarioPlayerDirection,
): Promise<ProjectScenarioPlayer | null | Error> {
  if (nbaPlayerId == null) return null;
  const res = await db
    .from('project_scenario_players')
    .select('*')
    .eq('scenario_id', scenarioId)
    .eq('team_id', teamId.trim().toUpperCase())
    .eq('nba_player_id', nbaPlayerId)
    .eq('direction', direction)
    .maybeSingle();
  if (res.error) return new Error(res.error.message);
  return res.data ? normalizeScenarioPlayer(res.data) : null;
}

async function upsertScenarioValidation(
  scenarioId: string,
  input: {
    kind: ProjectScenarioValidationKind;
    status: ProjectScenarioValidationStatus;
    summary: string;
    details: Record<string, unknown>;
    source_refs: ProjectPackageSourceRef[];
  },
): Promise<ProjectScenarioValidation | Error> {
  const res = await db
    .from('project_scenario_validations')
    .upsert({
      scenario_id: scenarioId,
      kind: input.kind,
      status: input.status,
      summary: input.summary,
      details: input.details,
      source_refs: input.source_refs,
      validated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'scenario_id,kind' })
    .select('*')
    .single();
  if (res.error || !res.data) return new Error(res.error?.message ?? 'scenario validation upsert failed');
  return normalizeScenarioValidation(res.data);
}

function nextScenarioRank(project: ProjectDetail): number {
  const maxRank = project.scenarios.reduce((max, scenario) => Math.max(max, scenario.rank), 0);
  return maxRank + 1;
}

function cleanTeamIds(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim().toUpperCase().slice(0, 6)))];
}

function groupByScenario<T extends { scenario_id: string }>(rows: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const existing = grouped.get(row.scenario_id) ?? [];
    existing.push(row);
    grouped.set(row.scenario_id, existing);
  }
  return grouped;
}

async function normalizeCreateProjectInput(
  body: Partial<CreateProjectRequest> & { brief_id?: string },
): Promise<
  | { status: 200; input: CreateProjectRequest; sourceBrief: Pick<Brief, 'thesis' | 'question'> | null }
  | { status: 400 | 404; error: string }
  | Error
> {
  const sourceBriefId = typeof body.source_brief_id === 'string'
    ? body.source_brief_id
    : (typeof body.brief_id === 'string' ? body.brief_id : null);
  const sourceBrief = sourceBriefId ? await loadBriefForProject(sourceBriefId) : null;
  if (sourceBriefId && sourceBrief instanceof Error) return sourceBrief;
  if (sourceBriefId && !sourceBrief) return { status: 404, error: 'brief_not_found' };

  const title = typeof body.title === 'string'
    ? body.title.trim()
    : '';
  const question = typeof body.question === 'string'
    ? body.question.trim()
    : '';
  const objective = typeof body.objective === 'string'
    ? body.objective.trim()
    : '';
  const brief = sourceBrief && !(sourceBrief instanceof Error) ? sourceBrief : null;
  const derivedQuestion = question || brief?.question || title;
  const derivedTitle = title || (brief ? deriveProjectTitle(brief) : '');
  const derivedObjective = objective || (brief
    ? `Use this inbound context to build scenario concepts, cross-check cap/CBA risk, and narrow to phone-ready options.`
    : '');
  const workflowType = isProjectWorkflowType(body.workflow_type) ? body.workflow_type : 'inbound_trade';
  const subjectTeamId = typeof body.subject_team_id === 'string' && body.subject_team_id.trim()
    ? body.subject_team_id.trim().toUpperCase().slice(0, 6)
    : 'GSW';
  const counterpartyTeamId = typeof body.counterparty_team_id === 'string' && body.counterparty_team_id.trim()
    ? body.counterparty_team_id.trim().toUpperCase().slice(0, 6)
    : null;
  const inboundPlayerId = typeof body.inbound_player_id === 'number' && Number.isFinite(body.inbound_player_id)
    ? Math.trunc(body.inbound_player_id)
    : null;
  const triggerSummary = typeof body.trigger_summary === 'string' && body.trigger_summary.trim()
    ? body.trigger_summary.trim()
    : (brief ? brief.question : derivedQuestion);

  if (!derivedTitle) return { status: 400, error: 'title_required' };
  if (!derivedQuestion) return { status: 400, error: 'question_required' };
  if (!derivedObjective) return { status: 400, error: 'objective_required' };

  return {
    status: 200,
    input: {
      title: derivedTitle.slice(0, 120),
      question: derivedQuestion,
      objective: derivedObjective,
      workflow_type: workflowType,
      subject_team_id: subjectTeamId,
      counterparty_team_id: counterpartyTeamId,
      inbound_player_id: inboundPlayerId,
      trigger_summary: triggerSummary,
      counterparty_context: normalizeCounterpartyContext(body.counterparty_context),
      source_brief_id: sourceBriefId,
    },
    sourceBrief: brief,
  };
}

async function loadProjectSummaries(): Promise<ProjectSummary[] | Error> {
  const res = await db
    .from('projects')
    .select('*')
    .is('archived_at', null)
    .order('updated_at', { ascending: false });
  if (res.error) return new Error(res.error.message);
  const projects = res.data ?? [];
  const projectIds = projects.map((project) => String(project.id));
  if (projectIds.length === 0) return [];

  const [briefsRes, tasksRes, scenariosRes] = await Promise.all([
    db.from('project_briefs').select('project_id, id').in('project_id', projectIds),
    db.from('project_tasks').select('project_id, id, completed_at').in('project_id', projectIds),
    db.from('project_trade_scenarios').select('project_id, id, status').in('project_id', projectIds),
  ]);
  if (briefsRes.error) return new Error(briefsRes.error.message);
  if (tasksRes.error) return new Error(tasksRes.error.message);
  if (scenariosRes.error) return new Error(scenariosRes.error.message);

  const briefCounts = new Map<string, number>();
  for (const row of briefsRes.data ?? []) {
    const projectId = String(row.project_id);
    briefCounts.set(projectId, (briefCounts.get(projectId) ?? 0) + 1);
  }

  const taskCounts = new Map<string, { total: number; completed: number }>();
  for (const row of tasksRes.data ?? []) {
    const projectId = String(row.project_id);
    const counts = taskCounts.get(projectId) ?? { total: 0, completed: 0 };
    counts.total += 1;
    if (typeof row.completed_at === 'string') counts.completed += 1;
    taskCounts.set(projectId, counts);
  }

  const scenarioCounts = new Map<string, { total: number; shortlisted: number }>();
  for (const row of scenariosRes.data ?? []) {
    const projectId = String(row.project_id);
    const counts = scenarioCounts.get(projectId) ?? { total: 0, shortlisted: 0 };
    counts.total += 1;
    if (row.status === 'shortlisted' || row.status === 'presented' || row.status === 'terms_agreed') counts.shortlisted += 1;
    scenarioCounts.set(projectId, counts);
  }

  return projects.map((project) => normalizeProjectSummary(
    project,
    briefCounts.get(String(project.id)) ?? 0,
    taskCounts.get(String(project.id)) ?? { total: 0, completed: 0 },
    scenarioCounts.get(String(project.id)) ?? { total: 0, shortlisted: 0 },
  ));
}

async function loadProjectDetail(projectId: string): Promise<ProjectDetail | null | Error> {
  const projectRes = await db.from('projects').select('*').eq('id', projectId).maybeSingle();
  if (projectRes.error) return new Error(projectRes.error.message);
  if (!projectRes.data) return null;

  const [briefsRes, notesRes, tasksRes, packagesRes, scenariosRes, artifactsRes] = await Promise.all([
    db.from('project_briefs').select('*, brief:briefs(*)').eq('project_id', projectId).order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
    db.from('project_stage_notes').select('*').eq('project_id', projectId).order('created_at', { ascending: true }),
    db.from('project_tasks').select('*').eq('project_id', projectId).order('step', { ascending: true }).order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
    db.from('project_packages').select('*').eq('project_id', projectId).order('generated_at', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }).limit(1),
    db.from('project_trade_scenarios').select('*').eq('project_id', projectId).order('rank', { ascending: true }).order('updated_at', { ascending: false }),
    db.from('project_artifacts').select('*').eq('project_id', projectId).order('created_at', { ascending: false }),
  ]);

  if (briefsRes.error) return new Error(briefsRes.error.message);
  if (notesRes.error) return new Error(notesRes.error.message);
  if (tasksRes.error) return new Error(tasksRes.error.message);
  if (packagesRes.error) return new Error(packagesRes.error.message);
  if (scenariosRes.error) return new Error(scenariosRes.error.message);
  if (artifactsRes.error) return new Error(artifactsRes.error.message);

  const scenarioIds = (scenariosRes.data ?? []).map((row) => String(row.id));
  const [playersRes, assetsRes, validationsRes] = scenarioIds.length > 0
    ? await Promise.all([
      db.from('project_scenario_players').select('*').in('scenario_id', scenarioIds).order('created_at', { ascending: true }),
      db.from('project_scenario_assets').select('*').in('scenario_id', scenarioIds).order('created_at', { ascending: true }),
      db.from('project_scenario_validations').select('*').in('scenario_id', scenarioIds).order('created_at', { ascending: true }),
    ])
    : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }];
  if (playersRes.error) return new Error(playersRes.error.message);
  if (assetsRes.error) return new Error(assetsRes.error.message);
  if (validationsRes.error) return new Error(validationsRes.error.message);

  const playersByScenario = groupByScenario((playersRes.data ?? []).map(normalizeScenarioPlayer));
  const assetsByScenario = groupByScenario((assetsRes.data ?? []).map(normalizeScenarioAsset));
  const validationsByScenario = groupByScenario((validationsRes.data ?? []).map(normalizeScenarioValidation));

  return {
    project: normalizeProject(projectRes.data),
    source_briefs: (briefsRes.data ?? []).map(normalizeProjectSourceBrief),
    stage_notes: (notesRes.data ?? []).map(normalizeProjectStageNote).sort((a, b) => STEP_RANK[a.step] - STEP_RANK[b.step]),
    tasks: (tasksRes.data ?? []).map(normalizeProjectTask).sort((a, b) => STEP_RANK[a.step] - STEP_RANK[b.step] || a.sort_order - b.sort_order),
    scenarios: (scenariosRes.data ?? []).map((row) => {
      const scenario = normalizeTradeScenario(row);
      return {
        ...scenario,
        players: playersByScenario.get(scenario.id) ?? [],
        assets: assetsByScenario.get(scenario.id) ?? [],
        validations: validationsByScenario.get(scenario.id) ?? [],
      };
    }),
    artifacts: (artifactsRes.data ?? []).map(normalizeArtifact),
    latest_package: packagesRes.data?.[0] ? normalizeProjectPackage(packagesRes.data[0]) : null,
  };
}

async function loadBriefForProject(briefId: string): Promise<Pick<Brief, 'thesis' | 'question'> | null | Error> {
  const res = await db
    .from('briefs')
    .select('thesis, question')
    .eq('id', briefId)
    .maybeSingle();
  if (res.error) return new Error(res.error.message);
  return res.data as Pick<Brief, 'thesis' | 'question'> | null;
}

async function attachBrief(projectId: string, briefId: string): Promise<ProjectSourceBrief | Error> {
  const insert = await db
    .from('project_briefs')
    .insert({ project_id: projectId, brief_id: briefId, step: 'research' })
    .select('*, brief:briefs(*)')
    .single();
  if (insert.error || !insert.data) return new Error(insert.error?.message ?? 'project_briefs insert failed');
  return normalizeProjectSourceBrief(insert.data);
}

async function seedProjectWorkspace(projectId: string, sourceBrief: Pick<Brief, 'thesis' | 'question'> | null): Promise<true | Error> {
  const noteRows = STAGE_IDS.map((step) => {
    const sourceContext = step === 'research' && sourceBrief
      ? `\n\nInitial source: ${sourceBrief.thesis || sourceBrief.question}`
      : '';
    return {
      project_id: projectId,
      step,
      body: `${DEFAULT_STAGE_NOTES[step]}${sourceContext}`,
      ai_draft: DEFAULT_STAGE_NOTES[step],
      citation_refs: [],
      updated_at: new Date().toISOString(),
    };
  });
  const notes = await db
    .from('project_stage_notes')
    .upsert(noteRows, { onConflict: 'project_id,step' });
  if (notes.error) return new Error(notes.error.message);

  const existing = await db.from('project_tasks').select('step, label').eq('project_id', projectId);
  if (existing.error) return new Error(existing.error.message);
  const existingKeys = new Set((existing.data ?? []).map((row) => `${String(row.step)}:${String(row.label)}`));
  const missingTasks = defaultProjectTasks()
    .filter((task) => !existingKeys.has(`${task.step}:${task.label}`))
    .map((task) => ({ ...task, project_id: projectId, source: 'system' }));
  if (missingTasks.length > 0) {
    const tasks = await db.from('project_tasks').insert(missingTasks);
    if (tasks.error) return new Error(tasks.error.message);
  }

  return true;
}

async function upsertStageNote(projectId: string, step: ProjectStepId, body: string): Promise<ProjectStageNote | Error> {
  const update = await db
    .from('project_stage_notes')
    .upsert({
      project_id: projectId,
      step,
      body,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'project_id,step' })
    .select('*')
    .single();
  if (update.error || !update.data) return new Error(update.error?.message ?? 'stage note update failed');
  return normalizeProjectStageNote(update.data);
}

async function markPackageStale(projectId: string): Promise<void> {
  const now = new Date().toISOString();
  await db
    .from('projects')
    .update({ package_status: 'stale', updated_at: now })
    .eq('id', projectId)
    .neq('package_status', 'not_started');
  await db
    .from('project_packages')
    .update({ status: 'stale', updated_at: now })
    .eq('project_id', projectId)
    .neq('status', 'stale');
}

function normalizeProjectSummary(
  row: Record<string, unknown>,
  linkedBriefCount: number,
  taskCounts: { total: number; completed: number },
  scenarioCounts: { total: number; shortlisted: number },
): ProjectSummary {
  const project = normalizeProject(row);
  return {
    ...project,
    linked_brief_count: linkedBriefCount,
    task_count: taskCounts.total,
    completed_task_count: taskCounts.completed,
    scenario_count: scenarioCounts.total,
    shortlisted_scenario_count: scenarioCounts.shortlisted,
  };
}

function normalizeProject(row: Record<string, unknown>): Project {
  const activeStep = isProjectStep(row.active_step) ? row.active_step : 'research';
  const status = isProjectStatus(row.status) ? row.status : (row.archived_at ? 'archived' : 'active');
  return {
    id: String(row.id),
    user_id: stringOrNull(row.user_id),
    title: String(row.title ?? 'Untitled project'),
    question: String(row.question ?? row.title ?? 'Untitled project'),
    objective: String(row.objective ?? ''),
    workflow_type: isProjectWorkflowType(row.workflow_type) ? row.workflow_type : 'inbound_trade',
    subject_team_id: String(row.subject_team_id ?? 'GSW').toUpperCase(),
    counterparty_team_id: stringOrNull(row.counterparty_team_id)?.toUpperCase() ?? null,
    inbound_player_id: numberOrNull(row.inbound_player_id),
    trigger_summary: String(row.trigger_summary ?? ''),
    counterparty_context: normalizeCounterpartyContext(row.counterparty_context),
    active_step: activeStep,
    status,
    package_status: isProjectPackageStatus(row.package_status) ? row.package_status : 'not_started',
    source_brief_id: stringOrNull(row.source_brief_id),
    archived_at: stringOrNull(row.archived_at),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function normalizeProjectSourceBrief(value: unknown): ProjectSourceBrief {
  const record = isRecord(value) ? value : {};
  const projectBrief = normalizeProjectBrief(record);
  const brief = isRecord(record.brief) ? record.brief : {};
  return {
    ...projectBrief,
    brief: brief as unknown as Brief,
  };
}

function normalizeProjectBrief(row: Record<string, unknown>): ProjectBrief {
  const step = isProjectStep(row.step) ? row.step : 'research';
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    brief_id: String(row.brief_id),
    step,
    sort_order: numberOrDefault(row.sort_order, 0),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function normalizeProjectStageNote(row: Record<string, unknown>): ProjectStageNote {
  const step = isProjectStep(row.step) ? row.step : 'research';
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    step,
    body: String(row.body ?? ''),
    ai_draft: String(row.ai_draft ?? ''),
    citation_refs: Array.isArray(row.citation_refs)
      ? row.citation_refs.filter((value): value is number => typeof value === 'number')
      : [],
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function normalizeProjectTask(row: Record<string, unknown>): ProjectTask {
  const step = isProjectStep(row.step) ? row.step : 'research';
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    step,
    label: String(row.label ?? ''),
    required: Boolean(row.required),
    completed_at: stringOrNull(row.completed_at),
    sort_order: numberOrDefault(row.sort_order, 0),
    source: isProjectTaskSource(row.source) ? row.source : 'user',
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function normalizeProjectPackage(row: Record<string, unknown>): ProjectPackage {
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    status: isStoredPackageStatus(row.status) ? row.status : 'drafted',
    markdown: String(row.markdown ?? ''),
    sections: Array.isArray(row.sections) ? row.sections as ProjectPackageSection[] : [],
    source_refs: Array.isArray(row.source_refs) ? row.source_refs as ProjectPackageSourceRef[] : [],
    generated_at: stringOrNull(row.generated_at),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function normalizeTradeScenario(row: Record<string, unknown>): ProjectTradeScenarioDetail {
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    title: String(row.title ?? 'Untitled scenario'),
    summary: String(row.summary ?? ''),
    status: isScenarioStatus(row.status) ? row.status : 'active',
    rank: numberOrDefault(row.rank, 0),
    participating_teams: Array.isArray(row.participating_teams)
      ? row.participating_teams.filter((value): value is string => typeof value === 'string')
      : [],
    notes: String(row.notes ?? ''),
    basketball_fit: String(row.basketball_fit ?? ''),
    risks: String(row.risks ?? ''),
    phone_framing: String(row.phone_framing ?? ''),
    walk_away: String(row.walk_away ?? ''),
    counter_range: String(row.counter_range ?? ''),
    validation_summary: String(row.validation_summary ?? ''),
    players: [],
    assets: [],
    validations: [],
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function normalizeScenarioPlayer(row: Record<string, unknown>): ProjectScenarioPlayer {
  return {
    id: String(row.id),
    scenario_id: String(row.scenario_id),
    team_id: String(row.team_id ?? '').toUpperCase(),
    nba_player_id: numberOrNull(row.nba_player_id),
    player_name: String(row.player_name ?? ''),
    direction: isScenarioDirection(row.direction) ? row.direction : 'outgoing',
    salary_amount: numberOrNull(row.salary_amount),
    salary_source_status: isSalarySourceStatus(row.salary_source_status) ? row.salary_source_status : 'source-needed',
    manual_override: Boolean(row.manual_override),
    stats_snapshot: isRecord(row.stats_snapshot) ? row.stats_snapshot as unknown as ProjectScenarioPlayer['stats_snapshot'] : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function normalizeScenarioAsset(row: Record<string, unknown>): ProjectScenarioAsset {
  return {
    id: String(row.id),
    scenario_id: String(row.scenario_id),
    asset_type: isScenarioAssetType(row.asset_type) ? row.asset_type : 'other',
    label: String(row.label ?? ''),
    direction: isScenarioDirection(row.direction) ? row.direction : 'outgoing',
    team_id: stringOrNull(row.team_id)?.toUpperCase() ?? null,
    amount: numberOrNull(row.amount),
    notes: String(row.notes ?? ''),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function normalizeScenarioValidation(row: Record<string, unknown>): ProjectScenarioValidation {
  return {
    id: String(row.id),
    scenario_id: String(row.scenario_id),
    kind: isValidationKind(row.kind) ? row.kind : 'app_advisory',
    status: isValidationStatus(row.status) ? row.status : 'not_run',
    summary: String(row.summary ?? ''),
    details: isRecord(row.details) ? row.details : {},
    source_refs: Array.isArray(row.source_refs) ? row.source_refs as ProjectPackageSourceRef[] : [],
    validated_at: stringOrNull(row.validated_at),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function normalizeArtifact(row: Record<string, unknown>): ProjectArtifact {
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    scenario_id: stringOrNull(row.scenario_id),
    artifact_type: isArtifactType(row.artifact_type) ? row.artifact_type : 'other',
    title: String(row.title ?? ''),
    url: stringOrNull(row.url),
    notes: String(row.notes ?? ''),
    metadata: isRecord(row.metadata) ? row.metadata : {},
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function normalizeCounterpartyContext(value: unknown): ProjectCounterpartyContext {
  const record = isRecord(value) ? value : {};
  return {
    apron_level: String(record.apron_level ?? DEFAULT_COUNTERPARTY_CONTEXT.apron_level),
    cap_room: String(record.cap_room ?? DEFAULT_COUNTERPARTY_CONTEXT.cap_room),
    aims: String(record.aims ?? DEFAULT_COUNTERPARTY_CONTEXT.aims),
    pressure: String(record.pressure ?? DEFAULT_COUNTERPARTY_CONTEXT.pressure),
    job_security: String(record.job_security ?? DEFAULT_COUNTERPARTY_CONTEXT.job_security),
    known_targets: String(record.known_targets ?? DEFAULT_COUNTERPARTY_CONTEXT.known_targets),
    signals: String(record.signals ?? DEFAULT_COUNTERPARTY_CONTEXT.signals),
  };
}

function stepLabel(step: ProjectStepId): string {
  return PROJECT_STEP_DEFINITIONS.find((definition) => definition.id === step)?.label ?? step;
}

function isProjectStatus(value: unknown): value is ProjectStatus {
  return value === 'active' || value === 'packaged' || value === 'archived';
}

function isProjectWorkflowType(value: unknown): value is ProjectWorkflowType {
  return value === 'inbound_trade' || value === 'decision';
}

function isProjectPackageStatus(value: unknown): value is Project['package_status'] {
  return value === 'not_started' || value === 'drafted' || value === 'stale' || value === 'ready';
}

function isStoredPackageStatus(value: unknown): value is ProjectPackage['status'] {
  return value === 'drafted' || value === 'stale' || value === 'ready';
}

function isProjectTaskSource(value: unknown): value is ProjectTaskSource {
  return value === 'system' || value === 'ai' || value === 'user';
}

function isScenarioStatus(value: unknown): value is ProjectTradeScenarioStatus {
  return value === 'active'
    || value === 'shortlisted'
    || value === 'presented'
    || value === 'terms_agreed'
    || value === 'archived'
    || value === 'collapsed';
}

function isScenarioDirection(value: unknown): value is ProjectScenarioPlayerDirection {
  return value === 'outgoing' || value === 'incoming';
}

function isScenarioAssetType(value: unknown): value is ProjectScenarioAssetType {
  return value === 'pick'
    || value === 'cash'
    || value === 'rights'
    || value === 'exception'
    || value === 'other';
}

function isValidationKind(value: unknown): value is ProjectScenarioValidationKind {
  return value === 'app_advisory'
    || value === 'trade_builder'
    || value === 'internal_cap_sheet'
    || value === 'cba';
}

function isValidationStatus(value: unknown): value is ProjectScenarioValidationStatus {
  return value === 'not_run'
    || value === 'pass'
    || value === 'warning'
    || value === 'fail'
    || value === 'source_needed'
    || value === 'manual_pending';
}

function isArtifactType(value: unknown): value is ProjectArtifactType {
  return value === 'trade_builder_report'
    || value === 'internal_cap_sheet'
    || value === 'source_brief'
    || value === 'scout_intel'
    || value === 'performance_intel'
    || value === 'slack_note'
    || value === 'email_note'
    || value === 'other';
}

function isSalarySourceStatus(value: unknown): value is ProjectSalarySourceStatus {
  return value === 'captured'
    || value === 'source-needed'
    || value === 'not-available'
    || value === 'not-applicable'
    || value === 'manual';
}

function numberOrDefault(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function nullableNumber(value: unknown): number | null {
  return numberOrNull(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
