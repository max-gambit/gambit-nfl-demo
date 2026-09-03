import type {
  NflPositionMarketGroup,
  NflSellerMoveConversationArtifact,
  NflSellerMovePlayerOption,
  NflSellerMoveScenarioState,
  NflTransactionMarketAnalysis,
} from '@shared/types';
import { loadCurrentNflTeamDataWithMode, type NflDemoSeed } from '../nfl_data/seed.js';
import {
  analyzeNflTransactionMarketSnapshot,
  type NflTransactionMarketSnapshot,
} from './analyze.js';
import {
  buildNflSellerMoveOptions,
  calculateNflSellerMove,
} from './model_move.js';
import { loadCurrentNflTransactionMarketSnapshot } from './seed.js';

const POSITION_GROUPS: NflPositionMarketGroup[] = [
  'QB', 'RB', 'WR', 'TE', 'OT', 'IOL', 'EDGE', 'IDL', 'LB', 'CB', 'S', 'ST',
];

type SellerMovePatch = {
  player_query?: string;
  pick_year?: number;
  pick_round?: number;
  show_comparables?: boolean;
};

export interface ParsedSellerMoveTurn {
  kind: 'scenario';
  patch: SellerMovePatch;
}

export interface PreparedNflSellerMoveTurn {
  artifact: NflSellerMoveConversationArtifact;
  market: NflTransactionMarketAnalysis;
}

/**
 * Recognize only explicit seller-side proposals and tightly bounded edits to
 * an existing proposal. Market questions such as "show me trades only" are
 * deliberately left to the normal transaction-analysis path.
 */
export function parseNflSellerMoveTurn(
  question: string,
  previous: NflSellerMoveScenarioState | null,
): ParsedSellerMoveTurn | null {
  const value = question.trim();
  if (!value) return null;

  if (previous && /^show me (?:the )?trades? behind (?:that|this|the (?:proposal|return))[?.!]*$/i.test(value)) {
    return { kind: 'scenario', patch: { show_comparables: true } };
  }

  if (previous) {
    const roundUpdate = value.match(/^make it (?:a |an |the )?((?:first|second|third|fourth|fifth|sixth|seventh|[1-7](?:st|nd|rd|th)))\b/i);
    if (roundUpdate) return { kind: 'scenario', patch: { pick_round: parseRound(roundUpdate[1])! } };

    const yearUpdate = value.match(/^use\s+(20\d{2})\b/i);
    if (yearUpdate) return { kind: 'scenario', patch: { pick_year: Number(yearUpdate[1]) } };

    const playerUpdate = value.match(/^what about\s+(.+?)\s+instead\??$/i);
    if (playerUpdate) return { kind: 'scenario', patch: { player_query: cleanPlayerQuery(playerUpdate[1]) } };

    // A clarification is part of the same conversation, so accept the short
    // answer the prompt naturally invites without broadening scenario intent.
    const needsPlayer = previous.player_id == null;
    const needsYear = previous.pick_year == null;
    const needsRound = previous.pick_round == null;
    if (needsPlayer || needsYear || needsRound) {
      const years = uniqueMatches(value, /\b(20\d{2})\b/g).map(Number);
      const rounds = roundValues(value);
      const patch: SellerMovePatch = {};
      if (needsYear && years.length === 1) patch.pick_year = years[0];
      if (needsRound && rounds.length === 1) patch.pick_round = rounds[0];
      if (needsPlayer && years.length === 0 && rounds.length === 0 && looksLikePlayerName(value)) {
        patch.player_query = cleanPlayerQuery(value);
      }
      if (Object.keys(patch).length > 0) return { kind: 'scenario', patch };
    }
  }

  const scenarioCue = /\b(?:what if|suppose|if)\s+(?:the giants|new york|we)\s+(?:(?:were to|could|should)\s+)?(?:move|moved|trade|traded|trading)(?!\s+for\b)\b/i.test(value)
    || /^\s*(?:move|trade)\s+.+?\s+(?:for|in exchange for|in return for)\b/i.test(value);
  if (!scenarioCue) return null;

  const playerMatch = value.match(/\b(?:move|moved|trade|traded|trading)\s+(.+?)(?:\s+away)?\s+(?:for|in exchange for|in return for)\b/i)
    ?? value.match(/\b(?:move|moved|trade|traded|trading)\s+(.+?)(?:\?|$)/i);
  const years = uniqueMatches(value, /\b(20\d{2})\b/g).map(Number);
  const rounds = roundValues(value);
  const patch: SellerMovePatch = {};
  if (playerMatch?.[1]) patch.player_query = cleanPlayerQuery(playerMatch[1]);
  if (years.length === 1) patch.pick_year = years[0];
  if (rounds.length === 1) patch.pick_round = rounds[0];
  return { kind: 'scenario', patch };
}

export async function runNflSellerMoveConversationTurn(
  question: string,
  market: NflTransactionMarketAnalysis | null,
  previous: NflSellerMoveScenarioState | null,
): Promise<PreparedNflSellerMoveTurn | null> {
  const parsed = parseNflSellerMoveTurn(question, previous);
  if (!parsed) return null;
  let teamData;
  let snapshot;
  try {
    [teamData, snapshot] = await Promise.all([
      loadCurrentNflTeamDataWithMode('NYG'),
      loadCurrentNflTransactionMarketSnapshot(),
    ]);
  } catch {
    if (!market) return null;
    return {
      artifact: unavailableArtifact(baseScenario(market, previous), 'The current public contract or transaction data is unavailable right now.'),
      market,
    };
  }
  const effectiveMarket = market ?? defaultSellerMarketFromSnapshot(teamData.seed, snapshot);
  if (teamData.source_mode !== 'supabase_current_views') {
    return {
      artifact: unavailableArtifact(baseScenario(effectiveMarket, previous), 'Current Giants contract data is not available from the local database.'),
      market: effectiveMarket,
    };
  }
  return {
    artifact: resolveNflSellerMoveConversationTurn(parsed, effectiveMarket, previous, teamData.seed, snapshot),
    market: effectiveMarket,
  };
}

export function defaultSellerMarketFromSnapshot(seed: NflDemoSeed, snapshot: NflTransactionMarketSnapshot): NflTransactionMarketAnalysis {
  const currentYear = Number.parseInt(seed.season, 10);
  if (!Number.isInteger(currentYear)) throw new Error('The current league year is unavailable.');
  const endYear = currentYear - 1;
  return analyzeNflTransactionMarketSnapshot({
    analysis_mode: 'ten_year_trend',
    start_year: endYear - 9,
    end_year: endYear,
    transaction_types: [
      'trade',
      'free_agent_signing',
      're_signing',
      'extension',
      'tag',
      'waiver_claim',
      'release',
    ],
    include_ytd: false,
    max_comparables: 12,
  }, snapshot);
}

/** Pure conversation resolver used by focused tests and the live brief route. */
export function resolveNflSellerMoveConversationTurn(
  parsed: ParsedSellerMoveTurn,
  market: NflTransactionMarketAnalysis,
  previous: NflSellerMoveScenarioState | null,
  seed: NflDemoSeed,
  snapshot: NflTransactionMarketSnapshot,
  generatedAt: Date | string = new Date(),
): NflSellerMoveConversationArtifact {
  const scenario = baseScenario(market, previous);
  if (parsed.patch.player_query !== undefined) {
    scenario.player_query = parsed.patch.player_query;
    scenario.player_id = null;
    scenario.player_name = null;
    scenario.position_group = null;
  }
  if (parsed.patch.pick_year !== undefined) scenario.pick_year = parsed.patch.pick_year;
  if (parsed.patch.pick_round !== undefined) scenario.pick_round = parsed.patch.pick_round;

  if (scenario.player_query) {
    const resolution = resolvePlayer(scenario.player_query, seed, snapshot);
    if (resolution.kind === 'ambiguous') {
      return clarificationArtifact(scenario, `Which Giants player did you mean: ${joinNames(resolution.names)}?`);
    }
    if (resolution.kind === 'unsupported') {
      return unavailableArtifact(scenario, `${resolution.playerName} is on the current Giants roster, but the loaded public contract row is not complete enough to calculate this trade.`);
    }
    if (resolution.kind === 'missing') {
      const suggestions = resolution.suggestions.length
        ? resolution.suggestionKind === 'same_position'
          ? ` Giants players at the same position with usable contract data include ${joinNames(resolution.suggestions)}.`
          : ` Did you mean ${joinNames(resolution.suggestions)}?`
        : '';
      return clarificationArtifact(
        scenario,
        `I could not find ${scenario.player_query} in the current Giants roster or cap sheet as of ${seed.as_of_date}.${suggestions}`,
      );
    }
    scenario.player_id = resolution.player.player_id;
    scenario.player_name = resolution.player.player_name;
    scenario.position_group = resolution.player.position_group;
    scenario.player_query = resolution.player.player_name;
  }

  const missing = missingScenarioQuestion(scenario);
  if (missing) return clarificationArtifact(scenario, missing);

  const currentYear = Number.parseInt(seed.season, 10);
  if (!Number.isInteger(currentYear) || scenario.pick_year! <= currentYear || scenario.pick_year! > currentYear + 3) {
    return clarificationArtifact(scenario, `Use a draft year from ${currentYear + 1} through ${currentYear + 3}.`);
  }

  try {
    const result = calculateNflSellerMove({
      team_id: 'NYG',
      player_id: scenario.player_id!,
      position_group: scenario.position_group!,
      pick_year: scenario.pick_year!,
      pick_round: scenario.pick_round!,
      market_scope: scenario.market_scope,
    }, seed, snapshot, generatedAt);
    return {
      schema_version: 'nfl_seller_move_conversation.v1',
      status: 'answered',
      scenario,
      result,
      message: null,
      show_comparables: parsed.patch.show_comparables === true,
    };
  } catch (error) {
    return unavailableArtifact(scenario, friendlyCalculationError(error));
  }
}

function baseScenario(
  market: NflTransactionMarketAnalysis,
  previous: NflSellerMoveScenarioState | null,
): NflSellerMoveScenarioState {
  const marketScope: NflSellerMoveScenarioState['market_scope'] = {
    snapshot_id: market.snapshot_id,
    start_year: market.query.start_year,
    end_year: market.query.end_year,
    include_ytd: market.query.include_ytd,
    team_ids: [...market.query.team_ids],
  };
  return previous ? { ...structuredClone(previous), market_scope: marketScope } : {
    team_id: 'NYG',
    player_id: null,
    player_name: null,
    player_query: null,
    position_group: null,
    pick_year: null,
    pick_round: null,
    market_scope: marketScope,
  };
}

type PlayerResolution =
  | { kind: 'resolved'; player: NflSellerMovePlayerOption }
  | { kind: 'ambiguous'; names: string[] }
  | { kind: 'unsupported'; playerName: string }
  | { kind: 'missing'; suggestions: string[]; suggestionKind: 'same_position' | 'name' };

function resolvePlayer(query: string, seed: NflDemoSeed, snapshot: NflTransactionMarketSnapshot): PlayerResolution {
  const options = buildNflSellerMoveOptions(seed, 'NYG', POSITION_GROUPS, snapshot).positions.flatMap((position) => position.players);
  const eligible = matchingPlayers(query, options);
  if (eligible.length === 1) return { kind: 'resolved', player: eligible[0] };
  if (eligible.length > 1) return { kind: 'ambiguous', names: eligible.map((player) => player.player_name) };

  const activeRoster = seed.roster_entries.filter((row) => row.team_id === 'NYG' && row.roster_status === 'active');
  const rosterMatches = matchingNames(query, activeRoster.map((row) => row.player_name));
  if (rosterMatches.length === 1) return { kind: 'unsupported', playerName: rosterMatches[0] };
  if (rosterMatches.length > 1) return { kind: 'ambiguous', names: rosterMatches };
  const samePosition = samePositionSuggestions(query, options, seed, snapshot);
  return samePosition
    ? { kind: 'missing', suggestions: samePosition, suggestionKind: 'same_position' }
    : { kind: 'missing', suggestions: suggestedNames(query, activeRoster.map((row) => row.player_name)), suggestionKind: 'name' };
}

function samePositionSuggestions(
  query: string,
  options: NflSellerMovePlayerOption[],
  seed: NflDemoSeed,
  snapshot: NflTransactionMarketSnapshot,
): string[] | null {
  const needle = normalizeName(query);
  const positionGroups = new Set(snapshot.events
    .filter((event) => event.identity_confidence === 'matched'
      && event.position_group != null
      && normalizeName(event.player_name) === needle)
    .map((event) => event.position_group!));
  if (positionGroups.size !== 1) return null;
  const capByPlayer = new Map(seed.cap_rows.map((row) => [row.player_id, row.cap_number_2026 ?? -1]));
  const suggestions = options
    .filter((player) => positionGroups.has(player.position_group))
    .sort((left, right) => (capByPlayer.get(right.player_id) ?? -1) - (capByPlayer.get(left.player_id) ?? -1)
      || left.player_name.localeCompare(right.player_name))
    .slice(0, 3)
    .map((player) => player.player_name);
  return suggestions.length ? suggestions : null;
}

function suggestedNames(query: string, names: string[]): string[] {
  const needle = normalizeName(query);
  if (!needle) return [];
  return [...names]
    .map((name) => ({ name, distance: editDistance(needle, normalizeName(name)) }))
    .filter((item) => item.distance <= Math.max(3, Math.floor(needle.length * 0.45)))
    .sort((left, right) => left.distance - right.distance || left.name.localeCompare(right.name))
    .slice(0, 3)
    .map((item) => item.name);
}

function editDistance(left: string, right: string): number {
  const prior = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        prior[rightIndex] + 1,
        prior[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    prior.splice(0, prior.length, ...current);
  }
  return prior[right.length];
}

function matchingPlayers(query: string, players: NflSellerMovePlayerOption[]): NflSellerMovePlayerOption[] {
  const names = matchingNames(query, players.map((player) => player.player_name));
  return players.filter((player) => names.includes(player.player_name));
}

function matchingNames(query: string, names: string[]): string[] {
  const needle = normalizeName(query);
  if (!needle) return [];
  const exact = names.filter((name) => normalizeName(name) === needle);
  if (exact.length) return exact;
  return names.filter((name) => {
    const parts = name.toLowerCase().split(/\s+/).map(normalizeName).filter(Boolean);
    return parts.at(-1) === needle || normalizeName(name).includes(needle);
  });
}

function missingScenarioQuestion(scenario: NflSellerMoveScenarioState): string | null {
  if (!scenario.player_id) return 'Which current Giants player should I use?';
  if (scenario.pick_year == null && scenario.pick_round == null) return 'What draft year and round should New York receive?';
  if (scenario.pick_year == null) return 'Which draft year should I use?';
  if (scenario.pick_round == null) return 'Which round should I use?';
  return null;
}

function clarificationArtifact(scenario: NflSellerMoveScenarioState, message: string): NflSellerMoveConversationArtifact {
  return {
    schema_version: 'nfl_seller_move_conversation.v1',
    status: 'clarification',
    scenario,
    result: null,
    message,
    show_comparables: false,
  };
}

function unavailableArtifact(scenario: NflSellerMoveScenarioState, message: string): NflSellerMoveConversationArtifact {
  return {
    schema_version: 'nfl_seller_move_conversation.v1',
    status: 'unavailable',
    scenario,
    result: null,
    message,
    show_comparables: false,
  };
}

function friendlyCalculationError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/snapshot.*current|no longer current/i.test(message)) return 'The historical data changed. Rerun the market question before testing this trade.';
  if (/contract/i.test(message)) return 'The current public contract data does not support this calculation.';
  if (/position group/i.test(message)) return 'The player’s current position could not be matched to the historical market data.';
  return 'This trade could not be calculated from the available public data.';
}

function roundValues(value: string): number[] {
  const matches = uniqueMatches(value, /\b(first|second|third|fourth|fifth|sixth|seventh|[1-7](?:st|nd|rd|th)|round\s+[1-7])\b/gi)
    .map(parseRound)
    .filter((round): round is number => round != null);
  return [...new Set(matches)];
}

function parseRound(value: string): number | null {
  const normalized = value.toLowerCase().replace(/^round\s+/, '');
  const words: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7 };
  if (words[normalized]) return words[normalized];
  const number = Number.parseInt(normalized, 10);
  return number >= 1 && number <= 7 ? number : null;
}

function uniqueMatches(value: string, pattern: RegExp): string[] {
  return [...value.matchAll(pattern)].map((match) => match[1] ?? match[0]);
}

function cleanPlayerQuery(value: string): string {
  return value.trim().replace(/^(?:the giants'?\s+)?/i, '').replace(/[?.!,]+$/, '').trim();
}

function looksLikePlayerName(value: string): boolean {
  return /^[a-z][a-z .'-]{1,60}[?.!]*$/i.test(value.trim());
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function joinNames(names: string[]): string {
  if (names.length < 2) return names[0] ?? 'that player';
  if (names.length === 2) return `${names[0]} or ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, or ${names.at(-1)}`;
}
