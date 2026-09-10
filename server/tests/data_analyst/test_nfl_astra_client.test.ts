import assert from 'node:assert/strict';
import { test } from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';
import { ANALYST_MODEL, analystModelMetadata, analystResponseRequest, createAnalystClient } from '../../src/nfl_conversation/model.js';

const params = (): Anthropic.MessageCreateParamsNonStreaming => ({
  model: ANALYST_MODEL, max_tokens: 4500, system: 'Use the provided evidence.',
  tools: [{ name: 'lookup', input_schema: { type: 'object', properties: { player: { type: 'string' } }, required: ['player'] } }],
  messages: [{ role: 'user', content: 'Compare these players.' }],
});
const apiResponse = (output: unknown[], extra = {}) => new Response(JSON.stringify({
  id: 'resp_test', model: ANALYST_MODEL, status: 'completed', service_tier: 'fast', output,
  usage: { input_tokens: 100, output_tokens: 80, output_tokens_details: { reasoning_tokens: 50 }, input_tokens_details: { cached_tokens: 60 } }, ...extra,
}), { status: 200 });

test('Astra uses max reasoning, Fast mode and application tools without forcing optional fields', () => {
  const request = analystResponseRequest(params());
  assert.equal(request.model, ANALYST_MODEL);
  assert.deepEqual(request.reasoning, { effort: 'max' });
  assert.equal(request.service_tier, 'fast');
  assert.equal(request.store, false);
  assert.equal(request.max_output_tokens, 32768);
  assert.equal(request.tools[0].strict, false);
  assert.equal(request.tools[0].name, 'lookup');
  assert.equal(request.parallel_tool_calls, true);
  assert.throws(() => analystResponseRequest({ ...params(), model: 'different-model' }), /explicitly request/);
});

test('parallel tool IDs, encrypted reasoning and assistant phase survive a complete tool round', async () => {
  const requests: any[] = [];
  const output = [
    { id: 'rs_one', type: 'reasoning', encrypted_content: 'opaque-test-value', summary: [] },
    { id: 'msg_one', type: 'message', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: 'Checking both records.' }] },
    { id: 'fc_one', type: 'function_call', call_id: 'call_one', name: 'lookup', arguments: '{"player":"A"}' },
    { id: 'fc_two', type: 'function_call', call_id: 'call_two', name: 'lookup', arguments: '{"player":"B"}' },
  ];
  const call = createAnalystClient({ getApiKey: () => 'unit-test', fetch: (async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return requests.length === 1 ? apiResponse(output) : apiResponse([{ type: 'message', content: [{ type: 'output_text', text: 'Comparison complete.' }] }], { service_tier: 'default' });
  }) as typeof fetch });
  const first = await call(params());
  const calls = first.content.filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use');
  assert.deepEqual(calls.map(block => block.id), ['call_one', 'call_two']);
  assert.equal(JSON.stringify(first).includes('opaque-test-value'), false);
  const second = await call({ ...params(), messages: [...params().messages,
    { role: 'assistant', content: first.content },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_one', content: 'A evidence' }, { type: 'tool_result', tool_use_id: 'call_two', content: 'B unavailable', is_error: true }] },
  ] });
  assert.deepEqual(requests[1].input.slice(1, 5), output);
  assert.deepEqual(requests[1].input.slice(5), [{ type: 'function_call_output', call_id: 'call_one', output: 'A evidence' }, { type: 'function_call_output', call_id: 'call_two', output: '{"error":"B unavailable"}' }]);
  assert.equal(analystModelMetadata(first)?.reasoning_tokens, 50);
  assert.equal(analystModelMetadata(second)?.service_tier, 'default');
  assert.equal(analystModelMetadata(second)?.requested_service_tier, 'fast');
});

test('forced finish disables parallel calls and preserves strict reviewer schema', () => {
  const request = analystResponseRequest({ ...params(), tools: [{ ...params().tools![0], strict: true } as Anthropic.Tool], tool_choice: { type: 'tool', name: 'lookup', disable_parallel_tool_use: true } });
  assert.deepEqual(request.tool_choice, { type: 'function', name: 'lookup' });
  assert.equal(request.parallel_tool_calls, false);
  assert.equal(request.tools[0].strict, true);
});

test('missing credentials and rejected requests never retry or fall back to another provider', async () => {
  let calls = 0;
  const fetcher = (async () => { calls++; return new Response('{"error":{"code":"model_not_found","message":"test"}}', { status: 404 }); }) as typeof fetch;
  await assert.rejects(createAnalystClient({ getApiKey: () => undefined, fetch: fetcher })(params()), /OPENAI_API_KEY/);
  assert.equal(calls, 0);
  await assert.rejects(createAnalystClient({ getApiKey: () => 'unit-test', fetch: fetcher })(params()), /model_not_found/);
  assert.equal(calls, 1);
});

test('truncated output cannot be mistaken for a completed tool answer', async () => {
  const call = createAnalystClient({ getApiKey: () => 'unit-test', fetch: (async () => apiResponse([], { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } })) as typeof fetch });
  assert.equal((await call(params())).stop_reason, 'max_tokens');
  const malformed = createAnalystClient({ getApiKey: () => 'unit-test', fetch: (async () => apiResponse([{ type: 'function_call', call_id: 'call_bad', name: 'lookup', arguments: '{' }])) as typeof fetch });
  await assert.rejects(malformed(params()), /incomplete tool arguments/);
});

test('the parent abort reaches the provider request', async () => {
  const controller = new AbortController();
  controller.abort(new Error('test cancellation'));
  const call = createAnalystClient({ getApiKey: () => 'unit-test', fetch: (async (_url, init) => { init?.signal?.throwIfAborted(); return apiResponse([]); }) as typeof fetch });
  await assert.rejects(call(params(), { signal: controller.signal }), /test cancellation/);
});
