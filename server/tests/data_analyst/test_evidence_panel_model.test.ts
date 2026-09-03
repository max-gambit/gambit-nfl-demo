import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Brief, BriefSource, DataAnalysisBriefBody } from '@shared/types';
import { buildEvidencePackModel } from '../../../src/fenway/evidencePanelModel.js';
import {
  deterministicMarketEventSourceRows,
  deterministicMarketSourceRows,
} from '../../src/claude/nfl_transaction_market_guardrails.js';
import { analyzeNflTransactionMarketSnapshot } from '../../src/nfl_transactions/analyze.js';
import { loadReviewedNflTransactionSnapshot } from '../../src/nfl_transactions/seed.js';

test('evidence stays hidden until a completed answer has material sources', () => {
  const generating = brief(null, 'generating');
  const model = buildEvidencePackModel(generating, [], [], null, null);

  assert.equal(model.hasCompletedAnswer, false);
  assert.equal(model.title, 'Evidence for this answer');
  assert.deepEqual(model.checkedItems, []);
});

test('current cap evidence uses a plain contribution and no default source dump', () => {
  const body: DataAnalysisBriefBody = {
    kind: 'data_analysis',
    answer: 'The loaded figure is not an exact cap-space total.',
    key_findings: [{ label: 'Current cap sheet', body: 'Shows listed charges.', source_refs: [1] }],
    tables: [],
    calculations: [{ label: 'Listed charges', value: '$276,549,606', source_refs: [1] }],
    caveats: [],
    followups: [],
  };
  const source = sourceRow(1, 'CAP', 'Giants 2026 player cap charges', {
    current_team_cap_summary: true,
    contribution: 'Establishes the player cap charges used in this answer.',
    rows: [{ k: 'As of', v: 'Sep 2, 2026' }],
  });
  const model = buildEvidencePackModel(brief(body), [source], [], null, null);

  assert.equal(model.hasCompletedAnswer, true);
  assert.equal(model.title, 'Evidence for this answer');
  assert.equal(model.checkedItems.length, 1);
  assert.equal(model.checkedItems[0]?.title, 'Giants 2026 cap position');
  assert.match(model.checkedItems[0]?.proof ?? '', /Establishes the player cap charges/i);
  assert.deepEqual(model.backgroundItems, []);
});

test('historical market evidence shows the market definition and four best transactions, with every other citation retained', async () => {
  const reviewed = await loadReviewedNflTransactionSnapshot();
  const analysis = analyzeNflTransactionMarketSnapshot({
    analysis_mode: 'ten_year_trend',
    start_year: 2016,
    end_year: 2025,
    position_groups: ['EDGE', 'IOL'],
    transaction_types: ['trade', 'free_agent_signing', 're_signing', 'extension', 'tag', 'waiver_claim', 'release'],
    include_ytd: false,
    max_comparables: 12,
  }, reviewed.snapshot, { generatedAt: '2026-09-03T20:00:00.000Z' });
  const rawSources = [
    ...deterministicMarketSourceRows(analysis, 1),
    ...deterministicMarketEventSourceRows(analysis, analysis.source_refs.length + 1),
  ];
  const sources = rawSources.map((source, index): BriefSource => ({
    ...source,
    id: `source-${index + 1}`,
    brief_id: 'brief-1',
  }));
  const body: DataAnalysisBriefBody = {
    kind: 'data_analysis',
    answer: 'Live market answer.',
    key_findings: [],
    tables: [],
    calculations: [],
    caveats: [],
    followups: [],
    market_analysis: analysis,
  };
  const model = buildEvidencePackModel(brief(body), sources, [], null, null);
  const representedRefs = new Set([...model.checkedItems, ...model.backgroundItems].flatMap((item) => item.refs));

  assert.equal(model.checkedItems.length, Math.min(5, 1 + new Set([...analysis.influential_transactions, ...analysis.comparables].map((row) => row.event_id)).size));
  assert.equal(model.checkedItems[0]?.title, 'Historical market definition');
  assert.match(model.checkedItems[0]?.proof ?? '', /EDGE/);
  assert.match(model.checkedItems[0]?.proof ?? '', /IOL/);
  assert.ok(model.backgroundItems.some((item) => item.title === 'Historical transaction market'));
  assert.equal(representedRefs.size, sources.length);
  for (const source of sources) assert.ok(model.refToItemKey[source.ref_index]);

  const lastRef = sources.at(-1)!.ref_index;
  const focused = buildEvidencePackModel(brief(body), sources, [], [lastRef], null);
  assert.ok(focused.checkedItems.some((item) => item.refs.includes(lastRef)));
  assert.ok(focused.refToItemKey[lastRef]);
});

test('Analysis evidence surfaces use plain user-facing labels', async () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const [leftRail, detail, cite] = await Promise.all([
    readFile(path.join(repoRoot, 'src', 'fenway', 'LeftRail.tsx'), 'utf8'),
    readFile(path.join(repoRoot, 'src', 'fenway', 'NflSourceDetail.tsx'), 'utf8'),
    readFile(path.join(repoRoot, 'src', 'ds', 'Cite.tsx'), 'utf8'),
  ]);

  assert.match(leftRail, /Evidence for this answer/);
  assert.match(leftRail, /Show all sources/);
  assert.doesNotMatch(leftRail, /Show background evidence|Background evidence|Sources checked/);
  assert.doesNotMatch(detail, /label="Source status"|>Rows</);
  assert.match(cite, /setSourceFilterRef\(refIndex\);[\s\S]*setHighlightedSourceRef\(refIndex\)/);
});

function brief(body: DataAnalysisBriefBody | null, status: Brief['status'] = 'ready'): Brief {
  return {
    id: 'brief-1',
    session_id: 'session-1',
    mode: 'data_analyst',
    question: 'Question',
    thesis: body?.answer ?? null,
    body,
    status,
    progress: null,
    error: null,
    duration_ms: null,
    created_at: '2026-09-03T20:00:00.000Z',
    updated_at: '2026-09-03T20:00:00.000Z',
  };
}

function sourceRow(ref: number, kind: string, title: string, data: Record<string, unknown>): BriefSource {
  return {
    id: `source-${ref}`,
    brief_id: 'brief-1',
    ref_index: ref,
    kind,
    source: 'Public source',
    title,
    data,
    updated_at: '2026-09-02',
  };
}
