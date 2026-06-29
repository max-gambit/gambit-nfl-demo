import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadTeamFile } from '../../src/context_graph/parser.js';
import { validateTeamDocument } from '../../src/context_graph/validator.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const nflTeamsDir = path.join(repoRoot, 'data/nfl-context-graph/teams');

test('valid minimal team fixture passes schema validation', async () => {
  const team = await loadTeamFile(path.join(fixturesDir, 'minimal_team_a.yaml'));
  const errors = validateTeamDocument(team);

  assert.deepEqual(errors, []);
});

test('strict vocabulary validation catches known coercion failures', async () => {
  const team = await loadTeamFile(path.join(fixturesDir, 'invalid_vocab.yaml'));
  const errors = validateTeamDocument(team);
  const paths = errors.map((error) => error.path);

  assert(paths.includes('cap_situation.hard_capped'));
  assert(paths.includes('roster[0].team_relationship.homegrown'));
  assert(paths.includes('roster[0].contract.trade_kicker'));
  assert(paths.includes('roster[0].movement_constraints.signal_strength'));
  assert(paths.includes('roster[0].contract.bird_rights'));
  assert(errors.every((error) => typeof error.line === 'number'));
});

test('focused NFL trade Intel validates buyer salary-out stances', async () => {
  const team = await loadTeamFile(path.join(nflTeamsDir, 'nyg.yaml'));
  const errors = validateTeamDocument(team);

  assert.deepEqual(errors, []);
  const intel = team.data.trade_market_intel as {
    position_group_stance?: Array<{ group?: string }>;
  };
  const groups = new Set((intel.position_group_stance ?? []).map((stance) => String(stance.group ?? '').toUpperCase()));
  assert.equal(groups.has('OL'), true);
  assert.equal(groups.has('DB'), true);
});

test('focused NFL trade Intel rejects generic seller-thesis text', async () => {
  const team = await loadTeamFile(path.join(nflTeamsDir, 'tb.yaml'));
  const intel = team.data.trade_market_intel as {
    seller_posture?: { evidence?: string };
  };
  if (intel.seller_posture) intel.seller_posture.evidence = 'internal demo synthesis';
  const errors = validateTeamDocument(team);

  assert.equal(errors.some((error) => error.path === 'trade_market_intel'), true);
});

test('focused NFL seller teams require an interior-front stance', async () => {
  const team = await loadTeamFile(path.join(nflTeamsDir, 'tb.yaml'));
  const intel = team.data.trade_market_intel as {
    position_group_stance?: unknown[];
  };
  intel.position_group_stance = [];
  const errors = validateTeamDocument(team);

  assert.equal(errors.some((error) => (
    error.path === 'trade_market_intel.position_group_stance'
    && /DL\/interior-front/.test(error.message)
  )), true);
});

test('focused NFL trade-demo teams require trade_market_intel', async () => {
  const team = await loadTeamFile(path.join(nflTeamsDir, 'ari.yaml'));
  delete team.data.trade_market_intel;
  const errors = validateTeamDocument(team);

  assert.equal(errors.some((error) => (
    error.path === 'trade_market_intel'
    && /require trade_market_intel/.test(error.message)
  )), true);
});
