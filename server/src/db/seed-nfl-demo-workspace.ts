import { db } from './client.js';
import {
  assertNygSeedOwnership,
  NYG_DEMO_WORKSPACE_KEY,
  NYG_HERO_PROJECT,
  NYG_HERO_SEED_KEY,
  NYG_HERO_SESSION_ID,
  NYG_STAGE_NOTES,
  NYG_TASKS,
  RETIRED_NYG_ANALYSIS_FIXTURE_SEED_KEY,
  RETIRED_NYG_ANALYSIS_FIXTURE_SESSION_ID,
} from '../nfl_workspace/seed.js';

export async function seedNygDemoWorkspace(now = new Date().toISOString()): Promise<void> {
  assertNygSeedOwnership();
  await checked(db.from('sessions').upsert({
    id: NYG_HERO_SESSION_ID,
    user_id: null,
    label: NYG_HERO_PROJECT.title,
    workspace_key: NYG_DEMO_WORKSPACE_KEY,
    seed_key: NYG_HERO_SEED_KEY,
    // The cap model remains available from Analysis without occupying the
    // live question channel rail.
    archived_at: now,
    updated_at: now,
  }, { onConflict: 'id' }), 'upsert Giants demo session');

  // Retire the exact, formerly owned precomputed Analysis fixture without
  // cascading through any user replies that may have been added to it.
  await checked(
    db.from('sessions').update({ archived_at: now, updated_at: now })
      .eq('id', RETIRED_NYG_ANALYSIS_FIXTURE_SESSION_ID)
      .eq('workspace_key', NYG_DEMO_WORKSPACE_KEY)
      .eq('seed_key', RETIRED_NYG_ANALYSIS_FIXTURE_SEED_KEY),
    'remove retired precomputed Analysis fixture',
  );

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
