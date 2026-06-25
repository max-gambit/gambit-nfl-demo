import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { TeamMemoryProfile } from '@shared/types';
import {
  contextGraphTraceFromLookupResult,
  contextGraphTracesToBriefSources,
  handleContextGraphToolUse,
} from '../../src/claude/context_graph.js';
import { buildContextGraph } from '../../src/context_graph/build.js';
import {
  buildTeamMemoryIntake,
  buildTeamMemoryOptions,
  getTeamMemoryProfile,
  normalizeTeamMemoryProfile,
  saveTeamMemoryProfile,
} from '../../src/context_graph/team_memory.js';
import { createContextGraphRoutes } from '../../src/routes/context_graph.js';
import type { TeamPreferenceStoreOptions } from '../../src/context_graph/preferences.js';
import { getContextGraphWarRoom } from '../../src/context_graph/war_room.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const NOW = new Date('2026-05-06T12:00:00.000Z');

test('team memory storage saves structured reviewed context without raw transcript text', async () => {
  const options = await buildFixtureGraph();
  const rawIntake = 'DO_NOT_STORE_FULL_TRANSCRIPT Anthony Gill is locker-room glue and a giver, but this exact sentence should not be persisted.';
  const intake = await buildTeamMemoryIntake('ATL', 'Atlanta Falcons', rawIntake, {
    ...options,
    now: () => NOW,
    extractor: async () => fixtureExtraction(),
  });

  assert.equal(intake.discarded_raw_input_chars, rawIntake.length);
  assert.equal(intake.profile.status, 'draft');
  assert.equal(intake.profile.cards.some((card) => card.title.includes('Anthony Gill')), true);
  assert.equal(intake.profile.cards.some((card) => card.kind === 'full_assessment_placeholder'), true);

  await saveTeamMemoryProfile('ATL', intake.profile, { ...options, now: () => NOW });
  const persisted = await getTeamMemoryProfile('ATL', options);
  assert.equal(persisted?.status, 'active');
  assert.equal(persisted?.player_signals[0]?.player_name, 'Anthony Gill');

  const rawFile = await readFile(options.teamMemoryFile, 'utf8');
  assert.equal(rawFile.includes('DO_NOT_STORE_FULL_TRANSCRIPT'), false);
  assert.equal(rawFile.includes('full raw transcript'), false);
});

test('team memory rejects unknown teams and normalizes edited profiles', async () => {
  const options = await buildFixtureGraph();
  await assert.rejects(() => getTeamMemoryProfile('NOPE', options), /Unknown Intel team_id NOPE/);

  const profile = normalizeTeamMemoryProfile('ARI', 'Arizona Cardinals', {
    summary: 'Private staff view of the roster.',
    cards: [{
      kind: 'coach_gut_hypothesis',
      title: 'Screen angle explains the gut',
      body: 'The room likes a pairing and wants numbers to test whether screen angle and roll depth explain it.',
      confidence: 'medium',
      evidence_snippet: 'Coach says the two go together.',
      player_names: ['Player A', 'Player Z'],
      tags: ['coach gut', 'pairing'],
      measurable_proxies: ['screen angle tags', 'roll depth', 'entry pass windows'],
    }],
  }, { now: () => NOW });

  const saved = await saveTeamMemoryProfile('ARI', { ...profile, summary: 'Edited summary.' }, { ...options, now: () => NOW });
  assert.equal(saved.profile.summary, 'Edited summary.');
  assert.equal(saved.profile.cards[0]?.source_type, 'private_intake');
});

test('team memory routes support get, intake, patch, and delete', async () => {
  const options = await buildFixtureGraph();
  const routes = createContextGraphRoutes({
    ...options,
    now: () => NOW,
    teamMemoryExtractor: async () => fixtureExtraction(),
  });

  const listed = await routes.request('/team-memory/ATL');
  assert.equal(listed.status, 200);
  assert.deepEqual(await listed.json(), { profile: null });

  const rejected = await routes.request('/team-memory/ATL/intake', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: 'too short' }),
  });
  assert.equal(rejected.status, 400);

  const intake = await routes.request('/team-memory/ATL/intake', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: 'This roster download is long enough to extract private team memory from it.' }),
  });
  assert.equal(intake.status, 200);
  const intakeBody = await intake.json() as { profile: TeamMemoryProfile };
  assert.equal(intakeBody.profile.status, 'draft');
  assert.equal(intakeBody.profile.cards.length > 1, true);

  const saved = await routes.request('/team-memory/ATL', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile: intakeBody.profile }),
  });
  assert.equal(saved.status, 200);
  const savedBody = await saved.json() as { profile: TeamMemoryProfile };
  assert.equal(savedBody.profile.status, 'active');

  const loaded = await routes.request('/team-memory/ATL');
  const loadedBody = await loaded.json() as { profile: TeamMemoryProfile };
  assert.equal(loadedBody.profile.cards[0]?.title, 'Anthony Gill is glue');

  const deleted = await routes.request('/team-memory/ATL', { method: 'DELETE' });
  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), { profile: null });
});

test('team memory option generation returns transient selectable hypotheses', async () => {
  const options = await buildFixtureGraph();
  const warRoom = await getContextGraphWarRoom('ATL', options);
  const response = await buildTeamMemoryOptions('ATL', warRoom, {
    stage: 'player',
    selections: [{
      id: 'player-anthony-gill',
      stage: 'player',
      label: 'Anthony Gill',
      detail: 'Final roster context where glue may matter more than public value.',
      source: 'user',
      player_names: ['Anthony Gill'],
      tags: ['glue'],
    }],
    traits: ['glue', 'leadership'],
    accepted_options: [],
    note: 'DO_NOT_PERSIST_OPTION_NOTE',
  }, {
    ...options,
    generator: async (request) => {
      assert.equal(request.teamId, 'ATL');
      assert.equal(request.stage, 'player');
      assert.equal(request.warRoom.subject.team_id, 'ATL');
      assert.deepEqual(request.traits, ['glue', 'leadership']);
      return fixtureOptions();
    },
  });

  assert.equal(response.options[0]?.title, 'Ask whether the 15th spot needs glue');
  assert.equal(response.options[0]?.measurable_proxies.includes('coach trust notes'), true);
  assert.equal(response.follow_up_questions.includes('Who would lose trust if this player is cut?'), true);

  await assert.rejects(() => readFile(options.teamMemoryFile, 'utf8'), /ENOENT/);
});

test('team memory option route validates requests and does not persist raw option context', async () => {
  const options = await buildFixtureGraph();
  const routes = createContextGraphRoutes({
    ...options,
    now: () => NOW,
    teamMemoryOptionsGenerator: async () => fixtureOptions(),
  });

  const generated = await routes.request('/team-memory/ATL/options', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      stage: 'room_belief',
      selections: [{
        id: 'belief-1',
        stage: 'room_belief',
        label: 'Coach likes the pairing',
        detail: 'The room thinks two players fit before the model explains why.',
        source: 'user',
        player_names: [],
        tags: ['coach gut'],
      }],
      traits: ['coach gut'],
      accepted_options: [],
      note: 'DO_NOT_STORE_OPTIONS_ROUTE_NOTE',
    }),
  });
  assert.equal(generated.status, 200);
  const generatedBody = await generated.json() as { options: Array<{ stage: string; caveat: string }> };
  assert.equal(generatedBody.options[0]?.stage, 'room_belief');
  assert.equal(generatedBody.options[0]?.caveat.includes('private'), true);

  const invalid = await routes.request('/team-memory/ATL/options', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stage: 'bad_stage', selections: [], traits: [], accepted_options: [] }),
  });
  assert.equal(invalid.status, 400);

  const extra = await routes.request('/team-memory/ATL/options', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stage: 'player', selections: [], traits: [], accepted_options: [], raw: 'nope' }),
  });
  assert.equal(extra.status, 400);

  const unknown = await routes.request('/team-memory/NOPE/options', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stage: 'player', selections: [], traits: [], accepted_options: [] }),
  });
  assert.equal(unknown.status, 400);

  await assert.rejects(() => readFile(options.teamMemoryFile, 'utf8'), /ENOENT/);
});

test('context graph AI adapter exposes private memory as separate brief source', async () => {
  const options = await buildFixtureGraph();
  const profile = normalizeTeamMemoryProfile('ARI', 'Arizona Cardinals', fixtureExtraction(), { now: () => NOW });
  await saveTeamMemoryProfile('ARI', profile, { ...options, now: () => NOW });

  const result = await handleContextGraphToolUse({ team_ids: ['ARI'] }, options);
  assert.equal(result.ok, true);
  assert.equal(result.teams[0]?.private_memory?.card_count, 3);
  assert.equal(result.teams[0]?.private_memory?.summary.includes('private soft context'), true);

  const trace = contextGraphTraceFromLookupResult('toolu_memory', result);
  const sources = contextGraphTracesToBriefSources([trace], 4);
  const privateSource = sources.find((source) => source.kind === 'PRIVATE_MEMORY');

  assert.equal(privateSource?.source, 'GAMBIT_TEAM_MEMORY');
  assert.equal(privateSource?.ref_index, 5);
  assert.equal(privateSource?.title.includes('Private prototype memory'), true);
});

async function buildFixtureGraph(): Promise<Required<Pick<TeamPreferenceStoreOptions, 'derivedDir' | 'overridesFile'>> & { teamMemoryFile: string }> {
  const teamsDir = await mkdtemp(path.join(tmpdir(), 'context-graph-memory-teams-'));
  const derivedDir = await mkdtemp(path.join(tmpdir(), 'context-graph-memory-derived-'));
  const overridesDir = await mkdtemp(path.join(tmpdir(), 'context-graph-memory-overrides-'));
  await copyFile(path.join(fixturesDir, 'minimal_team_a.yaml'), path.join(teamsDir, 'atl.yaml'));
  await copyFile(path.join(fixturesDir, 'minimal_team_b.yaml'), path.join(teamsDir, 'ari.yaml'));
  await buildContextGraph({ teamsDir, outputDir: derivedDir });
  return {
    derivedDir,
    overridesFile: path.join(overridesDir, 'team-preferences.local.json'),
    teamMemoryFile: path.join(overridesDir, 'team-memory.local.json'),
  };
}

function fixtureExtraction() {
  return {
    summary: 'The intake captured private soft context that public models would miss.',
    cards: [
      {
        kind: 'player_soft_context',
        title: 'Anthony Gill is glue',
        body: 'Anthony Gill has low on-court upside but is treated as a locker-room connector whose presence may be worth the final roster spot.',
        confidence: 'high',
        evidence_snippet: 'Best human being, glue that keeps the guys together.',
        player_names: ['Anthony Gill'],
        tags: ['glue', 'leadership', '15th spot'],
        measurable_proxies: ['teammate lineup stability', 'bench communication tags', 'coach trust notes'],
      },
      {
        kind: 'pairing_context',
        title: 'Better screener unlocks the guard',
        body: 'A guard may prefer the better screener and sealer because it creates an easier entry-pass window.',
        confidence: 'medium',
        evidence_snippet: 'A point guard might prefer the better screener and sealer.',
        player_names: ['Player A', 'Player Z'],
        tags: ['pairing', 'screening', 'entry pass'],
        measurable_proxies: ['screen assist location', 'roll depth', 'entry pass turnover rate'],
      },
      {
        kind: 'coach_gut_hypothesis',
        title: 'Translate the gut before testing it',
        body: 'When a coach says two players go together, Gambit should preserve the subjective read and propose measurable explanations.',
        confidence: 'medium',
        evidence_snippet: 'The gut is coming from someplace.',
        player_names: [],
        tags: ['coach gut', 'hypothesis'],
        measurable_proxies: ['film tags', 'lineup net rating', 'spacing maps'],
      },
    ],
    player_signals: [{
      player_name: 'Anthony Gill',
      role: 'Locker-room connector',
      soft_traits: ['glue', 'giver', 'trusted veteran'],
      context: 'Final roster spot decision where public player value misses internal chemistry.',
      confidence: 'high',
      evidence_snippet: 'Forever Wizard if his body holds up.',
      measurable_proxies: ['coach trust notes', 'teammate comments'],
    }],
    warnings: ['Treat as subjective private context.'],
  };
}

function fixtureOptions() {
  return {
    options: [{
      stage: 'room_belief',
      title: 'Ask whether the 15th spot needs glue',
      body: 'The room may value the final roster spot as a chemistry and trust slot before treating it as a pure upside bet.',
      confidence: 'medium',
      player_names: ['Anthony Gill'],
      tags: ['glue', 'leadership', 'coach gut'],
      measurable_proxies: ['coach trust notes', 'bench communication tags', 'lineup stability'],
      caveat: 'This is private subjective context and should be checked against public roster evidence.',
      follow_up_questions: ['Who would lose trust if this player is cut?'],
    }],
    follow_up_questions: ['Who would lose trust if this player is cut?', 'What would disprove the glue read?'],
    warnings: ['Generated options are not persisted until accepted and saved.'],
  };
}
