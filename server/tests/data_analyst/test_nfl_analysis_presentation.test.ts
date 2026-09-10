import assert from 'node:assert/strict';
import { test } from 'node:test';
import { presentAnalysisActivity, updateAnalysisActivity, type AnalysisActivity } from '@shared/nflAnalysisActivity';

const summary = (text: string): AnalysisActivity => ({ id: 'summary', kind: 'reasoning', text, status: 'done' });

test('contract and scouting task-management narration is omitted as a whole', () => {
  for (const text of [
    '**Executing plan action**\n\nI have enough tokens. The NFL comparison involves moving assets and restructuring the current budget.',
    'Adebo’s conversion releases cap space. I must follow the developer guidelines and keep the response concise.',
    'I’m thinking about a 350–430 word answer comparing receiving yards and cap charges.',
    'I should organize the scouting tables, choose eight rows and keep the paragraphs focused.',
    'The budget supports the move. Let’s keep it straightforward!',
    'The schema needs a source reference for every contract claim.',
  ]) assert.deepEqual(presentAnalysisActivity([summary(text)]), []);
});

test('substantive analysis retains attribution, uncertainty and linked conditions verbatim', () => {
  const text = 'Sutton has a longer active contract term, but that does not establish guaranteed liability. No guaranteed salary is reported for 2027.\n\nIf vesting has occurred, the comparison changes; the payment dates remain unverified.';
  const item = summary('**Evaluating contract obligations**\n\n' + text);
  const before = structuredClone(item);
  assert.equal(presentAnalysisActivity([item])[0].text, text);
  assert.deepEqual(item, before);
  const scouting = 'The attributed scouting model favors receiving ability, but the public production sample does not establish route fit.';
  assert.equal(presentAnalysisActivity([summary(scouting)])[0].text, scouting);
  const draft = 'The draft pick remains conditional, and written consent is required by the contract.';
  assert.equal(presentAnalysisActivity([summary(draft)])[0].text, draft);
});

test('a partial summary never flashes before later meta text arrives; tools appear immediately', () => {
  let items: AnalysisActivity[] = [];
  items = updateAnalysisActivity(items, { id: 'summary', kind: 'reasoning', delta: 'The contract has two active years.', status: 'running' });
  assert.deepEqual(presentAnalysisActivity(items, true), []);
  items = updateAnalysisActivity(items, { id: 'lookup', kind: 'tool', text: 'Reading contracts · Paulson Adebo', status: 'running' });
  assert.equal(presentAnalysisActivity(items, true)[0].kind, 'tool');
  items = updateAnalysisActivity(items, { id: 'summary', kind: 'reasoning', delta: ' I should fit the answer into 100 words.' });
  items = updateAnalysisActivity(items, { id: 'summary', kind: 'reasoning', status: 'done' });
  assert.deepEqual(presentAnalysisActivity(items, true).map(item => item.id), ['lookup']);
});

test('completed summaries appear during a live run and older saved summaries get the same presentation', () => {
  const item = summary('The conversion shifts cap charges into the remaining active year; annual cash is unchanged.');
  assert.deepEqual(presentAnalysisActivity([{ ...item, status: 'running' }], true), []);
  assert.deepEqual(presentAnalysisActivity([{ ...item, status: 'running' }]), []);
  assert.equal(presentAnalysisActivity([item], true)[0].text, item.text);
  assert.equal(presentAnalysisActivity([{ ...item, status: undefined }])[0].text, item.text);
});

test('generic headings and duplicated review steps disappear while tool failures remain visible', () => {
  const items: AnalysisActivity[] = [
    summary('**Executing the plan**'),
    { id: 'review', kind: 'status', text: 'Checking claims against the sources' },
    { id: 'finish', kind: 'tool', text: 'Checking the answer', status: 'done' },
    { id: 'lookup', kind: 'tool', text: 'Reading contracts', status: 'failed' },
  ];
  assert.deepEqual(presentAnalysisActivity(items), [items[3]]);
});
