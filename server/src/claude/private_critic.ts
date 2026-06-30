import type Anthropic from '@anthropic-ai/sdk';
import type { SubmitBriefInput, SubmitDataAnalysisInput } from '@shared/types';
import { BRIEF_MODEL, createClaudeMessage } from './client.js';
import type { ComposedNflContext } from './nfl_context_composer.js';

export type NflPrivateCriticVerdict = 'accept' | 'revise';
export type NflPrivateCriticIssueCategory =
  | 'unsupported_player_quality'
  | 'ol_quality_overreach'
  | 'seller_thesis_overclaim'
  | 'cap_math_mismatch'
  | 'availability_overclaim'
  | 'private_data_bluff'
  | 'meta_language'
  | 'missed_user_decision'
  | 'missing_cap_ladder'
  | 'row_count_depth_overclaim'
  | 'missing_trade_price'
  | 'unsupported_role_fit'
  | 'unsupported_benchmark_claim'
  | 'confidence_mismatch';

export interface NflPrivateCriticIssue {
  category: NflPrivateCriticIssueCategory;
  severity: 'high' | 'medium' | 'low';
  claim: string;
  evidence_boundary: string;
  fix: string;
}

export interface NflPrivateCriticResult {
  verdict: NflPrivateCriticVerdict;
  issues: NflPrivateCriticIssue[];
  revision_instructions: string[];
  source_ref_corrections: string[];
}

export interface RunNflPrivateCriticArgs {
  question: string;
  composedContext: ComposedNflContext | null;
  draftKind: 'brief' | 'data_analysis';
  draft: SubmitBriefInput | SubmitDataAnalysisInput;
  createMessage?: typeof createClaudeMessage;
}

const privateCriticTool: Anthropic.Tool = {
  name: 'submit_private_critique',
  description: 'Submit a private critique of the draft. This critique is internal and never shown to the user.',
  input_schema: {
    type: 'object',
    properties: {
      verdict: { type: 'string', enum: ['accept', 'revise'] },
      issues: {
        type: 'array',
        maxItems: 10,
        items: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              enum: [
                'unsupported_player_quality',
                'ol_quality_overreach',
                'seller_thesis_overclaim',
                'cap_math_mismatch',
                'availability_overclaim',
                'private_data_bluff',
                'meta_language',
                'missed_user_decision',
                'missing_cap_ladder',
                'row_count_depth_overclaim',
                'missing_trade_price',
                'unsupported_role_fit',
                'unsupported_benchmark_claim',
                'confidence_mismatch',
              ],
            },
            severity: { type: 'string', enum: ['high', 'medium', 'low'] },
            claim: { type: 'string' },
            evidence_boundary: { type: 'string' },
            fix: { type: 'string' },
          },
          required: ['category', 'severity', 'claim', 'evidence_boundary', 'fix'],
        },
      },
      revision_instructions: {
        type: 'array',
        maxItems: 10,
        items: { type: 'string' },
      },
      source_ref_corrections: {
        type: 'array',
        maxItems: 6,
        items: { type: 'string' },
      },
    },
    required: ['verdict', 'issues', 'revision_instructions', 'source_ref_corrections'],
  },
};

export async function runNflPrivateCritic(args: RunNflPrivateCriticArgs): Promise<NflPrivateCriticResult> {
  if (!args.composedContext) return acceptCritique();
  const deterministic = evaluateNflDraftForPrivateCritic(args);
  const callModel = args.createMessage ?? createClaudeMessage;

  try {
    const response = await callModel({
      model: BRIEF_MODEL,
      max_tokens: 4096,
      system: [
        {
          type: 'text',
          text: [
            'You are the private quality critic for an NFL front-office analysis draft.',
            'Your job is not to make the answer more templated. Your job is to catch unsupported claims, overconfident seller logic, product/meta language, and places where the draft fails to use loaded evidence.',
            'Accept compact, natural, judgment-led prose when it is supported. Revise only when the issue would make a Giants/front-office demo answer less credible.',
            'Never add public sources. Never expose this critique to the user. Return exactly one submit_private_critique tool call.',
            '',
            args.composedContext.system_block,
          ].join('\n'),
        },
      ],
      tools: [privateCriticTool],
      tool_choice: { type: 'tool', name: 'submit_private_critique' },
      messages: [{
        role: 'user',
        content: [
          `Question: ${args.question}`,
          `Draft kind: ${args.draftKind}`,
          'Deterministic preflight findings:',
          JSON.stringify(deterministic),
          'Draft payload:',
          JSON.stringify(args.draft),
        ].join('\n\n'),
      }],
    });
    const toolUse = response.content.find((block) => block.type === 'tool_use' && block.name === 'submit_private_critique');
    if (!toolUse || toolUse.type !== 'tool_use') return deterministic;
    return mergeCritiques(deterministic, normalizeCriticResult(toolUse.input));
  } catch (error) {
    if (process.env.NFL_PRIVATE_CRITIC_STRICT === '1') throw error;
    return deterministic;
  }
}

export function evaluateNflDraftForPrivateCritic(args: RunNflPrivateCriticArgs): NflPrivateCriticResult {
  if (!args.composedContext) return acceptCritique();
  const draftText = draftToText(args.draft);
  const question = args.question;
  const contextText = [
    args.composedContext.must_use_facts.join('\n'),
    args.composedContext.decision_primitives.map((primitive) => [
      primitive.key,
      ...primitive.facts,
      ...primitive.decision_checks,
      ...primitive.boundaries,
    ].join('\n')).join('\n'),
    args.composedContext.coverage_boundaries.join('\n'),
    args.composedContext.do_not_claim.join('\n'),
  ].join('\n');
  const issues: NflPrivateCriticIssue[] = [];

  if (/Vita Vea/i.test(draftText)
    && /(highest[-\s]?confidence|lead lane|lead path|cleanest route|best lane)/i.test(draftText)
    && /Vita Vea\/Tampa|posture_change_only|Do not headline Vita Vea/i.test(contextText)) {
    issues.push({
      category: 'seller_thesis_overclaim',
      severity: 'high',
      claim: 'The draft leads with Vita Vea/Tampa as a high-confidence lane.',
      evidence_boundary: 'The seller-thesis context says Tampa/Vea is not a lead lane unless posture changes.',
      fix: 'Frame Vita Vea as high impact but low probability, and lead with a supported call/check-call lane or a disciplined no-trade path.',
    });
  }

  if (args.composedContext.intent_tags.includes('ol_quality')
    && /\b(pressure allowed|pass[-\s]?block(?:ing)? grade|clean pocket|wins? in protection|quality starter)\b/i.test(draftText)
    && /continuity\/availability only|OL quality source/i.test(contextText)) {
    issues.push({
      category: 'ol_quality_overreach',
      severity: 'high',
      claim: 'The draft makes OL quality or pressure-allowed claims from public data.',
      evidence_boundary: 'Loaded OL evidence supports continuity and availability only unless a reviewed OL quality source is present.',
      fix: 'Replace the OL-quality claim with a continuity/availability caveat or remove it.',
    });
  }

  if (/(only\s+4\s+rostered|blocked on ingestion|data[-\s]?completeness failure|contract years\/guarantees not exposed)/i.test(draftText)) {
    issues.push({
      category: 'cap_math_mismatch',
      severity: 'high',
      claim: 'The draft repeats an obsolete data-completeness failure shape.',
      evidence_boundary: 'Current NFL roster/cap/metric rows are loaded and should be used as the authority.',
      fix: 'Analyze from the current rows and caveat only the specific unresolved fields.',
    });
  }

  if (/(Contract Ledger v1|captured-confidence|captured rows|derived rows|estimated rows|source-needed cap row|row parity|app rows|source status)/i.test(firstWords(draftText, 120))) {
    issues.push({
      category: 'meta_language',
      severity: 'medium',
      claim: 'The draft leads with product/schema language.',
      evidence_boundary: 'Visible prose should translate data quality into front-office language.',
      fix: 'Use high confidence, directional, priced in the current cap file, or needs source review only where it changes the recommendation.',
    });
  }

  if (args.composedContext.intent_tags.includes('player_quality')
    && /\b(disruptive|replaceable|coverage liability|separation|run[-\s]?stopping|quality|upgrade)\b/i.test(question)
    && !/\b(scorecard|pressure|hurr(?:y|ies)|snap|target|coverage|yac|continuity|availability|public metric|source-backed)\b/i.test(draftText)) {
    issues.push({
      category: 'unsupported_player_quality',
      severity: 'medium',
      claim: 'The draft makes or answers a player-quality question without visible scorecard grounding.',
      evidence_boundary: 'Player-quality claims should cite public position scorecards or narrow the caveat.',
      fix: 'Bring the relevant scorecard evidence into the answer before making the player-quality judgment.',
    });
  }

  if (hasPrimitive(args.composedContext, 'cap_scenario_ladder')
    && /\b(cap room|clean\s+2026\s+room|create\s+room|open\s+room|clear\s+room|cut|release|restructure|trade room|2027|dead money|cap lever|hangover)\b/i.test(question)
    && !/\b(\$?5M|\$?10M|\$?15M|target amount|target room|room target|small room|medium room|large room|how much room)\b/i.test(draftText)) {
    issues.push({
      category: 'missing_cap_ladder',
      severity: 'medium',
      claim: 'The draft names cap levers without scaling them to a room target or scenario ladder.',
      evidence_boundary: 'The composed context asks cap answers to reason in $5M/$10M/$15M+ bands when the user does not specify a target amount.',
      fix: 'Add a compact scenario ladder or state which room band the recommendation is meant to solve.',
    });
  }

  if (hasPrimitive(args.composedContext, 'playable_depth')
    && /\b(?:stays?|leaves?|drops?|falls?|at|to)\s+(?:roughly\s+|~)?\d+\s*(?:-deep|roster rows?|cap rows?|bodies)\b/i.test(draftText)
    && !/\b(core|starter|probable starter|rotation|role|playable|development|special teams|quality|validate|replacement plan)\b/i.test(draftText)) {
    issues.push({
      category: 'row_count_depth_overclaim',
      severity: 'medium',
      claim: 'The draft treats row count as playable depth.',
      evidence_boundary: 'The composed context says raw roster/cap rows are inventory, not a playable-depth conclusion.',
      fix: 'Translate the row count into starter/rotation/depth/development language or caveat that role quality still needs validation.',
    });
  }

  if (hasPrimitive(args.composedContext, 'trade_price_discipline')
    && /\b(call|trade for|acquire|send|offer|deal)\b/i.test(draftText)
    && !/\b(price|ask|asking|pick|day[-\s]?three|conditional|round|premium|draft capital|cost)\b/i.test(draftText)) {
    issues.push({
      category: 'missing_trade_price',
      severity: 'medium',
      claim: 'The draft recommends a trade lane without a price boundary.',
      evidence_boundary: 'Trade price discipline requires at least a range, pick band, or validation target before treating a call as executable.',
      fix: 'Add a non-final price boundary such as conditional/day-three, seller-signal watch, or explicit ask-to-validate language.',
    });
  }

  if (hasPrimitive(args.composedContext, 'role_fit')
    && /\b(solves?|answer|difference[-\s]?maker|disruptive|coverage liability|replaceable|trust it|upgrade|juice)\b/i.test(draftText)
    && /directional|public evidence is directional|OL is continuity\/availability|role-fit not proven/i.test(contextText)
    && !/\b(scorecard|pressure rate|hurr(?:y|ies)|target|coverage|yac|snap|starts|continuity|availability|directional|validate)\b/i.test(draftText)) {
    issues.push({
      category: 'unsupported_role_fit',
      severity: 'medium',
      claim: 'The draft makes a role-fit/player-quality claim without carrying the public metric boundary into the answer.',
      evidence_boundary: 'The role-fit primitive says quality claims need position scorecards or a narrow validation caveat.',
      fix: 'Ground the role-fit claim in the relevant public scorecard family or soften it into a validation question.',
    });
  }

  if (hasPrimitive(args.composedContext, 'benchmark_context')
    && /\b(over[-\s]?invested|under[-\s]?invested|over[-\s]?investment|under[-\s]?investment|heaviest|richest|too much|too little|cost center)\b/i.test(draftText)
    && !/\b(benchmark|relative|league|rank|percentile|share|concentration|compared with|current file)\b/i.test(draftText)) {
    issues.push({
      category: 'unsupported_benchmark_claim',
      severity: 'medium',
      claim: 'The draft makes an investment-level claim without benchmark framing.',
      evidence_boundary: 'The benchmark primitive requires spend-share, concentration, or league-relative context before over/under-investment language.',
      fix: 'Add benchmark framing or narrow the claim to team-internal concentration rather than league-relative investment quality.',
    });
  }

  if (hasPrimitive(args.composedContext, 'decision_confidence')
    && /\b(solved|confirmed|automatic(?:ally)?|executable path|only path|done deal|real lane)\b/i.test(draftText)
    && /Validation-required|Directional/i.test(contextText)
    && !/\b(validate|directional|if|unless|needs|unconfirmed|public evidence|before committing)\b/i.test(draftText)) {
    issues.push({
      category: 'confidence_mismatch',
      severity: 'medium',
      claim: 'The draft states a validation-required or directional conclusion too firmly.',
      evidence_boundary: 'Decision confidence separates firm app-data facts from directional public evidence and staff validation questions.',
      fix: 'Keep the supported lean, but add the specific validation condition or downgrade the claim from settled to directional.',
    });
  }

  if (args.composedContext.intent_tags.includes('trade')
    && /\b(available|would say yes|seller|call|trade for)\b/i.test(draftText)
    && !/\b(validate|validation|availability|why they say yes|what they lose|seller objection|seller case|low probability|posture)\b/i.test(draftText)) {
    issues.push({
      category: 'availability_overclaim',
      severity: 'medium',
      claim: 'The draft discusses trade availability without seller validation logic.',
      evidence_boundary: 'Trade answers need seller case, seller objection, what they lose, and validation trigger.',
      fix: 'Add the counterparty motivation and validation caveat in natural prose.',
    });
  }

  if (/\b(private medical|internal medical|coach(?:ing)? trust|owner pressure|actual asking price|real trade price)\b/i.test(draftText)
    && !/\b(user supplied|if our internal|requires internal|not in public data|validate)\b/i.test(draftText)) {
    issues.push({
      category: 'private_data_bluff',
      severity: 'high',
      claim: 'The draft states private team context as if loaded.',
      evidence_boundary: 'No private team data is loaded unless supplied by the user.',
      fix: 'Turn the private claim into a validation question or remove it.',
    });
  }

  return critiqueFromIssues(issues);
}

export function buildNflPrivateCriticRevisionBlock(critique: NflPrivateCriticResult): string {
  return [
    '=== PRIVATE CRITIC REVISION INSTRUCTIONS ===',
    'Revise the prior structured payload once. Preserve the same output schema and source-ref discipline.',
    'Do not turn the answer into a rigid checklist. Keep it compact and front-office native.',
    'Fix only the issues below; preserve supported judgments and useful specificity.',
    '',
    'Issues:',
    ...critique.issues.map((issue) => `- ${issue.category} (${issue.severity}): ${issue.fix}`),
    '',
    'Revision instructions:',
    ...critique.revision_instructions.map((instruction) => `- ${instruction}`),
    '',
    'Source ref corrections:',
    ...(critique.source_ref_corrections.length ? critique.source_ref_corrections.map((item) => `- ${item}`) : ['- Keep existing valid refs; do not invent new public sources.']),
  ].join('\n');
}

function normalizeCriticResult(input: unknown): NflPrivateCriticResult {
  if (!isRecord(input)) return acceptCritique();
  const rawIssues = Array.isArray(input.issues) ? input.issues : [];
  const issues = rawIssues
    .filter(isRecord)
    .map((issue) => ({
      category: criticCategory(issue.category),
      severity: criticSeverity(issue.severity),
      claim: stringValue(issue.claim) ?? 'Unspecified draft issue.',
      evidence_boundary: stringValue(issue.evidence_boundary) ?? 'Evidence boundary not stated.',
      fix: stringValue(issue.fix) ?? 'Revise to match loaded evidence.',
    }));
  const verdict = input.verdict === 'revise' || issues.length > 0 ? 'revise' : 'accept';
  return {
    verdict,
    issues,
    revision_instructions: stringArray(input.revision_instructions, issues.map((issue) => issue.fix)),
    source_ref_corrections: stringArray(input.source_ref_corrections, []),
  };
}

function mergeCritiques(
  deterministic: NflPrivateCriticResult,
  model: NflPrivateCriticResult,
): NflPrivateCriticResult {
  const seen = new Set<string>();
  const issues = [...deterministic.issues, ...model.issues].filter((issue) => {
    const key = `${issue.category}:${issue.claim}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 10);
  return {
    verdict: issues.length || model.verdict === 'revise' || deterministic.verdict === 'revise' ? 'revise' : 'accept',
    issues,
    revision_instructions: [
      ...deterministic.revision_instructions,
      ...model.revision_instructions,
    ].filter((item, index, arr) => arr.indexOf(item) === index).slice(0, 10),
    source_ref_corrections: [
      ...deterministic.source_ref_corrections,
      ...model.source_ref_corrections,
    ].filter((item, index, arr) => arr.indexOf(item) === index).slice(0, 6),
  };
}

function critiqueFromIssues(issues: NflPrivateCriticIssue[]): NflPrivateCriticResult {
  return {
    verdict: issues.length ? 'revise' : 'accept',
    issues,
    revision_instructions: issues.map((issue) => issue.fix),
    source_ref_corrections: [],
  };
}

function acceptCritique(): NflPrivateCriticResult {
  return {
    verdict: 'accept',
    issues: [],
    revision_instructions: [],
    source_ref_corrections: [],
  };
}

function hasPrimitive(context: ComposedNflContext, key: ComposedNflContext['decision_primitives'][number]['key']): boolean {
  return context.decision_primitives.some((primitive) => primitive.key === key && primitive.applies);
}

function draftToText(draft: SubmitBriefInput | SubmitDataAnalysisInput): string {
  if ('answer' in draft) {
    return [
      draft.answer,
      draft.key_findings.map((finding) => `${finding.label}: ${finding.body}`).join('\n'),
      draft.tables.map((table) => `${table.title}\n${table.rows.map((row) => row.join(' | ')).join('\n')}`).join('\n'),
      draft.calculations.map((calculation) => `${calculation.label}: ${calculation.value}`).join('\n'),
      draft.caveats.join('\n'),
      draft.followups.join('\n'),
    ].join('\n');
  }
  return [
    draft.thesis,
    draft.reasoning,
    draft.watching.map((item) => `${item.tag}: ${item.body}`).join('\n'),
    draft.options.map(optionToText).join('\n'),
    presentationToText(draft.presentation),
  ].join('\n');
}

function optionToText(option: SubmitBriefInput['options'][number]): string {
  const details = option.details;
  return [
    option.title,
    option.subtitle ?? '',
    option.cba_section ?? '',
    option.net_cap_label,
    option.timing ?? '',
    details.decision_question,
    details.why_this,
    details.upside,
    details.downside,
    ...(details.move_candidates ?? []).flatMap((candidate) => [
      candidate.label,
      candidate.subject_team_id ?? '',
      ...(candidate.target_player_names ?? []),
      candidate.target_team_id ?? '',
      candidate.target_team_name ?? '',
      ...(candidate.outgoing_player_names ?? []),
      candidate.outgoing_package ?? '',
      candidate.salary_match ?? '',
      candidate.basketball_fit ?? '',
      candidate.mechanism ?? '',
      candidate.why ?? '',
      candidate.cost ?? '',
      candidate.constraints ?? '',
    ]),
    ...details.required_moves,
    ...details.blockers,
    ...details.watch_triggers,
    details.next_step,
  ].join('\n');
}

function presentationToText(presentation: SubmitBriefInput['presentation']): string {
  if (!presentation) return '';
  const parts: string[] = [presentation.title ?? '', presentation.template_id];
  for (const section of presentation.sections) {
    parts.push(section.title);
    if (section.kind === 'prose') {
      parts.push(section.body);
    } else if (section.kind === 'bullets') {
      for (const item of section.items) {
        parts.push(`${item.label ?? ''}: ${item.body}`);
      }
    } else if (section.kind === 'table') {
      parts.push(section.columns.join(' | '));
      for (const row of section.rows) {
        parts.push(row.map((cell) => cell ?? '').join(' | '));
      }
    } else if (section.kind === 'question_groups') {
      for (const group of section.groups) {
        parts.push(`${group.audience}: ${group.questions.join(' ')}`);
      }
    }
  }
  return parts.join('\n');
}

function firstWords(text: string, count: number): string {
  return text.split(/\s+/).slice(0, count).join(' ');
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length ? value.trim() : null;
}

function stringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const strings = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return strings.length ? strings : fallback;
}

function criticSeverity(value: unknown): NflPrivateCriticIssue['severity'] {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'medium';
}

function criticCategory(value: unknown): NflPrivateCriticIssueCategory {
  switch (value) {
    case 'unsupported_player_quality':
    case 'ol_quality_overreach':
    case 'seller_thesis_overclaim':
    case 'cap_math_mismatch':
    case 'availability_overclaim':
    case 'private_data_bluff':
    case 'meta_language':
    case 'missed_user_decision':
    case 'missing_cap_ladder':
    case 'row_count_depth_overclaim':
    case 'missing_trade_price':
    case 'unsupported_role_fit':
    case 'unsupported_benchmark_claim':
    case 'confidence_mismatch':
      return value;
    default:
      return 'missed_user_decision';
  }
}
