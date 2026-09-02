import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyzeNflTransactionMarket,
  analyzeNflTransactionMarketSnapshot,
  type NflTransactionMarketEvent,
  type NflTransactionMarketSnapshot,
} from '../../src/nfl_transactions/analyze.js';
import type { NflPositionMarketGroup, NflTransactionMarketRequest } from '@shared/types';

const GENERATED_AT = '2026-09-02T16:00:00.000Z';

test('default completed-year analysis calculates yearly mobility, move share, and independent price signals', () => {
  const snapshot = fixtureSnapshot();
  const result = analyzeNflTransactionMarketSnapshot(defaultRequest(), snapshot, { generatedAt: GENERATED_AT });
  const repeated = analyzeNflTransactionMarketSnapshot(defaultRequest(), structuredClone(snapshot), { generatedAt: GENERATED_AT });

  assert.deepEqual(result, repeated);
  assert.equal(result.schema_version, 'nfl_transaction_market.v1');
  assert.deepEqual(result.query.baseline_years, [2016, 2018]);
  assert.deepEqual(result.query.recent_years, [2023, 2025]);
  assert.equal(result.query.end_year, 2025);
  assert.equal(result.yearly_series.length, 20);
  assert.equal(result.status, 'supported');

  const edge = result.position_trends.find((trend) => trend.position_group === 'EDGE')!;
  assert.equal(edge.status, 'supported');
  assert.equal(edge.direction, 'growing');
  assert.deepEqual(
    [edge.mobility.baseline_value, edge.mobility.recent_value],
    [400, 600],
  );
  assert.deepEqual(
    [edge.transaction_share.baseline_value, edge.transaction_share.recent_value],
    [4_000, 6_000],
  );
  assert.deepEqual(
    [edge.contract_price.baseline_value, edge.contract_price.recent_value],
    [500, 1_000],
  );
  assert.deepEqual(
    [edge.trade_compensation.baseline_value, edge.trade_compensation.recent_value],
    [0, 10_000],
  );

  const iol = result.position_trends.find((trend) => trend.position_group === 'IOL')!;
  assert.equal(iol.status, 'supported');
  assert.equal(iol.direction, 'shrinking');
  assert.deepEqual([iol.mobility.baseline_value, iol.mobility.recent_value], [300, 200]);
  assert.deepEqual([iol.transaction_share.baseline_value, iol.transaction_share.recent_value], [6_000, 4_000]);
  assert.deepEqual([iol.contract_price.baseline_value, iol.contract_price.recent_value], [750, 500]);
  assert.deepEqual([iol.trade_compensation.baseline_value, iol.trade_compensation.recent_value], [10_000, 0]);
});

test('post-2020 period comparison resolves non-overlapping cohorts and recomputes from raw rows', () => {
  const request: NflTransactionMarketRequest = {
    ...defaultRequest(),
    analysis_mode: 'period_comparison',
    comparison_year: 2020,
  };
  const result = analyzeNflTransactionMarketSnapshot(request, fixtureSnapshot(), { generatedAt: GENERATED_AT });

  assert.deepEqual(result.query.baseline_years, [2016, 2020]);
  assert.deepEqual(result.query.recent_years, [2021, 2025]);
  assert.equal(result.query.comparison_year, 2020);
  assert.equal(result.position_trends.find((trend) => trend.position_group === 'EDGE')?.direction, 'growing');
  assert.equal(result.position_trends.find((trend) => trend.position_group === 'IOL')?.direction, 'shrinking');
});

test('trades-only filtering removes contract price observations without changing the governed roster denominator', () => {
  const result = analyzeNflTransactionMarketSnapshot({
    ...defaultRequest(),
    transaction_types: ['trade'],
  }, fixtureSnapshot(), { generatedAt: GENERATED_AT });
  const edge = result.position_trends.find((trend) => trend.position_group === 'EDGE')!;

  assert.equal(result.coverage.contract_count, 0);
  assert.equal(result.coverage.priced_contract_count, 0);
  assert.equal(result.coverage.roster_player_seasons, 3_000);
  assert.equal(edge.contract_price.status, 'insufficient_evidence');
  assert.deepEqual([edge.mobility.baseline_value, edge.mobility.recent_value], [200, 300]);
  assert.ok(result.comparables.every((event) => event.transaction_type === 'trade'));
});

test('missing and wrong-scope roster denominators stay null instead of borrowing a league value', () => {
  const missing = fixtureSnapshot();
  missing.roster_player_seasons = missing.roster_player_seasons.filter((row) => !(
    row.year === 2025 && row.position_group === 'EDGE'
  ));
  const missingResult = analyzeNflTransactionMarketSnapshot({
    ...defaultRequest(),
    position_groups: ['EDGE'],
  }, missing, { generatedAt: GENERATED_AT });
  assert.equal(missingResult.yearly_series.find((row) => row.year === 2025)!.roster_player_seasons, 0);
  assert.equal(missingResult.yearly_series.find((row) => row.year === 2025)!.mobility_per_100_basis_points, null);
  assert.ok(missingResult.limitations.some((item) => item.includes('no roster denominator')));

  const teamScoped = analyzeNflTransactionMarketSnapshot({
    ...defaultRequest(),
    position_groups: ['EDGE'],
    team_ids: ['aaa'],
  }, fixtureSnapshot(), { generatedAt: GENERATED_AT });
  assert.deepEqual(teamScoped.query.team_ids, ['AAA']);
  assert.equal(teamScoped.coverage.event_count, 46);
  assert.equal(teamScoped.coverage.roster_player_seasons, 0);
  assert.ok(teamScoped.yearly_series.every((row) => row.mobility_per_100_basis_points == null));
});

test('EDGE and IOL stay separate and a supported opposing signal forces a mixed directional read', () => {
  const snapshot = fixtureSnapshot();
  for (let index = 0; index < 60; index += 1) {
    snapshot.events.push(releaseEvent(`league-noise-${index}`, 2024, 'IOL'));
  }
  const result = analyzeNflTransactionMarketSnapshot({
    ...defaultRequest(),
    position_groups: ['EDGE'],
  }, snapshot, { generatedAt: GENERATED_AT });
  const edge = result.position_trends[0];

  assert.equal(edge.mobility.direction, 'growing');
  assert.equal(edge.transaction_share.direction, 'shrinking');
  assert.equal(edge.direction, 'mixed');
  assert.equal(edge.status, 'directional');
  assert.equal(result.status, 'directional');
});

test('sparse samples are insufficient rather than extrapolated', () => {
  const snapshot = fixtureSnapshot();
  snapshot.events = snapshot.events.filter((event) => (
    event.position_group === 'EDGE'
    && ((event.event_year === 2016 && event.event_id.endsWith('-0'))
      || (event.event_year === 2025 && event.event_id.endsWith('-0')))
  ));
  const result = analyzeNflTransactionMarketSnapshot({
    ...defaultRequest(),
    position_groups: ['EDGE'],
  }, snapshot, { generatedAt: GENERATED_AT });

  assert.equal(result.position_trends[0].status, 'insufficient_evidence');
  assert.equal(result.position_trends[0].direction, 'insufficient_evidence');
  assert.equal(result.status, 'insufficient_evidence');
});

test('multi-player trade compensation remains unallocated in coverage, signals, and comparables', () => {
  const snapshot = fixtureSnapshot();
  const event = snapshot.events.find((row) => row.event_id === 'EDGE-2025-trade-0')!;
  event.trade_player_asset_count = 2;
  event.compensation_pick_rounds = [1];
  event.compensation_summary = 'Two players and a first-round pick changed sides.';
  const result = analyzeNflTransactionMarketSnapshot({
    ...defaultRequest(),
    position_groups: ['EDGE'],
    max_comparables: 50,
  }, snapshot, { generatedAt: GENERATED_AT });
  const comparable = result.comparables.find((row) => row.event_id === event.event_id)!;

  assert.equal(comparable.compensation_band, null);
  assert.match(comparable.compensation_summary!, /not allocated per player/i);
  assert.equal(result.coverage.allocable_trade_count, 22);
  assert.ok(result.limitations.some((item) => item.includes('multi-player trade')));
});

test('identity coverage below the firm gate downgrades otherwise adequate samples', () => {
  const snapshot = fixtureSnapshot();
  const edgePeriodRows = snapshot.events.filter((event) => event.position_group === 'EDGE'
    && ([2016, 2017, 2018, 2023, 2024, 2025].includes(event.event_year)));
  for (const event of edgePeriodRows.filter((row) => row.event_year <= 2018).slice(0, 2)) {
    event.identity_confidence = 'directional';
  }
  for (const event of edgePeriodRows.filter((row) => row.event_year >= 2023).slice(0, 2)) {
    event.identity_confidence = 'directional';
  }
  const result = analyzeNflTransactionMarketSnapshot({
    ...defaultRequest(),
    position_groups: ['EDGE'],
  }, snapshot, { generatedAt: GENERATED_AT });

  assert.equal(result.position_trends[0].status, 'directional');
  assert.equal(result.status, 'directional');
  assert.ok(result.coverage.position_match_basis_points < 9_500);
  assert.ok(result.coverage.position_match_basis_points >= 8_500);
  assert.ok(result.limitations.some((item) => item.includes('identity matches')));
});

test('identity coverage below 85 percent is insufficient even with adequate samples', () => {
  const snapshot = fixtureSnapshot();
  const edgeRows = snapshot.events.filter((event) => event.position_group === 'EDGE');
  for (const event of edgeRows.slice(0, 9)) event.identity_confidence = 'directional';
  const result = analyzeNflTransactionMarketSnapshot({
    ...defaultRequest(),
    position_groups: ['EDGE'],
  }, snapshot, { generatedAt: GENERATED_AT });

  assert.ok(result.coverage.position_match_basis_points < 8_500);
  assert.equal(result.position_trends[0].status, 'insufficient_evidence');
  assert.equal(result.status, 'insufficient_evidence');
});

test('fractional contract, guarantee, APY, and cap dollars are rejected', () => {
  for (const mutate of [
    (snapshot: NflTransactionMarketSnapshot) => { snapshot.events[0].contract_value_dollars = 1_000.25; },
    (snapshot: NflTransactionMarketSnapshot) => { snapshot.events[0].contract_apy_dollars = 100.5; },
    (snapshot: NflTransactionMarketSnapshot) => { snapshot.events[0].guaranteed_dollars = 100.5; },
    (snapshot: NflTransactionMarketSnapshot) => { snapshot.league_caps[0].league_cap_dollars = 200_000_000.5; },
  ]) {
    const snapshot = fixtureSnapshot();
    mutate(snapshot);
    assert.throws(
      () => analyzeNflTransactionMarketSnapshot(defaultRequest(), snapshot, { generatedAt: GENERATED_AT }),
      /integer/,
    );
  }
});

test('comparables are traceable and influence is explicitly leave-one-out statistical sensitivity', () => {
  const result = analyzeNflTransactionMarketSnapshot(defaultRequest(), fixtureSnapshot(), { generatedAt: GENERATED_AT });

  assert.ok(result.comparables.length > 0);
  assert.ok(result.comparables.every((row) => row.source_ref_ids.length > 0));
  assert.ok(result.influential_transactions.length > 0);
  assert.ok(result.influential_transactions.every((row) => row.influence_basis_points! > 0));
  assert.ok(result.influential_transactions.every((row) => /not a causal estimate/i.test(row.influence_explanation!)));
});

test('an isolated inserted transaction changes computed statistics and the deterministic analysis identity', () => {
  const beforeSnapshot = fixtureSnapshot();
  const before = analyzeNflTransactionMarketSnapshot(defaultRequest(), beforeSnapshot, { generatedAt: GENERATED_AT });
  const afterSnapshot = structuredClone(beforeSnapshot);
  afterSnapshot.events.push(releaseEvent('inserted-edge-2025', 2025, 'EDGE'));
  const after = analyzeNflTransactionMarketSnapshot(defaultRequest(), afterSnapshot, { generatedAt: GENERATED_AT });

  const beforeMobility = before.position_trends.find((trend) => trend.position_group === 'EDGE')!.mobility.recent_value;
  const afterMobility = after.position_trends.find((trend) => trend.position_group === 'EDGE')!.mobility.recent_value;
  assert.notEqual(afterMobility, beforeMobility);
  assert.notEqual(after.analysis_id, before.analysis_id);
});

test('analysis does not mutate the frozen snapshot input', () => {
  const snapshot = fixtureSnapshot();
  const before = structuredClone(snapshot);
  analyzeNflTransactionMarketSnapshot(defaultRequest(), snapshot, { generatedAt: GENERATED_AT });
  assert.deepEqual(snapshot, before);
});

test('snapshot loading is injectable and called once per analysis', async () => {
  let calls = 0;
  const result = await analyzeNflTransactionMarket(defaultRequest(), {
    loadSnapshot: async () => {
      calls += 1;
      return fixtureSnapshot();
    },
    generatedAt: GENERATED_AT,
  });

  assert.equal(calls, 1);
  assert.equal(result.snapshot_id, 'fixture-snapshot-v1');
});

function defaultRequest(): NflTransactionMarketRequest {
  return {
    analysis_mode: 'ten_year_trend',
    position_groups: ['EDGE', 'IOL'],
    max_comparables: 12,
  };
}

function fixtureSnapshot(): NflTransactionMarketSnapshot {
  const events: NflTransactionMarketEvent[] = [];
  for (let year = 2016; year <= 2025; year += 1) {
    const phase = year <= 2018 ? 'baseline' : year >= 2023 ? 'recent' : 'middle';
    const edgeCount = phase === 'baseline' ? 4 : phase === 'recent' ? 6 : 4;
    const iolCount = phase === 'baseline' ? 6 : phase === 'recent' ? 4 : 4;
    events.push(...positionYearEvents('EDGE', year, edgeCount, phase));
    events.push(...positionYearEvents('IOL', year, iolCount, phase));
  }
  return {
    snapshot_id: 'fixture-snapshot-v1',
    events,
    roster_player_seasons: Array.from({ length: 10 }, (_, offset) => 2016 + offset).flatMap((year) => [
      { year, team_id: null, position_group: 'EDGE' as const, roster_player_seasons: 100, source_ref_ids: ['rosters'] },
      { year, team_id: null, position_group: 'IOL' as const, roster_player_seasons: 200, source_ref_ids: ['rosters'] },
    ]),
    league_caps: Array.from({ length: 10 }, (_, offset) => ({
      year: 2016 + offset,
      league_cap_dollars: 200_000_000,
      source_ref_ids: ['contracts'],
    })),
    source_refs: [
      sourceRef('trades'),
      sourceRef('contracts'),
      sourceRef('rosters'),
    ],
  };
}

function positionYearEvents(
  position: NflPositionMarketGroup,
  year: number,
  count: number,
  phase: 'baseline' | 'middle' | 'recent',
): NflTransactionMarketEvent[] {
  const contractCount = Math.floor(count / 2);
  const rows: NflTransactionMarketEvent[] = [];
  for (let index = 0; index < count; index += 1) {
    if (index < contractCount) {
      const apy = position === 'EDGE'
        ? phase === 'baseline' ? 10_000_000 : phase === 'recent' ? 20_000_000 : 14_000_000
        : phase === 'baseline' ? 15_000_000 : phase === 'recent' ? 10_000_000 : 12_000_000;
      const guaranteeShare = position === 'EDGE'
        ? phase === 'baseline' ? 0.5 : phase === 'recent' ? 0.6 : 0.55
        : phase === 'baseline' ? 0.6 : phase === 'recent' ? 0.5 : 0.55;
      const value = apy * 4;
      rows.push(baseEvent({
        id: `${position}-${year}-contract-${index}`,
        year,
        position,
        type: 'free_agent_signing',
        contractValue: value,
        contractApy: apy,
        guaranteed: Math.round(value * guaranteeShare),
      }));
    } else {
      const premium = position === 'EDGE' ? phase === 'recent' : phase === 'baseline';
      rows.push(baseEvent({
        id: `${position}-${year}-trade-${index - contractCount}`,
        year,
        position,
        type: 'trade',
        pickRounds: [premium ? 2 : 5],
      }));
    }
  }
  return rows;
}

function releaseEvent(id: string, year: number, position: NflPositionMarketGroup): NflTransactionMarketEvent {
  return baseEvent({ id, year, position, type: 'release' });
}

function baseEvent(args: {
  id: string;
  year: number;
  position: NflPositionMarketGroup;
  type: NflTransactionMarketEvent['transaction_type'];
  contractValue?: number;
  contractApy?: number;
  guaranteed?: number;
  pickRounds?: number[];
}): NflTransactionMarketEvent {
  return {
    event_id: args.id,
    event_year: args.year,
    event_date: `${args.year}-06-15`,
    date_precision: 'day',
    transaction_type: args.type,
    player_id: `player-${args.id}`,
    player_name: `Player ${args.id}`,
    position_group: args.position,
    from_team_id: 'AAA',
    to_team_id: 'BBB',
    contract_value_dollars: args.contractValue ?? null,
    contract_apy_dollars: args.contractApy ?? null,
    guaranteed_dollars: args.guaranteed ?? null,
    compensation_pick_rounds: args.pickRounds,
    compensation_includes_player: false,
    trade_player_asset_count: args.type === 'trade' ? 1 : null,
    compensation_band: null,
    compensation_summary: args.type === 'trade' ? `Round ${args.pickRounds?.[0]} pick` : null,
    identity_confidence: 'matched',
    source_ref_ids: [args.type === 'trade' ? 'trades' : 'contracts'],
  };
}

function sourceRef(id: string) {
  return {
    id,
    name: `Fixture ${id}`,
    url: `https://example.test/${id}`,
    upstream_attribution: 'Test fixture only',
    retrieved_at: GENERATED_AT,
    as_of_date: '2026-09-02',
    checksum_sha256: 'a'.repeat(64),
    coverage_note: 'Deterministic test fixture.',
  };
}
