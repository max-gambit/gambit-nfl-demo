import assert from 'node:assert/strict';
import test from 'node:test';
import type { NflSellerMoveScenarioState, NflTransactionMarketResolvedQuery } from '@shared/types';
import { classifyNflAnalysisTurn } from '../../src/nfl_transactions/intent.js';

const market: NflTransactionMarketResolvedQuery = {
  analysis_mode: 'ten_year_trend',
  start_year: 2016,
  end_year: 2025,
  baseline_years: [2016, 2018],
  recent_years: [2023, 2025],
  comparison_year: null,
  team_ids: [],
  position_groups: ['EDGE', 'IOL'],
  transaction_types: ['trade', 'extension'],
  include_ytd: false,
  max_comparables: 12,
};

const scenario: NflSellerMoveScenarioState = {
  team_id: 'NYG',
  player_id: 'burns',
  player_name: 'Brian Burns',
  player_query: 'Brian Burns',
  position_group: 'EDGE',
  pick_year: 2027,
  pick_round: 2,
  market_scope: {
    snapshot_id: 'snapshot',
    start_year: 2016,
    end_year: 2025,
    include_ytd: false,
    team_ids: [],
  },
};

const fresh = { market_query: null, seller_scenario: null };
const marketChannel = { market_query: market, seller_scenario: null };
const sellerChannel = { market_query: market, seller_scenario: scenario };

test('server intent matrix keeps prior context bounded to recognizable continuations', () => {
  const cases = [
    ['Which position markets have grown or shrunk over the last 10 years?', fresh, 'transaction_market', false],
    ['What if we moved Brian Burns for a 2027 second?', fresh, 'seller_move', false],
    ['Make it a first.', fresh, 'seller_modifier_without_context', false],
    ['Show me trades only.', marketChannel, 'transaction_market', true],
    ['Compare edge rushers with interior offensive linemen.', marketChannel, 'transaction_market', true],
    ['What changed after 2020?', marketChannel, 'transaction_market', true],
    ['Which recent transactions most influenced that conclusion?', marketChannel, 'transaction_market', true],
    ['Make it a first.', sellerChannel, 'seller_move', false],
    ['Use 2028.', sellerChannel, 'seller_move', false],
    ['What about Thibodeaux instead?', sellerChannel, 'seller_move', false],
    ['Show me the trades behind that.', sellerChannel, 'seller_move', false],
    ['What are post-June 1 trade rules?', fresh, 'rules', false],
    ['What are post-June 1 trade rules?', sellerChannel, 'rules', false],
    ['What if we moved Brian Burns for a 2027 second after June 1?', fresh, 'seller_move', false],
    ['How has the franchise-tag transaction market changed since 2020?', fresh, 'transaction_market', false],
    ['How does the PUP list work?', fresh, 'rules', false],
    ['How do compensatory picks work?', fresh, 'rules', false],
    ['How much cap room do the Giants have?', marketChannel, 'current_team', false],
    ['Who are the Giants starting cornerbacks right now?', marketChannel, 'current_team', false],
    ['Which Giants contracts have the largest 2026 cap hits?', sellerChannel, 'current_team', false],
    ['How much cap space do the New York Jets have?', marketChannel, 'general', false],
    ['Who is on the Giants roster?', marketChannel, 'general', false],
    ['How would a scout grade the current edge depth?', sellerChannel, 'general', false],
    ['How does that affect our draft strategy?', sellerChannel, 'general', false],
  ] as const;

  for (const [question, context, expectedKind, shouldInherit] of cases) {
    const intent = classifyNflAnalysisTurn(question, context);
    assert.equal(intent.kind, expectedKind, question);
    assert.equal(intent.kind === 'transaction_market' && intent.inherited_query !== null, shouldInherit, question);
  }
});

test('seller scenario state cannot activate a shorthand turn in another channel', () => {
  assert.equal(classifyNflAnalysisTurn('Make it a first.', sellerChannel).kind, 'seller_move');
  assert.equal(classifyNflAnalysisTurn('Make it a first.', fresh).kind, 'seller_modifier_without_context');
});
