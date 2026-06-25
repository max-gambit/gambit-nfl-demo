import test from 'node:test';
import assert from 'node:assert/strict';
import {
  briefGenerationErrorMessage,
  briefProgressStreamPayload,
  buildBriefUserPrompt,
  currentNbaEvidenceTeamIds,
  missingSubmitBriefFields,
  normalizeSubmitBriefInput,
  shouldRunContextGraphLookup,
  shouldRepairMissingSubmitBriefFields,
} from '../../src/routes/briefs.js';
import {
  mergeMoveCandidateEnrichment,
} from '../../src/claude/move_candidates.js';

test('first-person roster questions inherit the active demo team for app evidence', () => {
  const question = [
    'Build our offseason plan around three constraints:',
    're-signing Coby White, deciding whether Brandon Miller is worth an early max extension,',
    'and using Miles Bridges expiring salary without weakening the young core.',
  ].join(' ');

  assert.deepEqual(currentNbaEvidenceTeamIds(question, 'CHA'), ['CHA']);
  assert.match(buildBriefUserPrompt(question, 'CHA'), /Subject team: CHA/);
  assert.match(buildBriefUserPrompt(question, 'CHA'), /3-5 options/);
});

test('explicit team names win over the active demo team for app evidence', () => {
  const question = 'Should the Wizards shop a wing contract or preserve cap flexibility?';

  assert.deepEqual(currentNbaEvidenceTeamIds(question, 'CHA'), ['WAS']);
});

test('first-person counterparty questions include active demo team and named teams', () => {
  const question = 'Should we trade Jonathan Kuminga to the Lakers?';

  assert.deepEqual(currentNbaEvidenceTeamIds(question, 'GSW'), ['GSW', 'LAL']);
});

test('roster-sensitive questions resolve active or named teams for app evidence', () => {
  assert.deepEqual(currentNbaEvidenceTeamIds('Do we still have Jonathan Kuminga?', 'GSW'), ['GSW']);
  assert.deepEqual(currentNbaEvidenceTeamIds('Who do we have at guard?', 'GSW'), ['GSW']);
  assert.deepEqual(currentNbaEvidenceTeamIds('What is our depth chart at center?', 'GSW'), ['GSW']);
  assert.deepEqual(currentNbaEvidenceTeamIds('Starting lineup for Golden State?', 'BOS'), ['GSW']);
  assert.deepEqual(currentNbaEvidenceTeamIds('Who are the current Warriors players?', 'BOS'), ['GSW']);
});

test('context graph lookup still runs for current-evidence prompts that ask for team context', () => {
  assert.equal(
    shouldRunContextGraphLookup(
      'Using the GSW Intel onboarding profile, current public roster/cap/stat data, and Intel, identify the roster decisions where team-specific priorities change the recommendation.',
      true,
    ),
    true,
  );
  assert.equal(shouldRunContextGraphLookup('Should we trade Jonathan Kuminga to the Lakers?', true), false);
  assert.equal(shouldRunContextGraphLookup('What does the offseason plan look like?', false), true);
});

test('brief progress stream payload exposes only live-render fields', () => {
  const progress = {
    phase: 'drafting' as const,
    pct: 40,
    label: 'Drafting structured answer',
    detail: 'Asking the model for thesis and options.',
    updated_at: '2026-06-12T06:00:00.000Z',
    events: [{
      at: '2026-06-12T06:00:00.000Z',
      phase: 'drafting' as const,
      pct: 40,
      label: 'Drafting structured answer',
      detail: 'Asking the model for thesis and options.',
      kind: 'model' as const,
    }],
  };

  assert.deepEqual(briefProgressStreamPayload({
    id: 'brief-1',
    status: 'generating',
    progress,
    error: null,
    updated_at: '2026-06-12T06:00:01.000Z',
  }), {
    brief_id: 'brief-1',
    status: 'generating',
    progress,
    error: null,
    updated_at: '2026-06-12T06:00:01.000Z',
  });
});

test('submit brief normalization accepts server-provided source rows', () => {
  const input = normalizeSubmitBriefInput({
    thesis: 'Prioritize the core-extension path.',
    reasoning: 'This keeps the main decision tree intact.',
    options: mockSubmitOptions(),
  }, true);

  assert.deepEqual(input.sources, []);
  assert.deepEqual(missingSubmitBriefFields(input), []);
});

test('submit brief normalization drops archetype-only move candidates', () => {
  const input = normalizeSubmitBriefInput({
    thesis: 'Trade only if the construction is concrete.',
    reasoning: 'Generic move buckets are not useful enough for the operator view.',
    options: [
      {
        ref_index: 1,
        title: 'Trade for a guard',
        details: {
          evidence_refs: [1],
          move_candidates: [{
            label: 'Archetype: higher-floor combo guard via Moody-led match',
            mechanism: 'Send Moody plus filler for a combo guard in the $12-15M range.',
            why: 'Adds ball-handling.',
            cost: 'Moody plus pick.',
            constraints: 'Requires a willing seller.',
            evidence_refs: [1],
          }],
        },
      },
      { ref_index: 2, title: 'Stand pat', details: { evidence_refs: [1] } },
      { ref_index: 3, title: 'Buyout guard', details: { evidence_refs: [1] } },
    ],
  }, true);

  assert.deepEqual(input.options[0].details.move_candidates, []);
});

test('move candidate enrichment attaches specific player constructions by option ref', () => {
  const input = normalizeSubmitBriefInput({
    thesis: 'Prioritize one named guard construction.',
    reasoning: 'The construction needs player, salary, and evidence detail.',
    options: mockSubmitOptions(),
  }, true);

  const merged = mergeMoveCandidateEnrichment(input, {
    options: [{
      option_ref: 2,
      candidates: [{
        label: 'Alex Caruso via Moody-led match',
        subject_team_id: 'GSW',
        target_player_names: ['Alex Caruso'],
        target_team_id: 'OKC',
        target_team_name: 'Oklahoma City Thunder',
        outgoing_player_names: ['Moses Moody'],
        outgoing_package: 'Moses Moody plus minimum filler',
        salary_match: 'Use Moody salary as the primary matching piece and validate apron room.',
        basketball_fit: 'Adds playoff point-of-attack defense and secondary handling.',
        cost: 'Moody plus a protected pick or equivalent second-round value.',
        constraints: 'Seller availability is unconfirmed.',
        evidence_refs: [7],
      }],
    }],
  }, 9);

  assert.deepEqual(merged.options[0].details.move_candidates, []);
  assert.equal(merged.options[1].details.move_candidates?.[0]?.target_player_names?.[0], 'Alex Caruso');
  assert.equal(merged.options[1].details.move_candidates?.[0]?.target_team_id, 'OKC');
  assert.equal(merged.options[1].details.move_candidates?.[0]?.subject_team_id, 'GSW');
  assert.deepEqual(merged.options[1].details.move_candidates?.[0]?.outgoing_player_names, ['Moses Moody']);
  assert.deepEqual(merged.options[1].details.move_candidates?.[0]?.evidence_refs, [7, 9]);
});

test('submit brief normalization accepts template presentations without strategic options for non-decision templates', () => {
  const input = normalizeSubmitBriefInput({
    thesis: 'Compare the paths before spending assets.',
    reasoning: 'The table captures the actionable tradeoffs.',
    watching: [{ tag: 'Market', body: 'Guard prices may move before the deadline.' }],
    sources: [{ ref_index: 1, kind: 'NEWS', title: 'Public market note' }],
    presentation: {
      template_id: 'comparison_matrix',
      sections: [
        {
          kind: 'table',
          title: 'Paths',
          columns: ['Path', 'Risk'],
          rows: [['Low-risk guard trade', 'Asset price may exceed role value']],
        },
      ],
    },
  }, false);

  assert.deepEqual(input.options, []);
  assert.deepEqual(missingSubmitBriefFields(input, { template_id: 'comparison_matrix' }), []);
});

test('submit brief validation requires strategic options for decision briefs', () => {
  const input = normalizeSubmitBriefInput({
    thesis: 'Pursue the low-risk guard trade only if the hard-cap math clears.',
    reasoning: 'The current lean needs strategic alternatives.',
    watching: [{ tag: 'Market', body: 'Guard prices may move before the deadline.' }],
    sources: [{ ref_index: 1, kind: 'NEWS', title: 'Public market note' }],
    presentation: {
      template_id: 'decision_brief',
      sections: [
        {
          kind: 'table',
          title: 'Optional context',
          columns: ['Path', 'Risk'],
          rows: [['Low-risk guard trade', 'Asset price may exceed role value']],
        },
      ],
    },
  }, false);

  assert.deepEqual(missingSubmitBriefFields(input), ['options']);
});

test('submit brief validation requires presentation for non-decision templates', () => {
  const input = normalizeSubmitBriefInput({
    thesis: 'Compare the paths before spending assets.',
    reasoning: 'The table should carry the analysis.',
    watching: [{ tag: 'Market', body: 'Guard prices may move before the deadline.' }],
    sources: [{ ref_index: 1, kind: 'NEWS', title: 'Public market note' }],
  }, false);

  assert.deepEqual(missingSubmitBriefFields(input, { template_id: 'comparison_matrix' }), ['presentation']);
});

test('first-person prompt only forces options for decision briefs', () => {
  const question = 'Should we pursue a low-risk guard trade before the deadline?';
  const decisionPrompt = buildBriefUserPrompt(question, 'GSW', { template_id: 'decision_brief' });
  const comparisonPrompt = buildBriefUserPrompt(question, 'GSW', { template_id: 'comparison_matrix' });

  assert.match(decisionPrompt, /3-5 options/);
  assert.match(decisionPrompt, /Do not omit options/);
  assert.doesNotMatch(comparisonPrompt, /3-5 options/);
  assert.match(comparisonPrompt, /selected template presentation/);
});

test('missing decision-brief options are repairable before failing the brief', () => {
  assert.equal(
    shouldRepairMissingSubmitBriefFields(['options'], { template_id: 'decision_brief' }),
    true,
  );
  assert.equal(
    shouldRepairMissingSubmitBriefFields(['options'], { template_id: 'comparison_matrix' }),
    false,
  );
  assert.equal(
    shouldRepairMissingSubmitBriefFields(['options', 'sources'], { template_id: 'decision_brief' }),
    false,
  );
});

test('submit brief normalization still requires sources without server evidence', () => {
  const input = normalizeSubmitBriefInput({
    thesis: 'Prioritize the core-extension path.',
    reasoning: 'This keeps the main decision tree intact.',
    options: [],
  }, false);

  assert.deepEqual(missingSubmitBriefFields(input), ['options', 'sources']);
});

function mockSubmitOptions(): unknown[] {
  return [
    { ref_index: 1, title: 'Lead path', details: { evidence_refs: [1] } },
    { ref_index: 2, title: 'Alternative path', details: { evidence_refs: [1] } },
    { ref_index: 3, title: 'Hold path', details: { evidence_refs: [1] } },
  ];
}

test('brief generation errors hide raw provider JSON for known operational blockers', () => {
  assert.equal(
    briefGenerationErrorMessage(new Error(
      '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."},"request_id":"req_123"}',
    )),
    'Anthropic API credit balance is too low. Add credits or switch ANTHROPIC_API_KEY, then regenerate this brief.',
  );

  assert.equal(
    briefGenerationErrorMessage({
      error: {
        error: {
          message: 'tool_choice forces tool use is not compatible with this model.',
        },
      },
    }),
    'Configured Anthropic model does not support forced tool submissions. Switch to a tool-capable brief model or fallback model, then regenerate this brief.',
  );
});
