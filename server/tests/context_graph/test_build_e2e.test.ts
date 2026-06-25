import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildContextGraph } from '../../src/context_graph/build.js';
import { loadDerivedArtifacts } from '../../src/context_graph/storage.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

test('build pipeline writes JSON artifacts and markdown report for tiny fixture set', async () => {
  const teamsDir = await mkdtemp(path.join(tmpdir(), 'context-graph-teams-'));
  const outputDir = await mkdtemp(path.join(tmpdir(), 'context-graph-derived-'));
  await copyFile(path.join(fixturesDir, 'minimal_team_a.yaml'), path.join(teamsDir, 'atl.yaml'));
  await copyFile(path.join(fixturesDir, 'minimal_team_b.yaml'), path.join(teamsDir, 'bos.yaml'));

  const result = await buildContextGraph({ teamsDir, outputDir });
  const artifacts = await loadDerivedArtifacts(outputDir);
  const report = await readFile(path.join(outputDir, 'validation_report.md'), 'utf8');

  assert.equal(result.report.passed, true);
  assert.equal(artifacts.teams.length, 2);
  assert.equal(artifacts.edges.playerTeams.length, 2);
  assert(report.includes('Status: PASS'));
});

