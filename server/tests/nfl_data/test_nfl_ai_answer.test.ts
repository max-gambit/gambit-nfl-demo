import { loadReviewedNflTransactionSnapshot } from '../../src/nfl_transactions/seed.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';
import { analystPlayerEvidence, analystPlayerQuery, analystTradeEvidence, buildNflAiAnswer } from '../../src/nfl_facts/ai_answer.js';
import { loadNflDemoSeed } from '../../src/nfl_data/seed.js';
import { isFactualBody } from '@shared/nflFacts';
import { factualAnswerPresentation } from '@shared/nflAnswerDepth';

const seedPromise = loadNflDemoSeed();
const loadData = async () => ({ seed: await seedPromise, source_mode: 'supabase_current_views' as const, fallback_reason: null });
const toolResponse = (name: string, input: unknown): Anthropic.Message => ({
  id: 'test-message', type: 'message', role: 'assistant', model: 'test-model', stop_reason: 'tool_use', stop_sequence: null,
  content: [{ type: 'tool_use', id: 'tool-' + name, name, input }], usage: { input_tokens: 0, output_tokens: 0 },
} as Anthropic.Message);
const finalInput = () => ({ answer: 'Start by comparing the recorded usage and contract profiles of outside receivers. These current-team charges do not establish the Giants’ acquisition cost.',
  key_findings: [{ label: 'Outside receivers', body: 'This comparison preserves the requested cap ceiling.', source_refs: [1] }],
  tables: [{ table_id: 'lookup_1:0', title: 'Receiver records for investigation', row_ids: ['r0', 'r1'], column_names: ['Player', 'Team', '2026 cap at current team'] }],
  evidence_id: 'lookup_1', continuation_query_id: 'lookup_1', caveats: ['Seller availability and incoming cap costs still need checking.'], assumptions: ['Nabers’ availability concern is user-supplied context.'], followups: ['Keep the same budget and show more playing experience.'],
});

test('semantic search arguments preserve strict budgets and positive/excluded scopes', async () => {
  const seed = await seedPromise;
  const prior = analystPlayerQuery({ team_ids: [], position_groups: ['WR'], exclude_nyg: true, numeric_filters: [{ field: 'cap_2026', operator: 'lt', value: 5_000_000 }], sort: 'snaps_desc' }, seed, null);
  const next = analystPlayerQuery({ inherit_previous: true, excluded_team_ids: ['DAL'], limit: 5 }, seed, prior);
  assert.deepEqual(next.numeric_filters, prior.numeric_filters);
  assert.deepEqual(next.position_groups, ['WR']);
  assert.equal(next.exclude_nyg, true);
  const result = analystPlayerEvidence(next, seed);
  assert.ok(result.body.tables[0].rows.length);
  for (const row of result.body.tables[0].rows) {
    assert.ok(row[1] !== 'NYG' && row[1] !== 'DAL');
    assert.ok(Number(String(row[4]).replace(/[^0-9]/g, '')) < 5_000_000);
  }
  const empty = analystPlayerQuery({ team_ids: ['DAL'], excluded_team_ids: ['DAL'] }, seed, null);
  assert.deepEqual(analystPlayerEvidence(empty, seed).body.tables, []);
});

test('unsupported executable arguments cannot silently produce a different search', async () => {
  const seed = await seedPromise;
  for (const input of [{ healthy: true }, { team_ids: ['MISSING'] }, { player_names: ['Imaginary Receiver'] }, { numeric_filters: [{ field: 'pff_grade', operator: 'gt', value: 80 }] }, { inherit_previous: true }]) {
    assert.throws(() => analystPlayerQuery(input, seed, null));
  }
});

test('AI can interpret the exact scenario and select only retrieved table cells and sources', async () => {
  let calls = 0;
  const question = "Malik nabers' knee is in bad shape. We need to look at WR acquisitions. Where should we be looking without blowing up our cap?";
  const result = await buildNflAiAnswer(question, { loadData, prefetch: false, reviewDraft: async () => [], callModel: async params => {
    calls++;
    if (calls === 1) {
      assert.ok(String(params.messages[0].content).includes(question));
      return toolResponse('search_player_records', { team_ids: [], position_groups: ['WR'], exclude_nyg: true, sort: 'snaps_desc', limit: 10 });
    }
    const toolResults = params.messages.at(-1)!.content as Anthropic.ToolResultBlockParam[];
    const lookup = JSON.parse(String(toolResults[0].content));
    assert.ok(lookup.tables[0].columns.includes('2026 cap at current team'));
    assert.ok(lookup.tables[0].columns.includes('2025 receiving yards'));
    assert.ok(lookup.tables[0].rows.every((row: { fields: Record<string, string> }) => row.fields.Team !== 'NYG'));
    return toolResponse('finish_analysis', finalInput());
  } });
  assert.equal(calls, 2);
  assert.equal(result.body.language_policy, 'grounded_ai_v1');
  assert.equal(isFactualBody(result.body), true);
  assert.deepEqual(factualAnswerPresentation(result.body), result.body);
  assert.equal(result.body.tables[0].rows.length, 2);
  assert.deepEqual(result.body.tables[0].columns, ['Player', 'Team', '2026 cap at current team']);
  assert.equal(result.body.factual_query?.exclude_nyg, true);
  assert.equal(result.body.ai_analysis?.model, 'test-model');
  assert.ok(result.body.tables[0].source_refs.every(ref => result.sources.some(source => source.ref_index === ref)));
});

test('invalid model table indexes get one repair opportunity and never fabricate a row', async () => {
  let calls = 0;
  const result = await buildNflAiAnswer('Compare outside receivers.', { loadData, prefetch: false, reviewDraft: async () => [], callModel: async params => {
    calls++;
    if (calls === 1) return toolResponse('search_player_records', { team_ids: [], position_groups: ['WR'], exclude_nyg: true, limit: 5 });
    if (calls === 2) return toolResponse('finish_analysis', { ...finalInput(), tables: [{ ...finalInput().tables[0], row_ids: ['r999'] }] });
    const results = params.messages.at(-1)!.content as Anthropic.ToolResultBlockParam[];
    assert.equal(results[0].is_error, true);
    assert.match(String(results[0].content), /Unknown table row/);
    return toolResponse('finish_analysis', finalInput());
  } });
  assert.equal(calls, 3);
  assert.equal(result.body.tables[0].rows.length, 2);
});

test('follow-up context keeps original language and concrete predicates without executing old parser debris', async () => {
  const seed = await seedPromise;
  const prior = analystPlayerQuery({ team_ids: [], position_groups: ['WR'], exclude_nyg: true, numeric_filters: [{ field: 'cap_2026', operator: 'lt', value: 3_000_000 }] }, seed, null);
  prior.unresolved_constraints = ['exclude blowing up our cap'];
  let calls = 0;
  const result = await buildNflAiAnswer('Same budget, exclude Dallas.', { loadData, prefetch: false, reviewDraft: async () => [], history: [{ question: 'Look for outside WRs under $3 million.', body: { kind: 'data_analysis', answer: 'Earlier answer', factual_query: prior, key_findings: [], tables: [], calculations: [], caveats: [], followups: [] } }], callModel: async params => {
    calls++;
    if (calls === 1) {
      assert.match(String(params.messages[0].content), /outside WRs under/);
      return toolResponse('search_player_records', { inherit_previous: true, excluded_team_ids: ['DAL'], limit: 10 });
    }
    return toolResponse('finish_analysis', finalInput());
  } });
  assert.deepEqual(result.body.factual_query?.unresolved_constraints, []);
  assert.deepEqual(result.body.factual_query?.numeric_filters, prior.numeric_filters);
  assert.deepEqual(result.body.factual_query?.excluded_team_ids, ['DAL']);
});

test('provider failure is explicit rather than replaced by an unfiltered player list', async () => {
  const result = await buildNflAiAnswer('Explore receiver acquisitions.', { loadData, prefetch:false, reviewDraft: async()=>[], callModel: async()=>{throw new Error('provider unavailable');} });
  assert.equal(result.body.ai_analysis?.outcome,'unavailable');
  assert.equal(result.body.tables.length,0);
  assert.match(result.body.answer,/question is saved/);
});


test('older saved cap and starts limits survive a sort-only continuation', async () => {
  const seed = await seedPromise;
  const legacy = analystPlayerQuery({ position_groups: ['IOL'] }, seed, null);
  delete legacy.numeric_filters;
  legacy.max_cap = 5_000_000;
  legacy.min_starts = 10;
  const next = analystPlayerQuery({ inherit_previous: true, sort: 'snaps_desc' }, seed, legacy);
  assert.deepEqual(next.numeric_filters, [{ field: 'cap_2026', operator: 'lte', value: 5_000_000 }, { field: 'starts_2025', operator: 'gte', value: 10 }]);
});

test('single-year history returns only that year while preserving full packages', async () => {
  const result = await analystTradeEvidence({ start_year: 2024, end_year: 2024, position_groups: ['WR'] }, async () => (await loadReviewedNflTransactionSnapshot()).snapshot);
  assert.deepEqual(result.body.historical_selection?.years, [2024]);
  assert.ok(result.sources.length > 0);
  assert.ok(result.sources.every(source => source.updated_at?.startsWith('2024')));
  assert.ok(result.body.historical_selection?.event_ids.length);
});

test('depth-only snap defaults remain missing and recorded career stage is available', async () => {
  const seed = await seedPromise;
  const query = analystPlayerQuery({ player_names: ['Darnell Mooney', 'Malachi Fields', 'Darius Slayton'] }, seed, null);
  const table = analystPlayerEvidence(query, seed).body.tables[0];
  const cell = (name: string, column: string) => table.rows.find(row => row[0] === name)![table.columns.indexOf(column)];
  assert.equal(cell('Darnell Mooney', '2025 snaps'), 'Not recorded');
  assert.equal(cell('Darnell Mooney', '2025 offensive snaps'), 'Not recorded');
  assert.equal(cell('Darius Slayton', '2025 snaps'), '755');
  assert.equal(cell('Malachi Fields', 'NFL experience (years)'), 'R');
  const onlyPositive = analystPlayerQuery({ inherit_previous: true, numeric_filters: [{ field: 'snaps_2025', operator: 'gte', value: 0 }] }, seed, query);
  assert.ok(analystPlayerEvidence(onlyPositive, seed).body.tables[0].rows.every(row => row[0] === 'Darius Slayton'));
});