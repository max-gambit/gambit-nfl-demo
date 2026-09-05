import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDeterministicNflTransactionMarketFallback,
  deterministicMarketEventSourceRows,
  deterministicMarketChatAnswer,
  evaluateNflArtifactInterpretation,
  evaluateNflTransactionMarketDraft,
} from '../../src/claude/nfl_transaction_market_guardrails.js';
import { composeNflArtifactInterpretation } from '../../src/routes/briefs.js';
import { analyzeNflTransactionMarketSnapshot, type NflTransactionMarketSnapshot } from '../../src/nfl_transactions/analyze.js';
import type { SubmitDataAnalysisInput } from '@shared/types';
import type Anthropic from '@anthropic-ai/sdk';

test('guardrail rejects a number absent from the deterministic artifact', () => {
  const analysis = analysisFixture();
  const draft = buildDeterministicNflTransactionMarketFallback(analysis);
  draft.answer += ' The position produced 999 premium trades.';
  const result = evaluateNflTransactionMarketDraft(draft, analysis);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.includes('999')));
});

test('guardrail rejects causal wording for leave-one-out influence', () => {
  const analysis = analysisFixture();
  const draft = buildDeterministicNflTransactionMarketFallback(analysis);
  draft.answer += ' This transaction caused the market to grow.';
  const result = evaluateNflTransactionMarketDraft(draft, analysis);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => /not causal/i.test(issue)));
});

test('deterministic fallback carries method, source provenance, filters, and limitations', () => {
  const analysis = analysisFixture();
  const draft = buildDeterministicNflTransactionMarketFallback(analysis);
  const text = deterministicMarketChatAnswer(analysis);
  assert.ok(draft.calculations.some((row) => /player.season/i.test(`${row.label} ${row.formula}`)));
  assert.equal(draft.sources[0].source, 'nflverse trades');
  assert.ok(draft.caveats.length > 0);
  assert.match(text, /Executed filters: 2016–2025/);
  assert.match(text, /Supporting transactions:/);
});

test('transaction evidence rows include the exact returned transactions', () => {
  const analysis = analysisFixture();
  const rows = deterministicMarketEventSourceRows(analysis, analysis.source_refs.length + 1);

  assert.ok(rows.length > 0);
  assert.equal(rows[0].data && typeof rows[0].data === 'object' && 'transaction' in rows[0].data, true);
  assert.match(rows[0].title, / transaction$/);
  assert.equal(rows[0].source, 'nflverse transaction history');
  assert.doesNotMatch(JSON.stringify(rows), /NFL_TRANSACTION_MARKET|Player record|Position mapping|Raw position|Normalization/);
});

test('trade evidence prefers the trades source when player identity is also cited', () => {
  const analysis = structuredClone(analysisFixture());
  analysis.source_refs.unshift({
    ...analysis.source_refs[0],
    id: 'players',
    name: 'nflverse players',
    url: 'https://github.com/nflverse/nflverse-data/releases/download/players/players.csv',
  });
  for (const row of [...analysis.comparables, ...analysis.influential_transactions]) {
    row.source_ref_ids = ['players', 'trades'];
  }
  analysis.source_refs.find((source) => source.id === 'trades')!.url = 'https://github.com/nflverse/nflverse-data/releases/download/trades/trades.csv';

  const rows = deterministicMarketEventSourceRows(analysis, analysis.source_refs.length + 1);
  assert.ok(rows.length > 0);
  assert.equal(rows[0].data?.source_url, 'https://github.com/nflverse/nflverse-data/releases/download/trades/trades.csv');
});

test('artifact-grounded fallback itself passes deterministic checks', () => {
  const analysis = analysisFixture();
  const draft: SubmitDataAnalysisInput = buildDeterministicNflTransactionMarketFallback(analysis);
  assert.deepEqual(evaluateNflTransactionMarketDraft(draft, analysis), { ok: true, issues: [] });
});

test('artifact-grounded fallback admits signed shrinking deltas', () => {
  const analysis = structuredClone(analysisFixture());
  const signal = analysis.position_trends[0].mobility;
  signal.baseline_value = 800;
  signal.recent_value = 600;
  signal.relative_change_basis_points = -2500;
  signal.direction = 'shrinking';
  const draft = buildDeterministicNflTransactionMarketFallback(analysis);

  assert.match(draft.key_findings[0].body, /Δ -2\.00 per 100/);
  assert.deepEqual(evaluateNflTransactionMarketDraft(draft, analysis), { ok: true, issues: [] });
});

test('trades-only fallback answers the governed premium-pick ranking directly', () => {
  const draft = buildDeterministicNflTransactionMarketFallback(analysisFixture());

  assert.match(draft.answer, /highest observed day-one or day-two pick shares/i);
  assert.match(draft.answer, /EDGE/);
  assert.match(draft.answer, /allocable single-player trades/i);
  assert.deepEqual(evaluateNflTransactionMarketDraft(draft, analysisFixture()), { ok: true, issues: [] });
});

test('guardrail rejects mismatched periods and transaction filters even when their numbers exist elsewhere in the artifact', () => {
  const analysis = analyzeNflTransactionMarketSnapshot({
    analysis_mode: 'ten_year_trend',
    start_year: 2016,
    end_year: 2025,
    position_groups: ['EDGE'],
    max_comparables: 5,
  }, snapshotFixture(), { generatedAt: '2026-09-02T00:00:00.000Z' });
  const draft = buildDeterministicNflTransactionMarketFallback(analysis);
  draft.answer = 'Executed filters were 2017–2024 and trades only.';

  const result = evaluateNflTransactionMarketDraft(draft, analysis);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => /period/i.test(issue)));
  assert.ok(result.issues.some((issue) => /trades-only/i.test(issue)));
});

test('guardrail rejects an unreturned single-name transaction and mismatched signal attribution', () => {
  const analysis = analysisFixture();
  const draft = buildDeterministicNflTransactionMarketFallback(analysis);
  const unrelatedArtifactNumber = analysis.position_trends[0].trade_compensation.sample_size;
  draft.answer += ` Mahomes was traded in 2024. EDGE trade price was ${unrelatedArtifactNumber}.`;

  const result = evaluateNflTransactionMarketDraft(draft, analysis);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => /Mahomes/iu.test(issue)));
  assert.ok(result.issues.some((issue) => /claimed EDGE signal/i.test(issue)));
});

test('guardrail rejects a declared team scope that differs from the executed filter', () => {
  const analysis = analyzeNflTransactionMarketSnapshot({
    analysis_mode: 'ten_year_trend',
    start_year: 2016,
    end_year: 2025,
    team_ids: ['PHI'],
    position_groups: ['EDGE'],
    transaction_types: ['trade'],
    max_comparables: 5,
  }, snapshotFixture(), { generatedAt: '2026-09-02T00:00:00.000Z' });
  const draft = buildDeterministicNflTransactionMarketFallback(analysis);
  draft.answer += ' The executed scope was the Giants.';

  const result = evaluateNflTransactionMarketDraft(draft, analysis);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => /team scope/i.test(issue)));
});

test('market answer uses model-written football reasoning grounded in the live result', async () => {
  const analysis = analysisFixture();
  let captured: Anthropic.MessageCreateParamsNonStreaming | null = null;
  const answer = await composeNflArtifactInterpretation({
    question: 'How has the EDGE trade market changed, and what should New York do with that information?',
    market: analysis,
    seller_move: null,
  }, async (params) => {
    captured = params;
    return {
      content: [{
        type: 'text',
        text: 'EDGE activity should be read from the movement trend without collapsing every market signal into one label. For New York, the useful posture is to test availability against the closest returned trades before setting a negotiating position.',
      }],
    } as unknown as Anthropic.Message;
  });

  assert.match(answer, /For New York/);
  assert(captured);
  assert.match(JSON.stringify(captured), /Write the football judgment/);
  assert.match(JSON.stringify(captured), new RegExp(analysis.analysis_id));
  assert.deepEqual(evaluateNflArtifactInterpretation(answer, analysis), { ok: true, issues: [] });
});

test('AI interpretation rejects a qualitative direction opposite the calculated signal', () => {
  const analysis = analysisFixture();
  const expected = analysis.position_trends[0].mobility.direction;
  const wrong = expected === 'growing' ? 'shrinking' : 'growing';
  const result = evaluateNflArtifactInterpretation(
    `EDGE player movement is ${wrong}. For New York, that changes the negotiating posture.`,
    analysis,
  );

  assert.equal(result.ok, false);
  assert(result.issues.some((issue) => /calculation says/i.test(issue)));
});

test('AI interpretation rejects every raw basis-point value labeled as a per-100 rate', () => {
  const analysis = analysisFixture();
  const raw = analysis.position_trends[0].mobility.recent_value!;
  const result = evaluateNflArtifactInterpretation(
    `EDGE player movement reached ${raw} trades per 100 player-seasons.`,
    analysis,
  );

  assert.equal(result.ok, false);
  assert(result.issues.some((issue) => /not attached to the claimed EDGE signal/i.test(issue)));
});

function analysisFixture() {
  return analyzeNflTransactionMarketSnapshot({
    analysis_mode: 'ten_year_trend',
    start_year: 2016,
    end_year: 2025,
    position_groups: ['EDGE'],
    transaction_types: ['trade'],
    max_comparables: 5,
  }, snapshotFixture(), { generatedAt: '2026-09-02T00:00:00.000Z' });
}

function snapshotFixture(): NflTransactionMarketSnapshot {
  const events = Array.from({ length: 10 }, (_, yearIndex) => 2016 + yearIndex).flatMap((year) => (
    Array.from({ length: year <= 2018 ? 5 : year >= 2023 ? 8 : 6 }, (_, index) => ({
      event_id: `edge-${year}-${index}`,
      event_year: year,
      event_date: `${year}-03-${String(index + 1).padStart(2, '0')}`,
      date_precision: 'day' as const,
      transaction_type: 'trade' as const,
      player_id: `player-${year}-${index}`,
      player_name: `Edge Player ${year} ${index}`,
      position_group: 'EDGE' as const,
      from_team_id: 'AAA',
      to_team_id: 'BBB',
      contract_value_dollars: null,
      contract_apy_dollars: null,
      guaranteed_dollars: null,
      compensation_pick_rounds: [year >= 2023 ? 2 : 5],
      compensation_includes_player: false,
      trade_player_asset_count: 1,
      compensation_band: year >= 2023 ? 'rounds_2_3' as const : 'rounds_4_7' as const,
      compensation_summary: `Round ${year >= 2023 ? 2 : 5} pick`,
      identity_confidence: 'matched' as const,
      source_ref_ids: ['trades'],
    }))
  ));
  return {
    snapshot_id: 'guardrail-fixture-v1',
    events,
    roster_player_seasons: Array.from({ length: 10 }, (_, index) => ({
      year: 2016 + index,
      team_id: null,
      position_group: 'EDGE',
      roster_player_seasons: 100,
      source_ref_ids: ['trades'],
    })),
    league_caps: Array.from({ length: 10 }, (_, index) => ({
      year: 2016 + index,
      league_cap_dollars: 200_000_000,
      source_ref_ids: ['trades'],
    })),
    source_refs: [{
      id: 'trades',
      name: 'nflverse trades',
      url: 'https://github.com/nflverse/nfldata',
      upstream_attribution: 'Lee Sharpe / Pro Football Reference through nflverse',
      retrieved_at: '2026-09-02T00:00:00.000Z',
      as_of_date: '2026-09-02',
      checksum_sha256: 'a'.repeat(64),
      coverage_note: 'Fixture coverage.',
    }],
  };
}
