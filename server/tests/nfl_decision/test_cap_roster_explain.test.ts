import assert from 'node:assert/strict';
import test from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';
import type { NflCapRosterExplanationRequest } from '@shared/types';
import type { NflCapRosterNarrativeDraft } from '../../src/claude/private_critic.js';
import { buildCapRosterDecision } from '../../src/nfl_decision/cap_roster.js';
import { explainCapRosterDecision } from '../../src/nfl_decision/explain.js';
import { loadNflDemoSeed } from '../../src/nfl_data/seed.js';
import type { NflTransactionMarketDataHealth } from '../../src/nfl_transactions/seed.js';

const generatedAt = new Date('2026-09-02T18:00:00.000Z');

async function fixture() {
  const seed = structuredClone(await loadNflDemoSeed());
  seed.as_of_date = '2026-09-02T12:00:00.000Z';
  seed.retrieved_at = '2026-09-02T12:15:00.000Z';
  const request: NflCapRosterExplanationRequest = {
    team_id: 'NYG',
    question: 'Explain the recommended branch and the checks before action.',
    use_live_model: true,
    target_relief_dollars: 12_000_000,
    protected_player_ids: [],
    protected_position_groups: ['QB'],
    allowed_levers: ['hold', 'pre_june_cut', 'post_june_cut', 'trade'],
  };
  const options = { data: { seed, source_mode: 'supabase_current_views' as const, fallback_reason: null }, generatedAt, transactionMarket: transactionMarketHealth() };
  const decision = await buildCapRosterDecision(request, options);
  const branch = decision.branches.find((candidate) => candidate.id === decision.recommended_branch_id);
  assert.ok(branch);
  return { request, options, branch };
}

function transactionMarketHealth(): NflTransactionMarketDataHealth {
  return {
    source_mode: 'supabase_current_views',
    snapshot_id: 'fixture-transaction-market',
    as_of_date: '2026-09-02',
    retrieved_at: '2026-09-02T12:15:00.000Z',
    row_count: 100,
    coverage: {
      start_year: 2016,
      end_year: 2025,
      event_count: 100,
      trade_event_count: 50,
      contract_event_count: 50,
      trade_asset_count: 75,
      contract_term_count: 50,
      matched_position_count: 96,
      directional_position_count: 2,
      unmatched_position_count: 2,
      position_match_basis_points: 9_600,
      compensation_coverage_basis_points: 9_600,
      contract_term_coverage_basis_points: 9_600,
      transaction_types: { trade: 50, free_agent_signing: 50 },
    },
    sources: [],
    fallback_reason: null,
  };
}

function validDraft(branch: Awaited<ReturnType<typeof fixture>>['branch']): NflCapRosterNarrativeDraft {
  return {
    summary: 'The selected branch reaches the target with contract-backed actions.',
    rationale: 'It uses verified positive relief while preserving the stated protection boundary.',
    risks: ['Football operations must confirm every modeled depth effect before execution.'],
    next_actions: ['Confirm each contract row with cap administration.'],
    player_ids: branch.actions.map((action) => action.player_id),
    rule_ids: [...new Set(branch.actions.flatMap((action) => action.rule_references.map((rule) => rule.rule_id)))],
  };
}

function message(input: NflCapRosterNarrativeDraft): Anthropic.Message {
  return {
    content: [{ type: 'tool_use', id: 'tool-1', name: 'submit_nfl_cap_roster_explanation', input }],
  } as unknown as Anthropic.Message;
}

test('accepted model prose cannot originate player rows or figures', async () => {
  const { request, options, branch } = await fixture();
  const result = await explainCapRosterDecision(request, {
    ...options,
    apiKeyAvailable: true,
    createMessage: async () => message(validDraft(branch)),
  });
  assert.equal(result.status, 'model_validated');
  assert.equal(result.branch_id, branch.id);
  assert.deepEqual(result.player_rows.map((row) => row.relief_dollars), branch.actions.map((action) => action.relief_dollars));
  assert.deepEqual(result.player_rows.flatMap((row) => row.rule_references), branch.actions.flatMap((action) => action.rule_references));
});

test('unsupported numbers are rejected twice before deterministic fallback', async () => {
  const { request, options, branch } = await fixture();
  let attempts = 0;
  const draft = validDraft(branch);
  draft.summary = 'This creates $123,456 of additional relief.';
  const result = await explainCapRosterDecision(request, {
    ...options,
    apiKeyAvailable: true,
    createMessage: async () => { attempts += 1; return message(draft); },
  });
  assert.equal(attempts, 2);
  assert.equal(result.status, 'deterministic_fallback');
  assert.ok(result.validation_issues.some((issue) => issue.includes('cap_math_mismatch')));
});

test('numeric guard rejects unsupported money written without a dollar sign', async () => {
  const { request, options, branch } = await fixture();
  const draft = validDraft(branch);
  draft.summary = 'This creates 16 million dollars of relief with a low-risk roster path.';
  const result = await explainCapRosterDecision(request, {
    ...options,
    apiKeyAvailable: true,
    createMessage: async () => message(draft),
  });
  assert.equal(result.status, 'deterministic_fallback');
  assert.ok(result.validation_issues.some((issue) => issue.includes('cap_math_mismatch')));
  assert.ok(result.validation_issues.some((issue) => issue.includes('unsupported_player_quality')));
});

test('numeric guard rejects spelled-out dollar claims', async () => {
  const { request, options, branch } = await fixture();
  const draft = validDraft(branch);
  draft.summary = 'This creates twenty million dollars of relief.';
  const result = await explainCapRosterDecision(request, {
    ...options,
    apiKeyAvailable: true,
    createMessage: async () => message(draft),
  });
  assert.equal(result.status, 'deterministic_fallback');
  assert.ok(result.validation_issues.some((issue) => issue.includes('cap_math_mismatch')));
});

test('bare figures, undeclared player names, and partial rule sets fail closed', async () => {
  const { request, options, branch } = await fixture();
  const draft = validDraft(branch);
  const named = branch.actions[0];
  assert.ok(named);
  draft.summary = `${named.player_name} creates 16123456 in relief.`;
  draft.player_ids = draft.player_ids.filter((id) => id !== named.player_id);
  draft.rule_ids = draft.rule_ids.slice(0, -1);
  const result = await explainCapRosterDecision(request, {
    ...options,
    apiKeyAvailable: true,
    createMessage: async () => message(draft),
  });
  assert.equal(result.status, 'deterministic_fallback');
  assert.ok(result.validation_issues.some((issue) => issue.includes('cap_math_mismatch')));
  assert.ok(result.validation_issues.some((issue) => issue.includes('unsupported_player_quality')));
  assert.ok(result.validation_issues.some((issue) => issue.includes('missing_rule_citation')));
});

test('missing citations and invented private inputs fail closed', async () => {
  const { request, options, branch } = await fixture();
  const draft = validDraft(branch);
  draft.rule_ids = [];
  draft.rationale = 'The internal medical board confirms this branch is safe.';
  const result = await explainCapRosterDecision(request, {
    ...options,
    apiKeyAvailable: true,
    createMessage: async () => message(draft),
  });
  assert.equal(result.status, 'deterministic_fallback');
  assert.ok(result.validation_issues.some((issue) => issue.includes('missing_rule_citation')));
  assert.ok(result.validation_issues.some((issue) => issue.includes('private_data_bluff')));
});

test('default cap-analysis follow-up never requires a model provider', async () => {
  const { request, options } = await fixture();
  let calls = 0;
  const result = await explainCapRosterDecision({ ...request, use_live_model: false }, {
    ...options,
    apiKeyAvailable: true,
    createMessage: async () => { calls += 1; throw new Error('should not run'); },
  });
  assert.equal(calls, 0);
  assert.equal(result.status, 'deterministic_fallback');
  assert.match(result.summary, /All figures are computed|maximum supported positive relief/);
});

test('blocked preflight explanation exposes no branch or player actions', async () => {
  const { request, options } = await fixture();
  const seed = structuredClone(options.data.seed);
  const result = await explainCapRosterDecision({ ...request, use_live_model: false }, {
    ...options,
    data: { seed, source_mode: 'checked_in_snapshot_fallback', fallback_reason: 'database unavailable' },
  });
  assert.equal(result.branch_id, null);
  assert.deepEqual(result.player_rows, []);
  assert.match(result.rationale, /No branch can be explained/);
});
