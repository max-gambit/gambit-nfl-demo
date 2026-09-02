import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dataAnalystTools,
  dataAnalystTracesToToolCalls,
  queryNflTransactionMarketResult,
} from '../../src/claude/data_analyst.js';
import type { NflTransactionMarketSnapshot } from '../../src/nfl_transactions/analyze.js';

test('Analysis exposes both deterministic transaction-market tools', () => {
  const names = dataAnalystTools.map((tool) => tool.name);
  assert.ok(names.includes('analyze_nfl_transaction_market'));
  assert.ok(names.includes('query_nfl_transaction_comparables'));
});

test('market tool executes the injected snapshot loader and returns exact request plus artifact', async () => {
  let calls = 0;
  const result = await queryNflTransactionMarketResult('query_nfl_transaction_comparables', {
    analysis_mode: 'comparables',
    start_year: 2018,
    end_year: 2025,
    position_groups: ['S', 'RB'],
    transaction_types: ['trade'],
    max_comparables: 7,
  }, async () => {
    calls += 1;
    return snapshotFixture();
  });

  assert.equal(calls, 1);
  assert.equal(result.ok, true);
  assert.deepEqual(result.input, {
    analysis_mode: 'comparables',
    start_year: 2018,
    end_year: 2025,
    position_groups: ['S', 'RB'],
    transaction_types: ['trade'],
    include_ytd: false,
    max_comparables: 7,
  });
  assert.equal(result.market_analysis?.snapshot_id, 'tool-fixture-v1');
  assert.deepEqual(result.market_analysis?.query.transaction_types, ['trade']);
  assert.deepEqual(result.market_analysis?.query.position_groups, ['RB', 'S']);
});

test('persisted tool calls retain executed filters and deterministic artifact', () => {
  const market = {
    schema_version: 'nfl_transaction_market.v1' as const,
    analysis_id: 'analysis-1',
    generated_at: '2026-09-02T00:00:00.000Z',
    snapshot_id: 'snapshot-1',
  };
  const calls = dataAnalystTracesToToolCalls([{
    tool_use_id: 'tool-1',
    tool_name: 'analyze_nfl_transaction_market',
    input: { analysis_mode: 'ten_year_trend', start_year: 2016, end_year: 2025 },
    datasets: [],
    errors: [],
    market_analysis: market as never,
  }]);
  assert.deepEqual(calls[0].input, { analysis_mode: 'ten_year_trend', start_year: 2016, end_year: 2025 });
  assert.equal(calls[0].data_analyst_trace?.market_analysis?.snapshot_id, 'snapshot-1');
});

function snapshotFixture(): NflTransactionMarketSnapshot {
  return {
    snapshot_id: 'tool-fixture-v1',
    events: [
      event('trade-rb-2018', 2018, 'RB'),
      event('trade-s-2025', 2025, 'S'),
    ],
    roster_player_seasons: Array.from({ length: 8 }, (_, index) => 2018 + index).flatMap((year) => ([
      { year, team_id: null, position_group: 'RB' as const, roster_player_seasons: 100, source_ref_ids: ['trades'] },
      { year, team_id: null, position_group: 'S' as const, roster_player_seasons: 100, source_ref_ids: ['trades'] },
    ])),
    league_caps: Array.from({ length: 8 }, (_, index) => ({
      year: 2018 + index,
      league_cap_dollars: 200_000_000,
      source_ref_ids: ['trades'],
    })),
    source_refs: [{
      id: 'trades',
      name: 'nflverse trades',
      url: 'https://github.com/nflverse/nfldata',
      upstream_attribution: 'Test fixture',
      retrieved_at: '2026-09-02T00:00:00.000Z',
      as_of_date: '2026-09-02',
      checksum_sha256: 'a'.repeat(64),
      coverage_note: 'Test-only rows.',
    }],
  };
}

function event(id: string, year: number, position: 'RB' | 'S') {
  return {
    event_id: id,
    event_year: year,
    event_date: `${year}-03-01`,
    date_precision: 'day' as const,
    transaction_type: 'trade' as const,
    player_id: `player-${id}`,
    player_name: `Player ${position}`,
    position_group: position,
    from_team_id: 'AAA',
    to_team_id: 'BBB',
    contract_value_dollars: null,
    contract_apy_dollars: null,
    guaranteed_dollars: null,
    compensation_pick_rounds: [2],
    compensation_includes_player: false,
    trade_player_asset_count: 1,
    compensation_band: 'rounds_2_3' as const,
    compensation_summary: 'Round 2 pick',
    identity_confidence: 'matched' as const,
    source_ref_ids: ['trades'],
  };
}
