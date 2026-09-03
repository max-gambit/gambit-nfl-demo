import assert from 'node:assert/strict';
import test from 'node:test';
import type { NflCapRosterDecisionRequest } from '@shared/types';
import { buildCapRosterDecision } from '../../src/nfl_decision/cap_roster.js';
import { loadNflDemoSeed } from '../../src/nfl_data/seed.js';
import type { NflTransactionMarketDataHealth } from '../../src/nfl_transactions/seed.js';

async function fixtureRequest(overrides: Partial<NflCapRosterDecisionRequest> = {}) {
  const seed = structuredClone(await loadNflDemoSeed());
  seed.as_of_date = '2026-09-02T12:00:00.000Z';
  seed.retrieved_at = '2026-09-02T12:15:00.000Z';
  const request: NflCapRosterDecisionRequest = {
    team_id: 'NYG',
    target_relief_dollars: 12_000_000,
    protected_player_ids: ['nfl:NYG:brian-burns'],
    protected_position_groups: [],
    allowed_levers: ['hold', 'pre_june_cut', 'post_june_cut', 'trade'],
    ...overrides,
  };
  return buildCapRosterDecision(request, {
    data: { seed, source_mode: 'supabase_current_views', fallback_reason: null },
    generatedAt: new Date('2026-09-02T18:00:00.000Z'),
    transactionMarket: transactionMarketHealth(),
  });
}

test('cap roster branches use positive integer relief and reconcile components', async () => {
  const result = await fixtureRequest();
  assert.equal(result.schema_version, 'nfl_cap_roster_decision.v1');
  for (const branch of result.branches) {
    assert.equal(branch.total_relief_dollars, branch.actions.reduce((sum, action) => sum + action.relief_dollars, 0));
    assert.equal(branch.total_dead_money_dollars, branch.actions.reduce((sum, action) => sum + action.dead_money_dollars, 0));
    assert.equal(new Set(branch.actions.map((action) => action.player_id)).size, branch.actions.length);
    assert.ok(branch.actions.every((action) => Number.isSafeInteger(action.relief_dollars) && action.relief_dollars > 0));
    assert.ok(branch.actions.every((action) => action.rule_references.every((rule) => rule.locator && rule.authoritative_url)));
  }
  assert.equal(result.branches.flatMap((branch) => branch.actions).some((action) => action.player_name === 'Brian Burns'), false);
});

test('preserve-depth selects the smallest source-order-independent low-impact action set', async () => {
  const result = await fixtureRequest({ target_relief_dollars: 3_000_000, protected_player_ids: [] });
  const preserve = result.branches.find((branch) => branch.id === 'preserve_depth');

  assert.ok(preserve?.target_met);
  assert.equal(preserve.actions.length, 1);
  assert.ok(preserve.actions[0].relief_dollars >= 3_000_000);
});

test('protected position groups never enter transaction branches', async () => {
  const result = await fixtureRequest({ protected_position_groups: ['OL'] });
  const transactions = result.branches.flatMap((branch) => branch.actions);
  assert.equal(transactions.some((action) => ['G', 'C', 'T', 'OT', 'OG', 'OL'].includes(action.position ?? '')), false);
});

test('protected front-seven and secondary aliases normalize without leaks', async () => {
  const frontSeven = await fixtureRequest({ protected_player_ids: [], protected_position_groups: ['EDGE/LB'] });
  assert.equal(frontSeven.branches.flatMap((branch) => branch.actions).some((action) => ['DE', 'OLB', 'EDGE', 'LB', 'MLB', 'ILB'].includes(action.position ?? '')), false);
  const secondary = await fixtureRequest({ protected_player_ids: [], protected_position_groups: ['S', 'CB'] });
  assert.equal(secondary.branches.flatMap((branch) => branch.actions).some((action) => ['FS', 'SS', 'S', 'SAF', 'CB', 'DB'].includes(action.position ?? '')), false);
});

test('source-needed performance cannot grade depth or enter the preserve-depth branch', async () => {
  const seed = structuredClone(await loadNflDemoSeed());
  seed.as_of_date = '2026-09-02T12:00:00.000Z';
  seed.retrieved_at = '2026-09-02T12:15:00.000Z';
  const baseline = await buildCapRosterDecision({
    team_id: 'NYG', target_relief_dollars: 12_000_000, protected_player_ids: [], protected_position_groups: [], allowed_levers: ['pre_june_cut', 'post_june_cut', 'trade'],
  }, { data: { seed, source_mode: 'supabase_current_views', fallback_reason: null }, generatedAt: new Date('2026-09-02T18:00:00.000Z'), transactionMarket: transactionMarketHealth() });
  const candidate = baseline.branches.find((branch) => branch.id === 'preserve_depth')?.actions[0];
  assert.ok(candidate);
  const metric = seed.player_metrics.find((row) => row.player_id === candidate.player_id);
  assert.ok(metric);
  metric.source_status = 'source-needed';
  metric.metric_confidence = 'source-needed';
  metric.metric_gap_reason = 'test fixture has no public sample';
  const result = await buildCapRosterDecision({
    team_id: 'NYG', target_relief_dollars: 12_000_000, protected_player_ids: [], protected_position_groups: [], allowed_levers: ['pre_june_cut', 'post_june_cut', 'trade'],
  }, { data: { seed, source_mode: 'supabase_current_views', fallback_reason: null }, generatedAt: new Date('2026-09-02T18:00:00.000Z'), transactionMarket: transactionMarketHealth() });
  const action = result.branches.find((branch) => branch.id === 'maximize_relief')?.actions.find((item) => item.player_id === candidate.player_id);
  assert.equal(action?.depth_effect, 'unknown');
  assert.equal(action?.depth_evidence.source_status, 'source-needed');
  assert.equal(result.branches.find((branch) => branch.id === 'preserve_depth')?.actions.some((item) => item.player_id === candidate.player_id), false);
});

test('arithmetic-invalid or term-incomplete rows cannot enter any branch', async () => {
  const seed = structuredClone(await loadNflDemoSeed());
  seed.as_of_date = '2026-09-02T12:00:00.000Z';
  seed.retrieved_at = '2026-09-02T12:15:00.000Z';
  const row = seed.cap_rows.find((item) => item.team_id === 'NYG' && item.source_status === 'captured' && (item.trade_savings_2026 ?? 0) > 0 && item.contract_end_year != null);
  assert.ok(row?.player_id);
  const playerId = row.player_id;
  row.trade_savings_2026! += 1;
  row.contract_end_year = null;
  const result = await buildCapRosterDecision({
    team_id: 'NYG', target_relief_dollars: 1_000_000, protected_player_ids: [], protected_position_groups: [], allowed_levers: ['trade'],
  }, { data: { seed, source_mode: 'supabase_current_views', fallback_reason: null }, generatedAt: new Date('2026-09-02T18:00:00.000Z'), transactionMarket: transactionMarketHealth() });
  assert.equal(result.branches.flatMap((branch) => branch.actions).some((action) => action.player_id === playerId), false);
  assert.equal(result.status, 'blocked');
});

test('impossible target returns supported maximum without false recommendation', async () => {
  const result = await fixtureRequest({ target_relief_dollars: 500_000_000 });
  const maximum = result.branches.find((branch) => branch.id === 'maximize_relief');
  assert.ok(maximum);
  assert.equal(maximum.target_met, false);
  assert.equal(maximum.status, 'insufficient_evidence');
  assert.equal(result.status, 'insufficient_evidence');
  assert.equal(result.recommended_branch_id, null);
});

test('manual assumptions stay labeled and stale fallback blocks recommendation', async () => {
  const seed = await loadNflDemoSeed();
  const result = await buildCapRosterDecision({
    team_id: 'NYG',
    target_relief_dollars: 1_000_000,
    protected_player_ids: [],
    protected_position_groups: [],
    allowed_levers: ['trade'],
    assumptions: [{ key: 'replacement_cost', label: 'Replacement cost', value: 2_000_000, source: 'user_entered' }],
  }, {
    data: { seed, source_mode: 'checked_in_snapshot_fallback', fallback_reason: 'database unavailable' },
    generatedAt: new Date('2026-09-02T18:00:00.000Z'),
    transactionMarket: transactionMarketHealth(),
  });
  assert.equal(result.assumptions[0]?.source, 'user_entered');
  assert.equal(result.status, 'blocked');
  assert.equal(result.recommended_branch_id, null);
});

function transactionMarketHealth(): NflTransactionMarketDataHealth {
  return {
    source_mode: 'supabase_current_views',
    snapshot_id: 'fixture-transaction-market',
    as_of_date: '2026-09-02',
    retrieved_at: '2026-09-02T12:15:00.000Z',
    row_count: 100,
    coverage: {
      start_year: 2016,
      end_year: 2025,
      event_count: 100,
      trade_event_count: 50,
      contract_event_count: 50,
      trade_asset_count: 75,
      contract_term_count: 50,
      matched_position_count: 96,
      directional_position_count: 2,
      unmatched_position_count: 2,
      position_match_basis_points: 9_600,
      compensation_coverage_basis_points: 9_600,
      contract_term_coverage_basis_points: 9_600,
      transaction_types: { trade: 50, free_agent_signing: 50 },
    },
    sources: [],
    fallback_reason: null,
  };
}
