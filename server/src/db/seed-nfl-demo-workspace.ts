import { db } from './client.js';
import {
  assertNygSeedOwnership,
  NYG_DEMO_WORKSPACE_KEY,
  NYG_HERO_PROJECT,
  NYG_HERO_SEED_KEY,
  NYG_HERO_SESSION_ID,
  NYG_STAGE_NOTES,
  NYG_TASKS,
} from '../nfl_workspace/seed.js';

export async function seedNygDemoWorkspace(now = new Date().toISOString()): Promise<void> {
  assertNygSeedOwnership();
  await checked(db.from('sessions').upsert({
    id: NYG_HERO_SESSION_ID,
    user_id: null,
    label: NYG_HERO_PROJECT.title,
    workspace_key: NYG_DEMO_WORKSPACE_KEY,
    seed_key: NYG_HERO_SEED_KEY,
    archived_at: null,
    updated_at: now,
  }, { onConflict: 'id' }), 'upsert Giants demo session');

  await checked(db.from('projects').upsert({
    ...NYG_HERO_PROJECT,
    user_id: null,
    workspace_key: NYG_DEMO_WORKSPACE_KEY,
    seed_key: NYG_HERO_SEED_KEY,
    archived_at: null,
    updated_at: now,
  }, { onConflict: 'id' }), 'upsert Giants demo project');

  await checked(db.from('project_stage_notes').upsert(NYG_STAGE_NOTES.map((note) => ({
    ...note,
    project_id: NYG_HERO_PROJECT.id,
    citation_refs: [],
    updated_at: now,
  })), { onConflict: 'id' }), 'upsert Giants demo stage notes');

  await checked(db.from('project_tasks').upsert(NYG_TASKS.map((task) => ({
    id: task.id,
    project_id: NYG_HERO_PROJECT.id,
    step: task.step,
    label: task.label,
    required: task.required,
    completed_at: task.completed ? now : null,
    sort_order: task.sort_order,
    source: 'system',
    updated_at: now,
  })), { onConflict: 'id' }), 'upsert Giants demo tasks');
}

async function checked(query: PromiseLike<{ error: { message: string } | null }>, label: string): Promise<void> {
  const result = await query;
  if (result.error) throw new Error(`${label} failed: ${result.error.message}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedNygDemoWorkspace()
    .then(() => console.log('Seeded owned nyg-demo workspace without touching legacy or user-created rows.'))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
