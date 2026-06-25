import type {
  CompleteContextGraphOnboardingResponse,
  ContextGraphOnboardingDefaults,
  ContextGraphOnboardingCapContext,
  ContextGraphOnboardingPriorityOption,
  ContextGraphOnboardingProfile,
  ContextGraphOnboardingSectionId,
  ContextGraphOnboardingSectionStatus,
  ContextGraphOnboardingViewModel,
  ContextGraphCodedDetail,
  ContextGraphPriority,
  EffectiveTeamContext,
  GetContextGraphOnboardingResponse,
  PatchContextGraphOnboardingResponse,
  ResetContextGraphOnboardingResponse,
  TeamContextPreferencePatch,
  TeamContextPreferences,
  TeamContextPreferenceValues,
} from '@shared/types';
import {
  getEffectiveTeamContext,
  patchTeamContextPreferences,
  type TeamPreferenceStoreOptions,
} from './preferences.js';

const ONBOARDING_PRIORITY_PREFIX = 'Onboarding capture:';
const ONBOARDING_CAP_CONSTRAINT = 'onboarding_cap_posture';
const REQUIRED_SECTIONS: ContextGraphOnboardingSectionId[] = [
  'identity_role',
  'team_snapshot',
  'strategic_priorities',
  'working_style',
];
const SECTION_LABELS: Record<ContextGraphOnboardingSectionId, string> = {
  identity_role: 'Identity & role',
  team_snapshot: 'Team snapshot',
  strategic_priorities: 'Strategic priorities',
  working_style: 'Working style',
  stakeholders_rituals: 'Stakeholders & rituals',
  data_trust: 'Data & trust posture',
};

export async function getContextGraphOnboardingResponse(
  teamIdInput: string,
  options: TeamPreferenceStoreOptions = {},
): Promise<GetContextGraphOnboardingResponse> {
  const team = await getOnboardingTeam(teamIdInput, options);
  return { onboarding: deriveOnboardingViewModel(team) };
}

export async function patchContextGraphOnboarding(
  teamIdInput: string,
  profilePatch: unknown,
  options: TeamPreferenceStoreOptions = {},
): Promise<PatchContextGraphOnboardingResponse> {
  const team = await getOnboardingTeam(teamIdInput, options);
  if (!isRecord(profilePatch)) throw new Error('onboarding profile patch object required.');

  const now = nowIso(options);
  const current = normalizeOnboardingProfile(team.preferences.onboarding_profile, team, now);
  const merged = normalizeOnboardingProfile(deepMerge(current, profilePatch), team, now);
  const next: ContextGraphOnboardingProfile = {
    ...merged,
    status: merged.status === 'completed' ? 'completed' : 'in_progress',
    started_at: merged.started_at ?? now,
    updated_at: now,
    completed_at: merged.status === 'completed' ? merged.completed_at : null,
  };

  await patchTeamContextPreferences(team.team_id, buildGraphPatch(team.preferences, next, now), options);
  const saved = await getEffectiveTeamContext(team.team_id, options);
  return { onboarding: deriveOnboardingViewModel(saved) };
}

export async function completeContextGraphOnboarding(
  teamIdInput: string,
  options: TeamPreferenceStoreOptions = {},
): Promise<CompleteContextGraphOnboardingResponse> {
  const team = await getOnboardingTeam(teamIdInput, options);
  const now = nowIso(options);
  const current = normalizeOnboardingProfile(team.preferences.onboarding_profile, team, now);
  const view = deriveOnboardingViewModel({ ...team, preferences: { ...team.preferences, onboarding_profile: current } });
  const missing = view.sections.filter((section) => section.required && !section.complete);
  if (missing.length > 0) {
    throw new Error(`Required onboarding sections incomplete: ${missing.map((section) => section.label).join(', ')}.`);
  }

  const completed: ContextGraphOnboardingProfile = {
    ...current,
    status: 'completed',
    updated_at: now,
    completed_at: now,
  };
  await patchTeamContextPreferences(team.team_id, buildGraphPatch(team.preferences, completed, now), options);
  const saved = await getEffectiveTeamContext(team.team_id, options);
  return { onboarding: deriveOnboardingViewModel(saved) };
}

export async function resetContextGraphOnboarding(
  teamIdInput: string,
  options: TeamPreferenceStoreOptions = {},
): Promise<ResetContextGraphOnboardingResponse> {
  const team = await getOnboardingTeam(teamIdInput, options);
  const empty = emptyOnboardingProfile(team);
  await patchTeamContextPreferences(team.team_id, {
    onboarding_profile: empty,
    strategic_posture: {
      ...team.preferences.strategic_posture,
      constraints: team.preferences.strategic_posture.constraints
        .filter((constraint) => constraint.reason_code !== ONBOARDING_CAP_CONSTRAINT),
      derived_from: team.preferences.strategic_posture.derived_from
        .filter((source) => source !== 'Gambit onboarding'),
    },
    near_term_priorities: team.preferences.near_term_priorities
      .filter((priority) => !priority.detail.startsWith(ONBOARDING_PRIORITY_PREFIX)),
  }, options);
  const saved = await getEffectiveTeamContext(team.team_id, options);
  return { onboarding: deriveOnboardingViewModel(saved) };
}

type OnboardingTeamContext = Pick<TeamContextPreferences, 'team_id' | 'name' | 'preferences' | 'source_preferences'> & {
  source_team?: Record<string, unknown>;
};

export function deriveOnboardingViewModel(team: OnboardingTeamContext): ContextGraphOnboardingViewModel {
  const now = new Date().toISOString();
  const profile = normalizeOnboardingProfile(team.preferences.onboarding_profile, team, now);
  const inferredCapContext = inferCapContext(team);
  const generated = generatePriorityOptions(profile);
  const defaults = deriveWorkingStyleDefaults(profile);
  const sections = buildSectionStatuses(profile, generated, defaults);
  const canComplete = sections.every((section) => !section.required || section.complete);
  const nextSection = sections.find((section) => !section.complete)?.id ?? null;

  return {
    team_id: team.team_id,
    team_name: team.name,
    profile,
    inferred_cap_context: inferredCapContext,
    sections,
    generated_priority_options: generated,
    defaults,
    can_complete: canComplete,
    next_section: nextSection,
    warnings: profile.team_snapshot.cornerstones.length > 3
      ? ['Cornerstones are capped at three players for v1.']
      : [],
  };
}

export function generatePriorityOptions(
  profile: ContextGraphOnboardingProfile,
): ContextGraphOnboardingPriorityOption[] {
  const lifecycle = profile.team_snapshot.lifecycle;
  const lifecycleSet = new Set([lifecycle, ...profile.team_snapshot.secondary_lifecycles].filter(Boolean));
  const capPosture = profile.team_snapshot.cap_posture;
  const scenarios = new Set(profile.team_snapshot.active_scenarios);
  const cornerstones = profile.team_snapshot.cornerstones.slice(0, 3);
  const cornerstonePhrase = cornerstones.length > 0 ? cornerstones.join(' / ') : 'the young core';
  const options: ContextGraphOnboardingPriorityOption[] = [];

  addOption(options, {
    id: 'wizards-acceleration-trigger',
    label: `Set the acceleration trigger for ${cornerstonePhrase}`,
    detail: 'Define the evidence that would justify moving from rebuild posture to a veteran acceleration bet.',
    type: 'structural',
    timeline: 'this_season',
    source: 'team_context',
  });

  if (lifecycleSet.has('rebuilding') || lifecycleSet.has('tanking_asset_accumulation') || lifecycleSet.has('retooling')) {
    addOption(options, {
      id: 'protect-asset-flexibility',
      label: 'Protect asset flexibility before the next trade window',
      detail: 'Keep the rebuild optionality clear before the market turns noisy.',
      type: 'trade',
      timeline: 'by_trade_deadline',
      source: 'lifecycle',
    });
    addOption(options, {
      id: 'development-pathing',
      label: `Align development pathing around ${cornerstonePhrase}`,
      detail: 'Make the player-development lens explicit before roster moves crowd it out.',
      type: 'roster',
      timeline: 'this_season',
      source: 'lifecycle',
    });
  }

  if (lifecycleSet.has('title_contender') || lifecycleSet.has('playoff_hopeful')) {
    addOption(options, {
      id: 'rotation-upgrade-without-apron-damage',
      label: 'Find rotation upgrades without damaging future flexibility',
      detail: 'Contending paths should preserve the next transaction, not just solve the current one.',
      type: 'trade',
      timeline: 'by_trade_deadline',
      source: 'lifecycle',
    });
  }

  if (capPosture.includes('apron') || scenarios.has('apron_management')) {
    addOption(options, {
      id: 'apron-exposure-plan',
      label: 'Manage tax / apron exposure across the next two league years',
      detail: 'Convert tax line, apron posture, and hard-cap risk into concrete legal trade and signing lanes.',
      type: 'structural',
      timeline: 'this_offseason',
      source: 'cap_posture',
    });
  }

  if (scenarios.has('trade_deadline_planning')) {
    addOption(options, {
      id: 'deadline-call-lanes',
      label: 'Pre-wire first-wave trade calls before the deadline',
      detail: 'Use early calls to learn price and seriousness before structures harden.',
      type: 'trade',
      timeline: 'by_trade_deadline',
      source: 'active_scenarios',
    });
  }

  if (scenarios.has('star_extension_supermax')) {
    const player = profile.team_snapshot.star_extension_players.trim() || cornerstones[0] || 'the star';
    addOption(options, {
      id: 'star-extension-line',
      label: `Set the extension line for ${player}`,
      detail: 'Separate player value, market leverage, and timeline fit before negotiation mode.',
      type: 'extension',
      timeline: 'this_offseason',
      source: 'active_scenarios',
    });
  }

  if (scenarios.has('rookie_scale_extension')) {
    const player = profile.team_snapshot.rookie_scale_extension_players.trim() || cornerstones[0] || 'the rookie-scale player';
    addOption(options, {
      id: 'rookie-scale-extension-line',
      label: `Set the rookie-scale extension line for ${player}`,
      detail: 'Frame the extension range, trade alternative, and succession-plan evidence before negotiation mode.',
      type: 'extension',
      timeline: 'this_offseason',
      source: 'active_scenarios',
    });
  }

  if (scenarios.has('draft_prep_board')) {
    addOption(options, {
      id: 'draft-board-construction',
      label: 'Build the draft board around roster timeline and scarcity',
      detail: 'Tie draft prep to the roster thesis instead of generic best-player language.',
      type: 'draft',
      timeline: 'this_offseason',
      source: 'active_scenarios',
    });
  }

  addOption(options, {
    id: 'health-scenario-separation',
    label: 'Separate health-risk scenarios from roster-value scenarios',
    detail: 'Keep medical uncertainty from disguising fundamentally different football decisions.',
    type: 'roster',
    timeline: 'this_season',
    source: 'team_context',
  });
  addOption(options, {
    id: 'owner-check-in-ready',
    label: 'Make the owner check-in recommendation-ready',
    detail: 'Prepare a direct posture recommendation with evidence, downside, and trigger thresholds.',
    type: 'structural',
    timeline: 'next_30_days',
    source: 'team_context',
  });

  return options.slice(0, 10);
}

function inferCapContext(team: OnboardingTeamContext): ContextGraphOnboardingCapContext {
  const cap = recordAt(team.source_team, 'cap_situation');
  const currentStatus = cleanId(cap.current_status)
    || inferCapStatusFromConstraints(team.source_preferences.strategic_posture.constraints)
    || cleanId(team.preferences.onboarding_profile.team_snapshot.cap_posture);
  const payroll = numberOrNull(cap.current_payroll_estimate);
  const hardCapped = cleanId(cap.hard_capped);
  const source = cleanText(cap.source);

  return {
    current_status: currentStatus,
    current_status_label: labelFromId(currentStatus),
    current_payroll_estimate: payroll,
    hard_capped: hardCapped,
    hard_cap_reason: cleanText(cap.hard_cap_reason),
    flexibility_windows: recordsFrom(cap.flexibility_windows).slice(0, 3).map((window) => ({
      season: cleanText(window.season),
      projected_status: clip(cleanText(window.projected_status), 220),
    })).filter((window) => window.season || window.projected_status),
    exceptions_available: arrayOfStrings(cap.exceptions_available).slice(0, 6),
    confidence: cleanId(cap.confidence),
    source,
  };
}

function inferCapStatusFromConstraints(constraints: ContextGraphCodedDetail[]): string {
  const text = constraints.map((constraint) => `${constraint.reason_code} ${constraint.detail}`).join(' ').toLowerCase();
  if (!text) return '';
  if (text.includes('second apron')) return text.includes('below second apron') || text.includes('between') ? 'between_aprons' : 'second_apron';
  if (text.includes('first apron')) return text.includes('below first apron') ? 'below_first_apron' : 'above_first_apron';
  if (text.includes('cap room') || text.includes('cap space')) return 'below_cap';
  if (text.includes('tax')) return 'above_first_apron';
  return '';
}

function buildGraphPatch(
  current: TeamContextPreferenceValues,
  profile: ContextGraphOnboardingProfile,
  now: string,
): TeamContextPreferencePatch {
  const generatedOptions = generatePriorityOptions(profile);
  const onboardingPriorities = buildOnboardingPriorities(profile, generatedOptions);
  const currentNonOnboardingPriorities = current.near_term_priorities
    .filter((priority) => !priority.detail.startsWith(ONBOARDING_PRIORITY_PREFIX))
    .slice(0, Math.max(0, 8 - onboardingPriorities.length));
  const constraints = current.strategic_posture.constraints
    .filter((constraint) => constraint.reason_code !== ONBOARDING_CAP_CONSTRAINT);

  const patch: TeamContextPreferencePatch = {
    onboarding_profile: profile,
    strategic_posture: {
      constraints,
      derived_from: uniqueStrings([
        ...current.strategic_posture.derived_from.filter((source) => source !== 'Gambit onboarding'),
        profile.status === 'not_started' ? '' : 'Gambit onboarding',
      ]),
      last_reviewed: now.slice(0, 10),
    },
    near_term_priorities: [...onboardingPriorities, ...currentNonOnboardingPriorities],
  };

  const timeframe = lifecycleToTimeframe(profile.team_snapshot.lifecycle);
  if (timeframe) {
    patch.strategic_posture = {
      ...patch.strategic_posture,
      timeframe,
      confidence: 'high',
    };
  }
  return patch;
}

function buildOnboardingPriorities(
  profile: ContextGraphOnboardingProfile,
  options: ContextGraphOnboardingPriorityOption[],
): ContextGraphPriority[] {
  const byId = new Map(options.map((option) => [option.id, option]));
  const priorities: ContextGraphPriority[] = [];
  const ninetyDay = profile.strategic_priorities.ninety_day_decision.trim();
  if (ninetyDay) {
    priorities.push({
      priority: 'Most important 90-day decision',
      timeline: 'this_season',
      type: 'structural',
      detail: `${ONBOARDING_PRIORITY_PREFIX} ${clip(ninetyDay, 260)}`,
      confidence: 'high',
    });
  }
  for (const id of profile.strategic_priorities.ranked_priorities.slice(0, 3)) {
    const option = byId.get(id);
    if (!option) continue;
    priorities.push({
      priority: option.label,
      timeline: option.timeline,
      type: option.type,
      detail: `${ONBOARDING_PRIORITY_PREFIX} ${option.detail}`,
      confidence: 'high',
    });
  }
  return priorities;
}

function buildSectionStatuses(
  profile: ContextGraphOnboardingProfile,
  generated: ContextGraphOnboardingPriorityOption[],
  defaults: ContextGraphOnboardingDefaults,
): ContextGraphOnboardingSectionStatus[] {
  const sections: ContextGraphOnboardingSectionId[] = [
    'identity_role',
    'team_snapshot',
    'strategic_priorities',
    'working_style',
    'stakeholders_rituals',
    'data_trust',
  ];
  return sections.map((id) => {
    const required = REQUIRED_SECTIONS.includes(id);
    const skipped = isSectionSkipped(profile, id);
    const missing = skipped ? [] : missingForSection(profile, id, generated, defaults);
    return {
      id,
      label: SECTION_LABELS[id],
      required,
      skipped,
      complete: missing.length === 0 || (!required && skipped),
      missing,
    };
  });
}

function missingForSection(
  profile: ContextGraphOnboardingProfile,
  section: ContextGraphOnboardingSectionId,
  generated: ContextGraphOnboardingPriorityOption[],
  defaults: ContextGraphOnboardingDefaults,
): string[] {
  const missing: string[] = [];
  if (section === 'identity_role') {
    if (!profile.identity.role) missing.push('role');
    if (!profile.identity.years_in_role) missing.push('years in role');
    if (!profile.identity.decision_authority) missing.push('decision authority');
  }
  if (section === 'team_snapshot') {
    if (!profile.team_snapshot.lifecycle) missing.push('competitive lifecycle');
    if (profile.team_snapshot.cornerstones.length === 0) missing.push('1-3 cornerstone players');
    if (profile.team_snapshot.active_scenarios.includes('star_extension_supermax') && !profile.team_snapshot.star_extension_players.trim()) {
      missing.push('star extension player');
    }
    if (profile.team_snapshot.active_scenarios.includes('rookie_scale_extension') && !profile.team_snapshot.rookie_scale_extension_players.trim()) {
      missing.push('rookie-scale extension player');
    }
    if (profile.team_snapshot.active_scenarios.includes('trade_deadline_planning') && !profile.team_snapshot.trade_deadline_window) {
      missing.push('deadline timing');
    }
  }
  if (section === 'strategic_priorities') {
    if (!profile.strategic_priorities.ninety_day_decision.trim()) missing.push('90-day decision');
    if (generated.length > 0 && profile.strategic_priorities.ranked_priorities.length === 0) missing.push('ranked priorities');
    if (profile.strategic_priorities.decision_types.length === 0) missing.push('decision types');
  }
  if (section === 'working_style') {
    if (!(profile.working_style.recommendation_style || defaults.recommendation_style)) missing.push('recommendation style');
    if ((profile.working_style.claim_requirements.length || defaults.claim_requirements.length) === 0) missing.push('claim requirements');
    if (!profile.working_style.risk_posture) missing.push('risk posture');
    if (!profile.working_style.cadence) missing.push('cadence');
    if ((profile.working_style.cadence === 'daily_morning' || profile.working_style.cadence === 'mid_day') && !profile.working_style.briefing_time) {
      missing.push('briefing time');
    }
    if (profile.working_style.channels.length === 0) missing.push('channels');
    if (profile.working_style.channels.includes('slack') && (!profile.working_style.slack_workspace.trim() || !profile.working_style.slack_channel.trim())) {
      missing.push('Slack workspace and channel');
    }
  }
  if (section === 'stakeholders_rituals') {
    if (profile.stakeholders_rituals.rituals.length === 0) missing.push('decision rituals');
    if (!profile.stakeholders_rituals.fire_drill_frequency) missing.push('fire-drill frequency');
  }
  if (section === 'data_trust') {
    if (profile.data_trust.sources.length === 0) missing.push('data sources');
    if (profile.data_trust.integrations.length === 0) missing.push('first integrations');
  }
  return missing;
}

function deriveWorkingStyleDefaults(profile: ContextGraphOnboardingProfile): ContextGraphOnboardingDefaults {
  const role = profile.identity.role;
  const authority = profile.identity.decision_authority;
  const analystRoles = new Set(['capologist', 'analytics', 'strategy']);
  const execRoles = new Set(['president', 'gm', 'assistant_gm', 'owner_governor']);
  const scoutingRoles = new Set(['pro_scouting', 'amateur_scouting']);
  const recommendationStyle = analystRoles.has(role)
    ? 'three_options_tradeoffs'
    : execRoles.has(role) || authority === 'sign_off'
      ? 'single_best_answer'
      : scoutingRoles.has(role)
        ? 'data_only'
        : 'adaptive';
  return {
    recommendation_style: recommendationStyle,
    claim_requirements: ['source_citation', 'confidence_level', 'counter_evidence'],
    timezone: 'local',
  };
}

function normalizeOnboardingProfile(
  raw: unknown,
  team: OnboardingTeamContext,
  now: string,
): ContextGraphOnboardingProfile {
  const base = emptyOnboardingProfile(team);
  const record = isRecord(raw) ? raw : {};
  const merged = deepMerge(base, record) as ContextGraphOnboardingProfile;
  const inferredCapPosture = inferCapContext(team).current_status;
  return {
    ...base,
    ...merged,
    schema_version: 1,
    status: normalizeStatus(merged.status),
    team_id: team.team_id,
    team_name: team.name,
    started_at: nullableString(merged.started_at),
    completed_at: nullableString(merged.completed_at),
    skipped_sections: normalizeSectionIds(merged.skipped_sections),
    identity: {
      role: cleanId(merged.identity?.role),
      role_other: clip(cleanText(merged.identity?.role_other), 120),
      years_in_role: cleanId(merged.identity?.years_in_role),
      decision_authority: cleanId(merged.identity?.decision_authority),
    },
    team_snapshot: {
      lifecycle: cleanId(merged.team_snapshot?.lifecycle),
      secondary_lifecycles: uniqueStrings(arrayOfStrings(merged.team_snapshot?.secondary_lifecycles).map(cleanId))
        .filter((item) => item && item !== cleanId(merged.team_snapshot?.lifecycle))
        .slice(0, 3),
      cap_posture: inferredCapPosture || cleanId(merged.team_snapshot?.cap_posture),
      cornerstones: uniqueStrings(arrayOfStrings(merged.team_snapshot?.cornerstones).map((item) => clip(item, 80))).slice(0, 3),
      active_scenarios: uniqueStrings(arrayOfStrings(merged.team_snapshot?.active_scenarios).map(cleanId)),
      star_extension_players: clip(cleanText(merged.team_snapshot?.star_extension_players), 160),
      rookie_scale_extension_players: clip(cleanText(merged.team_snapshot?.rookie_scale_extension_players), 160),
      trade_deadline_window: cleanId(merged.team_snapshot?.trade_deadline_window),
      other_scenarios: uniqueStrings(arrayOfStrings(merged.team_snapshot?.other_scenarios).map((item) => clip(item, 120))).slice(0, 6),
    },
    strategic_priorities: {
      ninety_day_decision: clip(cleanText(merged.strategic_priorities?.ninety_day_decision), 600),
      ranked_priorities: uniqueStrings(arrayOfStrings(merged.strategic_priorities?.ranked_priorities).map(cleanOptionId)).slice(0, 3),
      decision_types: uniqueStrings(arrayOfStrings(merged.strategic_priorities?.decision_types).map(cleanId)),
      recent_decision_help: clip(cleanText(merged.strategic_priorities?.recent_decision_help), 700),
      other_decision_types: uniqueStrings(arrayOfStrings(merged.strategic_priorities?.other_decision_types).map((item) => clip(item, 120))).slice(0, 6),
    },
    working_style: {
      recommendation_style: cleanId(merged.working_style?.recommendation_style),
      claim_requirements: uniqueStrings(arrayOfStrings(merged.working_style?.claim_requirements).map(cleanId)),
      risk_posture: cleanId(merged.working_style?.risk_posture),
      cadence: cleanId(merged.working_style?.cadence),
      briefing_time: cleanId(merged.working_style?.briefing_time),
      briefing_timezone: clip(cleanText(merged.working_style?.briefing_timezone), 80),
      channels: uniqueStrings(arrayOfStrings(merged.working_style?.channels).map(cleanId)),
      slack_workspace: clip(cleanText(merged.working_style?.slack_workspace), 120),
      slack_channel: clip(cleanText(merged.working_style?.slack_channel), 120),
      other_channels: uniqueStrings(arrayOfStrings(merged.working_style?.other_channels).map((item) => clip(item, 120))).slice(0, 6),
    },
    stakeholders_rituals: {
      skipped: Boolean(merged.stakeholders_rituals?.skipped),
      people: normalizeStakeholders(merged.stakeholders_rituals?.people),
      authority: {
        cap_contracts: clip(cleanText(merged.stakeholders_rituals?.authority?.cap_contracts), 120),
        basketball_ops: clip(cleanText(merged.stakeholders_rituals?.authority?.basketball_ops), 120),
        draft: clip(cleanText(merged.stakeholders_rituals?.authority?.draft), 120),
        coaching_staff: clip(cleanText(merged.stakeholders_rituals?.authority?.coaching_staff), 120),
      },
      rituals: uniqueStrings(arrayOfStrings(merged.stakeholders_rituals?.rituals).map(cleanId)),
      other_rituals: uniqueStrings(arrayOfStrings(merged.stakeholders_rituals?.other_rituals).map((item) => clip(item, 120))).slice(0, 6),
      fire_drill_frequency: cleanId(merged.stakeholders_rituals?.fire_drill_frequency),
    },
    data_trust: {
      skipped: Boolean(merged.data_trust?.skipped),
      trust_panel_acknowledged: Boolean(merged.data_trust?.trust_panel_acknowledged),
      sources: uniqueStrings(arrayOfStrings(merged.data_trust?.sources).map(cleanId)),
      other_sources: uniqueStrings(arrayOfStrings(merged.data_trust?.other_sources).map((item) => clip(item, 120))).slice(0, 8),
      off_limits: uniqueStrings(arrayOfStrings(merged.data_trust?.off_limits).map(cleanId)),
      off_limits_people: clip(cleanText(merged.data_trust?.off_limits_people), 240),
      off_limits_topics: clip(cleanText(merged.data_trust?.off_limits_topics), 240),
      integrations: uniqueStrings(arrayOfStrings(merged.data_trust?.integrations).map(cleanId)),
      other_integrations: uniqueStrings(arrayOfStrings(merged.data_trust?.other_integrations).map((item) => clip(item, 120))).slice(0, 8),
    },
    updated_at: nullableString(merged.updated_at) ?? now,
  };
}

function emptyOnboardingProfile(team: Pick<TeamContextPreferences, 'team_id' | 'name'>): ContextGraphOnboardingProfile {
  return {
    schema_version: 1,
    status: 'not_started',
    team_id: team.team_id,
    team_name: team.name,
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

async function getOnboardingTeam(
  teamIdInput: string,
  options: TeamPreferenceStoreOptions,
): Promise<EffectiveTeamContext> {
  const teamId = String(teamIdInput || '').trim().toUpperCase();
  return getEffectiveTeamContext(teamId, options);
}

function normalizeStakeholders(raw: unknown): ContextGraphOnboardingProfile['stakeholders_rituals']['people'] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isRecord).slice(0, 10).map((person, index) => ({
    id: clip(cleanText(person.id) || `stakeholder-${index + 1}`, 80),
    name: clip(cleanText(person.name), 120),
    role: cleanId(person.role),
    decision_areas: uniqueStrings(arrayOfStrings(person.decision_areas).map(cleanId)),
  })).filter((person) => person.name);
}

function isSectionSkipped(profile: ContextGraphOnboardingProfile, section: ContextGraphOnboardingSectionId): boolean {
  return profile.skipped_sections.includes(section)
    || (section === 'stakeholders_rituals' && profile.stakeholders_rituals.skipped)
    || (section === 'data_trust' && profile.data_trust.skipped);
}

function lifecycleToTimeframe(lifecycle: string): string {
  if (lifecycle === 'title_contender') return 'contend_now';
  if (lifecycle === 'playoff_hopeful') return 'contend_soon';
  if (lifecycle === 'retooling') return 'retool';
  if (lifecycle === 'rebuilding') return 'rebuild';
  if (lifecycle === 'tanking_asset_accumulation') return 'tank';
  if (lifecycle === 'complicated') return 'purgatory';
  return '';
}

function normalizeStatus(status: unknown): ContextGraphOnboardingProfile['status'] {
  if (status === 'completed' || status === 'in_progress') return status;
  return 'not_started';
}

function normalizeSectionIds(raw: unknown): ContextGraphOnboardingSectionId[] {
  const allowed = new Set<ContextGraphOnboardingSectionId>([
    'identity_role',
    'team_snapshot',
    'strategic_priorities',
    'working_style',
    'stakeholders_rituals',
    'data_trust',
  ]);
  return arrayOfStrings(raw).filter((item): item is ContextGraphOnboardingSectionId => allowed.has(item as ContextGraphOnboardingSectionId));
}

function addOption(options: ContextGraphOnboardingPriorityOption[], option: ContextGraphOnboardingPriorityOption): void {
  if (!options.some((existing) => existing.id === option.id)) options.push(option);
}

function labelFromId(id: string): string {
  return id.replace(/_/g, ' ').trim();
}

function cleanId(value: unknown): string {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function cleanOptionId(value: unknown): string {
  return cleanText(value).toLowerCase().replace(/_/g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
}

function cleanText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function arrayOfStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(cleanText).filter(Boolean);
}

function recordsFrom(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord);
}

function recordAt(root: unknown, dottedPath: string): Record<string, unknown> {
  let current = root;
  for (const part of dottedPath.split('.')) {
    if (!isRecord(current)) return {};
    current = current[part];
  }
  return isRecord(current) ? current : {};
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function nullableString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
}

function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max).trim() : value;
}

function uniqueStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const item of items) {
    const clean = item.trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    values.push(clean);
  }
  return values;
}

function deepMerge(base: unknown, patch: unknown): unknown {
  if (Array.isArray(patch)) return patch;
  if (!isRecord(base) || !isRecord(patch)) return patch;
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    merged[key] = deepMerge(merged[key], value);
  }
  return merged;
}

function nowIso(options: TeamPreferenceStoreOptions): string {
  return (options.now ?? (() => new Date()))().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
