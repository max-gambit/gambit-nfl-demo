import type Anthropic from '@anthropic-ai/sdk';
import { isCustomBaseTemplateId } from '@shared/briefTemplates';
import type { BriefTemplateId, BriefTemplateSelection } from '@shared/types';

// `submit_brief` is the structured-output tool. The initial-brief prompt
// forces Claude to call it exactly once via tool_choice, and the server
// parses the tool input to write thesis/body/options/sources to Supabase.
//
// Schema mirrors @shared/types SubmitBriefInput at the boundary. Presentation
// sections are additive; recommendation briefs still persist strategic options
// for the shared OptionsTable.
const submitBriefToolBase: Anthropic.Tool = {
  name: 'submit_brief',
  description:
    'Submit your structured analysis as the final brief. Call this exactly once with the complete consultative decision brief. Do not respond with text — call the tool.',
  input_schema: {
    type: 'object',
    properties: {
      thesis: {
        type: 'string',
        description:
          'A single sentence stating the working thesis/current lean. Concrete, with numbers where they matter, but frame player values and offer terms as assumptions or validation targets unless the user supplied authoritative private data.',
      },
      reasoning: {
        type: 'string',
        description:
          '1–3 short paragraphs explaining the evidence, assumptions, tradeoffs, and why this is the current lean. Use [N] citation markers (e.g. "[2]" or "[3]") to reference options or sources by their ref_index. Plain prose, no markdown headers, no bullet lists.',
      },
      blockquote: {
        type: 'object',
        description:
          'Optional: a verbatim CBA or contract quote that supports or constrains the working thesis, with attribution. Omit if no specific quote applies.',
        properties: {
          text: { type: 'string', description: 'Quoted text, no surrounding quotes.' },
          source: { type: 'string', description: 'Attribution string, e.g. "CBA Article VII §7.1".' },
          cite_ref: {
            type: 'integer',
            description: 'Optional ref_index of the source row this quote comes from.',
          },
        },
        required: ['text', 'source'],
      },
      watching: {
        type: 'array',
        description: '2–4 watch-points: short risk/uncertainty notes the GM should monitor.',
        minItems: 2,
        maxItems: 4,
        items: {
          type: 'object',
          properties: {
            tag: {
              type: 'string',
              description: 'Short uppercase tag like "Cap", "Health", "Market", "RFA", "Option".',
            },
            body: { type: 'string', description: 'One sentence describing what to watch.' },
          },
          required: ['tag', 'body'],
        },
      },
      next_questions: {
        type: 'array',
        description:
          'Optional 3-6 total follow-up questions grouped by staff audience. Use when the answer naturally creates staff work, especially binary succession-plan, trade, extension, draft, or cap questions.',
        maxItems: 4,
        items: {
          type: 'object',
          properties: {
            audience: {
              type: 'string',
              enum: ['analytics', 'coaching', 'scouting_front_office', 'cap_contracts', 'gambit'],
              description: 'Staff audience that should own the questions.',
            },
            questions: {
              type: 'array',
              minItems: 1,
              maxItems: 3,
              items: { type: 'string' },
            },
          },
          required: ['audience', 'questions'],
        },
      },
      presentation: {
        type: 'object',
        description:
          'Optional template-specific render sections. Required when the answer template asks for comparison_matrix, options_table, evidence_report, staff_packet, or custom. Omit for the default decision_brief when reasoning/watching/options are sufficient. Presentation does not replace the strategic options rows.',
        properties: {
          template_id: {
            type: 'string',
            enum: ['decision_brief', 'comparison_matrix', 'options_table', 'evidence_report', 'staff_packet', 'data_table', 'custom'],
          },
          title: { type: 'string' },
          sections: {
            type: 'array',
            minItems: 1,
            maxItems: 6,
            items: {
              type: 'object',
              properties: {
                kind: {
                  type: 'string',
                  enum: ['prose', 'bullets', 'table', 'question_groups'],
                },
                title: { type: 'string' },
                body: { type: 'string', description: 'For prose sections.' },
                source_refs: {
                  type: 'array',
                  description: 'Source ref_index values supporting this section.',
                  items: { type: 'integer' },
                  maxItems: 8,
                },
                items: {
                  type: 'array',
                  description: 'For bullets sections.',
                  maxItems: 8,
                  items: {
                    type: 'object',
                    properties: {
                      label: { type: 'string' },
                      body: { type: 'string' },
                      source_refs: { type: 'array', items: { type: 'integer' }, maxItems: 8 },
                    },
                    required: ['body'],
                  },
                },
                columns: {
                  type: 'array',
                  description: 'For table sections.',
                  minItems: 1,
                  maxItems: 10,
                  items: { type: 'string' },
                },
                rows: {
                  type: 'array',
                  description: 'For table sections.',
                  maxItems: 12,
                  items: {
                    type: 'array',
                    items: { type: ['string', 'number', 'null'] },
                  },
                },
                groups: {
                  type: 'array',
                  description: 'For question_groups sections.',
                  maxItems: 5,
                  items: {
                    type: 'object',
                    properties: {
                      audience: {
                        type: 'string',
                        enum: ['analytics', 'coaching', 'scouting_front_office', 'cap_contracts', 'gambit'],
                      },
                      questions: {
                        type: 'array',
                        minItems: 1,
                        maxItems: 3,
                        items: { type: 'string' },
                      },
                    },
                    required: ['audience', 'questions'],
                  },
                },
              },
              required: ['kind', 'title'],
            },
          },
        },
        required: ['template_id', 'sections'],
      },
      options: {
        type: 'array',
        description:
          'For every non-data Gambit brief, provide 3-5 strategic options ranked by current lean and relevance. Each option is a candidate path the GM could take and feeds the shared Strategic options table. ref_index starts at 1 and increments. Option [1] must be the current lead path or the closest match to the working thesis.',
        minItems: 3,
        maxItems: 5,
        items: {
          type: 'object',
          properties: {
            ref_index: { type: 'integer' },
            title: { type: 'string', description: 'Neutral path label plus concrete terms, e.g. "Veteran center return · 3yr/$22M range".' },
            subtitle: { type: 'string', description: 'One short clarifying line (mechanism, condition).' },
            type_kind: { type: 'string', enum: ['fa', 'trade', 'extension'], description: 'Transaction kind.' },
            path_kind: {
              type: 'string',
              enum: ['compete', 'transition', 'swing'],
              description: 'Strategic posture.',
            },
            net_cap_num: {
              type: 'number',
              description: '3-year net cap impact in millions of dollars (negative for relief, positive for spend).',
            },
            net_cap_label: {
              type: 'string',
              description: 'Human label for the cap impact, e.g. "+$22.0M" or "−$30.7M". Use the unicode minus.',
            },
            epm: {
              type: 'string',
              description: 'Approximate EPM/EPA delta as a label, e.g. "+3.4" or "−2.2". Use unicode minus.',
            },
            cba_section: {
              type: 'string',
              description: 'Relevant CBA section, e.g. "BIRD §VI.3" or "MLE §VII.6.9".',
            },
            timing: {
              type: 'string',
              description: 'When this would execute, e.g. "JUL 2026", "PRE-DEADLINE", "OCT 2025".',
            },
            src_count: {
              type: 'integer',
              description: 'Number of sources backing this row (≤ total sources count).',
            },
            likelihood_kind: {
              type: 'string',
              enum: ['executable', 'speculative', 'plausible'],
              description: 'Qualitative likelihood — drives the row pill color.',
            },
            likelihood_pct: {
              type: 'integer',
              minimum: 0,
              maximum: 100,
              description: 'Likelihood as a percentage 0–100.',
            },
            spark: {
              type: 'array',
              description: 'A 5–9 point trend curve representing the cap-impact trajectory over the option\'s window. Used for the inline sparkline.',
              items: { type: 'integer' },
              minItems: 5,
              maxItems: 9,
            },
            details: {
              type: 'object',
              description:
                'Decision-inspector payload for this option. Make this concrete enough that a GM can click the option and understand why it is in the set, why not, what has to happen, what assumptions need validation, and what evidence supports it.',
              properties: {
                decision_question: {
                  type: 'string',
                  description: 'The yes/no or choose-path question this option resolves.',
                },
                why_this: {
                  type: 'string',
                  description: 'One terse sentence explaining why this path is on the table.',
                },
                upside: {
                  type: 'string',
                  description: 'Best practical outcome if this option works.',
                },
                downside: {
                  type: 'string',
                  description: 'Main cost, risk, or strategic concession.',
                },
                move_candidates: {
                  type: 'array',
                  description:
                    'Optional 0-4 concrete candidate executions for this option. Include only specific named player/team/package constructions supported by supplied evidence. Do not include archetypes, generic profiles, or placeholder targets; return an empty array when no named construction is supportable.',
                  maxItems: 4,
                  items: {
                    type: 'object',
                    properties: {
                      label: {
                        type: 'string',
                        description: 'Short specific candidate label, e.g. "Malcolm Brogdon via Moody-led match".',
                      },
                      subject_team_id: {
                        type: 'string',
                        description: 'Subject team_id for the team considering the move, e.g. GSW.',
                      },
                      target_player_names: {
                        type: 'array',
                        description: 'Specific target player name or names supported by the evidence.',
                        minItems: 1,
                        maxItems: 3,
                        items: { type: 'string' },
                      },
                      target_team_id: {
                        type: 'string',
                        description: 'Current team_id for the target player.',
                      },
                      target_team_name: {
                        type: 'string',
                        description: 'Readable current team name for the target player.',
                      },
                      outgoing_package: {
                        type: 'string',
                        description: 'Specific outgoing package, salary construction, or matching frame. Use full player names for named outgoing players.',
                      },
                      outgoing_player_names: {
                        type: 'array',
                        description: 'Full subject-team player names included in the outgoing package when supportable from supplied evidence. Leave unnamed filler in outgoing_package and constraints.',
                        maxItems: 4,
                        items: { type: 'string' },
                      },
                      salary_match: {
                        type: 'string',
                        description: 'Salary/CBA mechanics using only supplied salary and rule evidence.',
                      },
                      basketball_fit: {
                        type: 'string',
                        description: 'Why this target fits the option in basketball terms.',
                      },
                      mechanism: {
                        type: 'string',
                        description: 'Legacy alias for construction. Prefer outgoing_package and salary_match.',
                      },
                      why: {
                        type: 'string',
                        description: 'Legacy alias for basketball fit. Prefer basketball_fit.',
                      },
                      cost: {
                        type: 'string',
                        description: 'Likely outgoing value, cap cost, opportunity cost, or asset cost.',
                      },
                      constraints: {
                        type: 'string',
                        description: 'Hard-cap, apron, matching, medical, seller, permission, or evidence limitation.',
                      },
                      evidence_refs: {
                        type: 'array',
                        description: 'Source ref_index values that support this candidate, if any.',
                        maxItems: 6,
                        items: { type: 'integer' },
                      },
                    },
                    required: [
                      'label',
                      'target_player_names',
                      'target_team_id',
                      'target_team_name',
                      'outgoing_package',
                      'salary_match',
                      'basketball_fit',
                      'cost',
                      'constraints',
                      'evidence_refs',
                    ],
                  },
                },
                required_moves: {
                  type: 'array',
                  description: '2-4 concrete transactions, decisions, approvals, or sequencing steps required.',
                  minItems: 1,
                  maxItems: 5,
                  items: { type: 'string' },
                },
                blockers: {
                  type: 'array',
                  description: '0-4 hard blockers, dependencies, or missing facts.',
                  maxItems: 4,
                  items: { type: 'string' },
                },
                watch_triggers: {
                  type: 'array',
                  description: '1-4 events or signals that should change how this option is valued.',
                  minItems: 1,
                  maxItems: 4,
                  items: { type: 'string' },
                },
                next_step: {
                  type: 'string',
                  description: 'The next front-office action if this option is pursued.',
                },
                evidence_refs: {
                  type: 'array',
                  description:
                    'Source ref_index values that support this option. Include all material source refs, not just the option ref_index.',
                  minItems: 1,
                  maxItems: 8,
                  items: { type: 'integer' },
                },
              },
              required: [
                'decision_question', 'why_this', 'upside', 'downside',
                'required_moves', 'blockers', 'watch_triggers', 'next_step',
                'evidence_refs',
              ],
            },
          },
          required: [
            'ref_index', 'title', 'net_cap_num', 'net_cap_label',
            'cba_section', 'timing', 'src_count', 'likelihood_kind', 'likelihood_pct', 'spark',
            'details',
          ],
        },
      },
      sources: {
        type: 'array',
        description:
          'Source cards backing the brief — primarily contracts and CBA references. ref_index aligns with the option/citation it supports where possible.',
        minItems: 3,
        maxItems: 12,
        items: {
          type: 'object',
          properties: {
            ref_index: { type: 'integer' },
            kind: {
              type: 'string',
              enum: ['CONTRACT', 'CBA', 'NEWS', 'PROJECTION', 'CAP'],
              description: 'Source category.',
            },
            source: {
              type: 'string',
              description: 'Provider name, e.g. "SPOTRAC", "ESPN", "CBA REFERENCE".',
            },
            title: {
              type: 'string',
              description: 'Subject of this source, e.g. a player name or article section ID.',
            },
            updated_at: {
              type: 'string',
              description: 'Human freshness label, e.g. "2H AGO", "YDAY", "APR 12".',
            },
            data: {
              type: 'object',
              description:
                'Optional structured key/value rows displayed inside the source card. Shape: { rows: [{k,v}, ...] }.',
              properties: {
                rows: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      k: { type: 'string' },
                      v: { type: 'string' },
                    },
                    required: ['k', 'v'],
                  },
                },
              },
            },
          },
          required: ['ref_index', 'kind', 'title'],
        },
      },
    },
    required: ['thesis', 'reasoning', 'watching', 'options', 'sources'],
  },
};

export function buildSubmitBriefTool(
  selection: BriefTemplateSelection = { template_id: 'decision_brief' },
  options: { repair?: boolean } = {},
): Anthropic.Tool {
  const templateId = effectiveTemplateId(selection);
  const tool = JSON.parse(JSON.stringify(submitBriefToolBase)) as Anthropic.Tool;
  const schema = tool.input_schema as SubmitBriefJsonSchema;
  const properties = schema.properties;

  tool.description = options.repair
    ? 'Repair the structured brief so it satisfies the selected answer template. Preserve facts, citations, sources, and the compatibility fields. Do not add new factual claims.'
    : tool.description;

  properties.thesis.description = thesisDescription(templateId);
  properties.reasoning.description = reasoningDescription(templateId);
  properties.presentation.description = presentationDescription(templateId);
  properties.options.description = optionsDescription(templateId);

  if (templateId === 'decision_brief') {
    schema.required = ['thesis', 'reasoning', 'watching', 'options', 'sources'];
    properties.options.minItems = 3;
  } else {
    schema.required = ['thesis', 'reasoning', 'watching', 'presentation', 'sources'];
    properties.options.minItems = 0;
  }

  properties.sources.minItems = 0;
  properties.sources.description =
    'Source cards backing the brief. If server-provided current app/context evidence fully covers the answer, this may be an empty array; otherwise include generated source cards with ref_index values greater than reserved refs.';

  return tool;
}

export const submitBriefTool = buildSubmitBriefTool();

interface SubmitBriefJsonSchema {
  type: 'object';
  required: string[];
  properties: {
    thesis: { description: string };
    reasoning: { description: string };
    presentation: { description: string };
    options: { description: string; minItems?: number };
    sources: { description: string; minItems?: number };
  };
}

function effectiveTemplateId(selection: BriefTemplateSelection): BriefTemplateId {
  if (selection.template_id !== 'custom') return selection.template_id;
  return isCustomBaseTemplateId(selection.base_template_id) ? selection.base_template_id : 'custom';
}

function thesisDescription(templateId: BriefTemplateId): string {
  if (templateId === 'comparison_matrix') {
    return 'A one-sentence synthesis of what the matrix implies. Keep it secondary to the matrix, not a full recommendation essay.';
  }
  if (templateId === 'options_table') {
    return 'A one-sentence summary of the option inventory and current lead path, if any.';
  }
  if (templateId === 'evidence_report') {
    return 'A one-sentence decision implication to test, framed as evidence confidence rather than a final recommendation.';
  }
  if (templateId === 'staff_packet') {
    return 'A one-sentence operating thesis that tells staff why these tasks/questions matter.';
  }
  return 'A single sentence stating the working thesis/current lean. Concrete, with numbers where they matter, but use front-office language rather than product/schema labels; frame player values and offer terms as assumptions or validation targets unless the user supplied authoritative private data.';
}

function reasoningDescription(templateId: BriefTemplateId): string {
  if (templateId === 'comparison_matrix') {
    return 'A short decision rule or tie-breaker paragraph. Do not duplicate the matrix in prose.';
  }
  if (templateId === 'options_table') {
    return 'A short table preface explaining how the options are ranked. Do not write a full decision brief.';
  }
  if (templateId === 'evidence_report') {
    return 'A short audit summary explaining confidence, missing facts, conflicts, and what the evidence can or cannot support.';
  }
  if (templateId === 'staff_packet') {
    return 'A short handoff note explaining what staff should resolve. Do not write a full path comparison.';
  }
  return '1-3 short paragraphs explaining the evidence, assumptions, tradeoffs, and why this is the current lean. Use [N] citation markers (e.g. "[2]" or "[3]") to reference options or sources by their ref_index. Plain prose, no markdown headers, no bullet lists. Translate data-quality labels into normal operator language; avoid terms like "Contract Ledger v1", "captured", "derived", "estimated", "source-needed", "row parity", "app rows", or "source status" unless the user asked for a data QA audit. For NFL trade-goal prompts, explicitly use the trade-goal checks: depth after the outgoing player leaves, lower-pain outgoing hierarchy before premium starters, seller-thesis cards, recommended actions, and clean caveat logic for negative trade economics. Do not lead with a named target unless its recommended_action is call_now or check_call, and do not recite internal motivation_tier labels in visible prose.';
}

function presentationDescription(templateId: BriefTemplateId): string {
  switch (templateId) {
    case 'comparison_matrix':
      return 'Required. First visible section must be a table comparing candidate paths across basketball value, cap/CBA impact, timing, execution risk, confidence, and evidence. Add at most one short tie-breaker prose or bullets section.';
    case 'options_table':
      return 'Required. First visible section must be a ranked options table with path/option, cap impact or required moves, blockers, next owner/action, confidence, and evidence refs. It is an inventory, not a side-by-side criteria matrix.';
    case 'evidence_report':
      return 'Required. Render an evidence audit: claim ledger or sections for known evidence, inference, missing/private data, conflicts/caveats, and decision implication. Evidence and missing-data sections must be non-empty.';
    case 'staff_packet':
      return 'Required. Render a staff handoff: grouped tasks/questions by analytics, coaching, scouting/front office, cap/contracts, and Gambit follow-up. Do not lead with a path-comparison table.';
    case 'custom':
      return 'Required. Follow the safe base template and the user custom instructions while preserving source, citation, CBA, and missing-data guardrails.';
    case 'data_table':
      return 'Not used for data_table; the data analyst engine uses submit_data_analysis.';
    case 'decision_brief':
    default:
      return 'Optional. Omit for the default decision_brief when reasoning/watching/options are sufficient. The strategic options table is required through options.';
  }
}

function optionsDescription(templateId: BriefTemplateId): string {
  if (templateId === 'decision_brief') {
    return 'Required for every decision_brief: provide 3-5 strategic options ranked by current lean and relevance. These rows render the Strategic options table. Option [1] must be the current lead path or closest match to the working thesis.';
  }
  return 'Optional compatibility rows. Include only if useful for downstream agents or legacy option inspection; the selected template presentation is the primary visible artifact.';
}
