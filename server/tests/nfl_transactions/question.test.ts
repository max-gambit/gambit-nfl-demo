import assert from 'node:assert/strict';
import test from 'node:test';
import { isNflTransactionMarketQuestion, transactionMarketRequestFromQuestion } from '../../src/nfl_transactions/question.js';

test('recognizes novel market-analysis questions without matching stored answer text', () => {
  assert.equal(isNflTransactionMarketQuestion('Which position markets have grown or shrunk over the last 10 years?'), true);
  assert.equal(isNflTransactionMarketQuestion('Who is on the Giants roster?'), false);
});

test('explicit follow-up filters override inherited scope', () => {
  const inherited = {
    analysis_mode: 'ten_year_trend' as const,
    start_year: 2016,
    end_year: 2025,
    baseline_years: [2016, 2018] as [number, number],
    recent_years: [2023, 2025] as [number, number],
    comparison_year: null,
    team_ids: [],
    position_groups: ['WR' as const],
    transaction_types: ['trade' as const, 'extension' as const],
    include_ytd: false,
    max_comparables: 12,
  };

  const trades = transactionMarketRequestFromQuestion('Show me trades only.', inherited);
  assert.deepEqual(trades.transaction_types, ['trade']);
  assert.deepEqual(trades.position_groups, ['WR']);

  const positions = transactionMarketRequestFromQuestion('Compare edge rushers with interior offensive linemen.', inherited);
  assert.deepEqual(positions.position_groups, ['IOL', 'EDGE']);
  assert.equal(positions.analysis_mode, 'ten_year_trend');

  const period = transactionMarketRequestFromQuestion('What changed after 2020?', inherited);
  assert.equal(period.comparison_year, 2020);
  assert.equal(period.analysis_mode, 'period_comparison');

  const influence = transactionMarketRequestFromQuestion('Which recent transactions most influenced that conclusion?', inherited);
  assert.equal(influence.analysis_mode, 'recent_influence');

  const scopedToPhiladelphia = { ...inherited, team_ids: ['PHI'] };
  const giants = transactionMarketRequestFromQuestion('Show me Giants trades only.', scopedToPhiladelphia);
  assert.deepEqual(giants.team_ids, ['NYG']);

  const leaguewide = transactionMarketRequestFromQuestion('Show me trades across the NFL.', scopedToPhiladelphia);
  assert.equal(leaguewide.team_ids, undefined);
});

test('parses unplanned trade and position variations', () => {
  const tradeReturns = transactionMarketRequestFromQuestion('Among trades since 2018, which positions most often returned day-one or day-two picks?');
  assert.equal(tradeReturns.start_year, 2018);
  assert.deepEqual(tradeReturns.transaction_types, ['trade']);

  const beforeAfter = transactionMarketRequestFromQuestion('Compare safety and running-back material-move rates before and after 2020.');
  assert.deepEqual(beforeAfter.position_groups, ['RB', 'S']);
  assert.equal(beforeAfter.comparison_year, 2020);
  assert.equal(beforeAfter.analysis_mode, 'period_comparison');
});

test('recognizes hyphenated material-move acceptance wording', () => {
  assert.equal(
    isNflTransactionMarketQuestion('Compare safety and running-back material-move rates before and after 2020.'),
    true,
  );
});

test('fresh questions resolve explicit team names and safe uppercase ids', () => {
  assert.deepEqual(
    transactionMarketRequestFromQuestion('Compare the Giants trade market after 2020.').team_ids,
    ['NYG'],
  );
  assert.deepEqual(
    transactionMarketRequestFromQuestion('Compare NYG with PHI trades after 2020.').team_ids,
    ['NYG', 'PHI'],
  );
  assert.equal(
    transactionMarketRequestFromQuestion('No team filter; compare trades leaguewide.').team_ids,
    undefined,
  );
});
