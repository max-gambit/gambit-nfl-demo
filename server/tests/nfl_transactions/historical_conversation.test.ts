import assert from 'node:assert/strict';
import test from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';
import { loadReviewedNflTransactionSnapshot } from '../../src/nfl_transactions/seed.js';
import { analyzeNflTransactionMarketSnapshot } from '../../src/nfl_transactions/analyze.js';
import { classifyNflAnalysisTurn } from '../../src/nfl_transactions/intent.js';
import { transactionMarketRequestFromQuestion } from '../../src/nfl_transactions/question.js';
import { nflTransactionMarketModelContext } from '../../src/nfl_transactions/model_context.js';
import { dataAnalystResultForModel, queryNflTransactionMarketResult } from '../../src/claude/data_analyst.js';
import { deterministicMarketEventSourceRows, evaluateNflArtifactInterpretation } from '../../src/claude/nfl_transaction_market_guardrails.js';
import { composeNflArtifactInterpretation } from '../../src/routes/briefs.js';

const { snapshot } = await loadReviewedNflTransactionSnapshot();
const question = 'How has the trade market for edge rushers changed from 2016 to 2025?';
const initial = analyzeNflTransactionMarketSnapshot(transactionMarketRequestFromQuestion(question), snapshot);

test('rehearsal refinement recomputes the exact public cohort while retaining its question scope', () => {
  const refinement = 'Only include trades from 2020 through 2025.';
  const intent = classifyNflAnalysisTurn(refinement, { market_query: initial.query, seller_scenario: null });
  assert.equal(intent.kind, 'transaction_market');
  if (intent.kind !== 'transaction_market') return;
  const refined = analyzeNflTransactionMarketSnapshot(transactionMarketRequestFromQuestion(refinement, intent.inherited_query), snapshot);
  assert.deepEqual(refined.query.position_groups, initial.query.position_groups);
  assert.deepEqual(refined.query.transaction_types, ['trade']);
  assert.deepEqual(refined.query.team_ids, initial.query.team_ids);
  assert.equal(refined.query.analysis_mode, initial.query.analysis_mode);
  assert.equal(refined.query.start_year, 2020);
  assert.equal(refined.query.end_year, 2025);
  assert.equal(refined.query.include_ytd, false);
  assert.notEqual(refined.analysis_id, initial.analysis_id);
  const expected = snapshot.events.filter((event) => event.position_group === 'EDGE'
    && event.transaction_type === 'trade' && event.event_year >= 2020 && event.event_year <= 2025);
  assert.deepEqual(refined.full_cohort!.map((event) => event.event_id).sort(), expected.map((event) => event.event_id).sort());
  assert.equal(refined.coverage.event_count, expected.length);
  assert.equal(refined.coverage.distinct_trade_count, new Set(expected.map((event) => String(event.raw_source_record!.trade_id))).size);
  assert.deepEqual(JSON.parse(JSON.stringify(refined)), refined, 'saved artifact must round-trip without losing the cohort or packages');
});

test('every public cohort event has a persisted source and every Burns swap asset survives', () => {
  const sourceRows = deterministicMarketEventSourceRows(initial, initial.source_refs.length + 1);
  const byEvent = new Map(sourceRows.map((source) => {
    const transaction = source.data?.transaction as { event_id: string };
    return [transaction.event_id, source];
  }));
  assert.equal(byEvent.size, initial.full_cohort!.length);
  for (const event of initial.full_cohort!) assert.ok(byEvent.has(event.event_id));
  const burns = initial.full_cohort!.find((event) => event.player_name === 'Brian Burns' && event.event_year === 2024)!;
  assert.ok(burns?.trade_package);
  const expectedAssets = snapshot.trade_assets!.filter((asset) => asset.trade_id === burns.trade_id);
  assert.deepEqual(burns.trade_package.assets.map((asset) => asset.asset_id).sort(), expectedAssets.map((asset) => asset.asset_id).sort());
  assert.ok(burns.trade_package.assets.some((asset) => asset.gave_team_id === 'CAR'
    && asset.received_team_id === 'NYG' && asset.pick_number === 166));
  assert.ok(burns.trade_package.assets.some((asset) => asset.gave_team_id === 'NYG'
    && asset.received_team_id === 'CAR' && asset.pick_number === 141));
  assert.deepEqual((byEvent.get(burns.event_id)!.data!.transaction as typeof burns).trade_package, burns.trade_package);
  assert.match(JSON.stringify(byEvent.get(burns.event_id)!.data!.transaction_sources), /trades\.csv/);
});

test('full audit history stays out of model messages without truncating the saved result', async () => {
  const result = await queryNflTransactionMarketResult('analyze_nfl_transaction_market', initial.query, async () => snapshot);
  assert.equal(result.ok, true);
  const model = dataAnalystResultForModel(result);
  assert.equal(model.market_analysis?.full_cohort, undefined);
  assert.equal((model.data.market_analysis as typeof initial).full_cohort, undefined);
  assert.deepEqual(model.market_analysis?.query, initial.query);
  assert.deepEqual(model.market_analysis?.comparables, result.market_analysis?.comparables);
  assert.equal(result.market_analysis?.full_cohort?.length, initial.coverage.event_count);
  const largerAudit = { ...initial, full_cohort: Array.from({ length: 100 }, () => initial.full_cohort!).flat() };
  assert.equal(JSON.stringify(nflTransactionMarketModelContext(largerAudit)).length, JSON.stringify(nflTransactionMarketModelContext(initial)).length);
});

test('one rejected interpretation can be repaired, while two contradictory drafts never become prose', async () => {
  const valid = 'EDGE player movement is growing. Its share of league trades is flat. Coverage limits and small samples do not establish a current asking price.';
  assert.equal(evaluateNflArtifactInterpretation(valid, initial).ok, true);
  let calls = 0;
  const args = { question, market: initial, seller_move: null };
  const answer = await composeNflArtifactInterpretation(args, async (params) => {
    assert.ok(!JSON.stringify(params.system).includes('full_cohort'));
    calls += 1;
    return { content: [{ type: 'text', text: calls === 1 ? 'The EDGE market is shrinking.' : valid }], stop_reason: 'end_turn' } as Anthropic.Message;
  });
  assert.equal(calls, 2);
  assert.equal(answer, valid);
  await assert.rejects(composeNflArtifactInterpretation(args, async () => ({
    content: [{ type: 'text', text: 'The EDGE market is shrinking.' }], stop_reason: 'end_turn',
  } as Anthropic.Message)), /interpretation_rejected/);
});
