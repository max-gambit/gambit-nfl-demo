import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNflContextComposerForDataAnalyst,
  buildNflContextComposerForEvidence,
} from '../../src/claude/nfl_context_composer.js';
import {
  buildNflPrivateCriticRevisionBlock,
  evaluateNflDraftForPrivateCritic,
  runNflPrivateCritic,
} from '../../src/claude/private_critic.js';
import { buildCurrentNflEvidence } from '../../src/claude/nfl_evidence.js';
import type { DataAnalystTrace, SubmitBriefInput, SubmitDataAnalysisInput } from '@shared/types';

const TRADE_PROMPT = 'We are the Giants and need interior pressure without putting bad money on 2027. Should we call the Jets about Harrison Phillips, the Buccaneers about Vita Vea, or avoid the DT trade market unless a better seller emerges? Give me the realistic path, the salary-out piece, and what we weaken.';
const OL_PROMPT = 'We are the Giants. How good is our offensive line, and can we trust it before spending more cap?';
const CAP_PROMPT = 'We are the Giants. How should we create clean 2026 room without creating a 2027 hangover?';
const DB_SPEND_PROMPT = 'We are the Giants. Are we overinvested in the secondary, and what is the cleanest flexibility lever?';

test('NFL context composer orients trade answers without writing an answer plan', async () => {
  const evidence = await buildCurrentNflEvidence(TRADE_PROMPT);
  const context = buildNflContextComposerForEvidence(TRADE_PROMPT, evidence);

  assert.ok(context);
  assert.equal(context.intent_tags.includes('trade'), true);
  assert.equal(context.intent_tags.includes('seller_thesis'), true);
  assert.equal(context.focus_groups.includes('DL'), true);
  assert.match(context.system_block, /NFL ANALYST DESK CONTEXT/);
  assert.match(context.system_block, /evidence orientation, not an answer plan/i);
  assert.match(context.system_block, /Decision lenses/i);
  assert.equal(context.decision_primitives.some((primitive) => primitive.key === 'trade_price_discipline'), true);
  assert.equal(context.decision_primitives.some((primitive) => primitive.key === 'playable_depth'), true);
  assert.equal(context.decision_primitives.some((primitive) => primitive.key === 'decision_confidence'), true);
  assert.match(context.system_block, /Seller thesis cards/i);
  assert.match(context.system_block, /conditional\/day-three/i);
  assert.match(context.system_block, /Raw row counts are inventory/i);
  assert.match(context.system_block, /Do not headline Vita Vea/i);
  assert.match(context.system_block, /new extension, restructure, or new-money/i);
  assert.doesNotMatch(context.system_block, /Contract Ledger v1/i);
  assert.doesNotMatch(context.system_block, /Option \[1\]/i);
});

test('NFL context composer preserves OL public-data boundary', async () => {
  const evidence = await buildCurrentNflEvidence(OL_PROMPT);
  const context = buildNflContextComposerForEvidence(OL_PROMPT, evidence);

  assert.ok(context);
  assert.equal(context.intent_tags.includes('ol_quality'), true);
  assert.equal(context.focus_groups.includes('OL'), true);
  assert.match(context.system_block, /continuity and availability/i);
  assert.match(context.system_block, /Do not make OL pressure-allowed/i);
  assert.match(context.system_block, /For OL, use continuity, starts\/snaps, and availability only/i);
});

test('NFL context composer adds cap scenario and benchmark decision lenses', async () => {
  const capEvidence = await buildCurrentNflEvidence(CAP_PROMPT);
  const capContext = buildNflContextComposerForEvidence(CAP_PROMPT, capEvidence);
  assert.ok(capContext);
  assert.equal(capContext.decision_primitives.some((primitive) => primitive.key === 'cap_scenario_ladder'), true);
  assert.match(capContext.system_block, /small about \$5M, medium about \$10M, and large about \$15M\+/);
  assert.match(capContext.system_block, /scale the recommendation to how much room/i);

  const dbEvidence = await buildCurrentNflEvidence(DB_SPEND_PROMPT);
  const dbContext = buildNflContextComposerForEvidence(DB_SPEND_PROMPT, dbEvidence);
  assert.ok(dbContext);
  assert.equal(dbContext.decision_primitives.some((primitive) => primitive.key === 'benchmark_context'), true);
  assert.match(dbContext.system_block, /Before saying overinvested or underinvested/i);
  assert.match(dbContext.system_block, /Do not call a group overinvested from raw dollars alone/i);
});

test('NFL context composer can build from data analyst traces without NBA bleed-through', () => {
  const traces: DataAnalystTrace[] = [{
    tool_use_id: 'trace_nfl',
    tool_name: 'query_nfl_data',
    datasets: [
      {
        dataset_id: 'nfl_rosters_current',
        label: 'NFL offseason rosters',
        source_name: 'Reviewed NFL snapshot',
        as_of_date: '2026-06-29',
        team_ids: ['NYG'],
        row_count: 92,
      },
      {
        dataset_id: 'nfl_coverage_current',
        label: 'NFL coverage matrix',
        source_name: 'Gambit NFL Coverage Matrix',
        as_of_date: '2026-06-29',
        team_ids: ['NYG'],
        row_count: 1,
      },
      {
        dataset_id: 'nba_cap_sheets_current',
        label: 'NBA cap sheets',
        source_name: 'Gambit NBA demo',
        as_of_date: '2026-06-29',
        team_ids: ['GSW'],
        row_count: 15,
      },
    ],
    errors: [],
  }];

  const context = buildNflContextComposerForDataAnalyst('We are the Giants. Run a roster audit.', traces);
  assert.ok(context);
  assert.deepEqual(context.team_ids, ['NYG']);
  assert.match(context.system_block, /nfl_rosters_current/);
  assert.match(context.system_block, /trace 1:/);
  assert.doesNotMatch(context.system_block, /\[1\] nfl_rosters_current/);
  assert.doesNotMatch(context.system_block, /nba_cap_sheets_current/);
  assert.doesNotMatch(context.system_block, /GSW/);

  const nbaOnly = buildNflContextComposerForDataAnalyst('Warriors cap audit', [{
    tool_use_id: 'trace_nba',
    tool_name: 'query_nba_data',
    datasets: [{
      dataset_id: 'nba_cap_sheets_current',
      label: 'NBA cap sheets',
      source_name: 'Gambit NBA demo',
      as_of_date: '2026-06-29',
      team_ids: ['GSW'],
      row_count: 15,
    }],
    errors: [],
  }]);
  assert.equal(nbaOnly, null);

  const nbaTraceWithNflDataset = buildNflContextComposerForDataAnalyst('Warriors context audit', [{
    tool_use_id: 'trace_nba_context',
    tool_name: 'query_nba_data',
    datasets: [{
      dataset_id: 'nfl_context_graph',
      label: 'NFL-shaped context graph dataset from non-NFL trace',
      source_name: 'Gambit demo',
      as_of_date: '2026-06-29',
      team_ids: ['NYG'],
      row_count: 1,
    }],
    errors: [],
  }]);
  assert.equal(nbaTraceWithNflDataset, null);
});

test('data analyst composer keeps same dataset ids separate across tool results', () => {
  const traces: DataAnalystTrace[] = [{
    tool_use_id: 'trace_nyg',
    tool_name: 'query_nfl_data',
    datasets: [{
      dataset_id: 'nfl_rosters_current',
      label: 'NFL offseason rosters',
      source_name: 'Reviewed NFL snapshot',
      as_of_date: '2026-06-29',
      team_ids: ['NYG'],
      row_count: 1,
    }],
    errors: [],
  }, {
    tool_use_id: 'trace_tb',
    tool_name: 'query_nfl_data',
    datasets: [{
      dataset_id: 'nfl_rosters_current',
      label: 'NFL offseason rosters',
      source_name: 'Reviewed NFL snapshot',
      as_of_date: '2026-06-29',
      team_ids: ['TB'],
      row_count: 1,
    }],
    errors: [],
  }];
  const messages = traces.map((trace) => ({
    role: 'user',
    content: [{
      type: 'tool_result',
      tool_use_id: trace.tool_use_id,
      is_error: false,
      content: JSON.stringify({
        ok: true,
        tool_name: 'query_nfl_data',
        datasets: trace.datasets,
        errors: [],
        data: {
          rosters: {
            rows: [{
              team_id: trace.datasets[0].team_ids[0],
              player_name: trace.datasets[0].team_ids[0] === 'NYG' ? 'Dexter Lawrence' : 'Vita Vea',
              position: 'DT',
            }],
          },
        },
      }),
    }],
  }));

  const context = buildNflContextComposerForDataAnalyst(
    'Compare the Giants and Buccaneers defensive tackle rooms.',
    traces,
    messages as never,
  );

  assert.ok(context);
  assert.deepEqual(context.source_ref_map, [
    'trace 1: nfl_rosters_current (NYG)',
    'trace 2: nfl_rosters_current (TB)',
  ]);
  assert.match(context.system_block, /trace 1: Team: NYG/);
  assert.match(context.system_block, /trace 2: Team: TB/);
});

test('private critic flags a Tampa/Vita Vea lead-lane overclaim', async () => {
  const evidence = await buildCurrentNflEvidence(TRADE_PROMPT);
  const context = buildNflContextComposerForEvidence(TRADE_PROMPT, evidence);
  assert.ok(context);
  const draft: SubmitDataAnalysisInput = {
    answer: 'Vita Vea is the highest-confidence lane because Tampa has an expiring contract fit and the Giants need interior pressure.',
    key_findings: [{
      label: 'Target',
      body: 'Lead with Vita Vea.',
      source_refs: [1],
    }],
    tables: [],
    calculations: [],
    sources: [],
    caveats: [],
    followups: [],
  };

  const critique = evaluateNflDraftForPrivateCritic({
    question: TRADE_PROMPT,
    composedContext: context,
    draftKind: 'data_analysis',
    draft,
  });

  assert.equal(critique.verdict, 'revise');
  assert.equal(critique.issues.some((issue) => issue.category === 'seller_thesis_overclaim'), true);
  assert.match(buildNflPrivateCriticRevisionBlock(critique), /high impact but low probability/i);
});

test('data analyst composer carries trade-screen seller thesis into the private critic', () => {
  const traces: DataAnalystTrace[] = [{
    tool_use_id: 'trace_trade',
    tool_name: 'query_nfl_data',
    datasets: [{
      dataset_id: 'nfl_trade_screen_current',
      label: 'NFL trade-goal screen',
      source_name: 'Reviewed NFL snapshot',
      as_of_date: '2026-06-29',
      team_ids: ['NYG'],
      row_count: 3,
    }],
    errors: [],
  }];
  const messages = [{
    role: 'user',
    content: [{
      type: 'tool_result',
      tool_use_id: 'trace_trade',
      is_error: false,
      content: JSON.stringify({
        ok: true,
        tool_name: 'query_nfl_data',
        datasets: traces[0].datasets,
        errors: [],
        data: {
          trade_screen: {
            screens: [{
              subject_team_id: 'NYG',
              objective: 'Add interior pressure without adding bad 2027 money.',
              outgoing_hierarchy: ['Jon Runyan first if salary-out is needed.'],
              depth_after_trade: ['Moving Runyan thins interior OL but preserves premium starters.'],
              named_target_lanes: ['Vita Vea/Tampa: posture_change_only; high impact, low probability; do_not_lead'],
              counterparty_intel_team_ids: ['TB'],
              counterparty_intel_summary: ['TB Vita Vea: action=posture_change_only; seller_case=cap fit only; objection=core interior role'],
              bad_cap_relief_trades: ['Do not move Burns/Thomas/Carter as cap relief.'],
              answer_requirements: ['Do not lead with Vita Vea unless Tampa posture changes.'],
              row_count: 3,
            }],
          },
        },
      }),
    }],
  }];

  const context = buildNflContextComposerForDataAnalyst(TRADE_PROMPT, traces, messages as never);
  assert.ok(context);
  assert.match(context.system_block, /Seller thesis cards/i);
  assert.match(context.system_block, /posture_change_only/i);
  assert.match(context.system_block, /Do not headline Vita Vea/i);

  const draft: SubmitDataAnalysisInput = {
    answer: 'Vita Vea is the highest-confidence lane because the cap profile works.',
    key_findings: [{ label: 'Lead lane', body: 'Start with Tampa.', source_refs: [1] }],
    tables: [],
    calculations: [],
    sources: [],
    caveats: [],
    followups: [],
  };
  const critique = evaluateNflDraftForPrivateCritic({
    question: TRADE_PROMPT,
    composedContext: context,
    draftKind: 'data_analysis',
    draft,
  });

  assert.equal(critique.verdict, 'revise');
  assert.equal(critique.issues.some((issue) => issue.category === 'seller_thesis_overclaim'), true);
});

test('private critic flags OL quality overreach and product-meta language', async () => {
  const evidence = await buildCurrentNflEvidence(OL_PROMPT);
  const context = buildNflContextComposerForEvidence(OL_PROMPT, evidence);
  assert.ok(context);
  const draft: SubmitBriefInput = {
    thesis: 'Contract Ledger v1 says the Giants OL is a quality unit with strong pass-blocking grades.',
    reasoning: 'Andrew Thomas and the interior have a clean pressure allowed profile, so the line is not a concern.',
    watching: [{ tag: 'OL', body: 'Watch injuries.' }],
    options: mockOptions(),
    sources: [],
  };

  const critique = evaluateNflDraftForPrivateCritic({
    question: OL_PROMPT,
    composedContext: context,
    draftKind: 'brief',
    draft,
  });

  assert.equal(critique.verdict, 'revise');
  assert.equal(critique.issues.some((issue) => issue.category === 'ol_quality_overreach'), true);
  assert.equal(critique.issues.some((issue) => issue.category === 'meta_language'), true);
});

test('private critic flags missing cap ladder and row-count-only depth claims', async () => {
  const capEvidence = await buildCurrentNflEvidence(CAP_PROMPT);
  const capContext = buildNflContextComposerForEvidence(CAP_PROMPT, capEvidence);
  assert.ok(capContext);
  const capDraft: SubmitDataAnalysisInput = {
    answer: 'Cut Jon Runyan and restructure Adebo to create room while keeping 2027 clean.',
    key_findings: [],
    tables: [],
    calculations: [],
    sources: [],
    caveats: [],
    followups: [],
  };
  const capCritique = evaluateNflDraftForPrivateCritic({
    question: CAP_PROMPT,
    composedContext: capContext,
    draftKind: 'data_analysis',
    draft: capDraft,
  });
  assert.equal(capCritique.verdict, 'revise');
  assert.equal(capCritique.issues.some((issue) => issue.category === 'missing_cap_ladder'), true);

  const tradeEvidence = await buildCurrentNflEvidence(TRADE_PROMPT);
  const tradeContext = buildNflContextComposerForEvidence(TRADE_PROMPT, tradeEvidence);
  assert.ok(tradeContext);
  const depthDraft: SubmitDataAnalysisInput = {
    answer: 'Trade Runyan because the OL stays 15 roster rows after the move.',
    key_findings: [],
    tables: [],
    calculations: [],
    sources: [],
    caveats: [],
    followups: [],
  };
  const depthCritique = evaluateNflDraftForPrivateCritic({
    question: TRADE_PROMPT,
    composedContext: tradeContext,
    draftKind: 'data_analysis',
    draft: depthDraft,
  });
  assert.equal(depthCritique.verdict, 'revise');
  assert.equal(depthCritique.issues.some((issue) => issue.category === 'row_count_depth_overclaim'), true);
});

test('private critic flags missing trade price, unsupported role fit, and unsupported benchmark claims', async () => {
  const tradeEvidence = await buildCurrentNflEvidence(TRADE_PROMPT);
  const tradeContext = buildNflContextComposerForEvidence(TRADE_PROMPT, tradeEvidence);
  assert.ok(tradeContext);
  const tradeDraft: SubmitDataAnalysisInput = {
    answer: 'Call the Jets for Harrison Phillips because he solves the interior pressure need.',
    key_findings: [],
    tables: [],
    calculations: [],
    sources: [],
    caveats: [],
    followups: [],
  };
  const tradeCritique = evaluateNflDraftForPrivateCritic({
    question: TRADE_PROMPT,
    composedContext: tradeContext,
    draftKind: 'data_analysis',
    draft: tradeDraft,
  });
  assert.equal(tradeCritique.verdict, 'revise');
  assert.equal(tradeCritique.issues.some((issue) => issue.category === 'missing_trade_price'), true);
  assert.equal(tradeCritique.issues.some((issue) => issue.category === 'unsupported_role_fit'), true);

  const dbEvidence = await buildCurrentNflEvidence(DB_SPEND_PROMPT);
  const dbContext = buildNflContextComposerForEvidence(DB_SPEND_PROMPT, dbEvidence);
  assert.ok(dbContext);
  const dbDraft: SubmitDataAnalysisInput = {
    answer: 'The secondary is overinvested and too expensive, so move a veteran.',
    key_findings: [],
    tables: [],
    calculations: [],
    sources: [],
    caveats: [],
    followups: [],
  };
  const dbCritique = evaluateNflDraftForPrivateCritic({
    question: DB_SPEND_PROMPT,
    composedContext: dbContext,
    draftKind: 'data_analysis',
    draft: dbDraft,
  });
  assert.equal(dbCritique.verdict, 'revise');
  assert.equal(dbCritique.issues.some((issue) => issue.category === 'unsupported_benchmark_claim'), true);
});

test('private critic scans primary presentation bodies for unsupported visible claims', async () => {
  const evidence = await buildCurrentNflEvidence(OL_PROMPT);
  const context = buildNflContextComposerForEvidence(OL_PROMPT, evidence);
  assert.ok(context);
  const draft: SubmitBriefInput = {
    thesis: 'The visible template carries the analysis.',
    reasoning: 'Legacy body is intentionally clean.',
    watching: [{ tag: 'OL', body: 'Watch injuries.' }],
    options: mockOptions(),
    sources: [],
    presentation: {
      template_id: 'evidence_report',
      title: 'Giants OL',
      sections: [{
        kind: 'prose',
        title: 'Finding',
        body: 'The Giants offensive line has clean pressure allowed numbers and strong pass-blocking grades.',
      }],
    },
  };

  const critique = evaluateNflDraftForPrivateCritic({
    question: OL_PROMPT,
    composedContext: context,
    draftKind: 'brief',
    draft,
  });

  assert.equal(critique.verdict, 'revise');
  assert.equal(critique.issues.some((issue) => issue.category === 'ol_quality_overreach'), true);
});

test('private critic scans visible option detail fields for unsupported claims', async () => {
  const evidence = await buildCurrentNflEvidence(OL_PROMPT);
  const context = buildNflContextComposerForEvidence(OL_PROMPT, evidence);
  assert.ok(context);
  const options = mockOptions();
  options[0].details.downside = 'No concern because the Giants line has clean pressure allowed numbers and strong pass-blocking grades.';
  const draft: SubmitBriefInput = {
    thesis: 'Use a conservative OL answer.',
    reasoning: 'Legacy body stays within continuity and availability.',
    watching: [{ tag: 'OL', body: 'Watch injuries.' }],
    options,
    sources: [],
  };

  const critique = evaluateNflDraftForPrivateCritic({
    question: OL_PROMPT,
    composedContext: context,
    draftKind: 'brief',
    draft,
  });

  assert.equal(critique.verdict, 'revise');
  assert.equal(critique.issues.some((issue) => issue.category === 'ol_quality_overreach'), true);
});

test('private critic accepts a compact source-grounded draft', async () => {
  const evidence = await buildCurrentNflEvidence(OL_PROMPT);
  const context = buildNflContextComposerForEvidence(OL_PROMPT, evidence);
  assert.ok(context);
  const draft: SubmitDataAnalysisInput = {
    answer: 'Treat the Giants offensive line as a continuity and availability question from the public file, not a fully graded quality claim.',
    key_findings: [{
      label: 'Public evidence boundary',
      body: 'The loaded scorecards support snaps, starts, and availability context; pressure-allowed quality still needs a reviewed OL source.',
      source_refs: [3, 4],
    }],
    tables: [],
    calculations: [],
    sources: [],
    caveats: ['Public OL quality data is limited to continuity and availability here.'],
    followups: [],
  };

  const critique = evaluateNflDraftForPrivateCritic({
    question: OL_PROMPT,
    composedContext: context,
    draftKind: 'data_analysis',
    draft,
  });

  assert.equal(critique.verdict, 'accept');
  assert.deepEqual(critique.issues, []);
});

test('model private critic cannot override deterministic high-severity revision findings', async () => {
  const evidence = await buildCurrentNflEvidence(TRADE_PROMPT);
  const context = buildNflContextComposerForEvidence(TRADE_PROMPT, evidence);
  assert.ok(context);
  const draft: SubmitDataAnalysisInput = {
    answer: 'Vita Vea is the highest-confidence lane.',
    key_findings: [{ label: 'Target', body: 'Lead with Vita Vea.', source_refs: [1] }],
    tables: [],
    calculations: [],
    sources: [],
    caveats: [],
    followups: [],
  };

  const critique = await runNflPrivateCritic({
    question: TRADE_PROMPT,
    composedContext: context,
    draftKind: 'data_analysis',
    draft,
    createMessage: async () => ({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: 'test',
      content: [{
        type: 'tool_use',
        id: 'toolu_test',
        name: 'submit_private_critique',
        input: {
          verdict: 'accept',
          issues: [],
          revision_instructions: [],
          source_ref_corrections: [],
        },
      }],
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    } as never),
  });

  assert.equal(critique.verdict, 'revise');
  assert.equal(critique.issues.some((issue) => issue.category === 'seller_thesis_overclaim'), true);
});

function mockOptions(): SubmitBriefInput['options'] {
  return [1, 2, 3].map((ref) => ({
    ref_index: ref,
    title: `Option ${ref}`,
    subtitle: null,
    type_kind: 'trade',
    path_kind: 'transition',
    net_cap_num: 0,
    net_cap_label: '$0',
    epm: '0',
    cba_section: 'NFL',
    timing: '2026',
    src_count: 1,
    likelihood_kind: 'plausible',
    likelihood_pct: 50,
    spark: [0, 0, 0, 0, 0],
    details: {
      decision_question: `Question ${ref}`,
      why_this: `Why ${ref}`,
      upside: 'Keeps optionality.',
      downside: 'Requires validation.',
      required_moves: ['Validate public evidence.'],
      blockers: [],
      watch_triggers: ['Injury update.'],
      next_step: 'Review with staff.',
      evidence_refs: [1],
    },
  }));
}
