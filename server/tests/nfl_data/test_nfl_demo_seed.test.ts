import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadNflDemoSeed, nflTeamDetail, validateNflDemoSeed } from '../../src/nfl_data/seed.js';
import { nflRoutes } from '../../src/routes/nfl.js';

test('NFL demo seed validates all-32 static roster cap and metric rows', async () => {
  const seed = await loadNflDemoSeed();
  const summary = validateNflDemoSeed(seed);
  const rosterCounts = seed.teams.map((team) => seed.roster_entries.filter((row) => row.team_id === team.team_id).length);
  const capturedMetrics = seed.player_metrics.filter((row) => row.source_status === 'captured');

  assert.equal(summary.team_count, 32);
  assert.equal(summary.roster_row_count, 2_902);
  assert.equal(summary.cap_row_count, summary.roster_row_count);
  assert.equal(summary.player_metric_row_count, summary.roster_row_count);
  assert.equal(summary.cap_row_parity, true);
  assert.equal(Math.min(...rosterCounts) >= 70, true);
  assert.equal(summary.source_needed_cap_row_count, 62);
  assert.equal(seed.source_refs.some((source) => source.id === 'nfl_official_rosters'), true);
  assert.equal(seed.source_refs.some((source) => source.id === 'overthecap_contract_ledger_v1'), true);
  assert.equal(seed.source_refs.some((source) => source.id === 'nflverse_snap_counts_2025'), true);
  assert.equal(seed.source_refs.some((source) => source.id === 'nflverse_stats_player_2025'), true);
  assert.equal(seed.source_refs.some((source) => source.id === 'nflverse_pfr_advstats_2025'), true);
  assert.equal(seed.source_refs.some((source) => source.id === 'nflverse_nextgen_stats_2025'), true);
  assert.equal(seed.cap_rows.filter((row) => row.contract_ledger_status).length, summary.roster_row_count);
  assert.equal(seed.cap_rows.filter((row) => row.contract_ledger_confidence).length, summary.roster_row_count);
  assert.equal(seed.cap_rows.filter((row) => row.contract_years_remaining != null).length, 2_840);
  assert.equal(seed.cap_rows.filter((row) => row.source_status === 'estimated').length, 13);
  assert.equal(capturedMetrics.length > 1_500, true);
  assert.equal(seed.player_metrics.filter((row) => row.metric_coverage_level === 'strong').length > 1_000, true);
  assert.equal(seed.player_metrics.every((row) => Array.isArray(row.metric_families ?? [])), true);
  assert.equal(seed.player_metrics.length, summary.roster_row_count);
});

test('NFL demo seed exposes full Giants roster and cap levers', async () => {
  const seed = await loadNflDemoSeed();
  const detail = nflTeamDetail(seed, 'NYG');

  assert.equal(detail?.team.team_id, 'NYG');
  assert.equal((detail?.roster_entries.length ?? 0) >= 90, true);
  assert.equal(detail?.cap_rows.filter((row) => row.player_id).length, detail?.roster_entries.length);
  assert.equal(detail?.roster_entries.some((row) => row.player_name === 'Andrew Thomas'), true);
  assert.equal(detail?.cap_rows.some((row) => row.player_name === 'Andrew Thomas' && row.restructure_savings_estimate_2026 !== null), true);
  assert.equal(detail?.cap_rows.some((row) => row.player_name === 'Brian Burns' && row.cap_number_2026 !== null), true);
  assert.equal(detail?.cap_rows.some((row) => row.player_name === 'Gunner Olszewski' && row.source_status === 'source-needed'), true);
  assert.equal(detail?.roster_entries.length, 92);
  assert.equal(detail?.cap_rows.filter((row) => row.contract_ledger_status).length, 92);
  assert.equal(detail?.cap_rows.filter((row) => row.contract_years_remaining != null).length, 91);
  assert.equal(detail?.cap_rows.filter((row) => row.post_june_1_cut_savings_2026 != null).length, 91);
  assert.equal(detail?.cap_rows.filter((row) => row.trade_savings_2026 != null).length, 91);
  assert.equal(detail?.cap_rows.some((row) => row.player_name === 'Brian Burns' && row.contract_years_remaining === 3), true);
  assert.equal(detail?.cap_rows.some((row) => row.player_name === 'Brian Burns' && row.contract_ledger_confidence === 'captured'), true);
  assert.equal((detail?.player_metrics.filter((row) => row.source_status === 'captured').length ?? 0) > 50, true);
  assert.equal(detail?.player_metrics.some((row) => row.player_name === 'Brian Burns' && row.metric_coverage_level === 'strong' && row.position_metrics?.pressures != null), true);
  assert.equal(detail?.player_metrics.some((row) => row.player_name === 'Andrew Thomas' && row.metric_coverage_level === 'directional' && row.quality_flags?.includes('ol_continuity_only_no_public_blocking_grade')), true);
  assert.equal(detail?.player_metrics.some((row) => row.player_name === 'Malik Nabers' && row.position_metric_summary?.includes('targets=')), true);
});

test('NFL contract ledger covers high-cap rows with post-June trade and confidence data', async () => {
  const seed = await loadNflDemoSeed();
  const highCapRows = seed.cap_rows.filter((row) => (row.cap_number_2026 ?? 0) > 5_000_000);

  assert.equal(highCapRows.length > 100, true);
  assert.equal(highCapRows.every((row) => row.contract_ledger_status === 'captured'), true);
  assert.equal(highCapRows.every((row) => row.contract_ledger_confidence !== 'source-needed'), true);
  assert.equal(highCapRows.every((row) => row.dead_money_if_cut_2026 != null), true);
  assert.equal(highCapRows.every((row) => row.cut_savings_2026 != null), true);
  assert.equal(highCapRows.every((row) => row.post_june_1_dead_money_2026 != null), true);
  assert.equal(highCapRows.every((row) => row.post_june_1_cut_savings_2026 != null), true);
  assert.equal(highCapRows.every((row) => row.trade_dead_money_2026 != null), true);
  assert.equal(highCapRows.every((row) => row.trade_savings_2026 != null), true);
});

test('NFL routes return current all-team summaries and NYG detail', async () => {
  const all = await nflRoutes.request('/cap-sheets/current');
  assert.equal(all.status, 200);
  const allBody = await all.json() as { teams: Array<{ team_id: string }>; rows: Array<{ team_id: string }> };
  assert.equal(allBody.teams.length, 32);
  assert.equal(allBody.rows.some((row) => row.team_id === 'NYG'), true);

  const detail = await nflRoutes.request('/cap-sheets/current/NYG');
  assert.equal(detail.status, 200);
  const detailBody = await detail.json() as {
    team: { team_id: string };
    roster_entries: Array<{ player_name: string }>;
    cap_rows: Array<{ player_name: string; source_status: string }>;
  };
  assert.equal(detailBody.team.team_id, 'NYG');
  assert.equal(detailBody.roster_entries.length >= 90, true);
  assert.equal(detailBody.cap_rows.length, detailBody.roster_entries.length);
  assert.equal(detailBody.cap_rows.some((row) => row.player_name === 'Brian Burns'), true);
  assert.equal(detailBody.cap_rows.some((row) => row.player_name === 'Gunner Olszewski' && row.source_status === 'source-needed'), true);

  const missing = await nflRoutes.request('/cap-sheets/current/NOPE');
  assert.equal(missing.status, 404);
});
