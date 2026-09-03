import assert from 'node:assert/strict';
import test from 'node:test';
import type { NflPositionMarketGroup, NflSellerMoveRequest } from '@shared/types';
import { loadNflDemoSeed, type NflDemoSeed } from '../../src/nfl_data/seed.js';
import type { NflTransactionMarketSnapshot } from '../../src/nfl_transactions/analyze.js';
import {
  buildNflSellerMoveOptions,
  calculateNflSellerMove,
} from '../../src/nfl_transactions/model_move.js';
import { loadReviewedNflTransactionSnapshot } from '../../src/nfl_transactions/seed.js';

const GENERATED_AT = '2026-09-03T12:00:00.000Z';

test('move options expose only active Giants players with reconciled post-June trade rows', async () => {
  const seed = await loadNflDemoSeed();
  const { snapshot } = await loadReviewedNflTransactionSnapshot();
  const options = buildNflSellerMoveOptions(seed, 'NYG', ['CB', 'IOL', 'EDGE', 'IDL', 'LB'], snapshot);
  const active = new Set(seed.roster_entries.filter((row) => row.team_id === 'NYG' && row.roster_status === 'active').map((row) => row.player_id));

  assert.equal(options.schema_version, 'nfl_seller_move_options.v1');
  assert.deepEqual(options.positions.map((row) => row.position_group), ['CB', 'IOL', 'EDGE', 'IDL', 'LB']);
  for (const player of options.positions.flatMap((row) => row.players)) {
    const cap = seed.cap_rows.find((row) => row.player_id === player.player_id)!;
    assert.ok(active.has(player.player_id));
    assert.equal(cap.cap_number_2026! - cap.post_june_1_trade_dead_money_2026!, cap.post_june_1_trade_savings_2026);
    assert.ok(player.contract_source_url.startsWith('http'));
  }
  const playersFor = (position: NflPositionMarketGroup) => options.positions.find((row) => row.position_group === position)?.players.map((player) => player.player_name) ?? [];
  assert(playersFor('EDGE').includes('Brian Burns'));
  assert(!playersFor('LB').includes('Brian Burns'));
  assert(playersFor('IDL').includes('Shelby Harris'));
  assert(!playersFor('EDGE').includes('Shelby Harris'));
});

test('proposed pick year and round change the live historical comparison and comparable order', async () => {
  const { seed, player, position } = await fixturePlayer();
  const snapshot = fixtureSnapshot(position);
  const firstRound = calculateNflSellerMove(request(player.player_id, position, 2027, 1), seed, snapshot, GENERATED_AT);
  const futureSeventh = calculateNflSellerMove(request(player.player_id, position, 2029, 7), seed, snapshot, GENERATED_AT);

  assert.equal(firstRound.status, 'supported');
  assert.equal(firstRound.market.range, 'above');
  assert.equal(futureSeventh.market.range, 'below');
  assert.notEqual(firstRound.proposal.label, futureSeventh.proposal.label);
  assert.notEqual(firstRound.comparables[0].event_id, futureSeventh.comparables[0].event_id);
  assert.equal(firstRound.proposal.source, 'user_entered');
  assert.equal(firstRound.market.sample_size, 8);
});

test('cap, dead money, next-year effect, and depth come from the selected Giants rows', async () => {
  const { seed, player, position } = await fixturePlayer();
  const capRow = seed.cap_rows.find((row) => row.player_id === player.player_id)!;
  const result = calculateNflSellerMove(request(player.player_id, position, 2027, 3), seed, fixtureSnapshot(position), GENERATED_AT);

  assert.equal(result.cap.current_cap_number_dollars, capRow.cap_number_2026);
  assert.equal(result.cap.current_year_cap_space_created_dollars, capRow.post_june_1_trade_savings_2026);
  assert.equal(result.cap.current_year_dead_money_dollars, capRow.post_june_1_trade_dead_money_2026);
  assert.equal(result.cap.current_cap_number_dollars - result.cap.current_year_dead_money_dollars, result.cap.current_year_cap_space_created_dollars);
  assert.equal(result.cap.contract_source_url, capRow.source_url);
  assert.ok(result.depth.basis.length > 0);
  assert.ok(result.comparables.every((row) => row.source_url === 'https://example.test/trades'));
});

test('next-year cap effect is omitted when the loaded contract row cannot support it', async () => {
  const { seed, player, position } = await fixturePlayer();
  const capRow = seed.cap_rows.find((row) => row.player_id === player.player_id)!;
  capRow.source_data = { ...capRow.source_data, contract_years: [] };
  const result = calculateNflSellerMove(request(player.player_id, position, 2027, 3), seed, fixtureSnapshot(position), GENERATED_AT);

  assert.equal(result.cap.next_year, null);
  assert.ok(result.limitations.some((item) => item.includes('next-year cap effect')));
});

test('sparse or multi-player trade history does not create a market range', async () => {
  const { seed, player, position } = await fixturePlayer();
  const snapshot = fixtureSnapshot(position);
  snapshot.events = snapshot.events.slice(0, 4);
  snapshot.trade_assets = snapshot.trade_assets?.slice(0, 4);
  snapshot.events[0].trade_player_asset_count = 2;
  const result = calculateNflSellerMove(request(player.player_id, position, 2027, 3), seed, snapshot, GENERATED_AT);

  assert.equal(result.status, 'insufficient_evidence');
  assert.equal(result.market.range, null);
  assert.equal(result.market.sample_size, 3);
});

test('pick-swap deals are excluded rather than pricing the gross received pick as the player return', async () => {
  const { seed, player, position } = await fixturePlayer();
  const snapshot = fixtureSnapshot(position);
  snapshot.trade_assets?.push({
    asset_id: 'seller-outgoing-pick',
    trade_id: 'trade-0',
    event_year: 2017,
    trade_date: '2017-10-01',
    gave_team_id: 'AAA',
    received_team_id: 'BBB',
    asset_type: 'draft_pick',
    pfr_id: null,
    pfr_name: null,
    pick_season: 2018,
    pick_round: 2,
    pick_number: 50,
    conditional: false,
    source_ref_id: 'trades',
  });

  const result = calculateNflSellerMove(request(player.player_id, position, 2027, 3), seed, snapshot, GENERATED_AT);
  assert.equal(result.market.sample_size, 7);
  assert(!result.comparables.some((row) => row.event_id === 'trade-player-0'));
});

test('unresolved conditional picks are excluded from the fixed historical range', async () => {
  const { seed, player, position } = await fixturePlayer();
  const snapshot = fixtureSnapshot(position);
  snapshot.trade_assets![0].conditional = true;
  snapshot.trade_assets![0].pick_number = null;

  const result = calculateNflSellerMove(request(player.player_id, position, 2027, 3), seed, snapshot, GENERATED_AT);
  assert.equal(result.market.sample_size, 7);
  assert(!result.comparables.some((row) => row.event_id === 'trade-player-0'));
});

async function fixturePlayer(): Promise<{
  seed: NflDemoSeed;
  player: { player_id: string };
  position: NflPositionMarketGroup;
}> {
  const seed = structuredClone(await loadNflDemoSeed());
  const position: NflPositionMarketGroup = 'CB';
  const option = buildNflSellerMoveOptions(seed, 'NYG', [position], fixtureSnapshot(position)).positions[0]?.players[0];
  if (option) return { seed, player: option, position };
  throw new Error('test snapshot has no eligible Giants seller-move player');
}

function request(playerId: string, position: NflPositionMarketGroup, pickYear: number, pickRound: number): NflSellerMoveRequest {
  return {
    team_id: 'NYG',
    player_id: playerId,
    position_group: position,
    pick_year: pickYear,
    pick_round: pickRound,
    market_scope: {
      snapshot_id: 'seller-move-fixture',
      start_year: 2016,
      end_year: 2025,
      include_ytd: false,
      team_ids: [],
    },
  };
}

function fixtureSnapshot(position: NflPositionMarketGroup): NflTransactionMarketSnapshot {
  const rounds = [1, 2, 3, 4, 5, 6, 7, 7];
  const years = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024];
  return {
    snapshot_id: 'seller-move-fixture',
    events: years.map((year, index) => ({
      event_id: `trade-player-${index}`,
      event_year: year,
      event_date: `${year}-10-01`,
      date_precision: 'day',
      transaction_type: 'trade',
      player_id: `player-${index}`,
      player_name: `Comparable ${index}`,
      raw_position: position,
      position_group: position,
      normalization_basis: `provider position=${position}`,
      from_team_id: 'AAA',
      to_team_id: 'BBB',
      contract_value_dollars: null,
      contract_apy_dollars: null,
      guaranteed_dollars: null,
      compensation_pick_rounds: [rounds[index]],
      compensation_includes_player: false,
      trade_player_asset_count: 1,
      compensation_band: rounds[index] === 1 ? 'round_1' : rounds[index] <= 3 ? 'rounds_2_3' : 'rounds_4_7',
      compensation_summary: `${year + (index % 3) + 1} round ${rounds[index]} pick`,
      identity_confidence: 'matched',
      source_ref_ids: ['trades'],
      raw_source_record: { trade_id: `trade-${index}` },
    })),
    trade_assets: years.map((year, index) => ({
      asset_id: `pick-${index}`,
      trade_id: `trade-${index}`,
      event_year: year,
      trade_date: `${year}-10-01`,
      gave_team_id: 'BBB',
      received_team_id: 'AAA',
      asset_type: 'draft_pick',
      pfr_id: null,
      pfr_name: null,
      pick_season: year + (index % 3) + 1,
      pick_round: rounds[index],
      pick_number: null,
      conditional: false,
      source_ref_id: 'trades',
    })),
    roster_player_seasons: [],
    league_caps: [],
    source_refs: [{
      id: 'trades',
      name: 'nflverse trades test data',
      url: 'https://example.test/trades',
      upstream_attribution: 'Test fixture',
      retrieved_at: GENERATED_AT,
      as_of_date: '2026-09-02',
      checksum_sha256: 'a'.repeat(64),
      coverage_note: 'Test fixture only.',
    }],
  };
}
