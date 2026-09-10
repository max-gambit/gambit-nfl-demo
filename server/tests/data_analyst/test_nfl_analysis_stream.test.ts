import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readSse } from '@shared/sse';
import { updateAnalysisActivity, type AnalysisActivity } from '@shared/nflAnalysisActivity';
import { briefRoutes } from '../../src/routes/briefs.js';

test('SSE decoding preserves split UTF-8, CRLF frames, multiline data and ignores heartbeats', async () => {
  const bytes = new TextEncoder().encode(': ping\r\n\r\nevent: activity\r\ndata: Montréal\r\ndata: résumé\r\n\r\n');
  const response = new Response(new ReadableStream({ start(controller) {
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } }));
  const events = [];
  for await (const event of readSse(response)) events.push(event);
  assert.deepEqual(events, [{ event: 'activity', data: 'Montréal\nrésumé' }]);
});

test('summary completion replaces deltas once, tool status retains labels, and persisted activity stays bounded', () => {
  let items: AnalysisActivity[] = [];
  items = updateAnalysisActivity(items, { id: 'rs1', kind: 'reasoning', delta: 'Checking ' });
  items = updateAnalysisActivity(items, { id: 'rs1', kind: 'reasoning', delta: 'costs.' });
  items = updateAnalysisActivity(items, { id: 'rs1', kind: 'reasoning', text: 'Checking costs.' });
  assert.equal(items[0].text, 'Checking costs.');
  items = updateAnalysisActivity(items, { id: 'tool1', kind: 'tool', text: 'Reading contracts', status: 'running' });
  items = updateAnalysisActivity(items, { id: 'tool1', kind: 'tool', status: 'failed' });
  assert.equal(items[1].text, 'Reading contracts');
  assert.equal(items[1].status, 'failed');
  for (let i = 0; i < 100; i++) items = updateAnalysisActivity(items, { id: String(i), kind: 'reasoning', delta: 'a'.repeat(20000) });
  assert.equal(items.length, 60);
  assert.ok(items.every(item => item.text.length <= 12000));
});

test('streaming POST returns typed failure for invalid input while ordinary POST keeps its HTTP contract', async () => {
  const request = { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: '{}' };
  const streamed = await briefRoutes.request('/', request);
  assert.match(streamed.headers.get('Content-Type') ?? '', /text\/event-stream/);
  const events = [];
  for await (const event of readSse(streamed)) events.push({ event: event.event, data: JSON.parse(event.data) });
  assert.equal(events[0].event, 'connected');
  assert.deepEqual(events.at(-1), { event: 'failure', data: { error: 'session_id required' } });
  const ordinary = await briefRoutes.request('/', { ...request, headers: { 'Content-Type': 'application/json' } });
  assert.equal(ordinary.status, 400);
  assert.deepEqual(await ordinary.json(), { error: 'session_id required' });
});
