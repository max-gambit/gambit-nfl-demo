import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDeterministicNflTransactionMarketFallback,
  deterministicMarketChatAnswer,
  evaluateNflTransactionMarketDraft,
} from '../../src/claude/nfl_transaction_market_guardrails.js';
import { analyzeNflTransactionMarketSnapshot, type NflTransactionMarketSnapshot } from '../../src/nfl_transactions/analyze.js';
import type { SubmitDataAnalysisInput } from '@shared/types';

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

test('artifact-grounded fallback itself passes deterministic checks', () => {
  const analysis = analysisFixture();
  const draft: SubmitDataAnalysisInput = buildDeterministicNflTransactionMarketFallback(analysis);
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
