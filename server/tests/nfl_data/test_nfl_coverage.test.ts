import assert from 'node:assert/strict';
import test from 'node:test';
import { buildNflCoverageMatrix, buildNflCoverageTeam, normalizePositionGroup } from '../../src/nfl_coverage/coverage.js';
import { loadCurrentNflDataWithMode } from '../../src/nfl_data/seed.js';
import { nflRoutes } from '../../src/routes/nfl.js';

test('NFL coverage matrix preserves current all-32 baseline and contract field counts', async () => {
  const matrix = await buildNflCoverageMatrix({ generatedAt: new Date('2026-06-28T00:00:00.000Z') });

  assert.equal(matrix.league.team_count, 32);
  assert.equal(matrix.league.roster_row_count, 2_902);
  assert.equal(matrix.league.cap_row_count, 2_902);
  assert.equal(matrix.league.player_metric_row_count, 2_902);
  assert.equal(matrix.league.source_needed_cap_row_count, 3);
  assert.equal(matrix.league.contract_field_coverage.rows_with_years, 2_899);
  assert.equal(matrix.league.contract_field_coverage.rows_with_dead_cut, 2_899);
  assert.equal(matrix.league.contract_field_coverage.rows_with_post_june, 2_899);
  assert.equal(matrix.league.contract_field_coverage.rows_with_trade, 2_899);
  assert.equal(matrix.league.status, 'strong');
  assert.equal(matrix.league.to_9_10, 'League coverage meets the 9/10 target across current public-source constraints.');
  assert.equal(matrix.rules.status, 'strong');
  assert.equal(matrix.league.seller_thesis_team_count, 32);
  assert.match(matrix.source_mode, /^(supabase_current_views|checked_in_snapshot|checked_in_snapshot_fallback)$/);
});

test('NFL coverage uses app roster/cap rows instead of context graph mini-rosters', async () => {
  const { team } = await buildNflCoverageTeam('NYG', { generatedAt: new Date('2026-06-28T00:00:00.000Z') });

  assert.ok(team);
  assert.equal(team.roster_count, 92);
  assert.equal(team.cap_row_count, 92);
  assert.equal(team.graph_roster_count, 4);
  assert.equal(team.readiness.find((item) => item.key === 'roster_cap_audit')?.status, 'strong');
  assert.equal(team.readiness.find((item) => item.key === 'player_quality')?.status, 'strong');
  assert.equal(team.domains.find((domain) => domain.domain === 'player_metrics')?.status, 'strong');
  assert.equal(team.domains.find((domain) => domain.domain === 'player_metrics')?.detail.includes('public-ceiling'), true);
  assert.equal(team.domains.find((domain) => domain.domain === 'player_metrics')?.gaps.some((gap) => gap.key === 'public_sample_ceiling_rows'), true);
  assert.equal(team.domains.find((domain) => domain.domain === 'player_metrics')?.gaps.some((gap) => gap.key === 'metric_rows_need_context'), true);
  assert.equal(team.domains.find((domain) => domain.domain === 'seller_thesis')?.status, 'strong');
});

test('NFL coverage rejects equal-count roster cap rows with different player universes', async () => {
  const data = await loadCurrentNflDataWithMode();
  const seed = structuredClone(data.seed);
  const capRowIndex = seed.cap_rows.findIndex((row) => row.team_id === 'NYG' && row.player_id);
  assert.notEqual(capRowIndex, -1);
  seed.cap_rows[capRowIndex] = {
    ...seed.cap_rows[capRowIndex],
    player_id: 'coverage-mismatch-player',
    player_name: 'Coverage Mismatch Player',
  };

  const { team } = await buildNflCoverageTeam('NYG', {
    data: { ...data, seed },
    generatedAt: new Date('2026-06-28T00:00:00.000Z'),
  });

  assert.ok(team);
  assert.equal(team.roster_count, team.cap_row_count);
  assert.equal(team.readiness.find((item) => item.key === 'roster_cap_audit')?.status, 'weak');
  assert.equal(team.domains.find((domain) => domain.domain === 'roster')?.gaps.some((gap) => gap.key === 'roster_cap_parity'), true);
  assert.equal(team.domains.find((domain) => domain.domain === 'cap_contracts')?.gaps.some((gap) => gap.key === 'cap_roster_parity'), true);
});

test('NFL league readiness is capped by blocked material team coverage', async () => {
  const data = await loadCurrentNflDataWithMode();
  const seed = structuredClone(data.seed);
  seed.roster_entries = seed.roster_entries.filter((row) => row.team_id !== 'NYG');
  seed.cap_rows = seed.cap_rows.filter((row) => row.team_id !== 'NYG');
  seed.player_metrics = seed.player_metrics.filter((row) => row.team_id !== 'NYG');

  const matrix = await buildNflCoverageMatrix({
    data: { ...data, seed },
    generatedAt: new Date('2026-06-28T00:00:00.000Z'),
  });
  const nyg = matrix.teams.find((team) => team.team_id === 'NYG');

  assert.ok(nyg);
  assert.equal(nyg.status, 'blocked');
  assert.notEqual(matrix.league.status, 'strong');
});

test('NFL coverage keeps seller-thesis strength limited to graph-backed teams and groups', async () => {
  const matrix = await buildNflCoverageMatrix({ generatedAt: new Date('2026-06-28T00:00:00.000Z') });
  assert.equal(matrix.teams.filter((team) => team.domains.find((domain) => domain.domain === 'seller_thesis')?.status === 'strong').length, 32);

  const nyg = matrix.teams.find((team) => team.team_id === 'NYG');
  assert.ok(nyg);
  assert.equal(nyg.position_groups.some((group) => group.seller_thesis_status === 'strong'), true);
  assert.equal(nyg.position_groups.some((group) => group.seller_thesis_status !== 'strong'), true);
});

test('NFL coverage normalizes position groups for matrix rollups', () => {
  assert.equal(normalizePositionGroup('OLB'), 'EDGE/LB');
  assert.equal(normalizePositionGroup('DE'), 'EDGE/LB');
  assert.equal(normalizePositionGroup('FB'), 'RB');
  assert.equal(normalizePositionGroup('FS'), 'S');
  assert.equal(normalizePositionGroup('DT'), 'DL');
});

test('NFL coverage routes expose league and team detail', async () => {
  const all = await nflRoutes.request('/coverage/current');
  assert.equal(all.status, 200);
  const allBody = await all.json() as { teams: Array<{ team_id: string }>; league: { team_count: number } };
  assert.equal(allBody.league.team_count, 32);
  assert.equal(allBody.teams.length, 32);

  const detail = await nflRoutes.request('/coverage/current/NYG');
  assert.equal(detail.status, 200);
  const detailBody = await detail.json() as { team: { team_id: string; readiness: Array<{ key: string }> } };
  assert.equal(detailBody.team.team_id, 'NYG');
  assert.equal(detailBody.team.readiness.some((item) => item.key === 'roster_cap_audit'), true);

  const missing = await nflRoutes.request('/coverage/current/NOPE');
  assert.equal(missing.status, 404);
});
