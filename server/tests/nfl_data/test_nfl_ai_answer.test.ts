import assert from 'node:assert/strict';
import test from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';
import { analystPlayerEvidence, analystPlayerQuery, analystTradeEvidence, buildNflAiAnswer } from '../../src/nfl_facts/ai_answer.js';
import { loadReviewedNflTransactionSnapshot } from '../../src/nfl_transactions/seed.js';
import { loadNflDemoSeed } from '../../src/nfl_data/seed.js';
import { isFactualBody } from '@shared/nflFacts';
import { factualAnswerPresentation } from '@shared/nflAnswerDepth';

const seedPromise = loadNflDemoSeed();
const loadData = async () => ({ seed: await seedPromise, source_mode: 'supabase_current_views' as const, fallback_reason: null });
const editDraft = async (draft: { body: import('@shared/types').DataAnalysisBriefBody }) => ({ ...draft.body, assumptions: draft.body.ai_analysis?.assumptions ?? [] });
const toolResponse = (name: string, input: unknown): Anthropic.Message => ({
  id: 'test-message', type: 'message', role: 'assistant', model: 'test-model', stop_reason: 'tool_use', stop_sequence: null,
  content: name === 'finish_analysis' ? [{ type: 'text', text: JSON.stringify(input) }] : [{ type: 'tool_use', id: 'tool-' + name, name, input }], usage: { input_tokens: 0, output_tokens: 0 },
} as Anthropic.Message);
function finalInput(params: Anthropic.MessageCreateParamsNonStreaming) {
  const lookups = params.messages.flatMap(message => Array.isArray(message.content) ? message.content : [])
    .filter((block): block is Anthropic.ToolResultBlockParam => block.type === 'tool_result' && !block.is_error)
    .map(block => JSON.parse(String(block.content))).filter(value => value.tables?.length);
  return ({ answer: 'Start by comparing the recorded usage and contract profiles of outside receivers. These current-team charges do not establish the Giants’ acquisition cost.',
  key_findings: [{ label: 'Outside receivers', body: 'This comparison preserves the requested cap ceiling.', source_refs: [1] }],
  tables: [{ table_id: 'lookup_1:0', title: 'Receiver records for investigation', row_names: lookups.at(-1).tables[0].rows.slice(0, 2).map((row: { row_name: string }) => row.row_name), column_names: ['Player', 'Team', '2026 cap at current team'] }],
  evidence_id: 'lookup_1', continuation_query_id: 'lookup_1', caveats: ['Seller availability and incoming cap costs still need checking.'], assumptions: ['Nabers’ availability concern is user-supplied context.'], followups: ['Keep the same budget and show more playing experience.'],
});
}

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
  const result = await buildNflAiAnswer(question, { loadData, editDraft, callModel: async params => {
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
    return toolResponse('finish_analysis', finalInput(params));
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

test('unretrieved table names get one repair opportunity and never fabricate a row', async () => {
  let calls = 0;
  const result = await buildNflAiAnswer('Compare outside receivers.', { loadData, editDraft, callModel: async params => {
    calls++;
    if (calls === 1) return toolResponse('search_player_records', { team_ids: [], position_groups: ['WR'], exclude_nyg: true, limit: 5 });
    if (calls === 2) return toolResponse('finish_analysis', { ...finalInput(params), tables: [{ ...finalInput(params).tables[0], row_names: ['Imaginary Receiver'] }] });
    assert.match(String(params.messages.at(-1)!.content), /Unknown table row/);
    return toolResponse('finish_analysis', finalInput(params));
  } });
  assert.equal(calls, 3);
  assert.equal(result.body.tables[0].rows.length, 2);
});

test('follow-up context keeps original language and concrete predicates without executing old parser debris', async () => {
  const seed = await seedPromise;
  const prior = analystPlayerQuery({ team_ids: [], position_groups: ['WR'], exclude_nyg: true, numeric_filters: [{ field: 'cap_2026', operator: 'lt', value: 3_000_000 }] }, seed, null);
  prior.unresolved_constraints = ['exclude blowing up our cap'];
  let calls = 0;
  const result = await buildNflAiAnswer('Same budget, exclude Dallas.', { loadData, editDraft, history: [{ question: 'Look for outside WRs under $3 million.', body: { kind: 'data_analysis', answer: 'Earlier answer', factual_query: prior, key_findings: [], tables: [], calculations: [], caveats: [], followups: [] } }], callModel: async params => {
    calls++;
    if (calls === 1) {
      assert.match(String(params.messages[0].content), /outside WRs under/);
      return toolResponse('search_player_records', { inherit_previous: true, excluded_team_ids: ['DAL'], limit: 10 });
    }
    return toolResponse('finish_analysis', finalInput(params));
  } });
  assert.deepEqual(result.body.factual_query?.unresolved_constraints, []);
  assert.deepEqual(result.body.factual_query?.numeric_filters, prior.numeric_filters);
  assert.deepEqual(result.body.factual_query?.excluded_team_ids, ['DAL']);
});

test('provider failure is explicit rather than replaced by an unfiltered player list', async () => {
  await assert.rejects(buildNflAiAnswer('Explore receiver acquisitions.', { loadData, editDraft, callModel: async () => { throw new Error('provider unavailable'); } }), /provider unavailable/);
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

test('the AI can request existing release and restructure contract calculations', async () => {
  const seed = await seedPromise;
  const cap = seed.cap_rows.find(row => row.player_name === 'Paulson Adebo' && row.team_id === 'NYG')!;
  for (const transaction of ['release', 'restructure'] as const) {
    const query = analystPlayerQuery({ player_names: ['Paulson Adebo'], transaction, post_june: false }, seed, null);
    const table = analystPlayerEvidence(query, seed).body.tables[0];
    const expected = transaction === 'release' ? cap.cut_savings_2026 : cap.restructure_savings_estimate_2026;
    assert.equal(table.rows[0][table.columns.indexOf('2026 savings')], expected == null ? 'Not recorded' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(expected));
    assert.ok(analystPlayerEvidence(query, seed).body.caveats.some(value => /Scenario:|Restructure savings/.test(value)));
  }
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


test('the factual editor can qualify prose without rewriting exact tables or scope', async () => {
  let calls = 0;
  const result = await buildNflAiAnswer('Which internal receivers should we compare?', { loadData,
    editDraft: async draft => ({ ...draft.body, answer: 'Start with the largest recorded workload, while checking the veterans whose usage is missing. A larger future role is a hypothesis for the coaching staff.', assumptions: ['Nabers unavailable is a user scenario.'] }),
    callModel: async params => ++calls === 1
      ? toolResponse('search_player_records', { team_ids: ['NYG'], position_groups: ['WR'], sort: 'snaps_desc', limit: 5 })
      : toolResponse('finish_analysis', finalInput(params)),
  });
  assert.match(result.body.answer, /hypothesis/);
  assert.equal(result.body.tables[0].rows.length, 2);
  assert.ok(result.body.tables[0].rows.every(row => row[1] === 'NYG'));
  assert.deepEqual(result.body.factual_query?.team_ids, ['NYG']);
});
