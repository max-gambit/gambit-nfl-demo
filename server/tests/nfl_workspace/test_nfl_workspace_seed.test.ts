import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  assertNygSeedOwnership,
  NYG_DEMO_WORKSPACE_KEY,
  NYG_HERO_PROJECT,
  NYG_HERO_SEED_KEY,
  NYG_STAGE_LABELS,
  NYG_STAGE_NOTES,
  NYG_TASKS,
} from '../../src/nfl_workspace/seed.js';

test('Giants demo seed is scoped, stable, and covers the five football-operations stages', () => {
  assert.doesNotThrow(assertNygSeedOwnership);
  assert.equal(NYG_DEMO_WORKSPACE_KEY, 'nyg-demo');
  assert.equal(NYG_HERO_SEED_KEY, 'nyg-cap-roster-2026');
  assert.equal(NYG_HERO_PROJECT.subject_team_id, 'NYG');
  assert.equal(NYG_HERO_PROJECT.workflow_type, 'decision');
  assert.equal('apron_level' in NYG_HERO_PROJECT.counterparty_context, false);
  assert.deepEqual(Object.values(NYG_STAGE_LABELS), ['Question', 'Evidence', 'Scenarios', 'Decision', 'Action Plan']);
  assert.equal(NYG_STAGE_NOTES.length, 5);
  assert.ok(NYG_TASKS.every((task) => task.id && task.label && task.step));
});

test('normal database seed is NFL-only, non-destructive, and includes the presenter fixture', async () => {
  const source = await readFile(new URL('../../src/db/seed.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /clearGeneratedUserContent|loadNba|seedNba|seedCbaCorpus/);
  assert.match(source, /seedNflDemoData/);
  assert.match(source, /seedNygDemoWorkspace/);
});

test('Giants seed content does not contain active basketball or NBA terminology', () => {
  const activeSeed = [
    NYG_HERO_PROJECT.title,
    NYG_HERO_PROJECT.question,
    NYG_HERO_PROJECT.objective,
    NYG_HERO_PROJECT.trigger_summary,
    ...Object.values(NYG_HERO_PROJECT.counterparty_context),
    ...NYG_STAGE_NOTES.flatMap((note) => [note.body, note.ai_draft]),
    ...NYG_TASKS.map((task) => task.label),
  ].join(' ').toLowerCase();
  for (const banned of ['nba', 'basketball', 'warriors', 'sixers', 'trade machine', 'apron']) {
    assert.equal(activeSeed.includes(banned), false, `active Giants seed contains banned term: ${banned}`);
  }
});
