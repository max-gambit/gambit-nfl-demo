import assert from 'node:assert/strict';
import { copyFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Brief } from '@shared/types';
import { buildContextGraph } from '../../src/context_graph/build.js';
import { patchTeamContextPreferences, type TeamPreferenceStoreOptions } from '../../src/context_graph/preferences.js';
import {
  buildContextGraphSystemBlock,
  contextGraphLookupTool,
  contextGraphTraceFromLookupResult,
  contextGraphTracesToBriefSources,
  contextGraphTracesToToolCalls,
  getEffectiveTeamContextForAI,
  handleContextGraphToolUse,
} from '../../src/claude/context_graph.js';
import { buildBriefContext, BRIEF_SYSTEM, CHAT_SYSTEM } from '../../src/claude/prompts.js';
import { submitBriefTool } from '../../src/claude/tools.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

test('context graph AI adapter exposes all NBA team ids and compact league index guidance', async () => {
  const options = await buildFixtureGraph();
  const inputSchema = contextGraphLookupTool.input_schema as {
    properties?: { team_ids?: { items?: { enum?: string[] } } };
  };
  const teamIdsSchema = inputSchema.properties?.team_ids as {
    items?: { enum?: string[] };
  };

  assert.equal(contextGraphLookupTool.name, 'lookup_context_graph_teams');
  assert.equal(teamIdsSchema.items?.enum?.length, 30);
  assert.equal(teamIdsSchema.items?.enum?.includes('GSW'), true);

  const systemBlock = await buildContextGraphSystemBlock(options);
  assert.match(systemBlock, /NBA Intel is available for all 30 teams/);
  assert.match(systemBlock, /lookup_context_graph_teams/);
  assert.match(systemBlock, /ATL: Atlanta Hawks/);
  assert.match(systemBlock, /BOS: Boston Celtics/);
});

test('context graph lookup returns compact effective context with overrides applied', async () => {
  const options = await buildFixtureGraph();
  await patchTeamContextPreferences('ATL', {
    ownership: {
      spending_posture: 'conservative',
    },
  }, options);

  const result = await handleContextGraphToolUse({ team_ids: ['atl'] }, options);

  assert.equal(result.ok, true);
  assert.equal(result.teams.length, 1);
  assert.equal(result.teams[0].team_id, 'ATL');
  assert.equal(result.teams[0].preferences.ownership.spending_posture, 'conservative');
  assert.equal(result.teams[0].metadata.has_overrides, true);
  assert.equal(result.teams[0].roster_summary.roster_count, 1);
  assert.equal('source_team' in result.teams[0], false);
});

test('context graph traces preserve validation, freshness, and override metadata', async () => {
  const options = await buildFixtureGraph();
  await patchTeamContextPreferences('ATL', { ownership: { spending_posture: 'conservative' } }, options);

  const result = await handleContextGraphToolUse({ team_ids: ['ATL'] }, options);
  const trace = contextGraphTraceFromLookupResult('toolu_trace', result);

  assert.equal(trace.tool_use_id, 'toolu_trace');
  assert.equal(trace.teams[0].team_id, 'ATL');
  assert.equal(trace.teams[0].has_overrides, true);
  assert.equal(trace.teams[0].validation_status, 'pass');
  assert.equal(trace.teams[0].source_as_of_date, '2026-05-02');
});

test('context graph traces become persisted tool calls and brief source rows', async () => {
  const options = await buildFixtureGraph();
  const result = await handleContextGraphToolUse({ team_ids: ['BOS'] }, options);
  const trace = contextGraphTraceFromLookupResult('toolu_bos', result);

  const toolCalls = contextGraphTracesToToolCalls([trace]);
  assert.equal(toolCalls[0].name, 'lookup_context_graph_teams');
  assert.equal(toolCalls[0].context_graph_trace?.teams[0].team_id, 'BOS');

  const sources = contextGraphTracesToBriefSources([trace], 6);
  assert.equal(sources[0].ref_index, 6);
  assert.equal(sources[0].kind, 'CONTEXT_GRAPH');
  assert.equal(sources[0].source, 'GAMBIT_CONTEXT_GRAPH');
  assert.match(sources[0].title, /BOS/);
  assert.deepEqual((sources[0].data as { rows: { k: string; v: string }[] }).rows[0], {
    k: 'Team',
    v: 'BOS · Boston Celtics',
  });
});

test('context graph brief source rows preserve lookup errors', async () => {
  const options = await buildFixtureGraph();
  const result = await handleContextGraphToolUse({ team_ids: ['ATL', 'NOPE'] }, options);
  const trace = contextGraphTraceFromLookupResult('toolu_mixed', result);

  const sources = contextGraphTracesToBriefSources([trace], 9);
  assert.equal(sources.length, 2);
  assert.equal(sources[0].title, 'Intel · ATL · Atlanta Hawks');
  assert.equal(sources[1].title, 'Intel · lookup errors');
  assert.deepEqual((sources[1].data as { rows: { k: string; v: string }[] }).rows[0], {
    k: 'NOPE',
    v: 'unknown_team_id',
  });
});

test('context graph trace helpers emit no artifacts when no lookup occurred', () => {
  assert.deepEqual(contextGraphTracesToToolCalls([]), []);
  assert.deepEqual(contextGraphTracesToBriefSources([], 1), []);
});

test('context graph lookup returns controlled errors for invalid or missing team ids', async () => {
  const options = await buildFixtureGraph();

  const invalid = await handleContextGraphToolUse({ team_ids: ['NOPE'] }, options);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.errors[0]?.team_id, 'NOPE');
  assert.equal(invalid.errors[0]?.error, 'unknown_team_id');

  const missing = await handleContextGraphToolUse({}, options);
  assert.equal(missing.ok, false);
  assert.match(missing.errors[0]?.error ?? '', /non-empty array/);
});

test('AI-facing context does not mutate derived source artifacts', async () => {
  const options = await buildFixtureGraph();
  const first = await getEffectiveTeamContextForAI('BOS', options);
  first.preferences.ownership.spending_posture = 'conservative';

  const fresh = await getEffectiveTeamContextForAI('BOS', options);
  assert.equal(fresh.preferences.ownership.spending_posture, 'aggressive_spender');
});

test('prompts reference context graph tooling and no longer include mocked Warriors cap snapshot', () => {
  assert.match(BRIEF_SYSTEM, /Intel lookup tool/);
  assert.match(CHAT_SYSTEM, /Intel lookup tool/);
  assert.match(BRIEF_SYSTEM, /next_questions/);
  assert.match(BRIEF_SYSTEM, /binary succession-plan questions/);
  assert.match(BRIEF_SYSTEM, /thought-partner document/);
  assert.match(BRIEF_SYSTEM, /working thesis/);
  assert.match(BRIEF_SYSTEM, /amplifying the front office's expert judgment/);
  assert.match(CHAT_SYSTEM, /current lean or key tradeoff/);
  assert.doesNotMatch(BRIEF_SYSTEM, /one-recommendation document/);
  assert.doesNotMatch(BRIEF_SYSTEM, /Pick the path you actually believe is best/);

  const context = buildBriefContext({ ...mockBrief(), thesis: 'Pressure-test the current lead path.' }, [], []);
  assert.match(context, /Working thesis: Pressure-test the current lead path\./);
  assert.doesNotMatch(context, /Recommendation: Pressure-test/);
  assert.doesNotMatch(context, /TEAM CAP SNAPSHOT/);
  assert.doesNotMatch(context, /\$187\.4M/);
  assert.doesNotMatch(BRIEF_SYSTEM, /Golden State Warriors\. Current payroll/);
});

test('submit_brief schema includes staff follow-up questions grouped by audience', () => {
  const schema = submitBriefTool.input_schema as {
    required?: string[];
    properties?: Record<string, { description?: string; properties?: Record<string, unknown>; items?: unknown }>;
  };
  assert.ok(schema.properties?.next_questions);
  assert.ok(schema.properties?.presentation);
  assert.equal(Array.isArray((schema.properties.next_questions.items as { required?: string[] }).required), true);
  assert.equal(schema.required?.includes('options'), true);
  assert.match(schema.properties?.thesis?.description ?? '', /working thesis\/current lean/);
  assert.match(schema.properties?.options?.description ?? '', /current lead path/);
  assert.match(schema.properties?.options?.description ?? '', /Strategic options table/);
  assert.doesNotMatch(schema.properties?.options?.description ?? '', /Optional for presentation-first templates/);
  assert.doesNotMatch(schema.properties?.options?.description ?? '', /recommended path/);
});

async function buildFixtureGraph(): Promise<Required<Pick<TeamPreferenceStoreOptions, 'derivedDir' | 'overridesFile'>>> {
  const teamsDir = await mkdtemp(path.join(tmpdir(), 'context-graph-ai-teams-'));
  const derivedDir = await mkdtemp(path.join(tmpdir(), 'context-graph-ai-derived-'));
  const overridesDir = await mkdtemp(path.join(tmpdir(), 'context-graph-ai-overrides-'));
  await copyFile(path.join(fixturesDir, 'minimal_team_a.yaml'), path.join(teamsDir, 'atl.yaml'));
  await copyFile(path.join(fixturesDir, 'minimal_team_b.yaml'), path.join(teamsDir, 'bos.yaml'));
  await buildContextGraph({ teamsDir, outputDir: derivedDir });
  return {
    derivedDir,
    overridesFile: path.join(overridesDir, 'team-preferences.local.json'),
  };
}

function mockBrief(): Brief {
  return {
    id: 'brief-1',
    session_id: 'session-1',
    mode: 'brief',
    question: 'What should the front office do?',
    thesis: null,
    body: null,
    status: 'generating',
    progress: null,
    error: null,
    duration_ms: null,
    created_at: '2026-05-03T00:00:00.000Z',
    updated_at: '2026-05-03T00:00:00.000Z',
  };
}
