import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { ContextGraphOnboardingViewModel } from '@shared/types';
import {
  deriveOnboardingViewModel,
  generatePriorityOptions,
} from '../../src/context_graph/onboarding.js';
import { buildContextGraph } from '../../src/context_graph/build.js';
import {
  getEffectiveTeamContext,
  getTeamContextPreferences,
  type TeamPreferenceStoreOptions,
} from '../../src/context_graph/preferences.js';
import { createContextGraphRoutes } from '../../src/routes/context_graph.js';
import { handleContextGraphToolUse } from '../../src/claude/context_graph.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const NOW = new Date('2026-05-07T12:00:00.000Z');

test('onboarding derives role defaults, deterministic priorities, and required section status', async () => {
  const options = await buildWizardsFixtureGraph();
  const team = await getEffectiveTeamContext('WAS', options);
  const view = deriveOnboardingViewModel(team);

  assert.equal(view.profile.status, 'not_started');
  assert.equal(view.profile.team_snapshot.cap_posture, 'cap_room');
  assert.equal(view.inferred_cap_context.current_status, 'cap_room');
  assert.equal(view.defaults.recommendation_style, 'adaptive');
  assert.equal(view.sections.find((section) => section.id === 'identity_role')?.complete, false);
  assert.equal(view.generated_priority_options.some((option) => option.id === 'wizards-acceleration-trigger'), true);

  const profile = {
    ...view.profile,
    identity: { ...view.profile.identity, role: 'capologist', decision_authority: 'provide_input' },
    team_snapshot: {
      ...view.profile.team_snapshot,
      lifecycle: 'rebuilding',
      secondary_lifecycles: ['playoff_hopeful'],
      cornerstones: ['Alex Sarr'],
      active_scenarios: ['apron_management', 'trade_deadline_planning', 'rookie_scale_extension'],
      rookie_scale_extension_players: 'Bilal Coulibaly',
    },
  };
  const priorities = generatePriorityOptions(profile);
  assert.equal(priorities.some((option) => option.id === 'apron-exposure-plan' && /tax \/ apron/i.test(option.label)), true);
  assert.equal(priorities.some((option) => option.id === 'deadline-call-lanes'), true);
  assert.equal(priorities.some((option) => option.id === 'rookie-scale-extension-line' && option.label.includes('Bilal Coulibaly')), true);
  assert.equal(priorities.some((option) => option.id === 'rotation-upgrade-without-apron-damage'), true);
});

test('onboarding routes save partial graph context, complete, reset, and reject unsupported teams', async () => {
  const options = await buildWizardsFixtureGraph();
  const routes = createContextGraphRoutes({ ...options, now: () => NOW });

  const empty = await routes.request('/onboarding/WAS');
  assert.equal(empty.status, 200);
  const emptyBody = await empty.json() as { onboarding: ContextGraphOnboardingViewModel };
  assert.equal(emptyBody.onboarding.profile.team_id, 'WAS');
  assert.equal(emptyBody.onboarding.profile.status, 'not_started');

  const rejectedComplete = await routes.request('/onboarding/WAS/complete', { method: 'POST' });
  assert.equal(rejectedComplete.status, 400);

  const patch = await routes.request('/onboarding/WAS', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      profile: {
        identity: {
          role: 'president',
          years_in_role: '3_7',
          decision_authority: 'sign_off',
        },
        team_snapshot: {
          lifecycle: 'rebuilding',
          secondary_lifecycles: ['playoff_hopeful'],
          cornerstones: ['Alex Sarr', 'Bilal Coulibaly'],
          active_scenarios: ['apron_management', 'rookie_scale_extension'],
          rookie_scale_extension_players: 'Bilal Coulibaly',
        },
        strategic_priorities: {
          ninety_day_decision: 'Decide whether the young core has earned an acceleration trigger.',
          ranked_priorities: ['wizards-acceleration-trigger', 'apron-exposure-plan'],
          decision_types: ['roster_depth_chart', 'trade_evaluation'],
        },
        working_style: {
          recommendation_style: 'single_best_answer',
          claim_requirements: ['source_citation', 'confidence_level', 'counter_evidence'],
          risk_posture: 'balanced',
          cadence: 'daily_morning',
          briefing_time: '8_am',
          briefing_timezone: 'ET',
          channels: ['email', 'text_imessage', 'web_app'],
        },
        data_trust: {
          off_limits: ['former_roster_returns'],
          off_limits_people: 'Kyle Kuzma, Jordan Poole',
          off_limits_topics: 'Do not assume tax / apron appetite without evidence.',
        },
      },
    }),
  });
  assert.equal(patch.status, 200);
  const patchBody = await patch.json() as { onboarding: ContextGraphOnboardingViewModel };
  assert.equal(patchBody.onboarding.profile.status, 'in_progress');
  assert.deepEqual(patchBody.onboarding.profile.strategic_priorities.ranked_priorities, [
    'wizards-acceleration-trigger',
    'apron-exposure-plan',
  ]);
  assert.equal(patchBody.onboarding.can_complete, true);

  const teamAfterPatch = await getTeamContextPreferences('WAS', options);
  assert.equal(teamAfterPatch.preferences.onboarding_profile.team_snapshot.cornerstones[0], 'Alex Sarr');
  assert.deepEqual(teamAfterPatch.preferences.onboarding_profile.team_snapshot.secondary_lifecycles, ['playoff_hopeful']);
  assert.equal(teamAfterPatch.preferences.onboarding_profile.team_snapshot.rookie_scale_extension_players, 'Bilal Coulibaly');
  assert.equal(teamAfterPatch.preferences.onboarding_profile.data_trust.off_limits_people, 'Kyle Kuzma, Jordan Poole');
  assert.equal(teamAfterPatch.preferences.onboarding_profile.team_snapshot.cap_posture, 'cap_room');
  assert.equal(teamAfterPatch.preferences.strategic_posture.timeframe, 'rebuild');
  assert.equal(teamAfterPatch.preferences.strategic_posture.constraints.some((constraint) => constraint.reason_code === 'onboarding_cap_posture'), false);
  assert.equal(teamAfterPatch.preferences.near_term_priorities.some((priority) => priority.detail.includes('Onboarding capture:')), true);

  const complete = await routes.request('/onboarding/WAS/complete', { method: 'POST' });
  assert.equal(complete.status, 200);
  const completeBody = await complete.json() as { onboarding: ContextGraphOnboardingViewModel };
  assert.equal(completeBody.onboarding.profile.status, 'completed');
  assert.equal(completeBody.onboarding.profile.completed_at, NOW.toISOString());

  const aiResult = await handleContextGraphToolUse({ team_ids: ['WAS'] }, options);
  assert.equal(aiResult.ok, true);
  assert.equal(aiResult.teams[0]?.preferences.onboarding_profile.status, 'completed');
  assert.equal(aiResult.teams[0]?.preferences.onboarding_profile.working_style.recommendation_style, 'single_best_answer');

  const reset = await routes.request('/onboarding/WAS/reset', { method: 'POST' });
  assert.equal(reset.status, 200);
  const resetBody = await reset.json() as { onboarding: ContextGraphOnboardingViewModel };
  assert.equal(resetBody.onboarding.profile.status, 'not_started');

  const unsupported = await routes.request('/onboarding/ATL');
  assert.equal(unsupported.status, 400);
  const unknown = await routes.request('/onboarding/NOPE');
  assert.equal(unknown.status, 400);

  await assert.rejects(() => readFile(options.teamMemoryFile, 'utf8'), /ENOENT/);
});

async function buildWizardsFixtureGraph(): Promise<Required<Pick<TeamPreferenceStoreOptions, 'derivedDir' | 'overridesFile'>> & { teamMemoryFile: string }> {
  const teamsDir = await mkdtemp(path.join(tmpdir(), 'context-graph-onboarding-teams-'));
  const derivedDir = await mkdtemp(path.join(tmpdir(), 'context-graph-onboarding-derived-'));
  const overridesDir = await mkdtemp(path.join(tmpdir(), 'context-graph-onboarding-overrides-'));
  const atl = await readFile(path.join(fixturesDir, 'minimal_team_a.yaml'), 'utf8');
  const was = atl
    .replaceAll('ATL', 'WAS')
    .replaceAll('Atlanta Falcons', 'Washington Wizards')
    .replaceAll('Atlanta', 'Washington');
  await writeFile(path.join(teamsDir, 'was.yaml'), was, 'utf8');
  await copyFile(path.join(fixturesDir, 'minimal_team_b.yaml'), path.join(teamsDir, 'ari.yaml'));
  await buildContextGraph({ teamsDir, outputDir: derivedDir });
  return {
    derivedDir,
    overridesFile: path.join(overridesDir, 'team-preferences.local.json'),
    teamMemoryFile: path.join(overridesDir, 'team-memory.local.json'),
  };
}
