import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Brief, BriefSource, DataAnalysisBriefBody, NflTransactionTradeAsset } from '@shared/types';
import {
  nflTransactionMarketCohortEvidence,
  nflTransactionMarketCohortPage,
  nflTransactionTradeAssetLabel,
  nflTransactionTradePackageLines,
} from '../../../shared/nflTransactionMarket.js';
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

test('current NFL evidence keeps football labels instead of NBA or implementation language', () => {
  const source = sourceRow(1, 'ANALYST_DATA', 'New York Giants contracts and cap', {
    current_nfl_evidence: { dataset_id: 'nfl_cap_sheets_current', team_id: 'NYG' },
    rows: [{ k: 'Team', v: 'NYG - New York Giants' }],
  });
  const body: DataAnalysisBriefBody = {
    kind: 'data_analysis', answer: 'Answer.', key_findings: [], tables: [], calculations: [], caveats: [], followups: [],
  };
  const model = buildEvidencePackModel(brief(body), [source], [], null, null);
  const visible = [...model.checkedItems, ...model.backgroundItems]
    .flatMap((item) => [item.title, item.proof, ...item.rows.flatMap((row) => [row.title, row.proof])])
    .join(' ');

  assert.match(visible, /New York Giants contracts and cap/);
  assert.match(visible, /contract and salary-cap figures/);
  assert.doesNotMatch(visible, /apron|current team data|coverage matrix|dataset/i);
});

test('AI target evidence keeps the named player and exact sources instead of a generic salary label', () => {
  const source = sourceRow(7, 'CONTRACT', 'Tre Tucker — LV contract and team context', {
    source_url: 'https://overthecap.com/player/tre-tucker/10964',
    roster_source_url: 'https://www.raiders.com/team/players-roster/',
    contribution: 'Supports the contract and team context used when discussing Tre Tucker.',
    current_nfl_evidence: { dataset_id: 'nfl_trade_target_current', team_id: 'LV', player_name: 'Tre Tucker' },
    rows: [{ k: 'Player', v: 'Tre Tucker' }, { k: 'Team', v: 'LV' }],
  });
  const body: DataAnalysisBriefBody = {
    kind: 'data_analysis',
    answer: 'Call Las Vegas about Tre Tucker.',
    key_findings: [{ label: 'Tre Tucker', body: 'A useful speed option.', source_refs: [7] }],
    tables: [], calculations: [], caveats: [], followups: [],
  };

  const model = buildEvidencePackModel(brief(body), [source], [], null, null);
  assert.equal(model.checkedItems[0]?.title, 'Tre Tucker — LV contract and team context');
  assert.match(model.checkedItems[0]?.proof ?? '', /Tre Tucker/);
  assert.doesNotMatch(JSON.stringify(model), /salary stack/i);
});

test('uncited current NFL fallback sources stay in the background', () => {
  const source = sourceRow(1, 'CONTRACT', 'Tre Tucker — LV contract and team context', {
    current_nfl_evidence: { dataset_id: 'nfl_trade_target_current', team_id: 'LV', player_name: 'Tre Tucker' },
    rows: [{ k: 'Player', v: 'Tre Tucker' }],
  });
  const body: DataAnalysisBriefBody = {
    kind: 'data_analysis',
    answer: 'I could not complete a reliable football answer in time.',
    key_findings: [], tables: [], calculations: [], caveats: [], followups: [],
  };

  const model = buildEvidencePackModel(brief(body), [source], [], null, null);
  assert.deepEqual(model.checkedItems, []);
  assert.equal(model.usedRefs, 0);
  assert.ok(model.backgroundItems.some((item) => item.refs.includes(1)));
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
  assert.ok(model.backgroundItems.some((item) => item.title === 'Additional market transactions'));
  assert.equal(representedRefs.size, sources.length);
  for (const source of sources) assert.ok(model.refToItemKey[source.ref_index]);

  const lastRef = sources.at(-1)!.ref_index;
  const focused = buildEvidencePackModel(brief(body), sources, [], [lastRef], null);
  assert.ok(focused.checkedItems.some((item) => item.refs.includes(lastRef)));
  assert.ok(focused.refToItemKey[lastRef]);
});

test('Analysis evidence surfaces use plain user-facing labels', async () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const [leftRail, detail, cite, evidenceModel] = await Promise.all([
    readFile(path.join(repoRoot, 'src', 'fenway', 'LeftRail.tsx'), 'utf8'),
    readFile(path.join(repoRoot, 'src', 'fenway', 'NflSourceDetail.tsx'), 'utf8'),
    readFile(path.join(repoRoot, 'src', 'ds', 'Cite.tsx'), 'utf8'),
    readFile(path.join(repoRoot, 'src', 'fenway', 'evidencePanelModel.ts'), 'utf8'),
  ]);

  assert.match(leftRail, /Evidence for this answer/);
  assert.match(leftRail, /Show all sources/);
  assert.doesNotMatch(leftRail, /Show background evidence|Background evidence|Sources checked/);
  assert.doesNotMatch(leftRail, /Additional source/);
  assert.doesNotMatch(detail, /NFL_TRANSACTION_MARKET|Player Record|Position Mapping|pff_position|label="Source status"|>Rows</);
  assert.doesNotMatch(evidenceModel, /Adds reporting, projection, or market context/);
  assert.match(detail, /directFact\(data, 'article', 'Article'\)/);
  assert.match(detail, /directFact\(data, 'excerpt', 'What it says'\)/);
  assert.match(detail, /top cap contracts|contract field coverage|roster players|exact location/i);
  assert.match(detail, /2026 cap number|contract terms\?|why the team might listen|why it might not|what to confirm/i);
  assert.match(detail, /trade sample|full-period pick bands|premium-pick share|price conclusion|comparison windows|observed returns|what this does not show/i);
  assert.match(cite, /setSourceFilterRef\(refIndex\);[\s\S]*setHighlightedSourceRef\(refIndex\)/);
});

test('Analysis keeps channels on the left and evidence on the right without a second answer thread', async () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const [workspace, feed, options] = await Promise.all([
    readFile(path.join(repoRoot, 'src', 'analysis', 'AnalysisWorkspace.tsx'), 'utf8'),
    readFile(path.join(repoRoot, 'src', 'fenway', 'SessionFeed.tsx'), 'utf8'),
    readFile(path.join(repoRoot, 'src', 'fenway', 'OptionsTable.tsx'), 'utf8'),
  ]);

  assert.match(workspace, /analysis-channel-rail[\s\S]*contentOverride=\{<RailChannels \/>\}[\s\S]*analysis-workspace-main[\s\S]*analysis-evidence-rail/);
  assert.doesNotMatch(workspace, /BriefRightPanel/);
  assert.match(workspace, /if \(hasEvidence\) setRightPanelOpen\(true\)/);
  assert.doesNotMatch(feed, /rightPanelMode === 'thread'|setRightPanelMode\('thread'\)/);
  assert.match(options, /fire\('v6d3cf:prefill-composer'/);
  assert.doesNotMatch(options, /fire\('v6d3cf:prefill-reply-composer'/);
});

test('only transaction-history sources enter the additional-market group', () => {
  const body: DataAnalysisBriefBody = {
    kind: 'data_analysis', answer: 'Answer.', key_findings: [], tables: [], calculations: [], caveats: [], followups: [],
  };
  const transaction = sourceRow(1, 'ANALYST_DATA', 'Player transaction', {
    transaction: { event_id: 'event-1' },
    rows: [{ k: 'Date', v: '2025-10-01' }],
  });
  transaction.source = 'nflverse transaction history';
  const report = sourceRow(2, 'NEWS', 'Market report', { rows: [{ k: 'As of', v: '2026-09-03' }] });
  report.source = 'Public report';
  const model = buildEvidencePackModel(brief(body), [transaction, report], [], null, null);

  const transactionGroup = model.backgroundItems.find((item) => item.title === 'Additional market transactions');
  assert.deepEqual(transactionGroup?.refs, [1]);
  assert.ok(model.backgroundItems.some((item) => item.refs.includes(2) && item.title !== 'Additional market transactions'));
});

test('saved full history is searchable across directed packages and pageable without dropping player events', async () => {
  const { snapshot } = await loadReviewedNflTransactionSnapshot();
  const analysis = analyzeNflTransactionMarketSnapshot({
    analysis_mode: 'comparables', start_year: 2016, end_year: 2025,
    position_groups: ['EDGE'], transaction_types: ['trade'], max_comparables: 12,
  }, snapshot);
  const saved = JSON.parse(JSON.stringify(analysis)) as typeof analysis;
  const evidence = nflTransactionMarketCohortEvidence(saved);
  const expected = snapshot.events.filter((event) => event.position_group === 'EDGE'
    && event.transaction_type === 'trade' && event.event_year >= saved.query.start_year && event.event_year <= saved.query.end_year);
  assert.equal(evidence.complete, true);
  assert.equal(evidence.rows.length, expected.length);
  assert.equal(evidence.distinctTradeCount, new Set(expected.map((row) => row.raw_source_record?.trade_id)).size);
  assert.match(evidence.summary, /player events.*player trade events.*distinct trades/);
  assert.doesNotMatch(evidence.summary, /Sampled-only/);

  const pageSize = 11;
  const firstPage = nflTransactionMarketCohortPage(evidence.rows, '', 0, pageSize);
  const traversed = Array.from({ length: firstPage.pageCount }, (_, page) => (
    nflTransactionMarketCohortPage(evidence.rows, '', page, pageSize).rows
  )).flat();
  assert.deepEqual(traversed.map((row) => row.event_id), evidence.rows.map((row) => row.event_id));
  assert.equal(new Set(traversed.map((row) => row.event_id)).size, expected.length);
  assert.equal(nflTransactionMarketCohortPage(evidence.rows, '', 999, pageSize).page, firstPage.pageCount - 1);

  const burns = nflTransactionMarketCohortPage(evidence.rows, '  bRiAn BURNS CAR NYG 2024 166  ', 999);
  assert.equal(burns.rows.length, 1);
  assert.equal(burns.rows[0].player_name, 'Brian Burns');
  assert.equal(burns.page, 0, 'a narrowed search must not strand the user on an empty later page');
  const packageLines = nflTransactionTradePackageLines(burns.rows[0]);
  assert.ok(packageLines.includes('CAR → NYG: 2024 R5 No. 166'));
  assert.ok(packageLines.some((line) => /^NYG → CAR: 2025 R5.*conditional/.test(line)));
  assert.equal(packageLines.length, burns.rows[0].trade_package!.assets.length);
  const absent = nflTransactionMarketCohortPage(evidence.rows, 'nonexistent-player-and-asset');
  assert.equal(absent.matchCount, 0);
  assert.equal(absent.pageCount, 0);
  assert.deepEqual(absent.rows, []);

  const legacy = structuredClone(saved);
  delete legacy.full_cohort;
  for (const row of [...legacy.comparables, ...legacy.influential_transactions]) {
    delete row.trade_id;
    delete row.trade_package;
  }
  const sampled = nflTransactionMarketCohortEvidence(legacy);
  const savedIds = new Set([...legacy.comparables, ...legacy.influential_transactions].map((row) => row.event_id));
  assert.equal(sampled.complete, false);
  assert.equal(sampled.rows.length, savedIds.size);
  assert.equal(sampled.distinctTradeCount, null, 'a coverage total cannot recreate unsaved deal evidence');
  assert.match(sampled.summary, /Sampled-only evidence/);
  assert.match(sampled.summary, /Run the analysis again/);
  assert.ok(sampled.rows.length < expected.length);
  assert.ok(sampled.rows.every((row) => nflTransactionTradePackageLines(row).length === 0));

  const truncated = { ...saved, full_cohort: saved.full_cohort!.slice(0, 1) };
  assert.equal(nflTransactionMarketCohortEvidence(truncated).complete, false);
  const empty = { ...saved, full_cohort: [], coverage: { ...saved.coverage, event_count: 0 } };
  assert.equal(nflTransactionMarketCohortEvidence(empty).complete, true);
  assert.equal(nflTransactionMarketCohortEvidence(empty).distinctTradeCount, 0);
});

test('asset labels preserve unknown pick information and recorded conditional terms', () => {
  const asset: NflTransactionTradeAsset = {
    asset_id: 'conditional-pick', trade_id: 'synthetic-deal', event_year: 2025, trade_date: '2025-06-01',
    gave_team_id: 'AAA', received_team_id: 'BBB', asset_type: 'draft_pick',
    pfr_id: null, pfr_name: null, pick_season: 2027, pick_round: 3, pick_number: null,
    conditional: true, source_ref_id: 'synthetic-source',
    raw_source_record: { conditional: 'if the player reaches the snap threshold' },
  };
  assert.match(nflTransactionTradeAssetLabel(asset), /2027 R3 \(pick number not recorded\)/);
  assert.match(nflTransactionTradeAssetLabel(asset), /conditional: if the player reaches the snap threshold/);
  assert.match(nflTransactionTradeAssetLabel({ ...asset, conditional: null, raw_source_record: null }), /condition not recorded/);
  assert.doesNotMatch(nflTransactionTradeAssetLabel({ ...asset, conditional: false, raw_source_record: null }), /conditional/);
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
