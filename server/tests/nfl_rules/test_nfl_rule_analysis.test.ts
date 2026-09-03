import assert from 'node:assert/strict';
import test from 'node:test';
import { buildNflRuleAnswer } from '../../src/nfl_rules/analysis.js';

test('post-June trade question returns a plain-language answer with exact CBA location', async () => {
  const result = await buildNflRuleAnswer('What are post-June 1 trade rules?');

  assert.match(result.body.answer, /trade completed after June 1/i);
  assert.match(result.body.answer, /advance post-June 1 designation is a release mechanism/i);
  assert.doesNotMatch(result.body.answer, /submit_brief|options|sources|required fields/i);
  assert.equal(result.sources[0]?.kind, 'CBA');
  const rows = result.sources[0]?.data?.rows as Array<{ k: string; v: string }>;
  assert.match(rows.find((row) => row.k === 'Exact location')?.v ?? '', /Article 13, Section 6/);
  assert.match(String(result.sources[0]?.data?.source_url), /March-15-2020-NFL-NFLPA/);
});

test('every rule family recognized by conversational routing can clear retrieval scoring', async () => {
  const cases = [
    ['How does the PUP list work?', 'injury_lists'],
    ['What are NFL rules on contract extensions?', 'extensions'],
    ['How do compensatory picks work?', 'compensatory_picks'],
  ] as const;

  for (const [question, family] of cases) {
    const result = await buildNflRuleAnswer(question);
    assert.notEqual(result.body.answer, 'The loaded public rulebook does not have a strong match for that question.');
    assert.equal(result.sources[0]?.data?.rule_family, family, question);
  }
});
