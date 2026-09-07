import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NFL_RELIABILITY_DETERMINISTIC_CASE_COUNT,
  buildNflReliabilityConversationCases,
  buildNflReliabilityIntentCases,
} from '../../../shared/nflReliabilityCases.js';
import {
  NFL_BRIEF_GENERATION_DEADLINE_MS,
  briefGenerationDeadlineMs,
  buildCurrentNflConversationContext,
} from '../../src/routes/briefs.js';
import { classifyNflAnalysisTurn } from '../../src/nfl_transactions/intent.js';

const READY_DATA_BODY = {
  kind: 'data_analysis' as const,
  answer: '',
  key_findings: [],
  tables: [],
  calculations: [],
  caveats: [],
  followups: [],
};

test('the zero-cost reliability corpus stays broad', () => {
  const conversationCases = buildNflReliabilityConversationCases();
  const intentCases = buildNflReliabilityIntentCases();
  assert.equal(conversationCases.length + intentCases.length, NFL_RELIABILITY_DETERMINISTIC_CASE_COUNT);
  assert.ok(NFL_RELIABILITY_DETERMINISTIC_CASE_COUNT >= 150);
  assert.equal(new Set([...conversationCases, ...intentCases].map((entry) => entry.id)).size, NFL_RELIABILITY_DETERMINISTIC_CASE_COUNT);
});

test('explicit team names reset or retain a first-person default-team scope correctly', () => {
  const prior = [{
    id: 'first-person-prior',
    session_id: 'reliability-session',
    question: 'Which receivers should we target in a trade?',
    thesis: 'Compare the best fits.',
    body: { ...READY_DATA_BODY, answer: 'Compare the best fits for our current roster and cap.' },
    status: 'ready' as const,
    mode: 'data_analyst' as const,
    template_id: 'decision_brief' as const,
    created_at: '2026-09-06T12:00:00.000Z',
  }];

  assert(buildCurrentNflConversationContext('Which of those targets should the Giants call first?', prior));
  assert.equal(buildCurrentNflConversationContext('What about those targets for the Bills?', prior), null);
});

for (const reliabilityCase of buildNflReliabilityConversationCases()) {
  test(`current-NFL context matrix: ${reliabilityCase.id}`, () => {
    const context = buildCurrentNflConversationContext(reliabilityCase.question, [{
      id: `prior:${reliabilityCase.id}`,
      session_id: 'reliability-session',
      question: reliabilityCase.prior_question,
      thesis: reliabilityCase.prior_answer,
      body: { ...READY_DATA_BODY, answer: reliabilityCase.prior_answer },
      status: 'ready',
      mode: 'data_analyst',
      template_id: 'decision_brief',
      created_at: '2026-09-06T12:00:00.000Z',
    }]);

    if (reliabilityCase.expected === 'inherit_current_nfl') {
      assert(context, `${reliabilityCase.id} should inherit its current-NFL scope`);
      assert.match(context.reasoning_question, new RegExp(escapeRegex(reliabilityCase.question)));
      assert.equal(
        briefGenerationDeadlineMs({ question: reliabilityCase.question }, context),
        NFL_BRIEF_GENERATION_DEADLINE_MS,
      );
      return;
    }

    assert.equal(context, null, `${reliabilityCase.id} should start a fresh scope`);
  });
}

for (const reliabilityCase of buildNflReliabilityIntentCases()) {
  test(`NFL route matrix: ${reliabilityCase.id}`, () => {
    assert.equal(
      classifyNflAnalysisTurn(reliabilityCase.question, {
        market_query: null,
        seller_scenario: null,
      }).kind,
      reliabilityCase.expected,
    );
  });
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
