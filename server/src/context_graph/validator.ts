import {
  type EdgeGraph,
  type TeamDocument,
  TEAM_ID_SET,
  VOCAB,
  type ValidationMessage,
  type ValidationReport,
} from './schema.js';

const FOCUSED_TRADE_MARKET_INTEL_TEAM_IDS = new Set(['NYG', 'NYJ', 'TB', 'CIN', 'IND', 'GB', 'BAL', 'WAS', 'LV', 'PHI', 'ARI']);
const TRADE_MARKET_GENERIC_PHRASES = [
  'internal demo synthesis',
  'verify before external use',
  'premium-position decisions',
];

export function validateTeamDocuments(teams: TeamDocument[]): ValidationMessage[] {
  return teams.flatMap((team) => validateTeamDocument(team));
}

export function validateTeamDocument(team: TeamDocument): ValidationMessage[] {
  const validator = new TeamSchemaValidator(team);
  return validator.validate();
}

export function validateCrossTeamConsistency(teams: TeamDocument[], graph: EdgeGraph): {
  errors: ValidationMessage[];
  warnings: ValidationMessage[];
} {
  const errors: ValidationMessage[] = [];
  const warnings: ValidationMessage[] = [];
  const teamIds = new Set(teams.map((team) => String(team.data.team_id ?? team.teamId)));
  const teamById = new Map(teams.map((team) => [String(team.data.team_id ?? team.teamId), team]));

  for (const edge of graph.pickOwnership.filter((pick) => pick.source_path.includes('draft_picks_owed') && !pick.conditional)) {
    if (!teamIds.has(edge.owning_team)) {
      errors.push(crossMessage('error', teamById.get(edge.owed_team), edge.source_path, `Pick owed to ${edge.owning_team}, but that is not a known standard team_id in the loaded teams.`));
      continue;
    }
    const reciprocal = graph.pickOwnership.some((candidate) => (
      candidate.source_path.includes('draft_picks_owned')
      && candidate.owning_team === edge.owning_team
      && candidate.owed_team === edge.owed_team
      && candidate.year === edge.year
      && candidate.round === edge.round
      && candidate.protections === edge.protections
    ));
    if (!reciprocal) {
      errors.push(crossMessage(
        'error',
        teamById.get(edge.owed_team),
        edge.source_path,
        `Missing reciprocal draft_picks_owned entry: ${edge.owed_team} owes ${edge.year} round ${edge.round} pick to ${edge.owning_team}.`,
      ));
    }
  }

  for (const rivalry of graph.rivalries) {
    if (!teamIds.has(rivalry.team_b)) {
      errors.push(crossMessage('error', teamById.get(rivalry.team_a), rivalry.source_path, `Rivalry points to unknown team_id ${rivalry.team_b}.`));
      continue;
    }
    if (!rivalry.requires_reciprocal) continue;
    const reciprocal = graph.rivalries.some((candidate) => (
      candidate.team_a === rivalry.team_b && candidate.team_b === rivalry.team_a
    ));
    if (!reciprocal) {
      errors.push(crossMessage(
        'error',
        teamById.get(rivalry.team_a),
        rivalry.source_path,
        `Missing reciprocal rivalry: ${rivalry.team_a} lists ${rivalry.team_b}, but ${rivalry.team_b} does not list ${rivalry.team_a}.`,
      ));
    }
  }

  const playerTeams = new Map<string, string[]>();
  for (const edge of graph.playerTeams) {
    const list = playerTeams.get(edge.player_id) ?? [];
    list.push(edge.team_id);
    playerTeams.set(edge.player_id, list);
  }
  for (const [playerId, owningTeams] of playerTeams) {
    const uniqueTeams = [...new Set(owningTeams)];
    if (uniqueTeams.length !== 1) {
      errors.push({
        severity: 'error',
        file: '<cross-team>',
        path: 'roster',
        message: `player_id ${playerId} appears on multiple rosters: ${uniqueTeams.join(', ')}.`,
      });
    }
  }

  const rosterByTeam = new Map<string, Set<string>>();
  for (const edge of graph.playerTeams) {
    const roster = rosterByTeam.get(edge.team_id) ?? new Set<string>();
    roster.add(edge.player_id);
    rosterByTeam.set(edge.team_id, roster);
  }
  for (const edge of graph.pendingFreeAgents) {
    if (!rosterByTeam.get(edge.team_id)?.has(edge.player_id)) {
      errors.push(crossMessage(
        'error',
        teamById.get(edge.team_id),
        edge.source_path.replace(`${edge.team_id}.`, ''),
        `Pending free agent ${edge.player_id} is not present on ${edge.team_id}'s current roster.`,
      ));
    }
  }

  const untouchables = graph.playerTeams.filter((edge) => {
    const team = teamById.get(edge.team_id);
    const player = recordsAt(team?.data ?? {}, 'roster').find((candidate) => candidate.player_id === edge.player_id);
    return getAt(player ?? {}, 'movement_constraints.status') === 'untouchable';
  });
  for (const player of untouchables) {
    const teamsWithPlayer = [...new Set(graph.playerTeams.filter((edge) => edge.player_id === player.player_id).map((edge) => edge.team_id))];
    if (teamsWithPlayer.length > 1) {
      errors.push(crossMessage(
        'error',
        teamById.get(player.team_id),
        player.source_path.replace(`${player.team_id}.`, ''),
        `Untouchable player ${player.player_id} appears on another roster (${teamsWithPlayer.join(', ')}), which contradicts current-team ownership.`,
      ));
    }
  }

  return { errors, warnings };
}

export function createValidationReport(schemaErrors: ValidationMessage[], crossTeamErrors: ValidationMessage[], crossTeamWarnings: ValidationMessage[]): ValidationReport {
  const totalErrors = schemaErrors.length + crossTeamErrors.length;
  const totalWarnings = crossTeamWarnings.length;
  return {
    schemaErrors,
    crossTeamErrors,
    crossTeamWarnings,
    totalErrors,
    totalWarnings,
    passed: totalErrors === 0 && totalWarnings === 0,
  };
}

export function renderValidationReport(report: ValidationReport): string {
  const lines: string[] = [
    '# Gambit NFL Intel Validation Report',
    '',
    '## Summary',
    '',
    `- Status: ${report.passed ? 'PASS' : 'FAIL'}`,
    `- Total errors: ${report.totalErrors}`,
    `- Total warnings: ${report.totalWarnings}`,
    `- Per-file schema errors: ${report.schemaErrors.length}`,
    `- Cross-team consistency errors: ${report.crossTeamErrors.length}`,
    `- Cross-team consistency warnings: ${report.crossTeamWarnings.length}`,
    '',
    '## Per-File Schema Errors',
    '',
    ...renderMessages(report.schemaErrors, 'No per-file schema errors.'),
    '',
    '## Cross-Team Consistency Errors',
    '',
    ...renderMessages(report.crossTeamErrors, 'No cross-team consistency errors.'),
    '',
    '## Cross-Team Consistency Warnings',
    '',
    ...renderMessages(report.crossTeamWarnings, 'No cross-team consistency warnings.'),
    '',
    '## Notes',
    '',
    '- Validation enforces context graph schema v2.2.2; repeatable source semantics are represented explicitly.',
    '- Underscore-prefixed source files and non-standard team filenames are ignored by the loader.',
    '- Relationship completeness checks for trades, rivalries, and personnel reverse links live in context-graph:audit unless a row explicitly requires reciprocity.',
    '',
  ];
  return `${lines.join('\n')}`;
}

function renderMessages(messages: ValidationMessage[], emptyText: string): string[] {
  if (messages.length === 0) return [`- ${emptyText}`];
  return messages.map((message) => {
    const location = message.line === undefined
      ? `${message.file} ${message.path}`
      : `${message.file}:${message.line} ${message.path}`;
    return `- ${location} - ${message.message}`;
  });
}

class TeamSchemaValidator {
  private readonly errors: ValidationMessage[] = [];

  constructor(private readonly team: TeamDocument) {}

  validate(): ValidationMessage[] {
    this.errors.push(...this.team.parseErrors);
    if (this.team.parseErrors.length > 0) return this.errors;

    this.requiredString('team_id');
    this.enumValue('team_id', [...TEAM_ID_SET], false);
    this.requiredDate('as_of_date');
    this.requiredDate('last_updated');
    this.validateIdentity();
    this.validateOwnership();
    this.validateFrontOffice();
    this.validateStrategicPosture();
    this.validateCapSituation();
    this.validateTradeDna();
    this.validateTradeMarketIntel();
    this.validateCulturalSignals();
    this.validateRoster();
    this.validatePendingFreeAgents();
    this.validateKnownTargets();
    this.validateNearTermPriorities();
    this.validateKeyAssets();
    this.validateTeamRelationships();
    this.validateGLeagueAndStash();
    this.requiredArray('sources_used');
    this.requiredArray('fields_marked_unknown');
    this.requiredArray('vocabulary_flags');
    return this.errors;
  }

  private validateIdentity(): void {
    this.requiredRecord('identity');
    this.requiredString('identity.name');
    this.enumValue('identity.conference', VOCAB.conference, false);
    this.enumValue('identity.division', VOCAB.division, false);
    this.enumValue('identity.market_tier', VOCAB.marketTier, false);
    this.requiredString('identity.market_tier_rationale');
  }

  private validateOwnership(): void {
    this.requiredRecord('ownership');
    this.requiredRecord('ownership.primary_owner');
    this.requiredString('ownership.primary_owner.name');
    this.enumValue('ownership.primary_owner.type', VOCAB.ownerType, false);
    this.requiredNumber('ownership.primary_owner.tenure_years');
    this.requiredUrlOrUnknown('ownership.primary_owner.source');
    this.enumValue('ownership.primary_owner.confidence', VOCAB.confidence, false);
    this.enumValue('ownership.spending_posture', VOCAB.spendingPosture, false);
    this.requiredArray('ownership.spending_posture_evidence');
  }

  private validateFrontOffice(): void {
    this.requiredRecord('front_office');
    for (const role of ['president_basketball_ops', 'general_manager', 'head_coach']) {
      const base = `front_office.${role}`;
      this.requiredRecord(base);
      this.requiredString(`${base}.name`);
      this.enumValue(`${base}.confidence`, VOCAB.confidence, false);
      this.requiredUrlOrUnknown(`${base}.source`);
    }
    this.requiredArray('front_office.assistant_coaches_notable');
    this.requiredArray('front_office.notable_advisors_or_consultants');
  }

  private validateStrategicPosture(): void {
    this.requiredRecord('strategic_posture');
    this.enumValue('strategic_posture.timeframe', VOCAB.postureTimeframe, false);
    this.enumValue('strategic_posture.confidence', VOCAB.confidence, false);
    this.requiredArray('strategic_posture.derived_from');
    this.requiredArray('strategic_posture.constraints');
    for (const [index, constraint] of this.records('strategic_posture.constraints').entries()) {
      this.enumValue(`strategic_posture.constraints[${index}].reason_code`, VOCAB.postureConstraintReason, false);
      this.enumValue(`strategic_posture.constraints[${index}].weight`, VOCAB.confidence, false);
      this.requiredString(`strategic_posture.constraints[${index}].detail`);
    }
    this.requiredArray('strategic_posture.trigger_events');
    this.requiredDate('strategic_posture.last_reviewed');
  }

  private validateCapSituation(): void {
    this.requiredRecord('cap_situation');
    this.enumValue('cap_situation.current_status', VOCAB.capCurrentStatus, false);
    this.requiredNumberOrUnknown('cap_situation.current_payroll_estimate');
    this.enumValue('cap_situation.hard_capped', VOCAB.hardCapped, false);
    this.requiredString('cap_situation.hard_cap_reason');
    if (this.value('cap_situation.hard_capped') === 'yes') {
      const reason = this.value('cap_situation.hard_cap_reason');
      if (reason === 'none' || reason === 'unknown' || reason === '') {
        this.add('cap_situation.hard_cap_reason', 'hard_capped: yes requires hard_cap_reason to be present and not "none".');
      }
    }
    this.requiredArray('cap_situation.flexibility_windows');
    this.requiredArray('cap_situation.exceptions_available');
    this.requiredUrlOrUnknown('cap_situation.source');
    this.requiredArray('cap_situation.source_fallbacks_used');
    this.enumValue('cap_situation.confidence', VOCAB.confidence, false);
  }

  private validateTradeDna(): void {
    this.requiredRecord('trade_dna');
    this.requiredArray('trade_dna.frequent_partners');
    for (const [index] of this.values('trade_dna.frequent_partners').entries()) {
      this.enumValue(`trade_dna.frequent_partners[${index}]`, [...TEAM_ID_SET], false);
    }
    this.requiredArray('trade_dna.preferred_deal_archetypes');
    this.requiredArray('trade_dna.recent_significant_trades');
    for (const [index] of this.records('trade_dna.recent_significant_trades').entries()) {
      this.requiredDate(`trade_dna.recent_significant_trades[${index}].date`);
      this.requiredString(`trade_dna.recent_significant_trades[${index}].summary`);
      if (this.value(`trade_dna.recent_significant_trades[${index}].counterparties`) !== undefined) {
        this.requiredArray(`trade_dna.recent_significant_trades[${index}].counterparties`);
        for (const [counterpartyIndex] of this.values(`trade_dna.recent_significant_trades[${index}].counterparties`).entries()) {
          this.enumValue(`trade_dna.recent_significant_trades[${index}].counterparties[${counterpartyIndex}]`, [...TEAM_ID_SET], false);
        }
      }
    }
    this.enumValue('trade_dna.confidence', VOCAB.confidence, false);
  }

  private validateTradeMarketIntel(): void {
    const rawIntel = this.value('trade_market_intel');
    const focused = FOCUSED_TRADE_MARKET_INTEL_TEAM_IDS.has(this.team.teamId);
    if (rawIntel === undefined) {
      if (focused) this.add('trade_market_intel', 'Focused NFL trade-demo teams require trade_market_intel.');
      return;
    }
    if (!isRecord(rawIntel)) {
      this.add('trade_market_intel', `Expected object, got ${typeName(rawIntel)}.`);
      return;
    }

    this.enumValue('trade_market_intel.seller_posture.value', VOCAB.sellerPosture, false);
    this.enumValue('trade_market_intel.seller_posture.confidence', VOCAB.confidence, false);
    this.requiredNonGenericString('trade_market_intel.seller_posture.evidence');
    this.requiredUrl('trade_market_intel.seller_posture.source');

    this.requiredNonEmptyArray('trade_market_intel.position_group_stance');
    for (const [index] of this.records('trade_market_intel.position_group_stance').entries()) {
      const base = `trade_market_intel.position_group_stance[${index}]`;
      this.requiredNonGenericString(`${base}.group`);
      this.requiredNonGenericString(`${base}.stance`);
      this.requiredArray(`${base}.core_players`);
      this.requiredArray(`${base}.movable_players`);
      this.requiredNonGenericString(`${base}.seller_depth_notes`);
      this.requiredNonGenericString(`${base}.sell_threshold`);
      this.enumValue(`${base}.confidence`, VOCAB.confidence, false);
      this.requiredUrl(`${base}.source`);
    }

    this.requiredRecord('trade_market_intel.market_preferences');
    this.requiredNonEmptyArray('trade_market_intel.market_preferences.desired_return_types');
    this.requiredArray('trade_market_intel.market_preferences.avoided_deal_types');
    this.requiredNonGenericString('trade_market_intel.market_preferences.division_rivalry_friction');
    this.enumValue('trade_market_intel.market_preferences.confidence', VOCAB.confidence, false);
    this.requiredUrl('trade_market_intel.market_preferences.source');

    this.requiredNonEmptyArray('trade_market_intel.trade_triggers');
    for (const [index] of this.records('trade_market_intel.trade_triggers').entries()) {
      const base = `trade_market_intel.trade_triggers[${index}]`;
      this.requiredNonGenericString(`${base}.trigger`);
      this.requiredNonGenericString(`${base}.implication`);
      this.enumValue(`${base}.confidence`, VOCAB.confidence, false);
      this.requiredUrl(`${base}.source`);
    }

    this.requiredNonEmptyArray('trade_market_intel.availability_validation');
    for (const [index] of this.records('trade_market_intel.availability_validation').entries()) {
      const base = `trade_market_intel.availability_validation[${index}]`;
      this.requiredNonGenericString(`${base}.check`);
      this.requiredNonGenericString(`${base}.owner`);
      this.requiredUrl(`${base}.source`);
    }

    this.requiredNonEmptyArray('trade_market_intel.no_trade_guardrails');
    for (const [index] of this.records('trade_market_intel.no_trade_guardrails').entries()) {
      const base = `trade_market_intel.no_trade_guardrails[${index}]`;
      this.requiredNonGenericString(`${base}.guardrail`);
      this.enumValue(`${base}.confidence`, VOCAB.confidence, false);
      this.requiredUrl(`${base}.source`);
    }

    const intelText = JSON.stringify(rawIntel).toLowerCase();
    for (const phrase of TRADE_MARKET_GENERIC_PHRASES) {
      if (intelText.includes(phrase)) {
        this.add('trade_market_intel', `Trade-facing seller Intel must not use generic template phrase "${phrase}".`);
      }
    }

    if (focused && this.team.teamId === 'NYG') {
      const groups = this.values('trade_market_intel.position_group_stance').map((stance) => (
        isRecord(stance) ? String(stance.group ?? '').toUpperCase() : ''
      ));
      if (!groups.includes('OL')) this.add('trade_market_intel.position_group_stance', 'NYG trade_market_intel requires an OL salary-out tradeoff stance.');
      if (!groups.includes('DB')) this.add('trade_market_intel.position_group_stance', 'NYG trade_market_intel requires a DB salary-out tradeoff stance.');
    } else if (focused) {
      const hasInteriorFront = this.values('trade_market_intel.position_group_stance').some((stance) => {
        const group = isRecord(stance) ? String(stance.group ?? '') : '';
        return /\b(DL|DT|interior_front|defensive_line)\b/i.test(group);
      });
      if (!hasInteriorFront) this.add('trade_market_intel.position_group_stance', 'Focused seller teams require a DL/interior-front stance.');
    }
  }

  private validateCulturalSignals(): void {
    this.requiredRecord('cultural_signals');
    this.enumValue('cultural_signals.stability.value', VOCAB.stability, false);
    this.enumValue('cultural_signals.player_friendly.value', VOCAB.playerFriendly, false);
    this.enumValue('cultural_signals.analytics_orientation.value', VOCAB.analyticsOrientation, false);
    this.enumValue('cultural_signals.risk_tolerance.value', VOCAB.riskTolerance, false);
    this.requiredArray('cultural_signals.notable_traits');
    for (const [index] of this.values('cultural_signals.notable_traits').entries()) {
      this.enumValue(`cultural_signals.notable_traits[${index}]`, VOCAB.notableTraits, false);
    }
    this.requiredString('cultural_signals.rationale');
    this.enumValue('cultural_signals.confidence', VOCAB.confidence, false);
  }

  private validateRoster(): void {
    this.requiredArray('roster');
    if (this.values('roster').length === 0) {
      this.add('roster', 'roster must be a non-empty list.');
    }
    for (const [index, player] of this.records('roster').entries()) {
      const base = `roster[${index}]`;
      this.requiredString(`${base}.player_id`);
      this.requiredString(`${base}.name`);
      this.enumValue(`${base}.contract_type`, VOCAB.contractType, false);
      this.enumValue(`${base}.availability_status`, VOCAB.availabilityStatus, false);
      this.enumValue(`${base}.archetype.physical_position`, VOCAB.physicalPosition, false);
      this.enumValue(`${base}.archetype.offensive_role.primary`, VOCAB.offensiveRole, false);
      this.requiredArray(`${base}.archetype.offensive_role.secondary`);
      for (const [traitIndex] of this.values(`${base}.archetype.offensive_role.secondary`).entries()) {
        this.enumValue(`${base}.archetype.offensive_role.secondary[${traitIndex}]`, VOCAB.offensiveRole, false);
      }
      this.enumValue(`${base}.archetype.defensive_role`, VOCAB.defensiveRole, false);
      this.enumValue(`${base}.archetype.shooting_profile`, VOCAB.shootingProfile, false);
      this.requiredArray(`${base}.archetype.special_traits`);
      for (const [traitIndex] of this.values(`${base}.archetype.special_traits`).entries()) {
        this.enumValue(`${base}.archetype.special_traits[${traitIndex}]`, VOCAB.specialTraits, false);
      }
      this.enumValue(`${base}.tier`, VOCAB.playerTier, false);
      this.enumValue(`${base}.trajectory`, VOCAB.trajectory, false);
      this.validateContract(base);
      this.validateMovementConstraints(base, player);
      this.enumValue(`${base}.team_relationship.homegrown`, VOCAB.homegrown, false);
      this.enumValue(`${base}.team_relationship.contract_leverage.value`, VOCAB.contractLeverage, false);
      this.enumValue(`${base}.confidence`, VOCAB.confidence, false);
      this.requiredUrlOrUnknown(`${base}.source`);
    }
  }

  private validateContract(base: string): void {
    this.requiredRecord(`${base}.contract`);
    this.requiredNumberOrUnknown(`${base}.contract.years_remaining`);
    this.enumValue(`${base}.contract.no_trade_clause`, VOCAB.noTradeClause, false);
    this.validateTradeKicker(`${base}.contract.trade_kicker`);
    this.validateOption(`${base}.contract.player_option`);
    this.validateOption(`${base}.contract.team_option`);
    this.enumValue(`${base}.contract.bird_rights`, VOCAB.birdRights, false);
    this.validateContractThrough(`${base}.contract.contract_through`);
    this.requiredUrlOrUnknown(`${base}.contract.source`);
  }

  private validateMovementConstraints(base: string, player: Record<string, unknown>): void {
    const statusPath = `${base}.movement_constraints.status`;
    this.enumValue(statusPath, VOCAB.movementStatus, false);
    const status = this.value(statusPath);
    const reasons = this.records(`${base}.movement_constraints.reasons`);
    const falsification = this.values(`${base}.movement_constraints.falsification_conditions`);

    if (status === 'untouchable') {
      if (reasons.length === 0) this.add(`${base}.movement_constraints.reasons`, 'untouchable requires at least one reason.');
      if (falsification.length === 0) this.add(`${base}.movement_constraints.falsification_conditions`, 'untouchable requires at least one falsification condition.');
      this.validateReasonCodes(base, VOCAB.movementReason);
    } else if (status === 'available' || status === 'shopped' || status === 'actively_traded') {
      if (reasons.length === 0) this.add(`${base}.movement_constraints.reasons`, `${status} requires at least one reason.`);
      if (falsification.length === 0) this.add(`${base}.movement_constraints.falsification_conditions`, `${status} requires at least one falsification condition.`);
      this.enumValue(`${base}.movement_constraints.signal_strength`, VOCAB.signalStrength, false);
      this.validateReasonCodes(base, VOCAB.movementReason);
    } else if (status === 'unlikely' || status === 'unavailable') {
      this.validateReasonCodes(base, VOCAB.movementReason);
      if (getAt(player, 'movement_constraints.signal_strength') !== undefined) {
        this.enumValue(`${base}.movement_constraints.signal_strength`, VOCAB.signalStrength, false);
      }
    }
  }

  private validateReasonCodes(base: string, allowed: readonly string[]): void {
    for (const [reasonIndex] of this.records(`${base}.movement_constraints.reasons`).entries()) {
      this.enumValue(`${base}.movement_constraints.reasons[${reasonIndex}].reason_code`, allowed, false);
      this.enumValue(`${base}.movement_constraints.reasons[${reasonIndex}].weight`, VOCAB.confidence, false);
    }
  }

  private validatePendingFreeAgents(): void {
    this.requiredArray('pending_free_agents');
    for (const [index] of this.records('pending_free_agents').entries()) {
      const base = `pending_free_agents[${index}]`;
      this.requiredString(`${base}.player_id`);
      this.requiredString(`${base}.name`);
      this.enumValue(`${base}.type`, VOCAB.freeAgentType, false);
      this.enumValue(`${base}.bird_rights_status`, VOCAB.birdRights, false);
      this.enumValue(`${base}.expected_market`, VOCAB.expectedMarket, false);
      this.requiredUrlOrUnknown(`${base}.source`);
    }
  }

  private validateKnownTargets(): void {
    this.requiredArray('known_target_history');
    for (const [index] of this.records('known_target_history').entries()) {
      const base = `known_target_history[${index}]`;
      this.requiredString(`${base}.target`);
      this.requiredNumber(`${base}.year`);
      this.enumValue(`${base}.outcome`, VOCAB.targetOutcome, false);
      this.requiredString(`${base}.detail`);
      this.requiredUrlOrUnknown(`${base}.source`);
    }
  }

  private validateNearTermPriorities(): void {
    this.requiredArray('near_term_priorities');
    for (const [index] of this.records('near_term_priorities').entries()) {
      const base = `near_term_priorities[${index}]`;
      this.requiredString(`${base}.priority`);
      this.enumValue(`${base}.timeline`, VOCAB.priorityTimeline, false);
      this.enumValue(`${base}.type`, VOCAB.priorityType, false);
      this.requiredString(`${base}.detail`);
      this.enumValue(`${base}.confidence`, VOCAB.confidence, false);
    }
  }

  private validateKeyAssets(): void {
    this.requiredRecord('key_assets');
    this.requiredArray('key_assets.draft_picks_owned');
    for (const [index] of this.records('key_assets.draft_picks_owned').entries()) {
      this.validatePick(`key_assets.draft_picks_owned[${index}]`, false);
    }
    this.requiredArray('key_assets.draft_picks_owed');
    for (const [index] of this.records('key_assets.draft_picks_owed').entries()) {
      this.validatePick(`key_assets.draft_picks_owed[${index}]`, true);
    }
    this.requiredArray('key_assets.trade_exceptions');
  }

  private validatePick(base: string, owed: boolean): void {
    this.requiredNumber(`${base}.year`);
    this.enumValue(`${base}.round`, [1, 2, 3, 4, 5, 6, 7], false);
    this.requiredString(`${base}.protections`);
    this.requiredUrlOrUnknown(`${base}.source`);
    if (!owed) return;
    const toTeam = this.value(`${base}.to_team`);
    const toTeamOptions = this.value(`${base}.to_team_options`);
    if (toTeam !== undefined && toTeam !== 'unknown') {
      this.enumValue(`${base}.to_team`, [...TEAM_ID_SET], false);
      return;
    }
    if (Array.isArray(toTeamOptions) && toTeamOptions.length > 0) {
      for (const [optionIndex] of toTeamOptions.entries()) {
        this.enumValue(`${base}.to_team_options[${optionIndex}]`, [...TEAM_ID_SET, 'unknown'], false);
      }
      this.requiredString(`${base}.condition`);
      return;
    }
    this.add(`${base}.to_team`, 'Owed picks require a standard to_team or structured to_team_options with condition.');
  }

  private validateTeamRelationships(): void {
    this.requiredRecord('team_team_relationships');
    this.requiredArray('team_team_relationships.rivalries');
    for (const [index] of this.records('team_team_relationships.rivalries').entries()) {
      const base = `team_team_relationships.rivalries[${index}]`;
      this.enumValue(`${base}.team_id`, [...TEAM_ID_SET], false);
      this.enumValue(`${base}.type`, VOCAB.rivalryType, false);
      this.requiredString(`${base}.basis`);
      if (this.value(`${base}.requires_reciprocal`) !== undefined && typeof this.value(`${base}.requires_reciprocal`) !== 'boolean') {
        this.add(`${base}.requires_reciprocal`, 'Expected boolean when present.');
      }
    }
    this.requiredArray('team_team_relationships.notable_personnel_connections');
    for (const [index] of this.records('team_team_relationships.notable_personnel_connections').entries()) {
      const base = `team_team_relationships.notable_personnel_connections[${index}]`;
      this.requiredString(`${base}.person`);
      this.requiredString(`${base}.connected_team`);
      this.requiredString(`${base}.connection_type`);
      this.requiredString(`${base}.detail`);
    }
  }

  private validateGLeagueAndStash(): void {
    this.requiredRecord('g_league_and_stash');
    this.requiredString('g_league_and_stash.affiliate_team');
    this.requiredArray('g_league_and_stash.notable_affiliate_players');
    this.requiredArray('g_league_and_stash.international_stash');
    this.requiredRecord('narrative_summary');
    this.requiredString('narrative_summary.one_paragraph');
    this.requiredArray('narrative_summary.three_things_to_watch');
  }

  private validateTradeKicker(pathName: string): void {
    const value = this.value(pathName);
    if (value === undefined) {
      this.add(pathName, 'Missing required field.');
      return;
    }
    if (typeof value === 'number') {
      if (value < 0 || value > 0.15) {
        this.add(pathName, 'trade_kicker must be a decimal between 0.00 and 0.15, "none", a descriptive string, or "unknown".');
      }
      return;
    }
    if (typeof value === 'string') return;
    this.add(pathName, `Expected trade_kicker decimal/string, got ${typeName(value)}.`);
  }

  private validateOption(pathName: string): void {
    const value = this.value(pathName);
    if (value === undefined) {
      this.add(pathName, 'Missing required field.');
      return;
    }
    if (value === 'none' || value === 'option_pending' || value === 'unknown') return;
    if (isYear(value)) return;
    this.add(pathName, 'Expected year YYYY, "none", option_pending, or unknown.');
  }

  private validateContractThrough(pathName: string): void {
    const value = this.value(pathName);
    if (value === undefined) {
      this.add(pathName, 'Missing required field.');
      return;
    }
    if (['expired_pending_decision', 'option_pending', 'uncertain'].includes(String(value))) return;
    if (isYear(value)) return;
    this.add(pathName, 'Expected year YYYY, expired_pending_decision, option_pending, or uncertain.');
  }

  private enumValue(pathName: string, allowed: readonly unknown[], allowUnknown: boolean): void {
    const value = this.value(pathName);
    if (value === undefined) {
      this.add(pathName, 'Missing required controlled-vocabulary field.');
      return;
    }
    if (allowUnknown && value === 'unknown') return;
    if (!allowed.includes(value)) {
      this.add(pathName, `Invalid vocabulary value ${JSON.stringify(value)}. Expected one of: ${allowed.map((item) => JSON.stringify(item)).join(', ')}.`);
    }
  }

  private requiredRecord(pathName: string): void {
    const value = this.value(pathName);
    if (!isRecord(value)) this.add(pathName, `Expected object, got ${typeName(value)}.`);
  }

  private requiredArray(pathName: string): void {
    const value = this.value(pathName);
    if (!Array.isArray(value)) this.add(pathName, `Expected array, got ${typeName(value)}.`);
  }

  private requiredString(pathName: string): void {
    const value = this.value(pathName);
    if (typeof value !== 'string' || value.trim() === '') {
      this.add(pathName, `Expected non-empty string, got ${typeName(value)}.`);
    }
  }

  private requiredNonGenericString(pathName: string): void {
    this.requiredString(pathName);
    const value = this.value(pathName);
    if (typeof value !== 'string') return;
    const lower = value.toLowerCase();
    for (const phrase of TRADE_MARKET_GENERIC_PHRASES) {
      if (lower.includes(phrase)) {
        this.add(pathName, `Trade-facing seller Intel must not use generic template phrase "${phrase}".`);
      }
    }
  }

  private requiredNumber(pathName: string): void {
    const value = this.value(pathName);
    if (typeof value !== 'number' || Number.isNaN(value)) {
      this.add(pathName, `Expected number, got ${typeName(value)}.`);
    }
  }

  private requiredNumberOrUnknown(pathName: string): void {
    const value = this.value(pathName);
    if (value === 'unknown' || value === null) return;
    if (typeof value !== 'number' || Number.isNaN(value)) {
      this.add(pathName, `Expected number or "unknown", got ${typeName(value)}.`);
    }
  }

  private requiredDate(pathName: string): void {
    const value = this.value(pathName);
    if (!isDateLike(value)) {
      this.add(pathName, 'Expected date in YYYY, YYYY-MM, or YYYY-MM-DD format.');
    }
  }

  private requiredUrlOrUnknown(pathName: string): void {
    const value = this.value(pathName);
    if (value === 'unknown') return;
    if (typeof value !== 'string' || !/^https?:\/\//.test(value)) {
      this.add(pathName, `Expected URL string or "unknown", got ${typeName(value)}.`);
    }
  }

  private requiredUrl(pathName: string): void {
    const value = this.value(pathName);
    if (typeof value !== 'string' || !/^https?:\/\//.test(value)) {
      this.add(pathName, `Expected URL string, got ${typeName(value)}.`);
    }
  }

  private requiredNonEmptyArray(pathName: string): void {
    this.requiredArray(pathName);
    const value = this.value(pathName);
    if (Array.isArray(value) && value.length === 0) this.add(pathName, 'Expected non-empty array.');
  }

  private values(pathName: string): unknown[] {
    const value = this.value(pathName);
    return Array.isArray(value) ? value : [];
  }

  private records(pathName: string): Record<string, unknown>[] {
    return this.values(pathName).filter(isRecord);
  }

  private value(pathName: string): unknown {
    return getAt(this.team.data, pathName);
  }

  private add(pathName: string, message: string): void {
    this.errors.push({
      severity: 'error',
      file: this.team.filePath,
      path: pathName,
      message,
      line: this.team.lineForPath(pathName),
    });
  }
}

function crossMessage(
  severity: 'error' | 'warning',
  team: TeamDocument | undefined,
  pathName: string,
  message: string,
): ValidationMessage {
  return {
    severity,
    file: team?.filePath ?? '<cross-team>',
    path: pathName,
    message,
    line: team?.lineForPath(pathName),
  };
}

function recordsAt(root: Record<string, unknown>, pathName: string): Record<string, unknown>[] {
  const value = getAt(root, pathName);
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function getAt(root: Record<string, unknown>, pathName: string): unknown {
  let cursor: unknown = root;
  const parts = pathName.match(/[^.[\]]+|\[\d+\]/g) ?? [];
  for (const part of parts) {
    if (part.startsWith('[')) {
      const index = Number(part.slice(1, -1));
      if (!Array.isArray(cursor)) return undefined;
      cursor = cursor[index];
    } else {
      if (!isRecord(cursor)) return undefined;
      cursor = cursor[part];
    }
  }
  return cursor;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function typeName(value: unknown): string {
  if (value === undefined) return 'missing';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function isDateLike(value: unknown): boolean {
  if (typeof value === 'string') return /^\d{4}(-\d{2}(-\d{2})?)?$/.test(value);
  if (typeof value === 'number') return Number.isInteger(value) && value >= 1900 && value <= 2200;
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  return false;
}

function isYear(value: unknown): boolean {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 1900 && value <= 2200;
  return typeof value === 'string' && /^\d{4}$/.test(value);
}
