import assert from 'node:assert/strict';
import test from 'node:test';
import { buildNflDataHealth } from '../../src/nfl_coverage/data_health.js';
import { loadNflDemoSeed } from '../../src/nfl_data/seed.js';
import type { NflTransactionMarketDataHealth } from '../../src/nfl_transactions/seed.js';

const transactionHealth: NflTransactionMarketDataHealth = {
  source_mode: 'supabase_current_views',
  snapshot_id: 'nfltm_test',
  as_of_date: '2026-09-02',
  retrieved_at: '2026-09-02T12:30:00.000Z',
  row_count: 18_377,
  fallback_reason: null,
  sources: [],
  coverage: {
    start_year: 2016,
    end_year: 2025,
    event_count: 18_377,
    trade_event_count: 609,
    contract_event_count: 17_768,
    trade_asset_count: 2_605,
    contract_term_count: 17_768,
    matched_position_count: 17_991,
    directional_position_count: 1,
    unmatched_position_count: 385,
    position_match_basis_points: 9_790,
    compensation_coverage_basis_points: 7_209,
    contract_term_coverage_basis_points: 9_992,
    transaction_types: { trade: 609, free_agent_signing: 15_805 },
  },
};

test('NFL data health blocks stale checked-in fallback even when rows exist', async () => {
  const seed = await loadNflDemoSeed();
  seed.as_of_date = '2026-06-25';
  seed.retrieved_at = '2026-06-25T12:00:00.000Z';
  const health = await buildNflDataHealth('NYG', {
    data: { seed, source_mode: 'checked_in_snapshot_fallback', fallback_reason: 'database table missing' },
    transactionMarket: transactionHealth,
    generatedAt: new Date('2026-09-02T18:00:00.000Z'),
  });

  assert.equal(health.status, 'blocked');
  assert.equal(health.meeting_ready, false);
  assert.equal(health.source_mode, 'checked_in_snapshot_fallback');
  assert.ok(health.blockers.some((message) => /48 hours/.test(message)));
  assert.ok(health.remediation.some((message) => /Supabase/.test(message)));
});

test('NFL data health accepts a current DB-backed coherent snapshot', async () => {
  const seed = structuredClone(await loadNflDemoSeed());
  seed.as_of_date = '2026-09-02T12:00:00.000Z';
  seed.retrieved_at = '2026-09-02T12:15:00.000Z';
  const health = await buildNflDataHealth('NYG', {
    data: { seed, source_mode: 'supabase_current_views', fallback_reason: null },
    transactionMarket: transactionHealth,
    generatedAt: new Date('2026-09-02T18:00:00.000Z'),
  });

  assert.equal(health.meeting_ready, true);
  assert.notEqual(health.status, 'blocked');
  assert.equal(health.datasets.find((dataset) => dataset.id === 'roster')?.status, 'ready');
  assert.equal(health.datasets.find((dataset) => dataset.id === 'transaction_market')?.status, 'degraded');
  assert.equal(health.rule_authority.rules_with_locators, health.rule_authority.total_rules);
});

test('NFL data health blocks cap arithmetic mismatch', async () => {
  const seed = structuredClone(await loadNflDemoSeed());
  seed.as_of_date = '2026-09-02T12:00:00.000Z';
  const row = seed.cap_rows.find((candidate) => candidate.team_id === 'NYG' && candidate.cap_number_2026 != null && candidate.cut_savings_2026 != null);
  assert.ok(row);
  row.cut_savings_2026! += 1;
  const health = await buildNflDataHealth('NYG', {
    data: { seed, source_mode: 'supabase_current_views', fallback_reason: null },
    transactionMarket: transactionHealth,
    generatedAt: new Date('2026-09-02T18:00:00.000Z'),
  });
  assert.equal(health.meeting_ready, false);
  assert.ok(health.blockers.some((message) => /reconcile/.test(message)));
});
