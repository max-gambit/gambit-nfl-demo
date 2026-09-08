import type { NflHistoricalSelection, NflTransactionMarketAnalysis } from '@shared/types';
import { nflTransactionMarketCohortEvidence } from '@shared/nflTransactionMarket';
import { isNflTransactionMarketRefinement, positionGroupsFromQuestion, teamIdsFromQuestion } from './question.js';

/** Record-level questions take a different path from aggregate period comparisons. */
export function isHistoricalRecordQuestion(question: string, hasMarket = false, hasSelection = false): boolean {
  if (/\b(?:cap|salary|dead money|cba|rules?)\b/i.test(question)) return false;
  if (/\b(?:comparables?|if|would|could|proposed|proposal)\b/i.test(question)) return false;
  if (/^show (?:me )?(?:the )?trades? behind (?:that|this|the (?:proposal|return))[?.!]*$/i.test(question.trim())) return false;
  if (isNflTransactionMarketRefinement(question)) return hasSelection && !/^compare\b/i.test(question) && positionGroupsFromQuestion(question).length === 0 && !/\b(?:all teams?|all positions?|signings?|extensions?|tags?|claims?|waivers?|releases?|cuts?)\b/i.test(question);
  if (/\b(?:complete|full|whole) (?:trade )?packages?\b|\bboth sides\b|\bmulti[- ]player\b|\bexcluded\b/i.test(question)) return true;
  if (/\bwhat (?:did|does) .+ (?:get|receive|return)\b/i.test(question)) return true;
  if (/\b(?:trades?|deals?|packages?)\b/i.test(question) && /\b(?:show|list|which|involving|include[ds]?|return(?:ed|ing)?|received|compensation|assets)\b/i.test(question)) return true;
  if (!hasMarket) return false;
  if (/^(?:only(?: include)?|show(?: me)?|in|what about)\s+(?:trades? (?:from|in)\s+)?20\d{2}[?.!]*$/i.test(question.trim())) return true;
  if (/^(?:only|show|which|what about)\b/i.test(question) && /\b(?:first|second|third|fourth|fifth|sixth|seventh|[1-7](?:st|nd|rd|th))[- ]round\b/i.test(question)) return true;
  return hasSelection && isNflTransactionMarketRefinement(question);
}

const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

export function selectHistoricalRecords(question: string, market: NflTransactionMarketAnalysis, prior: NflHistoricalSelection | null = null) {
  const evidence = nflTransactionMarketCohortEvidence(market);
  const text = ` ${normalize(question)} `;
  const names = [...new Set(evidence.rows.map(row => row.player_name))];
  const named = names.filter(name => {
    const full = normalize(name), last = full.split(' ').at(-1)!;
    return text.includes(` ${full} `) || (last.length >= 4 && text.includes(` ${last} `) && names.filter(other => normalize(other).split(' ').at(-1) === last).length === 1);
  });
  const refinement = /^(?:only|filter|narrow|restrict|in\s+20|what about\s+20)/i.test(question.trim());
  const selection: NflHistoricalSelection = prior && refinement ? structuredClone(prior) : {
    player_names: [], years: [], pick_rounds: [], team_ids: [], multi_player_only: false, event_ids: [], summary: '',
  };
  if (named.length) selection.player_names = named;
  const range = question.match(/\b(20\d{2})\s*(?:to|through|[-–—])\s*(20\d{2})\b/i);
  const years = [...question.matchAll(/\b20\d{2}\b/g)].map(match => Number(match[0]));
  const pickYears = [...question.matchAll(/\b(20\d{2})\s+(?:first|second|third|fourth|fifth|sixth|seventh|[1-7](?:st|nd|rd|th)|round|r[1-7])\b/gi)].map(match => Number(match[1]));
  if (pickYears.length) selection.pick_years = [...new Set(pickYears)];
  const boundary = question.match(/\b(since|after|before|through|until)\s+(20\d{2})\b/i);
  if (!range && boundary) {
    const year = Number(boundary[2]), operator = boundary[1].toLowerCase();
    selection.years = Array.from({ length: market.query.end_year - market.query.start_year + 1 }, (_, index) => market.query.start_year + index).filter(candidate => operator === 'after' ? candidate > year : operator === 'before' ? candidate < year : operator === 'since' ? candidate >= year : candidate <= year);
    // An empty valid year interval must stay empty rather than clear the filter.
    if (!selection.years.length) selection.years = [year < market.query.start_year ? market.query.start_year - 1 : market.query.end_year + 1];
  } else if (range) selection.years = Array.from({ length: Math.max(0, Math.min(100, Number(range[2]) - Number(range[1]) + 1)) }, (_, index) => Number(range[1]) + index);
  else if (years.length && !/\b20\d{2}\s+(?:first|second|third|fourth|fifth|sixth|seventh|[1-7](?:st|nd|rd|th)|round|r[1-7])\b/i.test(question)) selection.years = [...new Set(years)];
  const round = question.match(/\b(first|second|third|fourth|fifth|sixth|seventh|[1-7](?:st|nd|rd|th)?)[- ]round\b|\bround\s+([1-7])\b/i);
  if (round) {
    const value = (round[1] ?? round[2]).toLowerCase();
    selection.pick_rounds = [Number.parseInt(value) || ['first','second','third','fourth','fifth','sixth','seventh'].indexOf(value) + 1];
  }
  const teams = teamIdsFromQuestion(question);
  if (teams.length) selection.team_ids = teams;
  if (/\b(?:multi[- ]player|excluded)\b/i.test(question)) selection.multi_player_only = true;
  // An unidentified requested subject must never expand into every trade.
  const namedCue = /\b(?:for|involving|about)\s+[a-z][a-z'.-]*(?:\s+[a-z][a-z'.-]*){0,2}[?.!]*$/i.test(question.trim())
    || /\bwhat (?:did|does) .+ (?:get|receive)\b/i.test(question);
  const requestedSubject = question.match(/\b(?:for|involving|about)\s+(.+?)[?.!]*$/i)?.[1];
  const beforeTrade = question.match(/^(?:show|list|what about)\s+(?:me\s+)?(?:the\s+)?(.+?)\s+(?:trade|deal)s?[?.!]*$/i)?.[1];
  const unmatchedBeforeTrade = Boolean(beforeTrade && !named.length && !teamIdsFromQuestion(beforeTrade).length && !positionGroupsFromQuestion(beforeTrade).length && normalize(beforeTrade).replace(/\b(?:complete|full|whole|all|historical|recent|latest|20\d{2})\b/g, '').trim());
  const unknownSubject = unmatchedBeforeTrade || (namedCue && !named.length && (!teams.length || Boolean(requestedSubject && !teamIdsFromQuestion(requestedSubject).length)) && !/\b(?:packages?|trades?|deals?|picks?|round|both sides)\b[?.!]*$/i.test(question.trim()));
  const unsupportedFilter = /\b(?:without|didn't|did not|never|less than|more than|at least|at most|younger|older|under age|over age)\b/i.test(question);
  const selected = unknownSubject || unsupportedFilter ? [] : evidence.rows.filter(row => row.transaction_type === 'trade'
    && (!selection.player_names.length || selection.player_names.includes(row.player_name))
    && (!selection.years.length || selection.years.includes(row.event_year))
    && (!selection.team_ids.length || selection.team_ids.includes(row.from_team_id ?? '') || selection.team_ids.includes(row.to_team_id ?? ''))
    && (!selection.multi_player_only || (row.trade_package?.assets.filter(asset => asset.asset_type === 'player').length ?? 0) > 1)
    && (!(selection.pick_rounds.length || selection.pick_years?.length) || row.trade_package?.assets.some(asset => asset.asset_type === 'draft_pick' && (!selection.pick_rounds.length || selection.pick_rounds.includes(asset.pick_round ?? 0)) && (!selection.pick_years?.length || selection.pick_years.includes(asset.pick_season ?? 0)) && asset.received_team_id === row.from_team_id)));
  selected.sort((a, b) => b.event_year - a.event_year || (b.event_date ?? '').localeCompare(a.event_date ?? '') || a.player_name.localeCompare(b.player_name));
  const rows = [...new Map(selected.map(row => [row.trade_id ?? row.event_id, row])).values()];
  selection.event_ids = rows.map(row => row.event_id);
  selection.summary = [selection.player_names.join(', '), selection.years.length ? `trade year ${selection.years.join(', ')}` : '', selection.pick_years?.length ? `draft year ${selection.pick_years.join(', ')}` : '', selection.pick_rounds.length ? `a round ${selection.pick_rounds.join(', ')} pick received by the player's former team` : '', selection.team_ids.length ? `${selection.team_ids.join(', ')} on either side` : '', selection.multi_player_only ? 'packages containing more than one player' : ''].filter(Boolean).join(' · ') || 'all recorded trades in the selected cohort';
  if (unknownSubject) selection.summary = 'No selection executed: the requested subject is not identified in this cohort.';
  if (unsupportedFilter) selection.summary = 'No selection executed: this package view supports player, team, trade year, returned draft round and draft year filters. The requested exclusion or numeric condition was not applied.';
  return { rows, selection, evidence, unknownSubject, unsupportedFilter };
}
