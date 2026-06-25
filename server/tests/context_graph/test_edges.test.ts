import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { extractEdgeGraph } from '../../src/context_graph/edges.js';
import { loadTeamFile } from '../../src/context_graph/parser.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

test('edge extraction creates each relationship edge type from parsed teams', async () => {
  const teams = await Promise.all([
    loadTeamFile(path.join(fixturesDir, 'minimal_team_a.yaml')),
    loadTeamFile(path.join(fixturesDir, 'minimal_team_b.yaml')),
  ]);

  const graph = extractEdgeGraph(teams);

  assert(graph.pickOwnership.some((edge) => edge.owning_team === 'ATL' && edge.owed_team === 'ARI' && edge.year === 2027));
  assert.deepEqual(graph.tradePartners.map((edge) => [edge.team_a, edge.team_b]), [['ARI', 'ATL']]);
  assert.equal(graph.tradePartners[0].trade_count_recent, 2);
  assert(graph.rivalries.some((edge) => edge.team_a === 'ATL' && edge.team_b === 'ARI'));
  assert(graph.personnelConnections.some((edge) => edge.person_name === 'Coach Link' && edge.connected_team === 'ARI'));
  assert(graph.playerTeams.some((edge) => edge.player_id === 'player_alpha' && edge.team_id === 'ATL'));
  assert(graph.pendingFreeAgents.some((edge) => edge.player_id === 'player_alpha' && edge.free_agent_type === 'UFA'));
  assert(graph.historicalPursuits.some((edge) => edge.pursuer_team === 'ARI' && edge.target_name === 'Player Alpha'));
});
