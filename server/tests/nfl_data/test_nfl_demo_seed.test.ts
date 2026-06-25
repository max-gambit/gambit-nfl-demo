import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadNflDemoSeed, nflTeamDetail, validateNflDemoSeed } from '../../src/nfl_data/seed.js';
import { nflRoutes } from '../../src/routes/nfl.js';

test('NFL demo seed validates all-32 static roster cap and metric rows', async () => {
  const seed = await loadNflDemoSeed();
  const summary = validateNflDemoSeed(seed);

  assert.equal(summary.team_count, 32);
  assert.equal(summary.roster_row_count >= 128, true);
  assert.equal(summary.cap_row_count >= 160, true);
  assert.equal(summary.player_metric_row_count >= 128, true);
  assert.equal(seed.source_refs.some((source) => source.id === 'otc_giants'), true);
});

test('NFL demo seed exposes richer Giants cap levers', async () => {
  const seed = await loadNflDemoSeed();
  const detail = nflTeamDetail(seed, 'NYG');

  assert.equal(detail?.team.team_id, 'NYG');
  assert.equal(detail?.roster_entries.some((row) => row.player_name === 'Andrew Thomas'), true);
  assert.equal(detail?.cap_rows.some((row) => row.player_name === 'Andrew Thomas' && row.restructure_savings_estimate_2026 !== null), true);
  assert.equal(detail?.cap_rows.some((row) => row.player_name === '__TEAM_CAP_POSTURE__' && row.contract_lever === 'restructure_needed'), true);
});

test('NFL routes return current all-team summaries and NYG detail', async () => {
  const all = await nflRoutes.request('/cap-sheets/current');
  assert.equal(all.status, 200);
  const allBody = await all.json() as { teams: Array<{ team_id: string }>; rows: Array<{ team_id: string }> };
  assert.equal(allBody.teams.length, 32);
  assert.equal(allBody.rows.some((row) => row.team_id === 'NYG'), true);

  const detail = await nflRoutes.request('/cap-sheets/current/NYG');
  assert.equal(detail.status, 200);
  const detailBody = await detail.json() as { team: { team_id: string }; cap_rows: Array<{ player_name: string }> };
  assert.equal(detailBody.team.team_id, 'NYG');
  assert.equal(detailBody.cap_rows.some((row) => row.player_name === 'Brian Burns'), true);

  const missing = await nflRoutes.request('/cap-sheets/current/NOPE');
  assert.equal(missing.status, 404);
});
