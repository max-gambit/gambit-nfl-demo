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
  RETIRED_NYG_ANALYSIS_FIXTURE_SEED_KEY,
} from '../../src/nfl_workspace/seed.js';

test('Giants demo seed is scoped, stable, and covers the five football-operations stages', () => {
  assert.doesNotThrow(assertNygSeedOwnership);
  assert.equal(NYG_DEMO_WORKSPACE_KEY, 'nyg-demo');
  assert.equal(NYG_HERO_SEED_KEY, 'nyg-cap-roster-2026');
  assert.equal(NYG_HERO_PROJECT.subject_team_id, 'NYG');
  assert.equal(NYG_HERO_PROJECT.workflow_type, 'decision');
  assert.equal(RETIRED_NYG_ANALYSIS_FIXTURE_SEED_KEY, 'nyg-transaction-market-presenter');
  assert.equal('apron_level' in NYG_HERO_PROJECT.counterparty_context, false);
  assert.deepEqual(Object.values(NYG_STAGE_LABELS), ['Question', 'Evidence', 'Scenarios', 'Decision', 'Action Plan']);
  assert.equal(NYG_STAGE_NOTES.length, 5);
  assert.ok(NYG_TASKS.every((task) => task.id && task.label && task.step));
});

test('normal database seed is NFL-only and archives only the retired canned Analysis fixture', async () => {
  const source = await readFile(new URL('../../src/db/seed.ts', import.meta.url), 'utf8');
  const workspaceSource = await readFile(new URL('../../src/db/seed-nfl-demo-workspace.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /clearGeneratedUserContent|loadNba|seedNba|seedCbaCorpus/);
  assert.match(source, /seedNflDemoData/);
  assert.match(source, /seedNflTransactionMarketData/);
  assert.match(source, /seedNygDemoWorkspace/);
  assert.match(workspaceSource, /RETIRED_NYG_ANALYSIS_FIXTURE_SESSION_ID/);
  assert.match(workspaceSource, /db\.from\('sessions'\)\.update\(\{ archived_at: now, updated_at: now \}\)/);
  assert.doesNotMatch(workspaceSource, /db\.from\('sessions'\)\.delete\(\)/);
  assert.doesNotMatch(workspaceSource, /analyzeNflTransactionMarket|buildDeterministicNflTransactionMarketFallback/);
  assert.doesNotMatch(workspaceSource, /Which position markets have grown or shrunk/);
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

test('workspace continuation carries its active session and decision question into Analysis', async () => {
  const serviceSource = await readFile(new URL('../../src/nfl_workspace/service.ts', import.meta.url), 'utf8');
  const appSource = await readFile(new URL('../../../src/nyg/NygApp.tsx', import.meta.url), 'utf8');
  assert.match(serviceSource, /session_id: sessionId/);
  assert.match(serviceSource, /\.is\('archived_at', null\)[\s\S]*\.in\('seed_key', seedKeys\)/);
  assert.match(appSource, /setActiveSession\(workspace\?\.session_id \?\? null\)/);
  assert.match(appSource, /setPendingAnalysisQuestion\(workspace\?\.question \?\? null\)/);
  assert.match(appSource, /fire\('v6d3cf:prefill-composer', \{ text: pendingAnalysisQuestion \}\)/);
  assert.match(appSource, /onClick=\{\(\) => onOpenAnalysis\(selected\)\}/);
});
