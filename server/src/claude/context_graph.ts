import type Anthropic from '@anthropic-ai/sdk';
import type {
  BriefSource,
  ContextGraphTeamId,
  ContextGraphTrace,
  ContextGraphTraceTeam,
  EffectiveTeamContext,
  TeamMemoryTraceSummary,
  TeamContextPreferenceValues,
  TeamContextPreferences,
} from '@shared/types';
import {
  getEffectiveTeamContext,
  listTeamContextPreferences,
  type TeamPreferenceStoreOptions,
} from '../context_graph/preferences.js';
import {
  getTeamMemoryProfile,
  teamMemoryTraceSummary,
  type TeamMemoryStoreOptions,
} from '../context_graph/team_memory.js';
import { NBA_TEAM_IDS, isNbaTeamId } from '../context_graph/schema.js';

export const CONTEXT_GRAPH_LOOKUP_TOOL_NAME = 'lookup_context_graph_teams';
type ContextGraphAiOptions = TeamPreferenceStoreOptions & TeamMemoryStoreOptions;

export interface ContextGraphTeamIndexEntry {
  team_id: string;
  name: string;
  conference: string;
  division: string;
  validation_status: 'pass' | 'fail';
  has_overrides: boolean;
  source_as_of_date: string;
  source_last_updated: string;
}

export interface AiTeamContext {
  team_id: string;
  name: string;
  metadata: {
    derived_updated_at: string | null;
    overrides_updated_at: string | null;
    has_overrides: boolean;
    override_updated_at: string | null;
    source_as_of_date: string;
    source_last_updated: string;
  };
  validation: EffectiveTeamContext['validation'];
  roster_summary: EffectiveTeamContext['roster_summary'];
  relationship_summary: EffectiveTeamContext['relationship_summary'];
  preferences: {
    ownership: TeamContextPreferenceValues['ownership'];
    strategic_posture: TeamContextPreferenceValues['strategic_posture'];
    trade_dna: TeamContextPreferenceValues['trade_dna'];
    cultural_signals: TeamContextPreferenceValues['cultural_signals'];
    near_term_priorities: TeamContextPreferenceValues['near_term_priorities'];
    narrative_summary: TeamContextPreferenceValues['narrative_summary'];
    team_team_relationships: TeamContextPreferenceValues['team_team_relationships'];
    onboarding_profile: TeamContextPreferenceValues['onboarding_profile'];
  };
  override: EffectiveTeamContext['override'];
  private_memory: TeamMemoryTraceSummary | null;
}

export interface ContextGraphLookupToolResult {
  ok: boolean;
  teams: AiTeamContext[];
  errors: { team_id: string; error: string }[];
  valid_team_ids: readonly ContextGraphTeamId[];
}

export const contextGraphLookupTool: Anthropic.Tool = {
  name: CONTEXT_GRAPH_LOOKUP_TOOL_NAME,
  description:
    'Lookup effective NBA Intel data for one or more teams by standard three-letter NBA team_id. Use this before making claims about team preferences, posture, trade DNA, culture, priorities, relationships, or Settings-editable context.',
  input_schema: {
    type: 'object',
    properties: {
      team_ids: {
        type: 'array',
        minItems: 1,
        maxItems: 30,
        items: {
          type: 'string',
          enum: NBA_TEAM_IDS,
        },
        description: 'Standard NBA three-letter team ids, e.g. GSW, BOS, LAL.',
      },
    },
    required: ['team_ids'],
  },
};

export const contextGraphTools: Anthropic.Tool[] = [contextGraphLookupTool];

export async function listContextGraphTeams(
  options: ContextGraphAiOptions = {},
): Promise<ContextGraphTeamIndexEntry[]> {
  const response = await listTeamContextPreferences(options);
  return response.teams.map((team) => indexEntry(team));
}

export async function buildContextGraphSystemBlock(
  options: ContextGraphAiOptions = {},
): Promise<string> {
  const lines: string[] = [
    '=== NBA CONTEXT GRAPH TOOLING ===',
    'NBA Intel is available for all 30 teams through the lookup_context_graph_teams tool.',
    'The index below is only for discovery. It is not enough evidence for substantive claims.',
    'Before making claims about team preferences, strategic posture, spending posture, trade DNA, cultural signals, near-term priorities, relationships, or Settings-editable context, call lookup_context_graph_teams for the relevant team_id values.',
    'Tool results return effective context: source graph data layered with Settings JSON overrides and first-party onboarding_profile context captured from the user. Source YAML and derived graph artifacts are not user-editable; Settings/onboarding overrides are user-editable.',
    'If onboarding_profile is present, treat it as team-provided Intel context. Use it to personalize posture, priorities, working style, and trust boundaries, but never use it to override current roster, cap, contract, or stat evidence.',
    'Older tool results may also include Private prototype memory from a legacy Team Memory flow. Treat that memory as compatibility context only, cite it separately, and prefer onboarding_profile when both exist.',
    'If validation status is fail, freshness metadata is missing, or a tool result includes errors, caveat the answer instead of smoothing over the issue.',
    '',
    'Team index:',
  ];

  try {
    const teams = await listContextGraphTeams(options);
    for (const team of teams) {
      lines.push(
        `- ${team.team_id}: ${team.name} (${team.conference || 'unknown'} / ${team.division || 'unknown'}; validation=${team.validation_status}; overrides=${team.has_overrides ? 'yes' : 'no'}; as_of=${team.source_as_of_date || 'unknown'})`,
      );
    }
  } catch (error) {
    lines.push(`- Intel unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }

  return lines.join('\n');
}

export async function getEffectiveTeamContextForAI(
  teamId: string,
  options: ContextGraphAiOptions = {},
): Promise<AiTeamContext> {
  const [effective, memory] = await Promise.all([
    getEffectiveTeamContext(teamId, options),
    getTeamMemoryProfile(teamId, options),
  ]);
  return compactTeamContext(effective, teamMemoryTraceSummary(memory));
}

export async function handleContextGraphToolUse(
  input: unknown,
  options: ContextGraphAiOptions = {},
): Promise<ContextGraphLookupToolResult> {
  const teamIds = parseLookupTeamIds(input);
  const result: ContextGraphLookupToolResult = {
    ok: true,
    teams: [],
    errors: [],
    valid_team_ids: NBA_TEAM_IDS,
  };

  if (teamIds.length === 0) {
    return {
      ...result,
      ok: false,
      errors: [{ team_id: '(missing)', error: 'team_ids must be a non-empty array.' }],
    };
  }

  for (const teamId of teamIds) {
    if (!isNbaTeamId(teamId)) {
      result.ok = false;
      result.errors.push({ team_id: teamId, error: 'unknown_team_id' });
      continue;
    }
    try {
      result.teams.push(await getEffectiveTeamContextForAI(teamId, options));
    } catch (error) {
      result.ok = false;
      result.errors.push({
        team_id: teamId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

export function isContextGraphToolUse(
  block: Anthropic.ContentBlock,
): block is Anthropic.ToolUseBlock {
  return block.type === 'tool_use' && block.name === CONTEXT_GRAPH_LOOKUP_TOOL_NAME;
}

export async function contextGraphToolResultBlock(
  toolUse: Anthropic.ToolUseBlock,
  options: ContextGraphAiOptions = {},
): Promise<Anthropic.ToolResultBlockParam> {
  const result = await handleContextGraphToolUse(toolUse.input, options);
  return {
    type: 'tool_result',
    tool_use_id: toolUse.id,
    content: JSON.stringify(result),
    is_error: !result.ok,
  };
}

export function contextGraphTraceFromLookupResult(
  toolUseId: string,
  result: ContextGraphLookupToolResult,
): ContextGraphTrace {
  return {
    tool_use_id: toolUseId,
    tool_name: CONTEXT_GRAPH_LOOKUP_TOOL_NAME,
    teams: result.teams.map(traceTeam),
    errors: result.errors,
  };
}

export function contextGraphTraceFromToolResult(
  toolUseId: string,
  result: Anthropic.ToolResultBlockParam,
): ContextGraphTrace | null {
  if (typeof result.content !== 'string') return null;
  try {
    const parsed = JSON.parse(result.content) as ContextGraphLookupToolResult;
    return contextGraphTraceFromLookupResult(toolUseId, parsed);
  } catch {
    return null;
  }
}

export function contextGraphTracesToToolCalls(traces: ContextGraphTrace[]) {
  return traces.map((trace) => ({
    id: trace.tool_use_id,
    name: trace.tool_name,
    input: { team_ids: trace.teams.map((team) => team.team_id) },
    context_graph_trace: trace,
  }));
}

export function contextGraphTracesToBriefSources(
  traces: ContextGraphTrace[],
  startRefIndex: number,
): Omit<BriefSource, 'id' | 'brief_id'>[] {
  const teams = dedupeTraceTeams(traces);
  const errors = dedupeTraceErrors(traces);
  const teamSources = teams.map((team, index) => ({
    ref_index: startRefIndex + index,
    kind: 'CONTEXT_GRAPH',
    source: 'GAMBIT_CONTEXT_GRAPH',
    title: `Intel · ${team.team_id} · ${team.name}`,
    updated_at: team.source_last_updated || team.source_as_of_date || team.derived_updated_at,
    data: {
      rows: [
        { k: 'Team', v: `${team.team_id} · ${team.name}` },
        { k: 'Validation', v: validationLabel(team) },
        { k: 'Overrides', v: team.has_overrides ? 'yes' : 'no' },
        { k: 'Onboarding', v: onboardingLabel(team) },
        { k: 'Source as of', v: team.source_as_of_date || 'unknown' },
        { k: 'Source updated', v: team.source_last_updated || 'unknown' },
      ],
      context_graph_trace: {
        tool_use_id: 'brief_context_graph_sources',
        tool_name: CONTEXT_GRAPH_LOOKUP_TOOL_NAME,
        teams: [team],
        errors,
      } satisfies ContextGraphTrace,
    },
  }));
  const memorySources = teams
    .filter((team) => (team.private_memory?.card_count ?? 0) > 0)
    .map((team, index) => ({
      ref_index: startRefIndex + teamSources.length + index,
      kind: 'PRIVATE_MEMORY',
      source: 'GAMBIT_TEAM_MEMORY',
      title: `Private prototype memory · ${team.team_id} · ${team.name}`,
      updated_at: team.private_memory?.updated_at ?? null,
      data: {
        rows: [
          { k: 'Team', v: `${team.team_id} · ${team.name}` },
          { k: 'Status', v: team.private_memory?.status ?? 'unknown' },
          { k: 'Cards', v: String(team.private_memory?.card_count ?? 0) },
          { k: 'Player signals', v: String(team.private_memory?.player_signal_count ?? 0) },
          { k: 'Summary', v: team.private_memory?.summary ?? 'No summary' },
          ...(team.private_memory?.snippets ?? []).slice(0, 4).map((snippet, snippetIndex) => ({
            k: `Private snippet ${snippetIndex + 1}`,
            v: snippet,
          })),
        ],
        context_graph_trace: {
          tool_use_id: 'brief_context_graph_private_memory',
          tool_name: CONTEXT_GRAPH_LOOKUP_TOOL_NAME,
          teams: [team],
          errors: [],
        } satisfies ContextGraphTrace,
      },
    }));

  if (errors.length === 0) return [...teamSources, ...memorySources];

  return [
    ...teamSources,
    ...memorySources,
    {
      ref_index: startRefIndex + teamSources.length + memorySources.length,
      kind: 'CONTEXT_GRAPH',
      source: 'GAMBIT_CONTEXT_GRAPH',
      title: 'Intel · lookup errors',
      updated_at: null,
      data: {
        rows: errors.map((error) => ({ k: error.team_id, v: error.error })),
        context_graph_trace: {
          tool_use_id: 'brief_context_graph_errors',
          tool_name: CONTEXT_GRAPH_LOOKUP_TOOL_NAME,
          teams: [],
          errors,
        } satisfies ContextGraphTrace,
      },
    },
  ];
}

function indexEntry(team: TeamContextPreferences): ContextGraphTeamIndexEntry {
  return {
    team_id: team.team_id,
    name: team.name,
    conference: team.conference,
    division: team.division,
    validation_status: team.validation.status,
    has_overrides: team.has_overrides,
    source_as_of_date: team.as_of_date,
    source_last_updated: team.last_updated,
  };
}

function compactTeamContext(
  effective: EffectiveTeamContext,
  privateMemory: TeamMemoryTraceSummary | null,
): AiTeamContext {
  return {
    team_id: effective.team_id,
    name: effective.name,
    metadata: {
      derived_updated_at: effective.metadata.derived_updated_at,
      overrides_updated_at: effective.metadata.overrides_updated_at,
      has_overrides: effective.metadata.has_overrides,
      override_updated_at: effective.metadata.override_updated_at,
      source_as_of_date: effective.metadata.source_as_of_date,
      source_last_updated: effective.metadata.source_last_updated,
    },
    validation: effective.validation,
    roster_summary: effective.roster_summary,
    relationship_summary: {
      ...effective.relationship_summary,
      trade_partners: limit(effective.relationship_summary.trade_partners, 8),
      rivalries: limit(effective.relationship_summary.rivalries, 8),
      personnel_connections: limit(effective.relationship_summary.personnel_connections, 8),
      historical_pursuits: limit(effective.relationship_summary.historical_pursuits, 8),
    },
    preferences: {
      ownership: {
        ...effective.preferences.ownership,
        spending_posture_evidence: limit(effective.preferences.ownership.spending_posture_evidence, 6),
      },
      strategic_posture: {
        ...effective.preferences.strategic_posture,
        derived_from: limit(effective.preferences.strategic_posture.derived_from, 6),
        constraints: limit(effective.preferences.strategic_posture.constraints, 6),
        trigger_events: limit(effective.preferences.strategic_posture.trigger_events, 6),
      },
      trade_dna: {
        ...effective.preferences.trade_dna,
        frequent_partners: limit(effective.preferences.trade_dna.frequent_partners, 8),
        preferred_deal_archetypes: limit(effective.preferences.trade_dna.preferred_deal_archetypes, 8),
        recent_significant_trades: limit(effective.preferences.trade_dna.recent_significant_trades, 8),
      },
      cultural_signals: {
        ...effective.preferences.cultural_signals,
        notable_traits: limit(effective.preferences.cultural_signals.notable_traits, 8),
      },
      near_term_priorities: limit(effective.preferences.near_term_priorities, 8),
      narrative_summary: {
        ...effective.preferences.narrative_summary,
        three_things_to_watch: limit(effective.preferences.narrative_summary.three_things_to_watch, 4),
      },
      team_team_relationships: {
        rivalries: limit(effective.preferences.team_team_relationships.rivalries, 8),
        notable_personnel_connections: limit(
          effective.preferences.team_team_relationships.notable_personnel_connections,
          8,
        ),
      },
      onboarding_profile: {
        ...effective.preferences.onboarding_profile,
        team_snapshot: {
          ...effective.preferences.onboarding_profile.team_snapshot,
          cornerstones: limit(effective.preferences.onboarding_profile.team_snapshot.cornerstones, 3),
          active_scenarios: limit(effective.preferences.onboarding_profile.team_snapshot.active_scenarios, 8),
        },
        strategic_priorities: {
          ...effective.preferences.onboarding_profile.strategic_priorities,
          ranked_priorities: limit(effective.preferences.onboarding_profile.strategic_priorities.ranked_priorities, 3),
          decision_types: limit(effective.preferences.onboarding_profile.strategic_priorities.decision_types, 8),
        },
        stakeholders_rituals: {
          ...effective.preferences.onboarding_profile.stakeholders_rituals,
          people: limit(effective.preferences.onboarding_profile.stakeholders_rituals.people, 10),
          rituals: limit(effective.preferences.onboarding_profile.stakeholders_rituals.rituals, 8),
        },
        data_trust: {
          ...effective.preferences.onboarding_profile.data_trust,
          sources: limit(effective.preferences.onboarding_profile.data_trust.sources, 10),
          off_limits: limit(effective.preferences.onboarding_profile.data_trust.off_limits, 10),
          integrations: limit(effective.preferences.onboarding_profile.data_trust.integrations, 10),
        },
      },
    },
    override: effective.override,
    private_memory: privateMemory,
  };
}

function traceTeam(team: AiTeamContext): ContextGraphTraceTeam {
  return {
    team_id: team.team_id,
    name: team.name,
    validation_status: team.validation.status,
    validation_error_count: team.validation.error_count,
    validation_warning_count: team.validation.warning_count,
    has_overrides: team.metadata.has_overrides,
    source_as_of_date: team.metadata.source_as_of_date,
    source_last_updated: team.metadata.source_last_updated,
    override_updated_at: team.metadata.override_updated_at,
    derived_updated_at: team.metadata.derived_updated_at,
    onboarding_status: team.preferences.onboarding_profile.status,
    onboarding_updated_at: team.preferences.onboarding_profile.updated_at,
    onboarding_priority_count: team.preferences.onboarding_profile.strategic_priorities.ranked_priorities.length,
    private_memory: team.private_memory,
  };
}

function dedupeTraceTeams(traces: ContextGraphTrace[]): ContextGraphTraceTeam[] {
  const byId = new Map<string, ContextGraphTraceTeam>();
  for (const trace of traces) {
    for (const team of trace.teams) {
      byId.set(team.team_id, team);
    }
  }
  return [...byId.values()].sort((a, b) => a.team_id.localeCompare(b.team_id));
}

function dedupeTraceErrors(traces: ContextGraphTrace[]): ContextGraphTrace['errors'] {
  const byKey = new Map<string, ContextGraphTrace['errors'][number]>();
  for (const trace of traces) {
    for (const error of trace.errors) {
      byKey.set(`${error.team_id}:${error.error}`, error);
    }
  }
  return [...byKey.values()].sort((a, b) => a.team_id.localeCompare(b.team_id));
}

function validationLabel(team: ContextGraphTraceTeam): string {
  if (team.validation_status === 'pass') return 'pass';
  return `fail (${team.validation_error_count} errors, ${team.validation_warning_count} warnings)`;
}

function onboardingLabel(team: ContextGraphTraceTeam): string {
  if (!team.onboarding_status || team.onboarding_status === 'not_started') return 'not started';
  return `${team.onboarding_status}${team.onboarding_priority_count ? ` · ${team.onboarding_priority_count} ranked priorities` : ''}`;
}

function parseLookupTeamIds(input: unknown): string[] {
  if (!isRecord(input)) return [];
  const rawTeamIds = input.team_ids;
  if (!Array.isArray(rawTeamIds)) return [];
  return [...new Set(rawTeamIds.map((teamId) => String(teamId).trim().toUpperCase()).filter(Boolean))];
}

function limit<T>(items: T[], max: number): T[] {
  return items.slice(0, max);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
