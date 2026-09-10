import assert from 'node:assert/strict';
import test from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';
import type { FactualAnswer } from '../../src/nfl_facts/answer.js';
import { buildNflAiAnswer } from '../../src/nfl_facts/ai_answer.js';
import { AnalystProviderError } from '../../src/nfl_conversation/model.js';
import { updateNflConversationState } from '../../src/nfl_conversation/state.js';
import { executeContractComparison } from '../../src/nfl_conversation/contract_tools.js';
import { loadNflDemoSeed } from '../../src/nfl_data/seed.js';

const seed = loadNflDemoSeed();
const loadData = async () => ({ seed: await seed, source_mode: 'supabase_current_views' as const, fallback_reason: null });
const conversion = { schema_version: 1 as const, team_id: 'NYG', season: 2026, timing: 'post_june_1' as const, moves: [{ player_id: 'Paulson Adebo', action: 'restructure' as const, conversion_amount: 6_000_000 }] };
const originalQuestion = 'Convert $6 million of Paulson Adebo’s 2026 salary after June 1.';
const question = 'What contract and payroll details must we verify before executing Adebo’s conversion?';
const stale: FactualAnswer = {
  body: { kind: 'data_analysis', answer: 'Historical player movements', key_findings: [], calculations: [], caveats: [], followups: [],
    tables: [{ title: 'Unrelated historical movements', columns: ['Period', 'Moves'], rows: [['2016–2025', 17992]], source_refs: [1] }],
    market_analysis: { query: { start_year: 2016, end_year: 2025 }, yearly_series: [], coverage: {} } as any,
  },
  sources: [{ ref_index: 1, source: 'Historical fixture', title: 'Unrelated historical movements', kind: 'table', data: {}, updated_at: '2026-09-09' }],
};

test('early provider failure cannot turn an unrelated prefetch into an answer or change the active scenario', async () => {
  const prior = await executeContractComparison(conversion, originalQuestion, undefined, undefined);
  prior.body.conversation_state = updateNflConversationState({ objective: 'contract', transaction: 'restructure', supplied_terms: ['Paulson Adebo conversion: $6,000,000'] }, undefined, originalQuestion);
  const before = structuredClone(prior.body);
  const result = await buildNflAiAnswer(question, { loadData, history: [{ question: originalQuestion, body: prior.body }], initialEvidence: stale,
    callModel: async () => { throw new AnalystProviderError('http_503', 'Unavailable'); },
  });
  assert.equal(result.body.ai_analysis?.outcome, 'unavailable');
  assert.equal(result.body.ai_analysis?.provider_error_code, 'http_503');
  assert.deepEqual(result.body.conversation_state, before.conversation_state);
  assert.deepEqual(prior.body, before);
  assert.equal(result.body.market_analysis, undefined);
  assert.deepEqual(result.body.tables, []);
  assert.deepEqual(result.sources, []);
  assert.deepEqual(result.body.followups, [question]);
});

test('late provider failure retains executed contract evidence and excludes unrelated prefetched tables and sources', async () => {
  let calls = 0;
  const result = await buildNflAiAnswer(originalQuestion, { loadData, initialEvidence: stale, callModel: async () => {
    if (calls++) throw new AnalystProviderError('stream_failed', 'Stream failed');
    return { id: 'test', type: 'message', role: 'assistant', model: 'test', stop_reason: 'tool_use', stop_sequence: null,
      content: [{ type: 'tool_use', id: 'conversion', name: 'nfl_contract_comparison', input: conversion }], usage: { input_tokens: 0, output_tokens: 0 },
    } as Anthropic.Message;
  } });
  assert.equal(result.body.ai_analysis?.outcome, 'evidence_only');
  assert.ok(result.body.contract_scenario);
  assert.equal(result.body.market_analysis, undefined);
  assert.ok(result.body.tables.length > 0);
  assert.doesNotMatch(JSON.stringify(result), /Unrelated historical movements/);
  const refs = new Set(result.sources.map(source => source.ref_index));
  assert.ok(result.body.tables.every(table => table.source_refs.every(ref => refs.has(ref))));
});
