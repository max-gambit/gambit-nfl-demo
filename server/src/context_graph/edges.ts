import {
  type EdgeGraph,
  type HistoricalPursuitEdge,
  type PendingFreeAgentEdge,
  type PersonnelConnectionEdge,
  type PickOwnershipEdge,
  type PlayerTeamEdge,
  type RivalryEdge,
  TEAM_ALIASES,
  TEAM_ID_SET,
  type TeamDocument,
  type TradePartnerEdge,
} from './schema.js';

export function extractEdgeGraph(teams: TeamDocument[]): EdgeGraph {
  return {
    pickOwnership: extractPickOwnershipEdges(teams),
    tradePartners: extractTradePartnerEdges(teams),
    rivalries: extractRivalryEdges(teams),
    personnelConnections: extractPersonnelConnectionEdges(teams),
    playerTeams: extractPlayerTeamEdges(teams),
    pendingFreeAgents: extractPendingFreeAgentEdges(teams),
    historicalPursuits: extractHistoricalPursuitEdges(teams),
  };
}

export function extractPickOwnershipEdges(teams: TeamDocument[]): PickOwnershipEdge[] {
  const edges: PickOwnershipEdge[] = [];
  for (const team of teams) {
    const teamId = String(team.data.team_id ?? team.teamId);
    for (const [index, pick] of recordsAt(team.data, 'key_assets.draft_picks_owned').entries()) {
      const year = pick.year;
      const round = pick.round;
      if (!isYearNumber(year) || !isPickRound(round)) continue;
      const owedTeam = stringOrNull(pick.from_team)
        ?? stringOrNull(pick.original_team)
        ?? stringOrNull(pick.team_id)
        ?? teamId;
      edges.push({
        type: 'pick_ownership',
        owning_team: teamId,
        owed_team: owedTeam,
        year,
        round,
        protections: stringifyValue(pick.protections),
        condition: stringOrNull(pick.condition),
        conditional: false,
        source_path: `${teamId}.key_assets.draft_picks_owned[${index}]`,
      });
    }

    for (const [index, pick] of recordsAt(team.data, 'key_assets.draft_picks_owed').entries()) {
      const year = pick.year;
      const round = pick.round;
      const owningTeam = stringOrNull(pick.to_team);
      if (!isYearNumber(year) || !isPickRound(round) || !owningTeam || !TEAM_ID_SET.has(owningTeam)) continue;
      edges.push({
        type: 'pick_ownership',
        owning_team: owningTeam,
        owed_team: teamId,
        year,
        round,
        protections: stringifyValue(pick.protections),
        condition: stringOrNull(pick.condition),
        conditional: typeof pick.condition === 'string' || Array.isArray(pick.to_team_options),
        source_path: `${teamId}.key_assets.draft_picks_owed[${index}]`,
      });
    }
  }
  return edges;
}

export function extractTradePartnerEdges(teams: TeamDocument[]): TradePartnerEdge[] {
  const byId = new Map(teams.map((team) => [String(team.data.team_id ?? team.teamId), team]));
  const pairs = new Map<string, TradePartnerEdge>();

  for (const team of teams) {
    const teamId = String(team.data.team_id ?? team.teamId);
    for (const rawPartner of valuesAt(team.data, 'trade_dna.frequent_partners')) {
      if (typeof rawPartner !== 'string') continue;
      const partner = rawPartner;
      const key = pairKey(teamId, partner);
      const existing = pairs.get(key);
      const count = countRecentTradesBetween(byId.get(teamId), byId.get(partner), teamId, partner);
      const lastTradeDate = lastRecentTradeDateBetween(byId.get(teamId), byId.get(partner), teamId, partner);
      if (existing) {
        existing.trade_count_recent = Math.max(existing.trade_count_recent, count);
        existing.last_trade_date = maxDate(existing.last_trade_date, lastTradeDate);
        existing.source_paths.push(`${teamId}.trade_dna.frequent_partners`);
      } else {
        pairs.set(key, {
          type: 'trade_partner',
          team_a: minTeam(teamId, partner),
          team_b: maxTeam(teamId, partner),
          trade_count_recent: count,
          last_trade_date: lastTradeDate,
          source_paths: [`${teamId}.trade_dna.frequent_partners`],
        });
      }
    }
  }

  return [...pairs.values()].sort((a, b) => `${a.team_a}-${a.team_b}`.localeCompare(`${b.team_a}-${b.team_b}`));
}

export function extractRivalryEdges(teams: TeamDocument[]): RivalryEdge[] {
  const edges: RivalryEdge[] = [];
  for (const team of teams) {
    const teamId = String(team.data.team_id ?? team.teamId);
    for (const [index, rivalry] of recordsAt(team.data, 'team_team_relationships.rivalries').entries()) {
      const otherTeam = stringOrNull(rivalry.team_id);
      if (!otherTeam) continue;
      edges.push({
        type: 'rivalry',
        team_a: teamId,
        team_b: otherTeam,
        rivalry_type: stringifyValue(rivalry.type),
        basis: stringifyValue(rivalry.basis),
        requires_reciprocal: rivalry.requires_reciprocal === true,
        source_path: `${teamId}.team_team_relationships.rivalries[${index}]`,
      });
    }
  }
  return edges;
}

export function extractPersonnelConnectionEdges(teams: TeamDocument[]): PersonnelConnectionEdge[] {
  const edges: PersonnelConnectionEdge[] = [];
  for (const team of teams) {
    const teamId = String(team.data.team_id ?? team.teamId);
    for (const [index, connection] of recordsAt(team.data, 'team_team_relationships.notable_personnel_connections').entries()) {
      const person = stringOrNull(connection.person);
      const connectedTeam = stringOrNull(connection.connected_team);
      if (!person || !connectedTeam) continue;
      edges.push({
        type: 'personnel_connection',
        team_with_entry: teamId,
        person_name: person,
        connected_team: connectedTeam,
        connection_type: stringifyValue(connection.connection_type),
        source_path: `${teamId}.team_team_relationships.notable_personnel_connections[${index}]`,
      });
    }
  }
  return edges;
}

export function extractPlayerTeamEdges(teams: TeamDocument[]): PlayerTeamEdge[] {
  const edges: PlayerTeamEdge[] = [];
  for (const team of teams) {
    const teamId = String(team.data.team_id ?? team.teamId);
    for (const [index, player] of recordsAt(team.data, 'roster').entries()) {
      const playerId = stringOrNull(player.player_id);
      if (!playerId) continue;
      edges.push({
        type: 'player_team',
        player_id: playerId,
        team_id: teamId,
        contract_type: stringifyValue(player.contract_type),
        tier: stringifyValue(player.tier),
        years_remaining: yearsRemaining(player),
        source_path: `${teamId}.roster[${index}]`,
      });
    }
  }
  return edges;
}

export function extractPendingFreeAgentEdges(teams: TeamDocument[]): PendingFreeAgentEdge[] {
  const edges: PendingFreeAgentEdge[] = [];
  for (const team of teams) {
    const teamId = String(team.data.team_id ?? team.teamId);
    for (const [index, player] of recordsAt(team.data, 'pending_free_agents').entries()) {
      const playerId = stringOrNull(player.player_id);
      if (!playerId) continue;
      edges.push({
        type: 'pending_free_agent',
        player_id: playerId,
        team_id: teamId,
        free_agent_type: stringifyValue(player.type),
        expected_market: stringifyValue(player.expected_market),
        source_path: `${teamId}.pending_free_agents[${index}]`,
      });
    }
  }
  return edges;
}

export function extractHistoricalPursuitEdges(teams: TeamDocument[]): HistoricalPursuitEdge[] {
  const edges: HistoricalPursuitEdge[] = [];
  for (const team of teams) {
    const teamId = String(team.data.team_id ?? team.teamId);
    for (const [index, target] of recordsAt(team.data, 'known_target_history').entries()) {
      const targetName = stringOrNull(target.target);
      if (!targetName) continue;
      edges.push({
        type: 'historical_pursuit',
        pursuer_team: teamId,
        target_name: targetName,
        year: typeof target.year === 'number' || typeof target.year === 'string' ? target.year : 'unknown',
        outcome: stringifyValue(target.outcome),
        source_path: `${teamId}.known_target_history[${index}]`,
      });
    }
  }
  return edges;
}

export function mentionedTeams(text: string, excludedTeam?: string): string[] {
  const upper = text.toUpperCase();
  const found = new Set<string>();
  for (const [alias, teamId] of Object.entries(TEAM_ALIASES)) {
    if (excludedTeam && teamId === excludedTeam) continue;
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(^|[^A-Z0-9])${escaped}([^A-Z0-9]|$)`).test(upper)) {
      found.add(teamId);
    }
  }
  return [...found].filter((teamId) => TEAM_ID_SET.has(teamId)).sort();
}

function countRecentTradesBetween(teamA: TeamDocument | undefined, teamB: TeamDocument | undefined, a: string, b: string): number {
  return recentTradeMatches(teamA, a, b).length + recentTradeMatches(teamB, b, a).length;
}

function lastRecentTradeDateBetween(teamA: TeamDocument | undefined, teamB: TeamDocument | undefined, a: string, b: string): string | null {
  const dates = [
    ...recentTradeMatches(teamA, a, b).map((trade) => stringOrNull(trade.date)),
    ...recentTradeMatches(teamB, b, a).map((trade) => stringOrNull(trade.date)),
  ].filter((date): date is string => !!date);
  return dates.sort().at(-1) ?? null;
}

function recentTradeMatches(team: TeamDocument | undefined, teamId: string, otherTeam: string): Record<string, unknown>[] {
  if (!team) return [];
  return recordsAt(team.data, 'trade_dna.recent_significant_trades').filter((trade) => {
    const counterparties = valuesAt(trade, 'counterparties').filter((value): value is string => (
      typeof value === 'string' && TEAM_ID_SET.has(value)
    ));
    if (counterparties.length > 0) return counterparties.includes(otherTeam);
    const summary = stringOrNull(trade.summary) ?? '';
    const mentions = mentionedTeams(summary, teamId);
    return mentions.includes(otherTeam);
  });
}

function valuesAt(root: Record<string, unknown>, pathName: string): unknown[] {
  const value = getAt(root, pathName);
  return Array.isArray(value) ? value : [];
}

function recordsAt(root: Record<string, unknown>, pathName: string): Record<string, unknown>[] {
  return valuesAt(root, pathName).filter(isRecord);
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

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return 'unknown';
  return JSON.stringify(value);
}

function yearsRemaining(player: Record<string, unknown>): number | string | null {
  const contract = player.contract;
  if (!isRecord(contract)) return null;
  const years = contract.years_remaining;
  if (typeof years === 'number' || typeof years === 'string') return years;
  return null;
}

function isYearNumber(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === 'number' && value >= 1900 && value <= 2200;
}

function isPickRound(value: unknown): value is 1 | 2 {
  return value === 1 || value === 2;
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}

function minTeam(a: string, b: string): string {
  return a <= b ? a : b;
}

function maxTeam(a: string, b: string): string {
  return a <= b ? b : a;
}

function maxDate(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}
