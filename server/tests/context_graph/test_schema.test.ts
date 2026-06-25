import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadTeamFile } from '../../src/context_graph/parser.js';
import { validateTeamDocument } from '../../src/context_graph/validator.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

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

