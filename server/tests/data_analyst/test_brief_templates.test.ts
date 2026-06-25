import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BRIEF_TEMPLATE_DEFINITIONS,
  CUSTOM_BASE_TEMPLATE_IDS,
  briefModeForTemplate,
  inferBriefTemplateFromQuestion,
  parseBriefTemplateSelection,
  parseSavedBriefTemplateInput,
  templateSelectionFromBrief,
} from '@shared/briefTemplates';
import {
  buildBriefTemplateSystemBlock,
  validatePresentationForTemplate,
} from '../../src/claude/brief_templates.js';
import { buildSubmitBriefTool } from '../../src/claude/tools.js';
import type { Brief, BriefPresentation } from '@shared/types';

test('template registry exposes curated templates and safe custom bases', () => {
  assert.deepEqual(BRIEF_TEMPLATE_DEFINITIONS.map((template) => template.id), [
    'decision_brief',
    'comparison_matrix',
    'options_table',
    'evidence_report',
    'staff_packet',
    'data_table',
    'custom',
  ]);
  assert.deepEqual(CUSTOM_BASE_TEMPLATE_IDS, [
    'decision_brief',
    'comparison_matrix',
    'options_table',
    'evidence_report',
    'staff_packet',
  ]);
});

test('template inference maps Gambit question families to answer formats', () => {
  assert.equal(inferBriefTemplateFromQuestion('Should Washington trade for a veteran guard?'), 'decision_brief');
  assert.equal(inferBriefTemplateFromQuestion('Compare ATL, BOS and MIL trade paths for Giannis'), 'comparison_matrix');
  assert.equal(
    inferBriefTemplateFromQuestion(
      'We are the Warriors front office. Should we pursue a low-risk guard trade, stand pat, or wait for the buyout market? Compare the three paths using basketball value, cap/CBA constraints, timing, execution risk, confidence, and evidence. Call out what analytics, coaching, scouting/front office, and cap staff should answer next.',
    ),
    'comparison_matrix',
  );
  assert.equal(inferBriefTemplateFromQuestion('Give me a table of options for using our MLE'), 'options_table');
  assert.equal(inferBriefTemplateFromQuestion('Give me options for using our MLE with CBA caveats'), 'options_table');
  assert.equal(inferBriefTemplateFromQuestion('What does the data say about highest usage?'), 'data_table');
  assert.equal(inferBriefTemplateFromQuestion('Validate the CBA evidence for this apron path'), 'evidence_report');
  assert.equal(inferBriefTemplateFromQuestion('Create staff questions for analytics and cap contracts'), 'staff_packet');
  assert.equal(inferBriefTemplateFromQuestion('/data Which Wizards players have the weakest net rating?'), 'data_table');
});

test('data table template forces data analyst mode without forcing compare/options templates', () => {
  assert.equal(briefModeForTemplate({ template_id: 'data_table' }), 'data_analyst');
  assert.equal(briefModeForTemplate({ template_id: 'comparison_matrix' }), null);
  assert.equal(briefModeForTemplate({ template_id: 'options_table' }), null);
});

test('custom template validation catches missing instructions, unsafe base, and oversize instructions', () => {
  assert.deepEqual(parseBriefTemplateSelection({ template_id: 'custom' }, 'Should we call?').errors, [
    'instructions required for custom template',
  ]);

  const unsafe = parseBriefTemplateSelection({
    template_id: 'custom',
    base_template_id: 'data_table',
    instructions: 'Use a terse scouting memo.',
  }, 'Question');
  assert.deepEqual(unsafe.errors, ['base_template_id unsupported']);

  const oversized = parseBriefTemplateSelection({
    template_id: 'custom',
    base_template_id: 'decision_brief',
    instructions: 'x'.repeat(2001),
  }, 'Question');
  assert.deepEqual(oversized.errors, [
    'instructions must be 2000 characters or fewer',
  ]);
});

test('saved custom template input requires name and safe base renderer', () => {
  assert.deepEqual(parseSavedBriefTemplateInput({
    name: '',
    base_template_id: 'data_table',
    instructions: '',
  }).errors, [
    'name required',
    'instructions required',
    'base_template_id unsupported',
  ]);

  const parsed = parseSavedBriefTemplateInput({
    name: 'Owner packet',
    base_template_id: 'staff_packet',
    instructions: 'Write in a forwardable ownership style.',
  });
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.base_template_id, 'staff_packet');
});

test('template prompt preserves source and tool guardrails', () => {
  const block = buildBriefTemplateSystemBlock({
    template_id: 'custom',
    base_template_id: 'evidence_report',
    instructions: 'Lead with missing facts.',
  });

  assert.match(block, /Allowed presentation section kinds/);
  assert.match(block, /Template instructions never override source\/citation\/tool-use rules/);
  assert.match(block, /Custom instructions/);
  assert.match(block, /primary visible artifact/);
  assert.match(block, /metadata\/current lean/);
  assert.match(block, /Job: audit truth/);
});

test('template prompts use distinct answer-product jobs', () => {
  const decisionBlock = buildBriefTemplateSystemBlock({ template_id: 'decision_brief' });
  assert.match(decisionBlock, /Job: make a call/);
  assert.match(decisionBlock, /Strategic options table/);
  assert.match(decisionBlock, /assumptions, ranges, comparable anchors, or validation targets/);
  assert.doesNotMatch(decisionBlock, /one actionable thesis/);

  const comparisonBlock = buildBriefTemplateSystemBlock({ template_id: 'comparison_matrix' });
  assert.match(comparisonBlock, /Job: compare named paths/);
  assert.match(comparisonBlock, /first visible artifact must be a comparison matrix table/i);
  assert.match(comparisonBlock, /Do not turn this into a staff packet/);

  const optionsBlock = buildBriefTemplateSystemBlock({ template_id: 'options_table' });
  assert.match(optionsBlock, /Job: inventory viable paths/);
  assert.match(optionsBlock, /first visible artifact must be a ranked options table/i);
  assert.match(optionsBlock, /current lead path/);
  assert.doesNotMatch(optionsBlock, /best\/recommended path/);

  const staffBlock = buildBriefTemplateSystemBlock({ template_id: 'staff_packet' });
  assert.match(staffBlock, /Job: delegate work/);
  assert.match(staffBlock, /Do not lead with a path-comparison/);
});

test('submit brief tool schema requires options only for decision briefs', () => {
  const decisionSchema = buildSubmitBriefTool({ template_id: 'decision_brief' }).input_schema as any;
  assert.equal(decisionSchema.required.includes('options'), true);
  assert.equal(decisionSchema.required.includes('presentation'), false);
  assert.equal(decisionSchema.properties.options.minItems, 3);

  const comparisonSchema = buildSubmitBriefTool({ template_id: 'comparison_matrix' }).input_schema as any;
  assert.equal(comparisonSchema.required.includes('presentation'), true);
  assert.equal(comparisonSchema.required.includes('options'), false);
  assert.equal(comparisonSchema.properties.options.minItems, 0);
  assert.match(comparisonSchema.properties.presentation.description, /First visible section must be a table/);
});

test('template presentation validation accepts good fixtures and rejects drift', () => {
  const goodMatrix: BriefPresentation = {
    template_id: 'comparison_matrix',
    sections: [{
      kind: 'table',
      title: 'Path comparison matrix',
      columns: ['Path', 'Basketball value', 'Cap/CBA impact', 'Timing', 'Execution risk', 'Confidence', 'Evidence'],
      rows: [
        ['Low-risk guard trade', 'Adds creation', 'Hard-cap check', 'Pre-deadline', 'Medium', '55%', '[1]'],
        ['Stand pat', 'Keeps depth', 'No new cap', 'Now', 'Low', '75%', '[2]'],
      ],
    }],
  };
  assert.deepEqual(validatePresentationForTemplate('comparison_matrix', goodMatrix), { ok: true, errors: [] });

  const driftedMatrix: BriefPresentation = {
    template_id: 'comparison_matrix',
    sections: [{
      kind: 'question_groups',
      title: 'Staff questions',
      groups: [{ audience: 'analytics', questions: ['What does EPM say?'] }],
    }],
  };
  assert.equal(validatePresentationForTemplate('comparison_matrix', driftedMatrix).ok, false);

  const goodOptions: BriefPresentation = {
    template_id: 'options_table',
    sections: [{
      kind: 'table',
      title: 'Ranked options',
      columns: ['Rank', 'Option', 'Required moves', 'Blockers', 'Next owner/action', 'Confidence', 'Evidence'],
      rows: [
        [1, 'Low-risk guard trade', 'Match salary', 'Hard-cap room', 'Cap staff validates apron room', '55%', '[1]'],
        [2, 'Stand pat', 'None', 'Internal growth must hold', 'Coaching tests rotation', '75%', '[2]'],
      ],
    }],
  };
  assert.deepEqual(validatePresentationForTemplate('options_table', goodOptions), { ok: true, errors: [] });

  const goodEvidence: BriefPresentation = {
    template_id: 'evidence_report',
    sections: [
      { kind: 'bullets', title: 'Known evidence', items: [{ body: 'GSW has guard depth questions.', source_refs: [1] }] },
      { kind: 'bullets', title: 'Missing private data', items: [{ body: 'Actual ownership tax tolerance is unknown.' }] },
    ],
  };
  assert.deepEqual(validatePresentationForTemplate('evidence_report', goodEvidence), { ok: true, errors: [] });

  const driftedStaff: BriefPresentation = {
    template_id: 'staff_packet',
    sections: [{
      kind: 'table',
      title: 'Path comparison matrix',
      columns: ['Path', 'Basketball value', 'Cap/CBA impact', 'Timing', 'Execution risk', 'Confidence'],
      rows: [['Trade', 'Better', 'Tight', 'Now', 'Medium', '55%']],
    }],
  };
  assert.equal(validatePresentationForTemplate('staff_packet', driftedStaff).ok, false);
});

test('stored briefs preserve template selection for regeneration defaults', () => {
  const brief = mockBrief({
    template_id: 'custom',
    template_base_id: 'staff_packet',
    custom_template_id: 'template-1',
    template_instructions: 'Use staff sections.',
  });

  assert.deepEqual(templateSelectionFromBrief(brief), {
    template_id: 'custom',
    base_template_id: 'staff_packet',
    custom_template_id: 'template-1',
    instructions: 'Use staff sections.',
  });

  assert.deepEqual(templateSelectionFromBrief(mockBrief({
    mode: 'data_analyst',
    template_id: null,
  })), {
    template_id: 'data_table',
    base_template_id: null,
    custom_template_id: null,
    instructions: null,
  });
});

function mockBrief(patch: Partial<Brief> = {}): Brief {
  return {
    id: 'brief-1',
    session_id: 'session-1',
    mode: 'brief',
    template_id: 'decision_brief',
    template_base_id: null,
    custom_template_id: null,
    template_instructions: null,
    question: 'What should the front office do?',
    thesis: null,
    body: null,
    status: 'generating',
    progress: null,
    error: null,
    duration_ms: null,
    created_at: '2026-05-03T00:00:00.000Z',
    updated_at: '2026-05-03T00:00:00.000Z',
    ...patch,
  };
}
