import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NFL_RELIABILITY_JUDGE_MODEL,
  NFL_RELIABILITY_MAX_JUDGE_CALLS,
  NFL_RELIABILITY_MAX_JUDGE_OUTPUT_TOKENS,
  buildTerraJudgeRequest,
  judgeNflReliabilityCases,
  parseTerraJudgeResponse,
  type NflReliabilityJudgeCase,
} from './terra-judge.js';

const CASES: NflReliabilityJudgeCase[] = [
  { id: 'current-followup-scope', answer: 'The Giants should treat this as a multi-week Nabers contingency.', facts: { team: 'NYG', player: 'Malik Nabers' } },
  { id: 'seller-interpretation-grounding', answer: 'The Burns return is above the historical range.', facts: { player: 'Brian Burns', pick_year: 2027, pick_round: 2 } },
];

test('Terra judge is one bounded, non-retained structured request', () => {
  const request = buildTerraJudgeRequest(CASES);
  assert.equal(request.model, NFL_RELIABILITY_JUDGE_MODEL);
  assert.equal(request.store, false);
  assert.deepEqual(request.reasoning, { effort: 'none' });
  assert.ok(request.max_output_tokens <= NFL_RELIABILITY_MAX_JUDGE_OUTPUT_TOKENS);
  assert.equal(NFL_RELIABILITY_MAX_JUDGE_CALLS, 1);
  assert.equal(request.text.format.type, 'json_schema');
  assert.equal(request.text.format.strict, true);
});

test('missing OpenAI credentials produces an explicit skip and no network call', async () => {
  let calls = 0;
  const result = await judgeNflReliabilityCases({
    cases: CASES,
    fetchImpl: async () => {
      calls += 1;
      throw new Error('unreachable');
    },
  });
  assert.equal(calls, 0);
  assert.deepEqual(result, { status: 'skipped_no_openai_key', verdicts: [], usage: null });
});

test('Terra judge batches all cases into exactly one call', async () => {
  let calls = 0;
  const result = await judgeNflReliabilityCases({
    apiKey: 'test-key',
    cases: CASES,
    fetchImpl: async (_input, init) => {
      calls += 1;
      const request = JSON.parse(String(init?.body)) as { input: Array<{ content: Array<{ text: string }> }> };
      assert.match(request.input[1].content[0].text, /current-followup-scope/);
      assert.match(request.input[1].content[0].text, /seller-interpretation-grounding/);
      return new Response(JSON.stringify({
        output: [{
          type: 'message',
          content: [{
            type: 'output_text',
            text: JSON.stringify({
              cases: CASES.map((entry) => ({
                id: entry.id,
                verdict: 'pass',
                violations: [],
                rationale: 'Grounded.',
              })),
            }),
          }],
        }],
        usage: { input_tokens: 321, output_tokens: 45 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.status, 'completed');
  assert.equal(result.verdicts.length, 2);
  assert.deepEqual(result.usage, { input_tokens: 321, output_tokens: 45 });
});

test('Terra response parser rejects missing or duplicated case IDs', () => {
  assert.throws(() => parseTerraJudgeResponse({
    output_text: JSON.stringify({
      cases: [
        { id: CASES[0].id, verdict: 'pass', violations: [], rationale: 'Grounded.' },
        { id: CASES[0].id, verdict: 'pass', violations: [], rationale: 'Grounded.' },
      ],
    }),
  }, CASES.map((entry) => entry.id)), /each requested case exactly once/);
});
