import type {
  ContextGraphWarRoomCounterparty,
  ContextGraphWarRoomEdge,
  ContextGraphWarRoomEdgeType,
  ContextGraphWarRoomExecutiveSummary,
  ContextGraphWarRoomNode,
  ContextGraphWarRoomRosterPressure,
  ContextGraphWarRoomScenarioLens,
  ContextGraphWarRoomResponse,
  ContextGraphWarRoomTier,
  ContextGraphWarRoomTension,
  TeamContextPreferences,
} from '@shared/types';
import { DEFAULT_DERIVED_DIR } from './paths.js';
import { listTeamContextPreferences, type TeamPreferenceStoreOptions } from './preferences.js';
import { isNbaTeamId } from './schema.js';
import { loadDerivedArtifacts } from './storage.js';

interface ScoreState {
  score: number;
  reasons: string[];
  relationshipTypes: Set<ContextGraphWarRoomEdgeType>;
  tradeCountRecent: number;
  lastTradeDate: string | null;
}

const POSTURE_BOOSTS = new Set(['rebuild', 'retool', 'purgatory']);

export async function getContextGraphWarRoom(
  teamIdInput: string,
  options: TeamPreferenceStoreOptions = {},
): Promise<ContextGraphWarRoomResponse> {
  const teamId = teamIdInput.toUpperCase();
  if (!isNbaTeamId(teamId)) throw new Error(`Unknown Intel team_id ${teamId}.`);

  const [preferences, artifacts] = await Promise.all([
    listTeamContextPreferences(options),
    loadDerivedArtifacts(options.derivedDir ?? DEFAULT_DERIVED_DIR),
  ]);
  const teamById = new Map(preferences.teams.map((team) => [team.team_id, team]));
  const subject = teamById.get(teamId);
  if (!subject) throw new Error(`Unknown Intel team_id ${teamId}.`);
  const sourceTeam = artifacts.teams.find((team) => String(team.team_id ?? '').toUpperCase() === teamId) as Record<string, unknown> | undefined;

  const aliases = buildTeamAliases(preferences.teams);
  const counterparties = preferences.teams
    .filter((team) => team.team_id !== teamId)
    .map((team) => scoreCounterparty(teamId, team, artifacts.edges, aliases))
    .filter((counterparty) => counterparty.score > 0)
    .sort((a, b) => b.score - a.score || a.team_id.localeCompare(b.team_id))
    .slice(0, 8);

  const graph = buildGraph(teamId, subject, counterparties, preferences.teams, artifacts.edges, aliases);
  const rosterPressure = buildRosterPressure(sourceTeam ?? {});
  const strategicTensions = buildStrategicTensions(subject, sourceTeam ?? {});
  const scenarioLenses = buildScenarioLenses(subject, counterparties);

  return {
    metadata: preferences.metadata,
    subject,
    executive_summary: buildExecutiveSummary(subject, counterparties, rosterPressure, strategicTensions),
    counterparties,
    roster_pressure: rosterPressure,
    strategic_tensions: strategicTensions,
    scenario_lenses: scenarioLenses,
    graph,
    demo_prompts: demoPrompts(subject),
  };
}

function scoreCounterparty(
  subjectTeamId: string,
  team: TeamContextPreferences,
  edges: Awaited<ReturnType<typeof loadDerivedArtifacts>>['edges'],
  aliases: Map<string, string>,
): ContextGraphWarRoomCounterparty {
  const state: ScoreState = {
    score: 0,
    reasons: [],
    relationshipTypes: new Set(),
    tradeCountRecent: 0,
    lastTradeDate: null,
  };

  const tradeEdges = edges.tradePartners.filter((edge) => {
    const ids = idsForText([edge.team_a, edge.team_b], aliases);
    return ids.has(subjectTeamId) && ids.has(team.team_id);
  });
  if (tradeEdges.length > 0) {
    const tradeCount = Math.max(...tradeEdges.map((edge) => edge.trade_count_recent));
    const lastTradeDate = latestDate(tradeEdges.map((edge) => edge.last_trade_date));
    addScore(state, 40 + Math.min(10, tradeCount * 5), 'trade_partner', `Recent trade history${lastTradeDate ? `, last ${lastTradeDate}` : ''}`);
    state.tradeCountRecent = tradeCount;
    state.lastTradeDate = lastTradeDate;
  }

  const personnelEdges = edges.personnelConnections.filter((edge) => {
    const ids = idsForText([edge.team_with_entry, edge.connected_team], aliases);
    return ids.has(subjectTeamId) && ids.has(team.team_id);
  });
  if (personnelEdges.length > 0) {
    addScore(state, 20, 'personnel', `Personnel link: ${personnelEdges[0].person_name}`);
  }

  const rivalryEdges = edges.rivalries.filter((edge) => {
    const ids = idsForText([edge.team_a, edge.team_b], aliases);
    return ids.has(subjectTeamId) && ids.has(team.team_id);
  });
  if (rivalryEdges.length > 0) {
    addScore(state, 12, 'rivalry', `Relationship signal: ${rivalryEdges[0].rivalry_type}`);
  }

  const pickEdges = edges.pickOwnership.filter((edge) => {
    const ids = idsForText([edge.owning_team, edge.owed_team], aliases);
    return ids.has(subjectTeamId) && ids.has(team.team_id);
  });
  if (pickEdges.length > 0) {
    addScore(state, 10, 'pick', `Pick linkage: ${pickEdges[0].year} R${pickEdges[0].round}`);
  }

  const pursuitEdges = edges.historicalPursuits.filter((edge) => {
    const ids = idsForText([edge.pursuer_team, edge.target_name], aliases);
    return ids.has(subjectTeamId) && ids.has(team.team_id);
  });
  if (pursuitEdges.length > 0) {
    addScore(state, 8, 'pursuit', `Historical pursuit signal: ${pursuitEdges[0].target_name}`);
  }

  if (POSTURE_BOOSTS.has(team.preferences.strategic_posture.timeframe)) {
    addScore(state, 5, 'pursuit', `Posture fit: ${team.preferences.strategic_posture.timeframe}`);
  }

  return {
    team_id: team.team_id,
    name: team.name,
    score: state.score,
    tier: tierForScore(state.score),
    reasons: state.reasons.slice(0, 4),
    relationship_types: [...state.relationshipTypes],
    dossier: buildCounterpartyDossier(team, state),
    validation: team.validation,
    has_overrides: team.has_overrides,
    override_updated_at: team.override_updated_at,
    posture: team.preferences.strategic_posture.timeframe,
    spending_posture: team.preferences.ownership.spending_posture,
    trade_count_recent: state.tradeCountRecent,
    last_trade_date: state.lastTradeDate,
  };
}

function buildCounterpartyDossier(
  team: TeamContextPreferences,
  state: ScoreState,
): ContextGraphWarRoomCounterparty['dossier'] {
  const tier = tierForScore(state.score);
  const tradeLinked = state.relationshipTypes.has('trade_partner');
  const pickLinked = state.relationshipTypes.has('pick');
  const personnelLinked = state.relationshipTypes.has('personnel');
  const posture = team.preferences.strategic_posture.timeframe;
  const spend = team.preferences.ownership.spending_posture;

  const likelyTradeLane = tradeLinked && POSTURE_BOOSTS.has(posture)
    ? 'Revisit a known trade channel around veteran salary, draft capital, or reset mechanics.'
    : pickLinked
      ? 'Use pick mechanics and swap/second-round cleanup as the low-friction opener.'
      : personnelLinked
        ? 'Use the personnel relationship as discovery before turning to structure.'
        : 'Start with posture discovery, then test whether their current timeline creates a trade lane.';

  return {
    call_priority: tier === 'hot' ? 'First-wave call' : tier === 'warm' ? 'Second-wave diligence' : 'Monitor only',
    likely_trade_lane: likelyTradeLane,
    opening_question: `Given your ${formatReadable(posture)} posture and ${formatReadable(spend)} spend profile, what kind of mutually workable structure would you actually take seriously before the market forms?`,
    leverage_notes: [
      ...state.reasons.slice(0, 3),
      `Counterparty posture: ${posture}`,
      `Counterparty spend: ${spend}`,
    ],
    risks: [
      ...(team.validation.status === 'fail' ? [`Graph validation caveat: ${team.validation.error_count} errors`] : []),
      ...(state.tradeCountRecent === 0 && tradeLinked ? ['Trade link is text-derived, not a counted recent trade.'] : []),
      ...(team.has_overrides ? ['Settings override present; confirm source vs edited preference.'] : []),
    ],
  };
}

function buildGraph(
  subjectTeamId: string,
  subject: TeamContextPreferences,
  counterparties: ContextGraphWarRoomCounterparty[],
  teams: TeamContextPreferences[],
  edges: Awaited<ReturnType<typeof loadDerivedArtifacts>>['edges'],
  aliases: Map<string, string>,
): ContextGraphWarRoomResponse['graph'] {
  const teamById = new Map(teams.map((team) => [team.team_id, team]));
  const visibleTeamIds = new Set([subjectTeamId, ...counterparties.map((team) => team.team_id)]);
  const graphEdges: ContextGraphWarRoomEdge[] = [];
  const seenEdges = new Set<string>();

  const addEdge = (
    type: ContextGraphWarRoomEdgeType,
    toTeamId: string,
    label: string,
    detail: string,
  ) => {
    if (toTeamId === subjectTeamId || !visibleTeamIds.has(toTeamId)) return;
    const key = `${type}:${subjectTeamId}:${toTeamId}:${label}`;
    if (seenEdges.has(key)) return;
    seenEdges.add(key);
    graphEdges.push({
      id: key,
      type,
      from_team_id: subjectTeamId,
      to_team_id: toTeamId,
      label,
      detail,
    });
  };

  for (const edge of edges.tradePartners) {
    const ids = idsForText([edge.team_a, edge.team_b], aliases);
    if (!ids.has(subjectTeamId)) continue;
    for (const id of ids) {
      if (id !== subjectTeamId) addEdge('trade_partner', id, 'Trade partner', edge.last_trade_date ?? 'recent trade link');
    }
  }
  for (const edge of edges.personnelConnections) {
    const ids = idsForText([edge.team_with_entry, edge.connected_team], aliases);
    if (!ids.has(subjectTeamId)) continue;
    for (const id of ids) {
      if (id !== subjectTeamId) addEdge('personnel', id, edge.person_name, edge.connection_type);
    }
  }
  for (const edge of edges.rivalries) {
    const ids = idsForText([edge.team_a, edge.team_b], aliases);
    if (!ids.has(subjectTeamId)) continue;
    for (const id of ids) {
      if (id !== subjectTeamId) addEdge('rivalry', id, 'Rivalry', edge.basis);
    }
  }
  for (const edge of edges.pickOwnership) {
    const ids = idsForText([edge.owning_team, edge.owed_team], aliases);
    if (!ids.has(subjectTeamId)) continue;
    for (const id of ids) {
      if (id !== subjectTeamId) addEdge('pick', id, `${edge.year} R${edge.round}`, edge.protections);
    }
  }
  for (const edge of edges.historicalPursuits) {
    const ids = idsForText([edge.pursuer_team, edge.target_name], aliases);
    if (!ids.has(subjectTeamId)) continue;
    for (const id of ids) {
      if (id !== subjectTeamId) addEdge('pursuit', id, edge.target_name, String(edge.outcome));
    }
  }

  const edgeTeamIds = graphEdges.flatMap((edge) => [edge.from_team_id, edge.to_team_id]);
  const nodeIds = new Set([subjectTeamId, ...counterparties.map((team) => team.team_id), ...edgeTeamIds]);
  const counterpartyById = new Map(counterparties.map((team) => [team.team_id, team]));
  const nodes: ContextGraphWarRoomNode[] = [...nodeIds].flatMap((id) => {
    const team = id === subjectTeamId ? subject : teamById.get(id);
    if (!team) return [];
    const counterparty = counterpartyById.get(id);
    return [{
      team_id: team.team_id,
      name: team.name,
      kind: id === subjectTeamId ? 'subject' : 'counterparty',
      tier: id === subjectTeamId ? 'subject' : counterparty?.tier ?? 'watch',
      validation_status: team.validation.status,
      has_overrides: team.has_overrides,
    }];
  });

  return { nodes, edges: graphEdges.slice(0, 24) };
}

function buildRosterPressure(team: Record<string, unknown>): ContextGraphWarRoomRosterPressure[] {
  return recordsAt(team, 'roster')
    .map((player) => {
      const movementStatus = stringAt(player, 'movement_constraints.status') || 'unknown';
      const availabilityStatus = stringAt(player, 'availability_status') || 'unknown';
      const trajectory = stringAt(player, 'trajectory') || 'unknown';
      const yearsRemaining = numberOrStringAt(player, 'contract.years_remaining');
      const leverage = stringAt(player, 'team_relationship.contract_leverage.detail')
        || stringAt(player, 'team_relationship.contract_leverage.value')
        || 'unknown leverage';
      const reasons = recordsAt(player, 'movement_constraints.reasons')
        .map((reason) => stringAt(reason, 'reason_code'))
        .filter(Boolean);
      const rationale: string[] = [];
      let score = 0;

      if (['actively_traded', 'shopped', 'available'].includes(movementStatus)) {
        score += movementStatus === 'available' ? 25 : 35;
        rationale.push(`Movement status: ${movementStatus}`);
      }
      if (availabilityStatus.includes('injured') || availabilityStatus.includes('season')) {
        score += 25;
        rationale.push(`Availability: ${availabilityStatus}`);
      }
      if (typeof yearsRemaining === 'number' && yearsRemaining <= 1) {
        score += 20;
        rationale.push('Contract decision window within one season');
      }
      if (['declining', 'declining_peak'].includes(trajectory)) {
        score += 15;
        rationale.push(`Trajectory: ${trajectory}`);
      }
      if (stringAt(player, 'team_relationship.homegrown') === 'no') {
        score += 8;
        rationale.push('Not homegrown; weaker institutional attachment');
      }
      if (movementStatus === 'untouchable') {
        score = Math.max(0, score - 25);
        rationale.push('Protected by current movement constraints');
      }
      for (const reason of reasons.slice(0, 2)) {
        if (!rationale.includes(reason)) rationale.push(reason);
      }

      return {
        player_id: stringAt(player, 'player_id'),
        name: stringAt(player, 'name'),
        tier: stringAt(player, 'tier') || 'unknown',
        movement_status: movementStatus,
        availability_status: availabilityStatus,
        trajectory,
        years_remaining: yearsRemaining,
        contract_leverage: leverage,
        pressure_score: score,
        action: actionForPressure(score, movementStatus),
        rationale: rationale.slice(0, 4),
      };
    })
    .filter((player) => player.player_id && player.name)
    .sort((a, b) => b.pressure_score - a.pressure_score || a.name.localeCompare(b.name))
    .slice(0, 10);
}

function buildStrategicTensions(
  subject: TeamContextPreferences,
  team: Record<string, unknown>,
): ContextGraphWarRoomTension[] {
  const posture = subject.preferences.strategic_posture.timeframe;
  const risk = subject.preferences.cultural_signals.risk_tolerance.value;
  const traits = subject.preferences.cultural_signals.notable_traits;
  const rosterPressure = buildRosterPressure(team);
  const highPressureStars = rosterPressure.filter((player) => player.tier === 'star' && player.pressure_score >= 35);
  const pendingDecisionPlayers = rosterPressure.filter((player) => player.action === 'decision').slice(0, 2);

  const tensions: ContextGraphWarRoomTension[] = [];
  if (posture === 'rebuild' && (risk === 'aggressive' || traits.includes('star_chasing'))) {
    tensions.push({
      title: 'Rebuild posture vs acceleration behavior',
      severity: 'high',
      signal: `${posture} posture, ${risk} risk tolerance, ${traits.includes('star_chasing') ? 'star-chasing trait' : 'aggressive transaction profile'}`,
      why_it_matters: 'The organization can either preserve a youth-development timeline or use veteran star recovery as an acceleration bet, but the middle path is where asset leakage happens.',
      winger_question: 'What result would make us stop behaving like a rebuilding team before the deadline?',
    });
  }
  if (highPressureStars.length > 0) {
    tensions.push({
      title: 'Star health and option-risk concentration',
      severity: 'high',
      signal: highPressureStars.map((player) => `${player.name}: ${player.availability_status}, ${player.years_remaining} years`).join(' · '),
      why_it_matters: 'The highest-ceiling version of the team depends on players who also carry the clearest decision pressure.',
      winger_question: 'What is the earliest health signal that changes our trade-call posture?',
    });
  }
  if (pendingDecisionPlayers.length > 0) {
    tensions.push({
      title: 'Decision windows are already forming',
      severity: 'medium',
      signal: pendingDecisionPlayers.map((player) => `${player.name}: ${player.movement_status}`).join(' · '),
      why_it_matters: `Waiting for certainty may cost optionality if counterparties understand the ${subject.name} front office has unresolved contract and role pressure.`,
      winger_question: 'Which player decision needs an answer before the market answers it for us?',
    });
  }
  if (subject.validation.status === 'fail') {
    tensions.push({
      title: 'Graph confidence must be part of the room',
      severity: 'medium',
      signal: `${subject.validation.error_count} validation errors, ${subject.validation.warning_count} warnings`,
      why_it_matters: 'The graph is useful because it makes assumptions visible; the room will trust it more if caveats are shown rather than hidden.',
      winger_question: 'Which caveat would change a call-sheet recommendation if corrected?',
    });
  }

  return tensions.slice(0, 4);
}

function buildScenarioLenses(
  subject: TeamContextPreferences,
  counterparties: ContextGraphWarRoomCounterparty[],
): ContextGraphWarRoomScenarioLens[] {
  const hotTeams = counterparties.filter((team) => team.tier === 'hot').slice(0, 4).map((team) => team.team_id);
  const rebuildTeams = counterparties.filter((team) => POSTURE_BOOSTS.has(team.posture)).slice(0, 4).map((team) => team.team_id);
  const relationshipTeams = counterparties
    .filter((team) => team.relationship_types.some((type) => type === 'personnel' || type === 'pick' || type === 'rivalry'))
    .slice(0, 4)
    .map((team) => team.team_id);

  return [
    {
      id: 'patient-core',
      label: 'Protect the core',
      stance: 'Protect the current core and pick optionality; use veteran calls to create leverage, not urgency.',
      focus: ['Core preservation', 'Low-regret pick mechanics', 'Timeline patience'],
      prompt: `For ${subject.team_id}, build a patient-core offseason plan using Intel. Which calls preserve optionality without forcing a veteran-star conclusion?`,
      team_ids: relationshipTeams.length ? relationshipTeams : hotTeams,
    },
    {
      id: 'accelerate',
      label: 'Accelerate if health clears',
      stance: 'Treat an acceleration branch as a real option and pressure-test known trade channels before the rest of the league catches up.',
      focus: ['Known counterparties', 'Veteran-salary structure', 'Rotation depth'],
      prompt: `For ${subject.team_id}, assume the acceleration signals are positive. Which counterparties should the front office call first and what should they ask for?`,
      team_ids: hotTeams,
    },
    {
      id: 'health-fail',
      label: 'Health fail-safe',
      stance: 'Prepare the reset branch now so the team is not negotiating from disappointment at the deadline.',
      focus: ['Exit ramps', 'Asset recovery', 'Contract pressure'],
      prompt: `For ${subject.team_id}, assume the acceleration branch does not clear. What is the cleanest reset branch and which teams are likeliest to engage?`,
      team_ids: rebuildTeams.length ? rebuildTeams : hotTeams,
    },
  ];
}

function buildExecutiveSummary(
  subject: TeamContextPreferences,
  counterparties: ContextGraphWarRoomCounterparty[],
  rosterPressure: ContextGraphWarRoomRosterPressure[],
  tensions: ContextGraphWarRoomTension[],
): ContextGraphWarRoomExecutiveSummary {
  const posture = subject.preferences.strategic_posture.timeframe;
  const spend = subject.preferences.ownership.spending_posture;
  const risk = subject.preferences.cultural_signals.risk_tolerance.value;
  const topCalls = counterparties.slice(0, 3).map((team) => ({
    team_id: team.team_id,
    name: team.name,
    priority: team.dossier.call_priority,
    trade_lane: team.dossier.likely_trade_lane,
    opening_question: team.dossier.opening_question,
    score: team.score,
    tier: team.tier,
    caveats: team.dossier.risks.slice(0, 2),
  }));
  const pressurePlayers = rosterPressure.filter((player) => player.pressure_score >= 35).slice(0, 3);
  const topPressurePlayer = pressurePlayers[0];
  const firstTension = tensions[0];

  const headline = posture === 'rebuild'
    ? 'Protect the rebuild optionality, but pre-wire the first calls now.'
    : posture === 'contend_now' || posture === 'contend_soon'
      ? 'Pressure-test the market without letting urgency set the price.'
      : 'Keep the posture flexible while the market reveals its real counterparties.';

  const recommendedPosture = [
    `Operate as ${formatReadable(posture)} with ${formatReadable(risk)} risk tolerance.`,
    `Treat ${formatReadable(spend)} spending posture as a boundary condition, not the thesis.`,
    topCalls.length > 0
      ? `Start with ${topCalls.map((call) => call.team_id).join(', ')} before widening the room.`
      : 'Use the graph to keep discovery narrow until a stronger relationship signal appears.',
  ].join(' ');

  const decisionCards: ContextGraphWarRoomExecutiveSummary['decision_cards'] = [
    {
      title: 'Set the posture trigger',
      signal: firstTension?.signal ?? `${formatReadable(posture)} posture with ${formatReadable(risk)} risk tolerance`,
      recommendation: firstTension?.why_it_matters
        ?? 'The key executive risk is drifting between patience and acceleration without an explicit trigger.',
      action: firstTension?.winger_question
        ?? `Define the one signal that changes ${subject.name} from patient to aggressive.`,
      severity: firstTension?.severity ?? 'medium',
    },
    {
      title: 'Make first-wave calls',
      signal: topCalls.length > 0
        ? topCalls.map((call) => `${call.team_id} ${call.tier}`).join(' / ')
        : 'No high-confidence counterparty lane yet',
      recommendation: topCalls.length > 0
        ? 'Use known relationship lanes to learn price, not to force an early structure.'
        : 'Hold the call list tight and use assumptions work before asking the AI for trade structures.',
      action: topCalls[0]?.opening_question ?? 'Ask what structure the counterparty would take seriously before the market forms.',
      severity: topCalls.some((call) => call.tier === 'hot') ? 'high' : 'medium',
    },
    {
      title: topPressurePlayer ? 'Resolve player pressure' : 'Protect option value',
      signal: topPressurePlayer
        ? pressurePlayers.map((player) => `${player.name}: ${player.action}`).join(' / ')
        : 'No roster-pressure spike in the current read',
      recommendation: topPressurePlayer
        ? 'Separate health, contract, and movement decisions before they collapse into one deadline problem.'
        : 'Keep youth-core and asset optionality visible while continuing counterparty discovery.',
      action: topPressurePlayer
        ? `Decide what would move ${topPressurePlayer.name} from ${topPressurePlayer.action} to hold.`
        : 'Name the protected young-core assets before any veteran-market conversation.',
      severity: topPressurePlayer?.pressure_score && topPressurePlayer.pressure_score >= 60 ? 'high' : 'medium',
    },
  ];

  return {
    headline,
    recommended_posture: recommendedPosture,
    decision_cards: decisionCards,
    top_calls: topCalls,
    confidence: executiveConfidence(subject, topCalls.length),
    caveats: executiveCaveats(subject, topCalls.length),
  };
}

function executiveConfidence(
  subject: TeamContextPreferences,
  topCallCount: number,
): ContextGraphWarRoomExecutiveSummary['confidence'] {
  const validationFailed = subject.validation.status === 'fail';
  const status = validationFailed || topCallCount === 0
    ? 'low'
    : subject.validation.warning_count > 0
      ? 'medium'
      : 'high';
  const label = status === 'high'
    ? 'High-confidence briefing'
    : status === 'medium'
      ? 'Usable with caveats'
      : 'Directional only';

  return {
    status,
    label,
    detail: [
      `Source as of ${subject.as_of_date || 'unknown'}`,
      `last updated ${subject.last_updated || 'unknown'}`,
      subject.has_overrides ? 'Settings assumptions active' : 'source assumptions only',
    ].join(' · '),
    source_as_of_date: subject.as_of_date,
    source_last_updated: subject.last_updated,
    has_overrides: subject.has_overrides,
    validation_status: subject.validation.status,
  };
}

function executiveCaveats(subject: TeamContextPreferences, topCallCount: number): string[] {
  const caveats: string[] = [];
  if (subject.validation.status === 'fail') {
    caveats.push(`${subject.validation.error_count} source validation issues should be acknowledged before using this as a final recommendation.`);
  }
  if (subject.validation.warning_count > 0) {
    caveats.push(`${subject.validation.warning_count} graph warnings remain in the source snapshot.`);
  }
  if (subject.has_overrides) {
    caveats.push('Settings overrides are active; confirm the edited assumptions reflect the room.');
  }
  if (topCallCount === 0) {
    caveats.push('No strong relationship lane was found; call recommendations are discovery-first.');
  }
  return caveats;
}

function addScore(
  state: ScoreState,
  points: number,
  type: ContextGraphWarRoomEdgeType,
  reason: string,
) {
  state.score += points;
  state.relationshipTypes.add(type);
  if (!state.reasons.includes(reason)) state.reasons.push(reason);
}

function tierForScore(score: number): ContextGraphWarRoomTier {
  if (score >= 45) return 'hot';
  if (score >= 25) return 'warm';
  return 'watch';
}

function actionForPressure(
  score: number,
  movementStatus: string,
): ContextGraphWarRoomRosterPressure['action'] {
  if (movementStatus === 'untouchable') return 'protect';
  if (score >= 60) return 'market';
  if (score >= 35) return 'decision';
  return 'monitor';
}

function latestDate(values: (string | null)[]): string | null {
  return values.filter((value): value is string => typeof value === 'string' && value.length > 0)
    .sort()
    .at(-1) ?? null;
}

function buildTeamAliases(teams: TeamContextPreferences[]): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const team of teams) {
    aliases.set(normalizeAlias(team.team_id), team.team_id);
    aliases.set(normalizeAlias(team.name), team.team_id);
  }
  return aliases;
}

function idsForText(values: string[], aliases: Map<string, string>): Set<string> {
  const ids = new Set<string>();
  const normalizedValues = values.map(normalizeAlias);
  for (const value of values) {
    for (const token of value.toUpperCase().match(/\b[A-Z]{3}\b/g) ?? []) {
      if (isNbaTeamId(token)) ids.add(token);
    }
  }
  for (const normalizedValue of normalizedValues) {
    for (const [alias, teamId] of aliases.entries()) {
      if (alias && normalizedValue.includes(alias)) ids.add(teamId);
    }
  }
  return ids;
}

function normalizeAlias(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function formatReadable(value: string): string {
  return value.replace(/_/g, ' ');
}

function recordsAt(root: Record<string, unknown>, pathName: string): Record<string, unknown>[] {
  const value = getAt(root, pathName);
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function stringAt(root: Record<string, unknown>, pathName: string): string {
  const value = getAt(root, pathName);
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function numberOrStringAt(root: Record<string, unknown>, pathName: string): number | string | null {
  const value = getAt(root, pathName);
  if (typeof value === 'number' || typeof value === 'string') return value;
  return null;
}

function getAt(root: Record<string, unknown>, pathName: string): unknown {
  let cursor: unknown = root;
  for (const part of pathName.split('.')) {
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function demoPrompts(subject: TeamContextPreferences): ContextGraphWarRoomResponse['demo_prompts'] {
  const prompts: ContextGraphWarRoomResponse['demo_prompts'] = [
    {
      title: 'Offseason posture',
      angle: 'Brief',
      prompt: `For the ${subject.name}, how should we think about the offseason trade posture given their Intel priorities, culture, and relationship map?`,
    },
    {
      title: 'Counterparty calls',
      angle: 'Brief',
      prompt: `For ${subject.team_id}, identify the three most productive trade-counterparty conversations to start this week and explain the context-graph evidence for each.`,
    },
    {
      title: 'Override proof',
      angle: 'Chat',
      prompt: `Use Intel for ${subject.team_id}. What changed if Settings overrides are present, and what caveats should we show the ${subject.name} front office?`,
    },
  ];
  if (subject.team_id === 'WAS') {
    prompts.unshift({
      title: 'Coulibaly succession protocol',
      angle: 'Brief',
      prompt: [
        'For the Washington Wizards, answer as a front-office decision brief.',
        'Can Jameer Watkins be a legitimate succession plan to Bilal Coulibaly if Washington does not extend Bilal and instead trades him for draft capital?',
        'Lead with yes/no/conditional and confidence; state what Washington would lose by replacing Coulibaly with Watkins; identify internal, 2026 draft, and league-wide alternatives to study; and generate the questions Michael should prioritize for analytics, coaching, scouting/front office, and cap/contracts.',
        'Use current roster/cap/stat evidence where available, use Intel only for Washington posture and trust boundaries, and explicitly say when private/internal data is missing.',
      ].join(' '),
    });
  }
  if (subject.team_id === 'GSW') {
    prompts.unshift({
      title: 'Curry window protocol',
      angle: 'Brief',
      prompt: [
        'For the Golden State Warriors, answer as a front-office decision brief from Mike Dunleavy Jr. POV.',
        'How should we sequence the Stephen Curry extension window, Draymond Green option or extension path, Jonathan Kuminga market, and second-apron constraints around the Curry-Butler-Green contention window?',
        'Lead with yes/no/conditional and confidence; separate what is proven by roster/cap/stat evidence from what requires private medical, coaching, or ownership input.',
        'Generate the questions Mike should prioritize for analytics, coaching, scouting/front office, and cap/contracts before any first-wave trade call.',
      ].join(' '),
    });
  }
  return prompts;
}
