import { randomUUID } from 'node:crypto';
import type { NflWorkspaceStage, NflWorkspaceSummary, ProjectStepId } from '@shared/types';
import { db } from '../db/client.js';
import { NYG_DEMO_WORKSPACE_KEY, NYG_HERO_SEED_KEY } from './seed.js';

const STAGE_MAP: Record<ProjectStepId, NflWorkspaceStage> = {
  research: 'question',
  validate: 'evidence',
  feedback: 'scenarios',
  gm: 'decision',
  proposal: 'action_plan',
};

const STAGE_COPY: Record<ProjectStepId, string> = {
  research: 'Define the football decision, target, protected depth, timing, and unavailable team-only inputs.',
  validate: 'Attach current player and contract rows, exact rule locators, arithmetic checks, and source boundaries.',
  feedback: 'Compare deterministic branches, football consequences, replacement plans, and change-the-call triggers.',
  gm: 'Select the smallest supported branch that meets the target and record unresolved judgments.',
  proposal: 'Assign contract, personnel, medical, timing, and re-model actions.',
};

const TASKS: Array<{ step: ProjectStepId; label: string; required: boolean; sort_order: number }> = [
  { step: 'research', label: 'Confirm the target, timing, and protected depth.', required: true, sort_order: 0 },
  { step: 'research', label: 'Separate public facts, temporary assumptions, and unavailable team-only inputs.', required: true, sort_order: 1 },
  { step: 'validate', label: 'Reconcile each displayed dollar to its player contract row.', required: true, sort_order: 0 },
  { step: 'validate', label: 'Open material rules at exact official locators.', required: true, sort_order: 1 },
  { step: 'feedback', label: 'Review depth effects and replacement plans.', required: true, sort_order: 0 },
  { step: 'gm', label: 'Choose the smallest supported branch that clears the target.', required: true, sort_order: 0 },
  { step: 'proposal', label: 'Assign transaction, roster, and re-model owners.', required: true, sort_order: 0 },
];

const PROJECT_SELECT = 'id,title,question,objective,active_step,subject_team_id,seed_key,created_at,updated_at';

export async function listNygWorkspaces(): Promise<NflWorkspaceSummary[]> {
  const result = await db
    .from('projects')
    .select(PROJECT_SELECT)
    .eq('workspace_key', NYG_DEMO_WORKSPACE_KEY)
    .eq('subject_team_id', 'NYG')
    .is('archived_at', null)
    .order('updated_at', { ascending: false });
  if (result.error) throw new Error(`load NYG workspaces failed: ${result.error.message}`);
  return (result.data ?? []).map(workspaceSummary);
}

export async function createNygWorkspace(question: string, now = new Date().toISOString()): Promise<NflWorkspaceSummary> {
  const normalized = question.trim();
  if (!normalized) throw new Error('question required');
  if (normalized.length > 1000) throw new Error('question must be 1000 characters or fewer');

  const projectId = randomUUID();
  const sessionId = randomUUID();
  const seedKey = `user:${randomUUID()}`;
  const title = normalized.length <= 72 ? normalized : `${normalized.slice(0, 69).trimEnd()}…`;
  let projectCreated = false;
  let sessionCreated = false;
  try {
    const session = await db.from('sessions').insert({
      id: sessionId,
      user_id: null,
      label: title,
      workspace_key: NYG_DEMO_WORKSPACE_KEY,
      seed_key: seedKey,
      created_at: now,
      updated_at: now,
    });
    if (session.error) throw new Error(`create NYG session failed: ${session.error.message}`);
    sessionCreated = true;

    const project = await db.from('projects').insert({
      id: projectId,
      user_id: null,
      title,
      workspace_key: NYG_DEMO_WORKSPACE_KEY,
      seed_key: seedKey,
      question: normalized,
      objective: 'Move this football-operations question from evidence to scenarios, a decision, and an owned action plan.',
      workflow_type: 'decision',
      subject_team_id: 'NYG',
      counterparty_team_id: null,
      inbound_player_id: null,
      trigger_summary: normalized,
      counterparty_context: {},
      active_step: 'research',
      status: 'active',
      package_status: 'not_started',
      source_brief_id: null,
      created_at: now,
      updated_at: now,
    }).select(PROJECT_SELECT).single();
    if (project.error || !project.data) throw new Error(`create NYG project failed: ${project.error?.message ?? 'no row returned'}`);
    projectCreated = true;

    const notes = await db.from('project_stage_notes').insert((Object.entries(STAGE_COPY) as Array<[ProjectStepId, string]>).map(([step, body]) => ({
      project_id: projectId,
      step,
      body,
      ai_draft: '',
      citation_refs: [],
      created_at: now,
      updated_at: now,
    })));
    if (notes.error) throw new Error(`create NYG stage notes failed: ${notes.error.message}`);

    const tasks = await db.from('project_tasks').insert(TASKS.map((task) => ({
      ...task,
      project_id: projectId,
      source: 'system',
      created_at: now,
      updated_at: now,
    })));
    if (tasks.error) throw new Error(`create NYG tasks failed: ${tasks.error.message}`);
    return workspaceSummary(project.data);
  } catch (error) {
    if (projectCreated) await db.from('projects').delete().eq('id', projectId);
    if (sessionCreated) await db.from('sessions').delete().eq('id', sessionId);
    throw error;
  }
}

function workspaceSummary(row: Record<string, unknown>): NflWorkspaceSummary {
  const step = isStep(row.active_step) ? row.active_step : 'research';
  return {
    id: String(row.id),
    title: String(row.title),
    question: String(row.question),
    objective: String(row.objective ?? ''),
    stage: STAGE_MAP[step],
    team_id: String(row.subject_team_id ?? 'NYG'),
    seeded: row.seed_key === NYG_HERO_SEED_KEY,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function isStep(value: unknown): value is ProjectStepId {
  return typeof value === 'string' && value in STAGE_MAP;
}
