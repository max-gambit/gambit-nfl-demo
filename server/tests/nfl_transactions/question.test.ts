import assert from 'node:assert/strict';
import test from 'node:test';
import { isNflTransactionMarketQuestion, transactionMarketRequestFromQuestion } from '../../src/nfl_transactions/question.js';
import { resolveNflTransactionMarketQuery } from '../../src/nfl_transactions/analyze.js';

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

  const edgeTradeMarket = transactionMarketRequestFromQuestion('Since 2018, how has the trade market for EDGE players changed?');
  assert.equal(edgeTradeMarket.start_year, 2018);
  assert.deepEqual(edgeTradeMarket.position_groups, ['EDGE']);
  assert.deepEqual(edgeTradeMarket.transaction_types, ['trade']);
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

test('bounded refinements change only explicit filters and keep the analysis mode', () => {
  const inherited = resolveNflTransactionMarketQuery({
    analysis_mode: 'ten_year_trend', start_year: 2016, end_year: 2025,
    position_groups: ['EDGE'], transaction_types: ['trade', 'extension'], team_ids: ['PHI'], max_comparables: 7,
  });
  const original = structuredClone(inherited);
  for (const wording of [
    'Only include trades from 2020 through 2025.',
    'Limit the sample to trades between 2020 and 2025.',
    'Show me trades from 2020–2025.',
  ]) {
    const query = resolveNflTransactionMarketQuery(transactionMarketRequestFromQuestion(wording, inherited));
    assert.deepEqual(query.position_groups, ['EDGE'], wording);
    assert.deepEqual(query.team_ids, ['PHI'], wording);
    assert.deepEqual(query.transaction_types, ['trade'], wording);
    assert.equal(query.start_year, 2020);
    assert.equal(query.end_year, 2025);
    assert.equal(query.analysis_mode, 'ten_year_trend');
    assert.equal(query.max_comparables, 7);
  }
  for (const [wording, types] of [
    ['Only include contracts.', ['free_agent_signing', 're_signing', 'extension', 'tag']],
    ['Include only free agent signings.', ['free_agent_signing']],
    ['Only releases and waiver claims.', ['waiver_claim', 'release']],
    ['Only re-signings and extensions.', ['re_signing', 'extension']],
  ] as const) {
    const request = transactionMarketRequestFromQuestion(wording, inherited);
    assert.deepEqual(request.transaction_types, types, wording);
    assert.deepEqual(request.position_groups, inherited.position_groups);
  }
  const position = transactionMarketRequestFromQuestion('Only include defensive tackles.', inherited);
  assert.deepEqual(position.position_groups, ['IDL']);
  const team = transactionMarketRequestFromQuestion('Only include Giants trades.', inherited);
  assert.deepEqual(team.team_ids, ['NYG']);
  assert.deepEqual(team.position_groups, ['EDGE']);
  assert.equal(transactionMarketRequestFromQuestion('Show me all teams.', inherited).team_ids, undefined);
  assert.equal(transactionMarketRequestFromQuestion('Show me all positions.', inherited).position_groups, undefined);
  assert.deepEqual(inherited, original, 'parsing must not mutate the executed parent query');
});

test('date bounds reset stale YTD and out-of-range comparison state', () => {
  const inherited = resolveNflTransactionMarketQuery({
    analysis_mode: 'period_comparison', start_year: 2016, end_year: 2026,
    comparison_year: 2018, include_ytd: true, position_groups: ['EDGE'], transaction_types: ['trade'],
  });
  const query = resolveNflTransactionMarketQuery(transactionMarketRequestFromQuestion(
    'Only include trades from 2020 through 2025.', inherited,
  ));
  assert.equal(query.include_ytd, false);
  assert.equal(query.comparison_year, null);
  assert.equal(query.start_year, 2020);
  assert.equal(query.end_year, 2025);
  assert.deepEqual(query.position_groups, ['EDGE']);
  assert.equal(query.analysis_mode, 'period_comparison');

  assert.equal(transactionMarketRequestFromQuestion('Only trades before 2026.', inherited).include_ytd, false);
  const after = transactionMarketRequestFromQuestion('Only trades after 2020.', inherited);
  assert.equal(after.start_year, 2021);
  assert.equal(after.comparison_year, undefined);
  assert.equal(transactionMarketRequestFromQuestion('What changed after 2020?', inherited).comparison_year, 2020);
  assert.deepEqual(resolveNflTransactionMarketQuery(transactionMarketRequestFromQuestion('', query)), query,
    'regeneration re-executes the saved scope without reapplying follow-up wording');
});
