import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  ContextGraphPreferenceVocab,
  EffectiveTeamContext,
  ListContextGraphPreferencesResponse,
  ContextGraphOnboardingProfile,
  TeamContextPreferenceOverride,
  TeamContextPreferencePatch,
  TeamContextPreferences,
  TeamContextPreferencesMetadata,
  TeamContextPreferenceValues,
  TeamContextValidationStatus,
  TeamRelationshipSummary,
  TeamRosterSummary,
} from '@shared/types';
import { DEFAULT_DERIVED_DIR, DEFAULT_TEAM_PREFERENCES_OVERRIDES_FILE } from './paths.js';
import { loadDerivedArtifacts } from './storage.js';
import { NBA_TEAM_IDS, VOCAB, isNbaTeamId } from './schema.js';

export interface TeamPreferenceStoreOptions {
  derivedDir?: string;
  overridesFile?: string;
  now?: () => Date;
}

interface TeamPreferenceState {
  metadata: TeamContextPreferencesMetadata;
  teams: TeamContextPreferences[];
  overrides: TeamPreferenceOverridesFile;
  sourceTeams: Record<string, Record<string, unknown>>;
}

interface TeamPreferenceOverridesFile {
  schema_version: 1;
  updated_at: string | null;
  teams: Record<string, TeamContextPreferenceOverride>;
}

type PatchSpec =
  | { kind: 'object'; fields: Record<string, PatchSpec> }
  | { kind: 'array'; item: PatchSpec }
  | { kind: 'string'; enum?: readonly string[] }
  | { kind: 'nullable_string' }
  | { kind: 'number' }
  | { kind: 'boolean' };

const EMPTY_OVERRIDES: TeamPreferenceOverridesFile = {
  schema_version: 1,
  updated_at: null,
  teams: {},
};

const TEAM_DISPLAY_NAMES: Record<string, string> = {
  ATL: 'Atlanta Hawks',
  BOS: 'Boston Celtics',
  BKN: 'Brooklyn Nets',
  CHA: 'Charlotte Hornets',
  CHI: 'Chicago Bulls',
  CLE: 'Cleveland Cavaliers',
  DAL: 'Dallas Mavericks',
  DEN: 'Denver Nuggets',
  DET: 'Detroit Pistons',
  GSW: 'Golden State Warriors',
  HOU: 'Houston Rockets',
  IND: 'Indiana Pacers',
  LAC: 'LA Clippers',
  LAL: 'Los Angeles Lakers',
  MEM: 'Memphis Grizzlies',
  MIA: 'Miami Heat',
  MIL: 'Milwaukee Bucks',
  MIN: 'Minnesota Timberwolves',
  NOP: 'New Orleans Pelicans',
  NYK: 'New York Knicks',
  OKC: 'Oklahoma City Thunder',
  ORL: 'Orlando Magic',
  PHI: 'Philadelphia 76ers',
  PHX: 'Phoenix Suns',
  POR: 'Portland Trail Blazers',
  SAC: 'Sacramento Kings',
  SAS: 'San Antonio Spurs',
  TOR: 'Toronto Raptors',
  UTA: 'Utah Jazz',
  WAS: 'Washington Wizards',
};

const PREFERENCE_PATCH_SPEC: PatchSpec = {
  kind: 'object',
  fields: {
    ownership: {
      kind: 'object',
      fields: {
        spending_posture: { kind: 'string', enum: VOCAB.spendingPosture },
        spending_posture_evidence: { kind: 'array', item: { kind: 'string' } },
        governance_notes: { kind: 'string' },
        recent_transitions: { kind: 'string' },
      },
    },
    strategic_posture: {
      kind: 'object',
      fields: {
        timeframe: { kind: 'string', enum: VOCAB.postureTimeframe },
        confidence: { kind: 'string', enum: VOCAB.confidence },
        derived_from: { kind: 'array', item: { kind: 'string' } },
        constraints: {
          kind: 'array',
          item: {
            kind: 'object',
            fields: {
              reason_code: { kind: 'string' },
              detail: { kind: 'string' },
              weight: { kind: 'string', enum: VOCAB.confidence },
            },
          },
        },
        trigger_events: { kind: 'array', item: { kind: 'string' } },
        last_reviewed: { kind: 'string' },
      },
    },
    trade_dna: {
      kind: 'object',
      fields: {
        frequent_partners: { kind: 'array', item: { kind: 'string' } },
        preferred_deal_archetypes: { kind: 'array', item: { kind: 'string' } },
        recent_significant_trades: {
          kind: 'array',
          item: {
            kind: 'object',
            fields: {
              date: { kind: 'string' },
              summary: { kind: 'string' },
            },
          },
        },
        confidence: { kind: 'string', enum: VOCAB.confidence },
      },
    },
    cultural_signals: {
      kind: 'object',
      fields: {
        stability: signalSpec(VOCAB.stability),
        player_friendly: signalSpec(VOCAB.playerFriendly),
        analytics_orientation: signalSpec(VOCAB.analyticsOrientation),
        risk_tolerance: signalSpec(VOCAB.riskTolerance),
        notable_traits: { kind: 'array', item: { kind: 'string' } },
        rationale: { kind: 'string' },
        confidence: { kind: 'string', enum: VOCAB.confidence },
      },
    },
    near_term_priorities: {
      kind: 'array',
      item: {
        kind: 'object',
        fields: {
          priority: { kind: 'string' },
          timeline: { kind: 'string', enum: VOCAB.priorityTimeline },
          type: { kind: 'string', enum: VOCAB.priorityType },
          detail: { kind: 'string' },
          confidence: { kind: 'string', enum: VOCAB.confidence },
        },
      },
    },
    narrative_summary: {
      kind: 'object',
      fields: {
        one_paragraph: { kind: 'string' },
        three_things_to_watch: { kind: 'array', item: { kind: 'string' } },
      },
    },
    team_team_relationships: {
      kind: 'object',
      fields: {
        rivalries: {
          kind: 'array',
          item: {
            kind: 'object',
            fields: {
              team_id: { kind: 'string' },
              type: { kind: 'string' },
              basis: { kind: 'string' },
            },
          },
        },
        notable_personnel_connections: {
          kind: 'array',
          item: {
            kind: 'object',
            fields: {
              person: { kind: 'string' },
              connected_team: { kind: 'string' },
              connection_type: { kind: 'string' },
              detail: { kind: 'string' },
            },
          },
        },
      },
    },
    onboarding_profile: {
      kind: 'object',
      fields: {
        schema_version: { kind: 'number' },
        status: { kind: 'string', enum: ['not_started', 'in_progress', 'completed'] },
        team_id: { kind: 'string' },
        team_name: { kind: 'string' },
        started_at: { kind: 'nullable_string' },
        updated_at: { kind: 'nullable_string' },
        completed_at: { kind: 'nullable_string' },
        skipped_sections: { kind: 'array', item: { kind: 'string' } },
        identity: {
          kind: 'object',
          fields: {
            role: { kind: 'string' },
            role_other: { kind: 'string' },
            years_in_role: { kind: 'string' },
            decision_authority: { kind: 'string' },
          },
        },
        team_snapshot: {
          kind: 'object',
          fields: {
            lifecycle: { kind: 'string' },
            secondary_lifecycles: { kind: 'array', item: { kind: 'string' } },
            cap_posture: { kind: 'string' },
            cornerstones: { kind: 'array', item: { kind: 'string' } },
            active_scenarios: { kind: 'array', item: { kind: 'string' } },
            star_extension_players: { kind: 'string' },
            rookie_scale_extension_players: { kind: 'string' },
            trade_deadline_window: { kind: 'string' },
            other_scenarios: { kind: 'array', item: { kind: 'string' } },
          },
        },
        strategic_priorities: {
          kind: 'object',
          fields: {
            ninety_day_decision: { kind: 'string' },
            ranked_priorities: { kind: 'array', item: { kind: 'string' } },
            decision_types: { kind: 'array', item: { kind: 'string' } },
            recent_decision_help: { kind: 'string' },
            other_decision_types: { kind: 'array', item: { kind: 'string' } },
          },
        },
        working_style: {
          kind: 'object',
          fields: {
            recommendation_style: { kind: 'string' },
            claim_requirements: { kind: 'array', item: { kind: 'string' } },
            risk_posture: { kind: 'string' },
            cadence: { kind: 'string' },
            briefing_time: { kind: 'string' },
            briefing_timezone: { kind: 'string' },
            channels: { kind: 'array', item: { kind: 'string' } },
            slack_workspace: { kind: 'string' },
            slack_channel: { kind: 'string' },
            other_channels: { kind: 'array', item: { kind: 'string' } },
          },
        },
        stakeholders_rituals: {
          kind: 'object',
          fields: {
            skipped: { kind: 'boolean' },
            people: {
              kind: 'array',
              item: {
                kind: 'object',
                fields: {
                  id: { kind: 'string' },
                  name: { kind: 'string' },
                  role: { kind: 'string' },
                  decision_areas: { kind: 'array', item: { kind: 'string' } },
                },
              },
            },
            authority: {
              kind: 'object',
              fields: {
                cap_contracts: { kind: 'string' },
                basketball_ops: { kind: 'string' },
                draft: { kind: 'string' },
                coaching_staff: { kind: 'string' },
              },
            },
            rituals: { kind: 'array', item: { kind: 'string' } },
            other_rituals: { kind: 'array', item: { kind: 'string' } },
            fire_drill_frequency: { kind: 'string' },
          },
        },
        data_trust: {
          kind: 'object',
          fields: {
            skipped: { kind: 'boolean' },
            trust_panel_acknowledged: { kind: 'boolean' },
            sources: { kind: 'array', item: { kind: 'string' } },
            other_sources: { kind: 'array', item: { kind: 'string' } },
            off_limits: { kind: 'array', item: { kind: 'string' } },
            off_limits_people: { kind: 'string' },
            off_limits_topics: { kind: 'string' },
            integrations: { kind: 'array', item: { kind: 'string' } },
            other_integrations: { kind: 'array', item: { kind: 'string' } },
          },
        },
      },
    },
  },
};

export async function listTeamContextPreferences(options: TeamPreferenceStoreOptions = {}): Promise<ListContextGraphPreferencesResponse> {
  const state = await loadTeamPreferenceState(options);
  return {
    metadata: state.metadata,
    teams: state.teams,
    vocab: preferenceVocab(),
  };
}

export async function getTeamContextPreferences(teamId: string, options: TeamPreferenceStoreOptions = {}): Promise<TeamContextPreferences> {
  const state = await loadTeamPreferenceState(options);
  const team = state.teams.find((candidate) => candidate.team_id === teamId);
  if (!team) throw new Error(`Unknown Intel team_id ${teamId}.`);
  return team;
}

export async function getEffectiveTeamContext(teamId: string, options: TeamPreferenceStoreOptions = {}): Promise<EffectiveTeamContext> {
  const state = await loadTeamPreferenceState(options);
  const team = state.teams.find((candidate) => candidate.team_id === teamId);
  const sourceTeam = state.sourceTeams[teamId];
  if (!team || !sourceTeam) throw new Error(`Unknown Intel team_id ${teamId}.`);

  return {
    team_id: team.team_id,
    name: team.name,
    metadata: {
      ...state.metadata,
      has_overrides: team.has_overrides,
      override_updated_at: team.override_updated_at,
      source_as_of_date: team.as_of_date,
      source_last_updated: team.last_updated,
    },
    validation: team.validation,
    roster_summary: team.roster_summary,
    relationship_summary: team.relationship_summary,
    source_team: deepClone(sourceTeam),
    source_preferences: deepClone(team.source_preferences),
    preferences: deepClone(team.preferences),
    override: deepClone(team.override),
  };
}

export async function patchTeamContextPreferences(
  teamId: string,
  patch: TeamContextPreferencePatch,
  options: TeamPreferenceStoreOptions = {},
): Promise<TeamContextPreferences> {
  if (!isNbaTeamId(teamId)) throw new Error(`Unknown Intel team_id ${teamId}.`);
  validatePreferencePatch(patch);

  const state = await loadTeamPreferenceState(options);
  const team = state.teams.find((candidate) => candidate.team_id === teamId);
  if (!team) throw new Error(`Unknown Intel team_id ${teamId}.`);

  const nextPreferences = deepMerge(team.preferences, patch) as TeamContextPreferenceValues;
  const nextOverride = diffValues(team.source_preferences, nextPreferences) as TeamContextPreferencePatch | undefined;
  const updatedAt = (options.now ?? (() => new Date()))().toISOString();
  const overrides: TeamPreferenceOverridesFile = deepClone(state.overrides);

  if (!nextOverride || isEmptyObject(nextOverride)) {
    delete overrides.teams[teamId];
  } else {
    overrides.teams[teamId] = {
      updated_at: updatedAt,
      preferences: nextOverride,
    };
  }
  overrides.updated_at = updatedAt;
  await writeOverridesFile(overrides, resolvedOverridesFile(options));
  return getTeamContextPreferences(teamId, options);
}

export async function resetTeamContextPreferences(teamId: string, options: TeamPreferenceStoreOptions = {}): Promise<TeamContextPreferences> {
  if (!isNbaTeamId(teamId)) throw new Error(`Unknown Intel team_id ${teamId}.`);
  const state = await loadTeamPreferenceState(options);
  if (!state.sourceTeams[teamId]) throw new Error(`Unknown Intel team_id ${teamId}.`);

  const overrides: TeamPreferenceOverridesFile = deepClone(state.overrides);
  delete overrides.teams[teamId];
  overrides.updated_at = (options.now ?? (() => new Date()))().toISOString();
  await writeOverridesFile(overrides, resolvedOverridesFile(options));
  return getTeamContextPreferences(teamId, options);
}

export async function loadTeamPreferenceState(options: TeamPreferenceStoreOptions = {}): Promise<TeamPreferenceState> {
  const derivedDir = options.derivedDir ?? DEFAULT_DERIVED_DIR;
  const overridesFile = resolvedOverridesFile(options);
  const [artifacts, overrides, derivedUpdatedAt, validation] = await Promise.all([
    loadDerivedArtifacts(derivedDir),
    readOverridesFile(overridesFile),
    latestMtime([
      path.join(derivedDir, 'teams.json'),
      path.join(derivedDir, 'edges.json'),
      path.join(derivedDir, 'validation_report.md'),
    ]),
    readValidationSummary(path.join(derivedDir, 'validation_report.md')),
  ]);

  const validTeams = artifacts.teams.filter((team) => isNbaTeamId(String(team.team_id ?? '')));
  const sourceTeams = Object.fromEntries(
    validTeams.map((team) => [String(team.team_id ?? ''), team as Record<string, unknown>]),
  );
  for (const teamId of validation.perTeam.keys()) {
    if (isNbaTeamId(teamId) && !sourceTeams[teamId]) {
      sourceTeams[teamId] = placeholderTeam(teamId);
    }
  }
  const metadata: TeamContextPreferencesMetadata = {
    schema_version: 1,
    derived_updated_at: derivedUpdatedAt,
    validation_report_path: path.join(derivedDir, 'validation_report.md'),
    overrides_path: overridesFile,
    overrides_updated_at: overrides.updated_at,
  };

  const teams = Object.values(sourceTeams)
    .map((team) => buildTeamPreference(team as Record<string, unknown>, artifacts.edges, overrides, validation.perTeam))
    .sort((a, b) => a.team_id.localeCompare(b.team_id));

  return { metadata, teams, overrides, sourceTeams };
}

function buildTeamPreference(
  team: Record<string, unknown>,
  edges: Awaited<ReturnType<typeof loadDerivedArtifacts>>['edges'],
  overrides: TeamPreferenceOverridesFile,
  validationByTeam: Map<string, TeamContextValidationStatus>,
): TeamContextPreferences {
  const teamId = stringAt(team, 'team_id');
  const sourcePreferences = extractPreferenceValues(team);
  const override = overrides.teams[teamId] ?? null;
  const preferences = override ? deepMerge(sourcePreferences, override.preferences) as TeamContextPreferenceValues : sourcePreferences;
  const validation = validationByTeam.get(teamId) ?? { status: 'pass', error_count: 0, warning_count: 0 };

  return {
    team_id: teamId,
    name: stringAt(team, 'identity.name'),
    conference: stringAt(team, 'identity.conference'),
    division: stringAt(team, 'identity.division'),
    market_tier: stringAt(team, 'identity.market_tier'),
    as_of_date: stringAt(team, 'as_of_date'),
    last_updated: stringAt(team, 'last_updated'),
    has_overrides: override !== null,
    override_updated_at: override?.updated_at ?? null,
    validation,
    roster_summary: summarizeRoster(team),
    relationship_summary: summarizeRelationships(teamId, edges),
    source_preferences: sourcePreferences,
    preferences,
    override: override ? deepClone(override.preferences) : null,
  };
}

function extractPreferenceValues(team: Record<string, unknown>): TeamContextPreferenceValues {
  return {
    ownership: {
      spending_posture: stringAt(team, 'ownership.spending_posture'),
      spending_posture_evidence: stringArrayAt(team, 'ownership.spending_posture_evidence'),
      governance_notes: stringAt(team, 'ownership.governance_notes'),
      recent_transitions: stringAt(team, 'ownership.recent_transitions'),
    },
    strategic_posture: {
      timeframe: stringAt(team, 'strategic_posture.timeframe'),
      confidence: stringAt(team, 'strategic_posture.confidence'),
      derived_from: stringArrayAt(team, 'strategic_posture.derived_from'),
      constraints: recordsAt(team, 'strategic_posture.constraints').map((constraint) => ({
        reason_code: stringValue(constraint.reason_code),
        detail: stringValue(constraint.detail),
        weight: stringValue(constraint.weight),
      })),
      trigger_events: stringArrayAt(team, 'strategic_posture.trigger_events'),
      last_reviewed: stringAt(team, 'strategic_posture.last_reviewed'),
    },
    trade_dna: {
      frequent_partners: stringArrayAt(team, 'trade_dna.frequent_partners'),
      preferred_deal_archetypes: stringArrayAt(team, 'trade_dna.preferred_deal_archetypes'),
      recent_significant_trades: recordsAt(team, 'trade_dna.recent_significant_trades').map((trade) => ({
        date: stringValue(trade.date),
        summary: stringValue(trade.summary),
      })),
      confidence: stringAt(team, 'trade_dna.confidence'),
    },
    cultural_signals: {
      stability: signalAt(team, 'cultural_signals.stability'),
      player_friendly: signalAt(team, 'cultural_signals.player_friendly'),
      analytics_orientation: signalAt(team, 'cultural_signals.analytics_orientation'),
      risk_tolerance: signalAt(team, 'cultural_signals.risk_tolerance'),
      notable_traits: stringArrayAt(team, 'cultural_signals.notable_traits'),
      rationale: stringAt(team, 'cultural_signals.rationale'),
      confidence: stringAt(team, 'cultural_signals.confidence'),
    },
    near_term_priorities: recordsAt(team, 'near_term_priorities').map((priority) => ({
      priority: stringValue(priority.priority),
      timeline: stringValue(priority.timeline),
      type: stringValue(priority.type),
      detail: stringValue(priority.detail),
      confidence: stringValue(priority.confidence),
    })),
    narrative_summary: {
      one_paragraph: stringAt(team, 'narrative_summary.one_paragraph'),
      three_things_to_watch: stringArrayAt(team, 'narrative_summary.three_things_to_watch'),
    },
    team_team_relationships: {
      rivalries: recordsAt(team, 'team_team_relationships.rivalries').map((rivalry) => ({
        team_id: stringValue(rivalry.team_id),
        type: stringValue(rivalry.type),
        basis: stringValue(rivalry.basis),
      })),
      notable_personnel_connections: recordsAt(team, 'team_team_relationships.notable_personnel_connections').map((connection) => ({
        person: stringValue(connection.person),
        connected_team: stringValue(connection.connected_team),
        connection_type: stringValue(connection.connection_type),
        detail: stringValue(connection.detail),
      })),
    },
    onboarding_profile: emptyOnboardingProfile(stringAt(team, 'team_id'), stringAt(team, 'identity.name')),
  };
}

function summarizeRoster(team: Record<string, unknown>): TeamRosterSummary {
  const roster = recordsAt(team, 'roster');
  const tierCounts: Record<string, number> = {};
  for (const player of roster) {
    const tier = stringValue(player.tier) || 'unknown';
    tierCounts[tier] = (tierCounts[tier] ?? 0) + 1;
  }
  return {
    roster_count: roster.length,
    pending_free_agents_count: recordsAt(team, 'pending_free_agents').length,
    tier_counts: tierCounts,
  };
}

function summarizeRelationships(
  teamId: string,
  edges: Awaited<ReturnType<typeof loadDerivedArtifacts>>['edges'],
): TeamRelationshipSummary {
  return {
    trade_partners: edges.tradePartners
      .filter((edge) => edge.team_a === teamId || edge.team_b === teamId)
      .map((edge) => ({
        team_id: edge.team_a === teamId ? edge.team_b : edge.team_a,
        trade_count_recent: edge.trade_count_recent,
        last_trade_date: edge.last_trade_date,
      })),
    rivalries: edges.rivalries
      .filter((edge) => edge.team_a === teamId)
      .map((edge) => ({
        team_id: edge.team_b,
        rivalry_type: edge.rivalry_type,
        basis: edge.basis,
      })),
    personnel_connections: edges.personnelConnections
      .filter((edge) => edge.team_with_entry === teamId)
      .map((edge) => ({
        person_name: edge.person_name,
        connected_team: edge.connected_team,
        connection_type: edge.connection_type,
      })),
    historical_pursuits: edges.historicalPursuits
      .filter((edge) => edge.pursuer_team === teamId)
      .map((edge) => ({
        target_name: edge.target_name,
        year: edge.year,
        outcome: edge.outcome,
      })),
    incoming_pick_count: edges.pickOwnership.filter((edge) => edge.owning_team === teamId && edge.owed_team !== teamId).length,
    outgoing_pick_count: edges.pickOwnership.filter((edge) => edge.owed_team === teamId && edge.owning_team !== teamId).length,
  };
}

function preferenceVocab(): ContextGraphPreferenceVocab {
  return {
    team_ids: [...NBA_TEAM_IDS],
    spending_posture: [...VOCAB.spendingPosture],
    timeframe: [...VOCAB.postureTimeframe],
    confidence: [...VOCAB.confidence],
    priority_type: [...VOCAB.priorityType],
    priority_timeline: [...VOCAB.priorityTimeline],
    stability: [...VOCAB.stability],
    player_friendly: [...VOCAB.playerFriendly],
    analytics_orientation: [...VOCAB.analyticsOrientation],
    risk_tolerance: [...VOCAB.riskTolerance],
    rivalry_type: [...VOCAB.rivalryType],
  };
}

function placeholderTeam(teamId: string): Record<string, unknown> {
  return {
    team_id: teamId,
    as_of_date: '',
    last_updated: '',
    identity: {
      name: TEAM_DISPLAY_NAMES[teamId] ?? teamId,
      conference: '',
      division: '',
      market_tier: '',
    },
  };
}

function validatePreferencePatch(value: unknown): asserts value is TeamContextPreferencePatch {
  validateAgainstSpec(value, PREFERENCE_PATCH_SPEC, 'preferences');
}

function validateAgainstSpec(value: unknown, spec: PatchSpec, location: string): void {
  if (spec.kind === 'number') {
    if (typeof value !== 'number') throw new Error(`${location} must be a number.`);
    return;
  }
  if (spec.kind === 'nullable_string') {
    if (value !== null && typeof value !== 'string') throw new Error(`${location} must be a string or null.`);
    return;
  }
  if (spec.kind === 'boolean') {
    if (typeof value !== 'boolean') throw new Error(`${location} must be a boolean.`);
    return;
  }
  if (spec.kind === 'string') {
    if (typeof value !== 'string') throw new Error(`${location} must be a string.`);
    if (spec.enum && !spec.enum.includes(value)) {
      throw new Error(`${location} must be one of: ${spec.enum.join(', ')}.`);
    }
    return;
  }
  if (spec.kind === 'array') {
    if (!Array.isArray(value)) throw new Error(`${location} must be an array.`);
    value.forEach((item, index) => validateAgainstSpec(item, spec.item, `${location}[${index}]`));
    return;
  }
  if (!isRecord(value)) throw new Error(`${location} must be an object.`);
  for (const [key, child] of Object.entries(value)) {
    const childSpec = spec.fields[key];
    if (!childSpec) throw new Error(`${location}.${key} is not an editable Intel preference field.`);
    validateAgainstSpec(child, childSpec, `${location}.${key}`);
  }
}

function emptyOnboardingProfile(teamId: string, teamName: string): ContextGraphOnboardingProfile {
  return {
    schema_version: 1,
    status: 'not_started',
    team_id: teamId,
    team_name: teamName || teamId,
    started_at: null,
    updated_at: null,
    completed_at: null,
    skipped_sections: [],
    identity: {
      role: '',
      role_other: '',
      years_in_role: '',
      decision_authority: '',
    },
    team_snapshot: {
      lifecycle: '',
      secondary_lifecycles: [],
      cap_posture: '',
      cornerstones: [],
      active_scenarios: [],
      star_extension_players: '',
      rookie_scale_extension_players: '',
      trade_deadline_window: '',
      other_scenarios: [],
    },
    strategic_priorities: {
      ninety_day_decision: '',
      ranked_priorities: [],
      decision_types: [],
      recent_decision_help: '',
      other_decision_types: [],
    },
    working_style: {
      recommendation_style: '',
      claim_requirements: [],
      risk_posture: '',
      cadence: '',
      briefing_time: '',
      briefing_timezone: '',
      channels: [],
      slack_workspace: '',
      slack_channel: '',
      other_channels: [],
    },
    stakeholders_rituals: {
      skipped: false,
      people: [],
      authority: {
        cap_contracts: '',
        basketball_ops: '',
        draft: '',
        coaching_staff: '',
      },
      rituals: [],
      other_rituals: [],
      fire_drill_frequency: '',
    },
    data_trust: {
      skipped: false,
      trust_panel_acknowledged: false,
      sources: [],
      other_sources: [],
      off_limits: [],
      off_limits_people: '',
      off_limits_topics: '',
      integrations: [],
      other_integrations: [],
    },
  };
}

async function readOverridesFile(filePath: string): Promise<TeamPreferenceOverridesFile> {
  let text: string;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return deepClone(EMPTY_OVERRIDES);
    throw error;
  }

  const parsed = JSON.parse(text) as unknown;
  if (!isRecord(parsed) || parsed.schema_version !== 1 || !isRecord(parsed.teams)) {
    throw new Error(`Invalid Intel preference overrides file at ${filePath}.`);
  }
  return {
    schema_version: 1,
    updated_at: typeof parsed.updated_at === 'string' ? parsed.updated_at : null,
    teams: Object.fromEntries(Object.entries(parsed.teams).flatMap(([teamId, entry]) => {
      if (!isNbaTeamId(teamId) || !isRecord(entry) || typeof entry.updated_at !== 'string' || !isRecord(entry.preferences)) {
        return [];
      }
      return [[teamId, {
        updated_at: entry.updated_at,
        preferences: deepClone(entry.preferences) as TeamContextPreferencePatch,
      }]];
    })),
  };
}

async function writeOverridesFile(overrides: TeamPreferenceOverridesFile, filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(overrides, null, 2)}\n`, 'utf8');
}

interface ValidationSummary {
  perTeam: Map<string, TeamContextValidationStatus>;
}

async function readValidationSummary(reportPath: string): Promise<ValidationSummary> {
  let text = '';
  try {
    text = await readFile(reportPath, 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return { perTeam: new Map() };
    throw error;
  }

  const perTeam = new Map<string, TeamContextValidationStatus>();
  let section: 'errors' | 'warnings' | null = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('## Per-File Schema Errors') || line.startsWith('## Cross-Team Consistency Errors')) {
      section = 'errors';
      continue;
    }
    if (line.startsWith('## Cross-Team Consistency Warnings')) {
      section = 'warnings';
      continue;
    }
    if (line.startsWith('## ') && !line.includes('Errors') && !line.includes('Warnings')) {
      section = null;
      continue;
    }
    if (!section || !line.startsWith('- ')) continue;
    const match = line.match(/\/teams\/([a-z]{3})\.yaml/i);
    if (!match) continue;
    const teamId = match[1].toUpperCase();
    const current = perTeam.get(teamId) ?? { status: 'pass', error_count: 0, warning_count: 0 };
    if (section === 'warnings') current.warning_count += 1;
    else current.error_count += 1;
    current.status = current.error_count > 0 ? 'fail' : 'pass';
    perTeam.set(teamId, current);
  }
  return { perTeam };
}

async function latestMtime(filePaths: string[]): Promise<string | null> {
  const times = await Promise.all(filePaths.map(async (filePath) => {
    try {
      return (await stat(filePath)).mtime.getTime();
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return null;
      throw error;
    }
  }));
  const latest = Math.max(...times.filter((time): time is number => typeof time === 'number'));
  return Number.isFinite(latest) ? new Date(latest).toISOString() : null;
}

function signalSpec(values: readonly string[]): PatchSpec {
  return {
    kind: 'object',
    fields: {
      value: { kind: 'string', enum: values },
      detail: { kind: 'string' },
    },
  };
}

function signalAt(root: Record<string, unknown>, pathName: string): { value: string; detail: string } {
  return {
    value: stringAt(root, `${pathName}.value`),
    detail: stringAt(root, `${pathName}.detail`),
  };
}

function recordsAt(root: Record<string, unknown>, pathName: string): Record<string, unknown>[] {
  const value = getAt(root, pathName);
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function stringArrayAt(root: Record<string, unknown>, pathName: string): string[] {
  const value = getAt(root, pathName);
  if (!Array.isArray(value)) return [];
  return value.map(stringValue).filter((item) => item !== '');
}

function stringAt(root: Record<string, unknown>, pathName: string): string {
  return stringValue(getAt(root, pathName));
}

function stringValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function getAt(root: Record<string, unknown>, pathName: string): unknown {
  let cursor: unknown = root;
  for (const part of pathName.split('.')) {
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

function deepMerge(base: unknown, patch: unknown): unknown {
  if (Array.isArray(patch)) return deepClone(patch);
  if (!isRecord(base) || !isRecord(patch)) return deepClone(patch);
  const merged: Record<string, unknown> = deepClone(base);
  for (const [key, value] of Object.entries(patch)) {
    merged[key] = deepMerge(merged[key], value);
  }
  return merged;
}

function diffValues(source: unknown, effective: unknown): unknown {
  if (stableJson(source) === stableJson(effective)) return undefined;
  if (isRecord(source) && isRecord(effective)) {
    const diff: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(effective)) {
      const child = diffValues(source[key], value);
      if (child !== undefined) diff[key] = child;
    }
    return Object.keys(diff).length > 0 ? diff : undefined;
  }
  return deepClone(effective);
}

function deepClone<T>(value: T): T {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function isEmptyObject(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).length === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function resolvedOverridesFile(options: TeamPreferenceStoreOptions): string {
  return options.overridesFile
    ?? process.env.CONTEXT_GRAPH_TEAM_PREFERENCES_OVERRIDES
    ?? DEFAULT_TEAM_PREFERENCES_OVERRIDES_FILE;
}
