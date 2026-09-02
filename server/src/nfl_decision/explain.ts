import type Anthropic from '@anthropic-ai/sdk';
import type {
  NflCapRosterAction,
  NflCapRosterBranch,
  NflCapRosterExplanationRequest,
  NflCapRosterExplanationResponse,
} from '@shared/types';
import { BRIEF_MODEL, createClaudeMessage } from '../claude/client.js';
import {
  evaluateNflCapRosterNarrative,
  type NflCapRosterNarrativeDraft,
} from '../claude/private_critic.js';
import { buildCapRosterDecision, type BuildCapRosterDecisionOptions } from './cap_roster.js';

const explanationTool: Anthropic.Tool = {
  name: 'submit_nfl_cap_roster_explanation',
  description: 'Explain one already-validated deterministic NFL cap-and-roster branch without changing its figures or citations.',
  input_schema: {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      rationale: { type: 'string' },
      risks: { type: 'array', maxItems: 5, items: { type: 'string' } },
      next_actions: { type: 'array', maxItems: 5, items: { type: 'string' } },
      player_ids: { type: 'array', items: { type: 'string' } },
      rule_ids: { type: 'array', items: { type: 'string' } },
    },
    required: ['summary', 'rationale', 'risks', 'next_actions', 'player_ids', 'rule_ids'],
  },
};

export interface ExplainCapRosterOptions extends BuildCapRosterDecisionOptions {
  createMessage?: typeof createClaudeMessage;
  apiKeyAvailable?: boolean;
}

export async function explainCapRosterDecision(
  input: NflCapRosterExplanationRequest,
  options: ExplainCapRosterOptions = {},
): Promise<NflCapRosterExplanationResponse> {
  const decision = await buildCapRosterDecision(input, options);
  const branch = decision.status === 'ready'
    ? selectedBranch(decision.branches, decision.recommended_branch_id)
    : null;
  const canCallModel = input.use_live_model === true
    && (options.apiKeyAvailable ?? Boolean(process.env.ANTHROPIC_API_KEY?.trim()))
    && decision.status === 'ready'
    && decision.recommended_branch_id !== null
    && branch !== null;
  if (!canCallModel) {
    return deterministicFallback(decision.generated_at, decision.deterministic_summary, branch, []);
  }

  const callModel = options.createMessage ?? createClaudeMessage;
  let validationIssues: string[] = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await callModel({
        model: BRIEF_MODEL,
        max_tokens: 1400,
        system: [
          'You explain a validated NFL cap-and-roster branch for football operations.',
          'The deterministic payload is the only numeric and citation authority.',
          'Do not add or repair dollar values, players, rules, medical facts, scouting grades, private team inputs, or transaction availability.',
          'Use player_ids and rule_ids only from the selected branch. Preserve evidence and depth-effect boundaries.',
          'Return exactly one submit_nfl_cap_roster_explanation tool call.',
        ].join('\n'),
        tools: [explanationTool],
        tool_choice: { type: 'tool', name: 'submit_nfl_cap_roster_explanation' },
        messages: [{
          role: 'user',
          content: [
            `Question: ${input.question}`,
            'Validated selected branch:',
            JSON.stringify(branch),
            validationIssues.length ? `Prior draft was rejected. Fix only these issues:\n${validationIssues.join('\n')}` : '',
          ].filter(Boolean).join('\n\n'),
        }],
      });
      const draft = explanationDraft(response);
      if (!draft) {
        validationIssues = ['The model did not return the required structured explanation tool payload.'];
        continue;
      }
      const critique = evaluateNflCapRosterNarrative(decision, draft);
      if (critique.verdict === 'accept') {
        return {
          schema_version: 'nfl_cap_roster_explanation.v1',
          generated_at: new Date().toISOString(),
          status: 'model_validated',
          branch_id: branch.id,
          summary: draft.summary,
          rationale: draft.rationale,
          risks: draft.risks,
          next_actions: draft.next_actions,
          player_rows: playerRows(branch.actions, draft.player_ids),
          validation_issues: [],
        };
      }
      validationIssues = critique.issues.map((issue) => `${issue.category}: ${issue.fix}`);
    } catch (error) {
      validationIssues = [`Model explanation unavailable: ${error instanceof Error ? error.message : String(error)}`];
      break;
    }
  }

  return deterministicFallback(decision.generated_at, decision.deterministic_summary, branch, validationIssues);
}

function selectedBranch(
  branches: NflCapRosterBranch[],
  recommendedBranchId: NflCapRosterBranch['id'] | null,
): NflCapRosterBranch | null {
  return branches.find((branch) => branch.id === recommendedBranchId)
    ?? null;
}

function deterministicFallback(
  generatedAt: string,
  summary: string,
  branch: NflCapRosterBranch | null,
  validationIssues: string[],
): NflCapRosterExplanationResponse {
  return {
    schema_version: 'nfl_cap_roster_explanation.v1',
    generated_at: generatedAt,
    status: 'deterministic_fallback',
    branch_id: branch?.id ?? null,
    summary,
    rationale: branch?.thesis ?? 'No branch can be explained until the deterministic preflight passes.',
    risks: [...new Set([...(branch?.tradeoffs ?? []), ...(branch?.blockers ?? [])])].slice(0, 5),
    next_actions: [...new Set(branch?.actions.flatMap((action) => action.next_actions) ?? [])].slice(0, 5),
    player_rows: playerRows(branch?.actions ?? []),
    validation_issues: validationIssues,
  };
}

function playerRows(actions: NflCapRosterAction[], selectedIds?: string[]) {
  const selected = selectedIds ? new Set(selectedIds) : null;
  return actions
    .filter((action) => !selected || selected.has(action.player_id))
    .map((action) => ({
      player_id: action.player_id,
      player_name: action.player_name,
      lever: action.lever,
      relief_dollars: action.relief_dollars,
      dead_money_dollars: action.dead_money_dollars,
      depth_effect: action.depth_effect,
      depth_evidence: action.depth_evidence,
      confidence: action.confidence,
      source_url: action.source_url,
      rule_references: action.rule_references,
    }));
}

function explanationDraft(response: Anthropic.Message): NflCapRosterNarrativeDraft | null {
  const block = response.content.find((item) => item.type === 'tool_use' && item.name === explanationTool.name);
  if (!block || block.type !== 'tool_use' || !isRecord(block.input)) return null;
  const input = block.input;
  if (typeof input.summary !== 'string' || typeof input.rationale !== 'string') return null;
  const risks = stringArray(input.risks);
  const nextActions = stringArray(input.next_actions);
  const playerIds = stringArray(input.player_ids);
  const ruleIds = stringArray(input.rule_ids);
  if (!risks || !nextActions || !playerIds || !ruleIds) return null;
  return { summary: input.summary, rationale: input.rationale, risks, next_actions: nextActions, player_ids: playerIds, rule_ids: ruleIds };
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
