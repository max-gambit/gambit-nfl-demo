import assert from 'node:assert/strict';
import test from 'node:test';
import {
  latestTransactionMarketBrief,
  latestTransactionMarketBriefForActiveAnalysis,
  transactionMarketAnalysisFromBrief,
} from '@shared/nflTransactionMarket';
import type { Brief, NflTransactionMarketAnalysis } from '@shared/types';
import {
  briefProgressStreamPayload,
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
