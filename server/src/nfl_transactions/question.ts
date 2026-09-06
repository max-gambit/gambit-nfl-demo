import type {
  NflPositionMarketGroup,
  NflTransactionAnalysisMode,
  NflTransactionMarketRequest,
  NflTransactionMarketResolvedQuery,
  NflTransactionType,
} from '@shared/types';
import { TEAM_ALIASES } from '../context_graph/schema.js';

const DEFAULT_START_YEAR = 2016;
const DEFAULT_END_YEAR = 2025;
const CURRENT_YTD_YEAR = 2026;

const POSITION_PATTERNS: Array<[NflPositionMarketGroup, RegExp]> = [
  ['QB', /\b(?:quarterbacks?|qbs?)\b/i],
  ['RB', /\b(?:running[- ]backs?|tailbacks?|rbs?)\b/i],
  ['WR', /\b(?:wide receivers?|receivers?|wrs?)\b/i],
  ['TE', /\b(?:tight ends?|tes?)\b/i],
  ['OT', /\b(?:offensive tackles?|ots?)\b/i],
  ['IOL', /\b(?:interior offensive line(?:men)?|interior o-?line(?:men)?|guards?|centers?|iols?)\b/i],
  ['EDGE', /\b(?:edge rushers?|edge defenders?|edges?)\b/i],
  ['IDL', /\b(?:interior defensive line(?:men)?|defensive tackles?|nose tackles?|idls?)\b/i],
  ['LB', /\b(?:linebackers?|lbs?)\b/i],
  ['CB', /\b(?:cornerbacks?|corners?|cbs?)\b/i],
  ['S', /\b(?:safet(?:y|ies)|defensive backs?|dbs?)\b/i],
  ['ST', /\b(?:special teams?|kickers?|punters?|long snappers?|sts?)\b/i],
];

const DEFAULT_MATERIAL_TYPES: NflTransactionType[] = [
  'trade',
  'free_agent_signing',
  're_signing',
  'extension',
  'tag',
  'waiver_claim',
  'release',
];

export function isNflTransactionMarketQuestion(question: string): boolean {
  const value = question.trim().toLowerCase();
  if (!value) return false;
  const marketLanguage = /\b(?:transaction|trade|traded|market|free agen|contract|extension|signing|comparables?|compensation|pick return|mobility|material[- ]move)/i.test(value);
  const analysisLanguage = /\b(?:trend|grew|grown|growth|shrank|shrunk|shrinkage|changed|compare|versus|vs\.?|before|after|since|recent|influenc|most often|over the last|historical)/i.test(value);
  return marketLanguage && analysisLanguage;
}

export function transactionMarketRequestFromQuestion(
  question: string,
  inherited?: NflTransactionMarketResolvedQuery | null,
): NflTransactionMarketRequest {
  const normalized = question.trim();
  const positions = positionGroupsFromQuestion(normalized);
  const explicitTypes = transactionTypesFromQuestion(normalized);
  const explicitTeams = teamIdsFromQuestion(normalized);
  const years = yearScopeFromQuestion(normalized);
  const analysisMode = analysisModeFromQuestion(normalized, inherited?.analysis_mode);
  const request: NflTransactionMarketRequest = {
    analysis_mode: analysisMode,
    start_year: years.start_year ?? inherited?.start_year ?? DEFAULT_START_YEAR,
    end_year: years.end_year ?? inherited?.end_year ?? DEFAULT_END_YEAR,
    comparison_year: years.comparison_year ?? inherited?.comparison_year ?? undefined,
    team_ids: explicitTeams.length ? explicitTeams : inherited?.team_ids.length ? inherited.team_ids : undefined,
    position_groups: positions.length ? positions : inherited?.position_groups.length ? inherited.position_groups : undefined,
    transaction_types: explicitTypes ?? (inherited?.transaction_types.length ? inherited.transaction_types : DEFAULT_MATERIAL_TYPES),
    include_ytd: years.include_ytd ?? inherited?.include_ytd ?? false,
    max_comparables: inherited?.max_comparables ?? 12,
  };

  if (hasExplicitLeagueScope(normalized)) delete request.team_ids;
  return request;
}

export function positionGroupsFromQuestion(question: string): NflPositionMarketGroup[] {
  return POSITION_PATTERNS
    .filter(([, pattern]) => pattern.test(question))
    .map(([position]) => position);
}

/**
 * Resolve explicitly named NFL teams without allowing short provider codes to
 * match ordinary prose (for example, "no" must not become New Orleans).
 */
export function teamIdsFromQuestion(question: string): string[] {
  const matches = Object.entries(TEAM_ALIASES)
    .sort(([left], [right]) => right.length - left.length)
    .flatMap(([alias, teamId]) => {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const flags = alias.length <= 3 && /^[A-Z]+$/.test(alias) ? 'g' : 'gi';
      const pattern = new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, flags);
      return pattern.test(question) ? [teamId] : [];
    });
  return [...new Set(matches)];
}

function transactionTypesFromQuestion(question: string): NflTransactionType[] | null {
  if (/\btrades? only\b|\btrade(?:s|d)? since\b|\bamong trades\b|\btrade market\b/i.test(question)) return ['trade'];
  if (/\bcontracts? only\b/i.test(question)) return ['free_agent_signing', 're_signing', 'extension', 'tag'];
  if (/\bfree agen(?:t|cy|ts) only\b/i.test(question)) return ['free_agent_signing'];
  if (/\breleases? only\b|\bcuts? only\b/i.test(question)) return ['release'];
  if (/\bwaivers? only\b/i.test(question)) return ['waiver_claim'];
  return null;
}

function analysisModeFromQuestion(
  question: string,
  inherited?: NflTransactionAnalysisMode,
): NflTransactionAnalysisMode {
  if (/\b(?:most influenced|most influence|drove (?:this|the) result|what drove|recent transactions?)\b/i.test(question)) return 'recent_influence';
  if (/\b(?:comparables?|supporting transactions?|show (?:me )?(?:the )?trades?)\b/i.test(question)) return 'comparables';
  if (/\b(?:before|after|versus|vs\.?)\b/i.test(question)) return 'period_comparison';
  if (/\bcompare\b/i.test(question)) {
    // “Compare EDGE with IOL” changes the position cohort, not the time
    // windows. Preserve the prior analysis mode so follow-ups do not silently
    // replace 2016–2018 vs 2023–2025 with a five-year split.
    if (positionGroupsFromQuestion(question).length >= 2) return inherited ?? 'ten_year_trend';
    return 'period_comparison';
  }
  if (/\b(?:trend|grew|grown|growth|shrank|shrunk|shrinkage|over the last|market)\b/i.test(question)) return 'ten_year_trend';
  return inherited ?? 'ten_year_trend';
}

function yearScopeFromQuestion(question: string): {
  start_year?: number;
  end_year?: number;
  comparison_year?: number;
  include_ytd?: boolean;
} {
  const result: { start_year?: number; end_year?: number; comparison_year?: number; include_ytd?: boolean } = {};
  const since = question.match(/\bsince\s+(20\d{2})\b/i);
  if (since) result.start_year = boundedYear(since[1]);
  const after = question.match(/\bafter\s+(20\d{2})\b/i);
  if (after) result.comparison_year = boundedYear(after[1]);
  const before = question.match(/\bbefore\s+(20\d{2})\b/i);
  if (before) result.comparison_year = boundedYear(before[1]);
  const between = question.match(/\b(?:between|from)\s+(20\d{2})\s+(?:and|to|through|-)\s*(20\d{2})\b/i);
  if (between) {
    result.start_year = boundedYear(between[1]);
    result.end_year = boundedYear(between[2]);
  }
  if (/\b(?:2026|ytd|year[- ]to[- ]date|this year)\b/i.test(question)) {
    result.include_ytd = true;
    result.end_year = Math.max(result.end_year ?? DEFAULT_END_YEAR, CURRENT_YTD_YEAR);
  }
  return result;
}

function boundedYear(value: string): number {
  const parsed = Number(value);
  return Math.max(1994, Math.min(CURRENT_YTD_YEAR, parsed));
}

function hasExplicitLeagueScope(question: string): boolean {
  return /\b(?:leaguewide|league-wide|across the nfl|nfl-wide|all teams?)\b/i.test(question);
}
