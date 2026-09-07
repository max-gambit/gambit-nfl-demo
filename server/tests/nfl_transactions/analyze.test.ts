import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import {
  analyzeNflTransactionMarket,
  analyzeNflTransactionMarketSnapshot,
  type NflTransactionMarketEvent,
  type NflTransactionMarketSnapshot,
  type NflTransactionTradeAsset,
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

test('2026 YTD is returned as context but excluded from completed-year comparison windows', () => {
  const snapshot = fixtureSnapshot();
  const completed = analyzeNflTransactionMarketSnapshot(defaultRequest(), structuredClone(snapshot), { generatedAt: GENERATED_AT });
  snapshot.events.push(...positionYearEvents('EDGE', 2026, 20, 'recent'));
  const result = analyzeNflTransactionMarketSnapshot({
    ...defaultRequest(),
    include_ytd: true,
    end_year: 2026,
  }, snapshot, { generatedAt: GENERATED_AT });

  assert.deepEqual(result.query.recent_years, [2023, 2025]);
  assert.equal(result.query.end_year, 2026);
  assert.equal(result.position_trends.find((trend) => trend.position_group === 'EDGE')?.mobility.recent_value, 600);
  assert.equal(
    result.position_trends.find((trend) => trend.position_group === 'EDGE')?.mobility.overall_value,
    completed.position_trends.find((trend) => trend.position_group === 'EDGE')?.mobility.overall_value,
  );
  assert.equal(result.yearly_series.find((row) => row.year === 2026 && row.position_group === 'EDGE')?.event_count, 20);
  assert.equal(result.yearly_series.find((row) => row.year === 2026 && row.position_group === 'EDGE')?.mobility_per_100_basis_points, null);
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

test('since-year trade questions expose an all-years day-one or day-two compensation share', () => {
  const snapshot = fixtureSnapshot();
  const result = analyzeNflTransactionMarketSnapshot({
    analysis_mode: 'ten_year_trend',
    start_year: 2018,
    end_year: 2025,
    position_groups: ['EDGE'],
    transaction_types: ['trade'],
  }, snapshot, { generatedAt: GENERATED_AT });
  const eligible = snapshot.events.filter((event) => (
    event.position_group === 'EDGE'
    && event.transaction_type === 'trade'
    && event.event_year >= 2018
    && event.event_year <= 2025
  ));
  const premium = eligible.filter((event) => Math.min(...(event.compensation_pick_rounds ?? [99])) <= 3).length;

  assert.equal(
    result.position_trends[0].trade_compensation.overall_value,
    Math.round((premium / eligible.length) * 10_000),
  );
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

test('unallocated in-scope identities lower the confidence gate instead of disappearing before it', () => {
  const snapshot = fixtureSnapshot();
  for (let index = 0; index < 12; index += 1) {
    snapshot.events.push({
      ...releaseEvent(`ambiguous-${index}`, 2024, 'EDGE'),
      position_group: null,
      raw_position: 'DE',
      identity_confidence: 'unmatched',
      normalization_basis: 'ambiguous DE/OLB mapping excluded from precise EDGE comparison',
    });
  }
  const result = analyzeNflTransactionMarketSnapshot({
    ...defaultRequest(),
    position_groups: ['EDGE'],
  }, snapshot, { generatedAt: GENERATED_AT });

  assert.ok(result.coverage.position_match_basis_points < 8_500);
  assert.equal(result.status, 'insufficient_evidence');
  assert.ok(result.limitations.some((item) => item.includes('12 in-scope events lack an allocated position')));
});

test('identity confidence is gated independently for each requested position', () => {
  const snapshot = fixtureSnapshot();
  for (let index = 0; index < 12; index += 1) {
    snapshot.events.push({
      ...releaseEvent(`edge-ambiguous-${index}`, 2024, 'EDGE'),
      position_group: null,
      raw_position: 'DE',
      identity_confidence: 'unmatched',
      normalization_basis: 'ambiguous DE/OLB mapping excluded from precise EDGE comparison',
    });
  }
  const result = analyzeNflTransactionMarketSnapshot(defaultRequest(), snapshot, { generatedAt: GENERATED_AT });

  assert.equal(result.position_trends.find((trend) => trend.position_group === 'EDGE')?.status, 'insufficient_evidence');
  assert.equal(result.position_trends.find((trend) => trend.position_group === 'IOL')?.status, 'supported');
  assert.equal(result.status, 'directional');
});

test('price-signal identity gates use only the transaction type behind that price', () => {
  const snapshot = fixtureSnapshot();
  for (let index = 0; index < 4; index += 1) {
    snapshot.events.push(baseEvent({
      id: `EDGE-2016-extra-contract-${index}`,
      year: 2016,
      position: 'EDGE',
      type: 'free_agent_signing',
      contractValue: 40_000_000,
      contractApy: 10_000_000,
      guaranteed: 20_000_000,
    }));
  }
  snapshot.events.push(baseEvent({
    id: 'EDGE-2025-extra-contract',
    year: 2025,
    position: 'EDGE',
    type: 'free_agent_signing',
    contractValue: 80_000_000,
    contractApy: 20_000_000,
    guaranteed: 48_000_000,
  }));
  for (const event of snapshot.events.filter((row) => row.position_group === 'EDGE' && row.transaction_type === 'trade')) {
    event.identity_confidence = 'directional';
  }
  const result = analyzeNflTransactionMarketSnapshot({
    ...defaultRequest(),
    position_groups: ['EDGE'],
  }, snapshot, { generatedAt: GENERATED_AT });
  const edge = result.position_trends[0];

  assert.equal(edge.contract_price.status, 'supported');
  assert.notEqual(edge.trade_compensation.status, 'supported');
});

test('a requested zero-event position remains visible and prevents an overall supported label', () => {
  const result = analyzeNflTransactionMarketSnapshot({
    ...defaultRequest(),
    position_groups: ['EDGE', 'ST'],
  }, fixtureSnapshot(), { generatedAt: GENERATED_AT });

  assert.equal(result.position_trends.find((trend) => trend.position_group === 'EDGE')?.status, 'supported');
  assert.equal(result.position_trends.find((trend) => trend.position_group === 'ST')?.status, 'insufficient_evidence');
  assert.equal(result.position_trends.find((trend) => trend.position_group === 'ST')?.event_count, 0);
  assert.equal(result.status, 'directional');
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

test('analysis identity changes when returned provenance or normalization detail changes', () => {
  const beforeSnapshot = fixtureSnapshot();
  const before = analyzeNflTransactionMarketSnapshot(defaultRequest(), beforeSnapshot, { generatedAt: GENERATED_AT });
  const afterSnapshot = structuredClone(beforeSnapshot);
  afterSnapshot.events[0].normalization_basis = 'revised provider mapping boundary';
  const after = analyzeNflTransactionMarketSnapshot(defaultRequest(), afterSnapshot, { generatedAt: GENERATED_AT });
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

test('public EDGE history persists every matching player event and whole deal beyond the comparable cap', async () => {
  const manifestUrl = new URL('../../../data/nfl-transactions/manifest.json', import.meta.url);
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
  const snapshot: NflTransactionMarketSnapshot = JSON.parse(gunzipSync(
    await readFile(new URL(manifest.snapshot_file, manifestUrl)),
  ).toString('utf8'));
  const request: NflTransactionMarketRequest = {
    analysis_mode: 'comparables', start_year: 2016, end_year: 2025,
    position_groups: ['EDGE'], transaction_types: ['trade'], max_comparables: 12,
  };
  const result = analyzeNflTransactionMarketSnapshot(request, snapshot, { generatedAt: GENERATED_AT });
  const expected = snapshot.events.filter((event) => event.position_group === 'EDGE'
    && event.transaction_type === 'trade' && event.event_year >= request.start_year!
    && event.event_year <= request.end_year!);
  const expectedDeals = new Set(expected.map((event) => event.raw_source_record!.trade_id));
  assert.ok(expected.length > result.query.max_comparables);
  assert.ok(expectedDeals.size < expected.length, 'multi-player trades must not count as distinct deals per player');
  assert.equal(result.coverage.event_count, expected.length);
  assert.equal(result.coverage.trade_count, expected.length);
  assert.equal(result.coverage.distinct_trade_count, expectedDeals.size);
  assert.equal(result.coverage.unidentified_trade_event_count, 0);
  assert.deepEqual(result.full_cohort!.map((row) => row.event_id).sort(), expected.map((row) => row.event_id).sort());
  assert.deepEqual(result.comparables, result.full_cohort!.slice(0, result.query.max_comparables));
  for (const row of result.full_cohort!) {
    const assets = snapshot.trade_assets!.filter((asset) => asset.trade_id === row.trade_id)
      .sort((a, b) => a.asset_id.localeCompare(b.asset_id));
    assert.ok(assets.length > 0);
    assert.deepEqual(row.trade_package?.assets, assets);
    for (const asset of assets) {
      assert.ok(row.source_ref_ids.includes(asset.source_ref_id));
      assert.ok(result.source_refs.some((source) => source.id === asset.source_ref_id));
    }
  }
  const burns = result.full_cohort!.find((row) => row.player_name === 'Brian Burns' && row.event_year === 2024)!;
  assert.ok(burns.trade_package?.assets.some((asset) => asset.gave_team_id === 'CAR'
    && asset.received_team_id === 'NYG' && asset.pick_season === 2024
    && asset.pick_round === 5 && asset.pick_number === 166));
  assert.ok(burns.trade_package?.assets.some((asset) => asset.gave_team_id === 'NYG'
    && asset.received_team_id === 'CAR' && asset.pick_season === 2025 && asset.conditional === true));
  assert.deepEqual(JSON.parse(JSON.stringify(result)).full_cohort, result.full_cohort);
});

test('cohort filtering retains multi-player packages, both directions, future picks and asset-only provenance', () => {
  const snapshot = packageFixtureSnapshot();
  const before = structuredClone(snapshot);
  const result = analyzeNflTransactionMarketSnapshot({
    ...defaultRequest(), position_groups: ['EDGE'], transaction_types: ['trade'], team_ids: ['AAA'], max_comparables: 1,
  }, snapshot, { generatedAt: GENERATED_AT });
  const expected = snapshot.events.filter((event) => event.position_group === 'EDGE'
    && event.transaction_type === 'trade' && event.event_year >= 2016
    && (event.from_team_id === 'AAA' || event.to_team_id === 'AAA'));
  assert.equal(result.full_cohort?.length, expected.length);
  assert.equal(result.comparables.length, 1);
  assert.equal(result.coverage.trade_count, expected.length);
  assert.equal(result.coverage.distinct_trade_count, 1);
  assert.ok(result.full_cohort!.every((row) => row.compensation_band === null));
  for (const row of result.full_cohort!) {
    assert.deepEqual(row.trade_package?.assets, snapshot.trade_assets);
    assert.ok(row.trade_package?.assets.some((asset) => asset.pfr_name === 'Other position player'));
    assert.ok(row.trade_package?.assets.some((asset) => asset.pick_season === 2027));
    assert.ok(row.source_ref_ids.includes('package-source'));
    assert.match(row.compensation_summary!, /not allocated per player/);
  }
  assert.ok(result.source_refs.some((source) => source.id === 'package-source'));
  assert.deepEqual(snapshot, before);

  const largerSample = analyzeNflTransactionMarketSnapshot({
    ...result.query, comparison_year: result.query.comparison_year ?? undefined, max_comparables: 50,
  }, snapshot, { generatedAt: GENERATED_AT });
  assert.deepEqual(result.full_cohort, largerSample.full_cohort);
  assert.deepEqual(result.yearly_series, largerSample.yearly_series);
  assert.deepEqual(result.position_trends, largerSample.position_trends);
  assert.deepEqual(result.coverage, largerSample.coverage);
  assert.deepEqual(result.comparables, largerSample.comparables.slice(0, result.query.max_comparables));
  assert.deepEqual(result.influential_transactions, largerSample.influential_transactions.slice(0, result.query.max_comparables));
});

test('calculation-only snapshots retain unknown deal counts and missing packages instead of fabricating identities', () => {
  const snapshot = fixtureSnapshot();
  const result = analyzeNflTransactionMarketSnapshot(defaultRequest(), snapshot, { generatedAt: GENERATED_AT });
  assert.equal(result.full_cohort?.length, snapshot.events.length);
  assert.equal(result.coverage.distinct_trade_count, null);
  assert.equal(result.coverage.unidentified_trade_event_count, result.coverage.trade_count);
  assert.ok(result.full_cohort!.every((row) => row.trade_id === null && row.trade_package === null));

  const identifiedWithoutAssets = packageFixtureSnapshot();
  delete identifiedWithoutAssets.trade_assets;
  const knownDeals = analyzeNflTransactionMarketSnapshot({
    ...defaultRequest(), position_groups: ['EDGE'], transaction_types: ['trade'], team_ids: ['AAA'],
  }, identifiedWithoutAssets);
  assert.equal(knownDeals.coverage.distinct_trade_count, 1);
  assert.ok(knownDeals.full_cohort!.every((row) => row.trade_id === 'whole-deal' && row.trade_package === null));

  const nonTrade = analyzeNflTransactionMarketSnapshot({ ...defaultRequest(), transaction_types: ['free_agent_signing'] }, snapshot);
  assert.equal(nonTrade.coverage.distinct_trade_count, 0);
  assert.equal(nonTrade.coverage.trade_count, 0);
  const empty = analyzeNflTransactionMarketSnapshot({ ...defaultRequest(), position_groups: ['QB'] }, snapshot);
  assert.deepEqual(empty.full_cohort, []);
  assert.equal(empty.coverage.distinct_trade_count, 0);
});

test('YTD events join the complete cohort without changing completed-year calculation windows', () => {
  const snapshot = packageFixtureSnapshot();
  const ytd = { ...snapshot.events[0], event_id: 'ytd-event', event_year: 2026, event_date: '2026-06-15', trade_id: 'ytd-deal' };
  snapshot.events.push(ytd);
  const request = { ...defaultRequest(), position_groups: ['EDGE'] as NflPositionMarketGroup[] };
  const completed = analyzeNflTransactionMarketSnapshot(request, snapshot);
  const withYtd = analyzeNflTransactionMarketSnapshot({ ...request, include_ytd: true }, snapshot);
  assert.ok(!completed.full_cohort!.some((row) => row.event_id === ytd.event_id));
  assert.ok(withYtd.full_cohort!.some((row) => row.event_id === ytd.event_id));
  assert.equal(withYtd.coverage.event_count, completed.coverage.event_count + 1);
  assert.deepEqual(
    withYtd.position_trends.map(({ event_count, ...trend }) => trend),
    completed.position_trends.map(({ event_count, ...trend }) => trend),
  );
});

test('package corrections change artifact identity without changing player compensation calculations', () => {
  const snapshot = packageFixtureSnapshot();
  const before = analyzeNflTransactionMarketSnapshot(defaultRequest(), snapshot);
  const reordered = structuredClone(snapshot);
  reordered.trade_assets!.reverse();
  assert.deepEqual(analyzeNflTransactionMarketSnapshot(defaultRequest(), reordered), before);
  for (const change of [
    (asset: NflTransactionTradeAsset) => { asset.pick_number = 167; },
    (asset: NflTransactionTradeAsset) => { asset.conditional = true; },
    (asset: NflTransactionTradeAsset) => { asset.gave_team_id = 'CCC'; },
    (asset: NflTransactionTradeAsset) => { asset.raw_source_record = { conditional: 'revised condition' }; },
  ]) {
    const changed = structuredClone(snapshot);
    change(changed.trade_assets!.at(-1)!);
    const after = analyzeNflTransactionMarketSnapshot(defaultRequest(), changed);
    assert.notEqual(after.analysis_id, before.analysis_id);
    assert.deepEqual(after.position_trends, before.position_trends);
    assert.deepEqual(after.yearly_series, before.yearly_series);
  }
  const invalid = structuredClone(snapshot);
  invalid.trade_assets![0].source_ref_id = 'unregistered-source';
  assert.throws(() => analyzeNflTransactionMarketSnapshot(defaultRequest(), invalid), /unknown source reference/);
});

function packageFixtureSnapshot(): NflTransactionMarketSnapshot {
  const snapshot = fixtureSnapshot();
  const player = baseEvent({ id: 'matching-edge', year: 2024, position: 'EDGE', type: 'trade', pickRounds: [2] });
  player.raw_source_record = { trade_id: 'whole-deal' };
  player.trade_player_asset_count = 3;
  snapshot.events = [
    player,
    { ...player, event_id: 'other-edge', player_id: 'other-edge', player_name: 'Other EDGE' },
    { ...player, event_id: 'other-position', position_group: 'CB', player_name: 'Other position player', from_team_id: 'BBB', to_team_id: 'AAA' },
    { ...player, event_id: 'other-team', from_team_id: 'CCC', to_team_id: 'DDD', trade_id: 'other-deal' },
    { ...player, event_id: 'outside-years', event_year: 2015, event_date: '2015-06-15', trade_id: 'older-deal' },
    releaseEvent('non-trade', 2025, 'EDGE'),
  ];
  const asset = (asset_id: string, changes: Partial<NflTransactionTradeAsset>): NflTransactionTradeAsset => ({
    asset_id, trade_id: 'whole-deal', event_year: 2024, trade_date: '2024-06-15',
    gave_team_id: 'AAA', received_team_id: 'BBB', asset_type: 'player',
    pfr_id: asset_id, pfr_name: 'Player', pick_season: null, pick_round: null,
    pick_number: null, conditional: null, source_ref_id: 'trades', ...changes,
  });
  snapshot.trade_assets = [
    asset('asset-1', { pfr_name: player.player_name }),
    asset('asset-2', { pfr_name: 'Other EDGE' }),
    asset('asset-3', { pfr_name: 'Other position player', gave_team_id: 'BBB', received_team_id: 'AAA' }),
    asset('asset-4', { asset_type: 'draft_pick', pfr_id: null, pfr_name: null, gave_team_id: 'BBB', received_team_id: 'AAA',
      pick_season: 2027, pick_round: 2, conditional: true, raw_source_record: { conditional: 'if playing-time threshold is met' }, source_ref_id: 'package-source' }),
    asset('asset-5', { asset_type: 'draft_pick', pfr_id: null, pfr_name: null, pick_season: 2024, pick_round: 5, pick_number: 166, conditional: false }),
  ];
  snapshot.source_refs.push(sourceRef('package-source'));
  return snapshot;
}

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
