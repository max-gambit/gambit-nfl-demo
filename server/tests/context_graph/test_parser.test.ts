import assert from 'node:assert/strict';
import { mkdtemp, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { discoverTeamFiles, loadTeamFile } from '../../src/context_graph/parser.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

test('loadTeamFile parses YAML and preserves line lookups', async () => {
  const team = await loadTeamFile(path.join(fixturesDir, 'minimal_team_a.yaml'));

  assert.equal(team.teamId, 'ATL');
  assert.equal(team.data.team_id, 'ATL');
  assert.equal(team.parseErrors.length, 0);
  assert.equal(typeof team.lineForPath('cap_situation.hard_capped'), 'number');
});

test('discoverTeamFiles only loads standard team-code YAML files', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'context-graph-parser-'));
  await copyFile(path.join(fixturesDir, 'minimal_team_a.yaml'), path.join(dir, 'atl.yaml'));
  await copyFile(path.join(fixturesDir, 'minimal_team_b.yaml'), path.join(dir, 'bos.yaml'));
  await copyFile(path.join(fixturesDir, '_ignored.yaml'), path.join(dir, '_ignored.yaml'));
  await copyFile(path.join(fixturesDir, 'invalid_vocab.yaml'), path.join(dir, 'invalid_vocab.yaml'));

  const files = await discoverTeamFiles(dir);

  assert.deepEqual(files.map((file) => path.basename(file)), ['atl.yaml', 'bos.yaml']);
});

