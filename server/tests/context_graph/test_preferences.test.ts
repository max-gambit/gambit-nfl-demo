import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildContextGraph } from '../../src/context_graph/build.js';
import { getContextGraphWarRoom } from '../../src/context_graph/war_room.js';
import {
  getEffectiveTeamContext,
  listTeamContextPreferences,
  patchTeamContextPreferences,
  resetTeamContextPreferences,
  type TeamPreferenceStoreOptions,
} from '../../src/context_graph/preferences.js';
import { createContextGraphRoutes } from '../../src/routes/context_graph.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

test('preferences load with no override file and expose source-derived fields', async () => {
  const options = await buildFixtureGraph();

  const response = await listTeamContextPreferences(options);
  const atl = response.teams.find((team) => team.team_id === 'ATL');

  assert.equal(response.metadata.overrides_updated_at, null);
  assert.equal(response.vocab.spending_posture.includes('moderate'), true);
  assert.equal(atl?.preferences.ownership.spending_posture, 'moderate');
  assert.equal(atl?.has_overrides, false);
});

test('preference patches are merged over source and written as JSON overrides', async () => {
  const options = await buildFixtureGraph();

  const updated = await patchTeamContextPreferences('ATL', {
    ownership: {
      spending_posture: 'conservative',
    },
    strategic_posture: {
      timeframe: 'retool',
    },
  }, options);

  assert.equal(updated.preferences.ownership.spending_posture, 'conservative');
  assert.equal(updated.preferences.strategic_posture.timeframe, 'retool');
  assert.equal(updated.source_preferences.ownership.spending_posture, 'moderate');
  assert.equal(updated.has_overrides, true);

  const rawOverrides = JSON.parse(await readFile(options.overridesFile!, 'utf8')) as {
    teams: Record<string, { preferences: Record<string, unknown> }>;
  };
  assert.deepEqual(rawOverrides.teams.ATL.preferences, {
    ownership: { spending_posture: 'conservative' },
    strategic_posture: { timeframe: 'retool' },
  });
});

test('preference patches reject invalid enum values and unknown fields', async () => {
  const options = await buildFixtureGraph();

  await assert.rejects(
    () => patchTeamContextPreferences('ATL', { ownership: { spending_posture: 'wildly_spending' } }, options),
    /spending_posture must be one of/,
  );
  await assert.rejects(
    () => patchTeamContextPreferences('ATL', { ownership: { non_editable: 'x' } } as never, options),
    /not an editable Intel preference field/,
  );
});

test('reset removes a team override and restores source preferences', async () => {
  const options = await buildFixtureGraph();
  await patchTeamContextPreferences('ATL', { ownership: { spending_posture: 'conservative' } }, options);

  const reset = await resetTeamContextPreferences('ATL', options);

  assert.equal(reset.preferences.ownership.spending_posture, 'moderate');
  assert.equal(reset.has_overrides, false);
});

test('effective team context includes overrides, metadata, summaries, and immutable source data', async () => {
  const options = await buildFixtureGraph();
  await patchTeamContextPreferences('BOS', { cultural_signals: { risk_tolerance: { value: 'moderate' } } }, options);

  const effective = await getEffectiveTeamContext('BOS', options);

  assert.equal(effective.preferences.cultural_signals.risk_tolerance.value, 'moderate');
  assert.equal(effective.source_preferences.cultural_signals.risk_tolerance.value, 'aggressive');
  assert.equal(effective.metadata.has_overrides, true);
  assert.equal(effective.roster_summary.roster_count, 1);
  assert.equal(effective.relationship_summary.trade_partners[0]?.team_id, 'ATL');

  effective.source_team.identity = {};
  const fresh = await getEffectiveTeamContext('BOS', options);
  assert.equal((fresh.source_team.identity as Record<string, unknown>).name, 'Boston Celtics');
});

test('context graph preference routes support get, patch, and reset', async () => {
  const options = await buildFixtureGraph();
  const routes = createContextGraphRoutes(options);

  const listed = await routes.request('/preferences');
  assert.equal(listed.status, 200);
  const listedBody = await listed.json() as { teams: { team_id: string }[] };
  assert.equal(listedBody.teams.length, 2);

  const patched = await routes.request('/preferences/ATL', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preferences: { ownership: { spending_posture: 'conservative' } } }),
  });
  assert.equal(patched.status, 200);
  const patchedBody = await patched.json() as { team: { preferences: { ownership: { spending_posture: string } } } };
  assert.equal(patchedBody.team.preferences.ownership.spending_posture, 'conservative');

  const rejected = await routes.request('/preferences/ATL', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preferences: { ownership: { spending_posture: 'high' } } }),
  });
  assert.equal(rejected.status, 400);

  const reset = await routes.request('/preferences/ATL/reset', { method: 'POST' });
  assert.equal(reset.status, 200);
  const resetBody = await reset.json() as { team: { has_overrides: boolean } };
  assert.equal(resetBody.team.has_overrides, false);
});

test('war-room read model returns subject, counterparties, map, and overrides', async () => {
  const options = await buildFixtureGraph();
  await patchTeamContextPreferences('ATL', { ownership: { spending_posture: 'conservative' } }, options);

  const warRoom = await getContextGraphWarRoom('ATL', options);

  assert.equal(warRoom.subject.team_id, 'ATL');
  assert.equal(warRoom.subject.has_overrides, true);
  assert.equal(warRoom.subject.preferences.ownership.spending_posture, 'conservative');
  assert.equal(warRoom.executive_summary.headline.length > 0, true);
  assert.equal(warRoom.executive_summary.top_calls[0]?.team_id, 'BOS');
  assert.equal(warRoom.executive_summary.confidence.has_overrides, true);
  assert.equal(warRoom.executive_summary.confidence.validation_status, 'pass');
  assert.equal(warRoom.executive_summary.decision_cards.length, 3);
  assert.equal(warRoom.executive_summary.caveats.some((caveat) => caveat.includes('Settings overrides')), true);
  assert.equal(warRoom.counterparties[0]?.team_id, 'BOS');
  assert.equal(warRoom.counterparties[0]?.tier, 'hot');
  assert.equal(warRoom.counterparties[0]?.relationship_types.includes('trade_partner'), true);
  assert.equal(warRoom.counterparties[0]?.dossier.call_priority, 'First-wave call');
  assert.equal(warRoom.roster_pressure.length > 0, true);
  assert.equal(warRoom.strategic_tensions.length > 0, true);
  assert.equal(warRoom.scenario_lenses.length, 3);
  assert.equal(warRoom.graph.nodes.some((node) => node.team_id === 'ATL' && node.kind === 'subject'), true);
  assert.equal(warRoom.graph.edges.some((edge) => edge.to_team_id === 'BOS'), true);
  assert.equal(warRoom.demo_prompts.length, 3);
});

test('war-room route returns controlled errors and does not mutate source artifacts', async () => {
  const options = await buildFixtureGraph();
  const before = await readFile(path.join(options.derivedDir, 'teams.json'), 'utf8');
  const routes = createContextGraphRoutes(options);

  const ok = await routes.request('/war-room/ATL');
  assert.equal(ok.status, 200);
  const body = await ok.json() as {
    subject: { team_id: string };
    executive_summary: { top_calls: unknown[] };
    counterparties: unknown[];
  };
  assert.equal(body.subject.team_id, 'ATL');
  assert.equal(body.executive_summary.top_calls.length > 0, true);
  assert.equal(body.counterparties.length > 0, true);

  const bad = await routes.request('/war-room/NOPE');
  assert.equal(bad.status, 400);

  const after = await readFile(path.join(options.derivedDir, 'teams.json'), 'utf8');
  assert.equal(after, before);
});

async function buildFixtureGraph(): Promise<Required<Pick<TeamPreferenceStoreOptions, 'derivedDir' | 'overridesFile'>>> {
  const teamsDir = await mkdtemp(path.join(tmpdir(), 'context-graph-pref-teams-'));
  const derivedDir = await mkdtemp(path.join(tmpdir(), 'context-graph-pref-derived-'));
  const overridesDir = await mkdtemp(path.join(tmpdir(), 'context-graph-pref-overrides-'));
  await copyFile(path.join(fixturesDir, 'minimal_team_a.yaml'), path.join(teamsDir, 'atl.yaml'));
  await copyFile(path.join(fixturesDir, 'minimal_team_b.yaml'), path.join(teamsDir, 'bos.yaml'));
  await buildContextGraph({ teamsDir, outputDir: derivedDir });
  return {
    derivedDir,
    overridesFile: path.join(overridesDir, 'team-preferences.local.json'),
  };
}
