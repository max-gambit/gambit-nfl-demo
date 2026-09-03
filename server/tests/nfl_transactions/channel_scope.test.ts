import assert from 'node:assert/strict';
import test from 'node:test';
import {
  latestTransactionMarketBrief,
  latestTransactionMarketBriefForActiveAnalysis,
  nflTransactionMarketFootballRead,
  transactionMarketAnalysisFromBrief,
} from '@shared/nflTransactionMarket';
import type { Brief, NflTransactionMarketAnalysis } from '@shared/types';
import {
  briefRoutes,
  briefProgressStreamPayload,
  marketArtifactBriefProgress,
  transactionMarketArtifactBody,
} from '../../src/routes/briefs.js';

test('primary Analysis continuation selects the latest executed market scope', () => {
  const firstAnalysis = marketAnalysis('analysis-1', ['WR']);
  const latestAnalysis = marketAnalysis('analysis-2', ['EDGE', 'IOL']);
  const briefs = [
    brief('brief-1', firstAnalysis),
    brief('brief-2', null),
    brief('brief-3', latestAnalysis),
    brief('brief-4', null),
  ];

  const inherited = latestTransactionMarketBrief(briefs);

  assert.equal(inherited?.id, 'brief-3');
  assert.strictEqual(transactionMarketAnalysisFromBrief(inherited!), latestAnalysis);
  assert.equal(latestTransactionMarketBriefForActiveAnalysis(briefs, 'brief-4'), null);
  assert.equal(latestTransactionMarketBriefForActiveAnalysis(briefs, 'brief-1')?.id, 'brief-3');

  const pending = {
    ...brief('brief-5', null),
    mode: 'data_analyst' as const,
    status: 'generating' as const,
  };
  assert.equal(
    latestTransactionMarketBriefForActiveAnalysis([...briefs, pending], pending.id, new Set([pending.id]))?.id,
    'brief-3',
  );
});

test('deterministic market artifact is streamable while interpretation is still generating', () => {
  const analysis = marketAnalysis('analysis-live', ['EDGE']);
  const body = transactionMarketArtifactBody(analysis);
  const progress = {
    phase: 'drafting' as const,
    pct: 36,
    label: 'Market calculation ready',
    detail: 'Drafting interpretation.',
    updated_at: '2026-09-02T12:00:00.000Z',
    events: [],
  };

  assert.equal(body.answer, '');
  assert.deepEqual(body.key_findings, []);
  assert.strictEqual(body.market_analysis, analysis);
  assert.deepEqual(briefProgressStreamPayload({
    id: 'brief-live',
    status: 'generating',
    progress,
    error: null,
    updated_at: '2026-09-02T12:00:01.000Z',
    body,
  }), {
    brief_id: 'brief-live',
    status: 'generating',
    progress,
    error: null,
    updated_at: '2026-09-02T12:00:01.000Z',
    body,
  });
});

test('initial market response progress is already renderable before interpretation', () => {
  const progress = marketArtifactBriefProgress();
  assert.equal(progress.phase, 'drafting');
  assert.equal(progress.pct, 36);
  assert.equal(progress.label, 'Market calculation ready');
});

test('EDGE and IOL comparison leads with a football conclusion while preserving signal boundaries', () => {
  const analysis = {
    ...marketAnalysis('analysis-edge-iol', ['EDGE', 'IOL']),
    status: 'directional',
    position_trends: [
      marketTrend('EDGE', 1417, 'growing', 'growing', 'flat'),
      marketTrend('IOL', 1722, 'growing', 'flat', 'growing'),
    ],
  } as unknown as NflTransactionMarketAnalysis;

  const read = nflTransactionMarketFootballRead(analysis);
  assert.match(read.conclusion, /EDGE movement has increased and premium trade compensation has strengthened/i);
  assert.match(read.conclusion, /IOL movement has increased, but its contract-cost and premium-pick trade signals do not agree/i);
  assert.match(read.implication, /pay selectively for difference-making EDGE talent/i);
  assert.match(read.implication, /IOL availability creates acquisition leverage/i);
});

test('football read does not turn insufficient price evidence into a supported price posture', () => {
  const trend = marketTrend('EDGE', 1417, 'growing', 'growing', 'flat');
  trend.trade_compensation.status = 'insufficient_evidence';
  trend.contract_price.status = 'insufficient_evidence';
  const analysis = {
    ...marketAnalysis('analysis-edge-sparse-price', ['EDGE']),
    status: 'directional',
    position_trends: [trend],
  } as unknown as NflTransactionMarketAnalysis;

  const read = nflTransactionMarketFootballRead(analysis);
  assert.match(read.conclusion, /price evidence is not strong enough to call/i);
  assert.match(read.implication, /keep price posture provisional/i);
  assert.doesNotMatch(`${read.conclusion} ${read.implication}`, /supported .*price/i);
});

test('trades-only football read labels only completed years when YTD is included', () => {
  const baseTrend = marketTrend('EDGE', 1417, 'growing', 'growing', 'flat');
  const trend = {
    ...baseTrend,
    trade_compensation: { ...baseTrend.trade_compensation, overall_value: 2910 },
  };
  const analysis = {
    ...marketAnalysis('analysis-ytd', ['EDGE']),
    status: 'directional',
    query: {
      ...marketAnalysis('analysis-ytd-query', ['EDGE']).query,
      end_year: 2026,
      include_ytd: true,
    },
    position_trends: [trend],
  } as unknown as NflTransactionMarketAnalysis;

  const read = nflTransactionMarketFootballRead(analysis);
  assert.match(read.conclusion, /2016–2025/);
  assert.doesNotMatch(read.conclusion, /2016–2026/);
});

test('brief creation rejects malformed session ids before market analysis', async () => {
  const response = await briefRoutes.request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      session_id: 'not-a-uuid',
      question: 'Which position markets are growing?',
    }),
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'invalid_session_id' });
});

function brief(id: string, analysis: NflTransactionMarketAnalysis | null): Brief {
  return {
    id,
    session_id: 'session-1',
    mode: analysis ? 'data_analyst' : 'brief',
    question: `Question ${id}`,
    thesis: null,
    body: analysis
      ? transactionMarketArtifactBody(analysis)
      : { kind: 'brief', reasoning: 'Non-market answer.', watching: [] },
    status: 'ready',
    progress: null,
    error: null,
    duration_ms: null,
    created_at: '2026-09-02T12:00:00.000Z',
    updated_at: '2026-09-02T12:00:00.000Z',
  };
}

function marketAnalysis(
  analysisId: string,
  positionGroups: NflTransactionMarketAnalysis['query']['position_groups'],
): NflTransactionMarketAnalysis {
  return {
    analysis_id: analysisId,
    query: {
      analysis_mode: 'ten_year_trend',
      start_year: 2016,
      end_year: 2025,
      baseline_years: [2016, 2018],
      recent_years: [2023, 2025],
      comparison_year: null,
      team_ids: [],
      position_groups: positionGroups,
      transaction_types: ['trade'],
      include_ytd: false,
      max_comparables: 12,
    },
  } as unknown as NflTransactionMarketAnalysis;
}

function marketTrend(
  position: 'EDGE' | 'IOL',
  eventCount: number,
  mobilityDirection: 'growing' | 'flat',
  tradeDirection: 'growing' | 'flat',
  contractDirection: 'growing' | 'flat',
) {
  const signal = (direction: 'growing' | 'flat') => ({
    status: 'supported',
    direction,
    baseline_value: 100,
    recent_value: direction === 'growing' ? 120 : 100,
  });
  return {
    position_group: position,
    event_count: eventCount,
    status: 'directional',
    direction: 'mixed',
    mobility: signal(mobilityDirection),
    transaction_share: signal('flat'),
    trade_compensation: signal(tradeDirection),
    contract_price: signal(contractDirection),
  };
}
