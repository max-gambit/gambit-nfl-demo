import assert from 'node:assert/strict';
import test from 'node:test';
import { factualMarketAnswer, marketAnnualRows, marketExampleTrades, sellerScenarioChanges } from '../../../shared/nflAnswerDepth.js';
import { loadReviewedNflTransactionSnapshot } from '../../src/nfl_transactions/seed.js';
import { analyzeNflTransactionMarketSnapshot } from '../../src/nfl_transactions/analyze.js';
import { buildNflFactualAnswer, historicalPackageAnswer } from '../../src/nfl_facts/answer.js';
import { classifyNflAnalysisTurn } from '../../src/nfl_transactions/intent.js';
import { transactionMarketRequestFromQuestion } from '../../src/nfl_transactions/question.js';
import type { NflSellerMoveResponse } from '../../../shared/types.js';

const fixture = loadReviewedNflTransactionSnapshot().then(({ snapshot }) => analyzeNflTransactionMarketSnapshot({ analysis_mode: 'ten_year_trend', start_year: 2016, end_year: 2025, position_groups: ['EDGE'], transaction_types: ['trade'] }, snapshot, { generatedAt: '2026-09-07T00:00:00Z' }));

test('market narrative, chart, percentages and whole-package examples reconcile to reviewed records', async () => {
  const market = await fixture, body = factualMarketAnswer(market);
  assert.match(body.answer, /72 EDGE player movements across 70 trades/);
  assert.match(body.key_findings[0].body, /21 player movements across 741 player-seasons/);
  assert.match(body.key_findings[0].body, /16 across 701/);
  assert.match(body.key_findings[1].body, /4 of 13/);
  assert.match(body.key_findings[1].body, /6 of 18/);
  assert.equal(marketAnnualRows(market).reduce((n, r) => n + r.events, 0), 72);
  assert.deepEqual(marketExampleTrades(market).rows.map(r => r.player_name), ['Micah Parsons', 'Bradley Chubb', 'Frank Clark']);
  assert.ok(marketExampleTrades(market, 2025).rows.every(r => r.event_year === 2025));
  const incomplete = structuredClone(market); incomplete.full_cohort = undefined;
  assert.ok(factualMarketAnswer(incomplete).key_findings.every(f => !f.body.includes('4 of 13')));
  const sparse = structuredClone(market); sparse.position_trends[0].mobility.status = 'insufficient_evidence';
  assert.equal(factualMarketAnswer(sparse).tables[0].rows[0][4], 'Comparison unavailable');
});

test('package questions preserve record filters, count distinct deals and do not omit multi-player returns', async () => {
  const market = await fixture;
  const all = historicalPackageAnswer('Show the complete trade packages.', market);
  assert.equal(all.body.historical_selection!.event_ids.length, 70);
  const firsts = historicalPackageAnswer('Only include trades returning a first-round pick.', market, all.body.historical_selection);
  assert.deepEqual(firsts.sources.map(s => s.title), ['Micah Parsons · 2025','Bradley Chubb · 2022','Frank Clark · 2019','Khalil Mack · 2018']);
  const year = historicalPackageAnswer('Only 2025.', market, firsts.body.historical_selection);
  assert.deepEqual(year.body.historical_selection!.years, [2025]);
  assert.deepEqual(year.body.historical_selection!.pick_rounds, [1]);
  assert.equal(year.sources.length, 1);
  const named = historicalPackageAnswer('What did Dallas get for Parsons?', market);
  const assets = JSON.stringify(named.sources[0].data);
  assert.match(assets, /Kenny Clark/); assert.match(assets, /2026 R1/); assert.match(assets, /2027 R1/);
  assert.equal(named.body.historical_selection!.event_ids.length, 1);
  assert.equal(historicalPackageAnswer('Which 2025 trades returned a first-round pick?', market).sources.length, 1);
  for (const question of ['Show trades involving Casper Unknown.', 'What did Dallas get for Casper Unknown?', 'Show the Amari Cooper trade.']) {
    const unknown = historicalPackageAnswer(question, market);
    assert.equal(unknown.sources.length, 0);
    assert.match(unknown.body.answer, /couldn’t find a trade/);
  }
  const pickYear = historicalPackageAnswer('Which trades returned a 2027 first-round pick?', market);
  assert.deepEqual(pickYear.sources.map(source => source.title), ['Micah Parsons · 2025']);
  assert.deepEqual(pickYear.body.historical_selection!.pick_years, [2027]);
  assert.match(historicalPackageAnswer('Which trades did not return a first-round pick?', market).body.answer, /can’t apply that condition/);
  const after = historicalPackageAnswer('Only trades after 2020.', market, firsts.body.historical_selection);
  assert.deepEqual(after.sources.map(source => source.title), ['Micah Parsons · 2025', 'Bradley Chubb · 2022']);
  const single = await buildNflFactualAnswer('Compare EDGE with IOL over the same period.', null, market, year.body.historical_selection);
  assert.match(single.body.answer, /2025 only/);
  assert.deepEqual(single.body.historical_selection!.years, [2025]);

});

test('record questions, aggregate refinements and seller scenarios remain separate routes', async () => {
  const market = await fixture, context = { market_query: market.query, seller_scenario: null };
  for (const question of ['Show the complete trade packages.','Which trades returned a first-round pick?','Only 2025.','What did Dallas get for Parsons?']) assert.equal(classifyNflAnalysisTurn(question, context).kind, 'general', question);
  for (const question of ['Only include trades from 2020 through 2025.','Compare EDGE with IOL over the same period.','What changed after 2020?']) assert.equal(classifyNflAnalysisTurn(question, context).kind, 'transaction_market', question);
  const request = transactionMarketRequestFromQuestion('Compare EDGE with IOL over the same period.', market.query);
  assert.deepEqual(request.position_groups, ['IOL', 'EDGE']);
  assert.equal(request.start_year, 2016); assert.equal(request.end_year, 2025);
  assert.equal(classifyNflAnalysisTurn('Only IOL.', { ...context, historical_selection: true }).kind, 'transaction_market');
  assert.equal(classifyNflAnalysisTurn('Compare EDGE with IOL over the same period.', { ...context, historical_selection: true, historical_years: [2025] }).kind, 'general');
  assert.equal(classifyNflAnalysisTurn('What if we moved Brian Burns for a 2027 second?', context).kind, 'seller_move');
  assert.equal(classifyNflAnalysisTurn('How much cap space do the Giants have?', context).kind, 'current_team');
});

test('changing only the proposed pick leaves the contract effects visibly unchanged', () => {
  const previous = { player: { player_name: 'Brian Burns', contract_as_of_date: '2026-09-03' }, proposal: { pick_year: 2027, pick_round: 2 }, cap: { accounting_timing: 'after June 1', current_year: 2026, current_year_cap_space_created_dollars: 2800000, current_year_dead_money_dollars: 18583333, next_year: { year: 2027, cap_effect_dollars: 26200000 } } } as NflSellerMoveResponse;
  const current = structuredClone(previous); current.proposal.pick_round = 1;
  const changes = sellerScenarioChanges(current, previous);
  assert.deepEqual(changes.filter(c => c.changed).map(c => c.label), ['Proposed return']);
  assert.ok(changes.filter(c => /Cap space|Dead money|Following-year/.test(c.label)).every(c => !c.changed));
  current.player.player_name = 'Different player'; current.player.contract_as_of_date = '2026-09-07';
  assert.deepEqual(sellerScenarioChanges(current, previous).filter(c => c.changed).map(c => c.label), ['Player', 'Proposed return', 'Contract record']);
});
