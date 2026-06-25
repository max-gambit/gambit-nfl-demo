import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { extractEdgeGraph } from '../../src/context_graph/edges.js';
import { loadTeamFile } from '../../src/context_graph/parser.js';
import { validateCrossTeamConsistency } from '../../src/context_graph/validator.js';
import type { TeamDocument } from '../../src/context_graph/schema.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

test('valid fixture set passes cross-team consistency validation', async () => {
  const teams = await loadPair();
  const graph = extractEdgeGraph(teams);
  const result = validateCrossTeamConsistency(teams, graph);

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});

test('cross-team validator catches duplicated roster players', async () => {
  const teams = await loadPair();
  const bosRoster = teams[1].data.roster as Record<string, unknown>[];
  bosRoster[0].player_id = 'player_alpha';

  const result = validateCrossTeamConsistency(teams, extractEdgeGraph(teams));

  assert(result.errors.some((error) => error.message.includes('appears on multiple rosters')));
});

test('cross-team validator catches pending free agents missing from roster', async () => {
  const teams = await loadPair();
  const pending = teams[0].data.pending_free_agents as Record<string, unknown>[];
  pending[0].player_id = 'missing_player';

  const result = validateCrossTeamConsistency(teams, extractEdgeGraph(teams));

  assert(result.errors.some((error) => error.message.includes('is not present on ATL')));
});

test('cross-team validator keeps one-way rivalry and trade history nonblocking by default', async () => {
  const teams = await loadPair();
  const bosRelationships = teams[1].data.team_team_relationships as Record<string, unknown>;
  bosRelationships.rivalries = [];
  const bosTradeDna = teams[1].data.trade_dna as Record<string, unknown>;
  bosTradeDna.recent_significant_trades = [];

  const result = validateCrossTeamConsistency(teams, extractEdgeGraph(teams));

  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 0);
});

test('cross-team validator enforces rivalry reciprocity when explicitly required', async () => {
  const teams = await loadPair();
  const atlRelationships = teams[0].data.team_team_relationships as Record<string, unknown>;
  const rivalries = atlRelationships.rivalries as Record<string, unknown>[];
  rivalries[0].requires_reciprocal = true;
  const bosRelationships = teams[1].data.team_team_relationships as Record<string, unknown>;
  bosRelationships.rivalries = [];

  const result = validateCrossTeamConsistency(teams, extractEdgeGraph(teams));

  assert(result.errors.some((error) => error.message.includes('Missing reciprocal rivalry')));
});

test('cross-team validator leaves one-way personnel links to audit tooling', async () => {
  const teams = await loadPair();
  const bosRelationships = teams[1].data.team_team_relationships as Record<string, unknown>;
  bosRelationships.notable_personnel_connections = [];

  const result = validateCrossTeamConsistency(teams, extractEdgeGraph(teams));

  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 0);
});

test('cross-team validator catches missing reciprocal pick ownership', async () => {
  const teams = await loadPair();
  const atlAssets = teams[0].data.key_assets as Record<string, unknown>;
  atlAssets.draft_picks_owned = [];

  const result = validateCrossTeamConsistency(teams, extractEdgeGraph(teams));

  assert(result.errors.some((error) => error.message.includes('Missing reciprocal draft_picks_owned')));
});

async function loadPair(): Promise<TeamDocument[]> {
  return Promise.all([
    loadTeamFile(path.join(fixturesDir, 'minimal_team_a.yaml')),
    loadTeamFile(path.join(fixturesDir, 'minimal_team_b.yaml')),
  ]);
}
