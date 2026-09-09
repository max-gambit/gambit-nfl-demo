import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { factualBody } from '@shared/nflFacts';
import type { FactualAnswer } from '../nfl_facts/answer.js';
import { teamIdsFromQuestion } from '../nfl_transactions/question.js';
import { isQualifyingExamplePlay, sourceRows, summarizeExamplePlays, unavailable, type CoachingSnapshot, type ExampleSource, type NflExampleArgs, type NflExamplePlay } from './evidence.js';

interface PlayDetail { game_id: string; play_id: number; description: string; qtr: number | null; quarter_seconds_remaining: number | null; score_differential: number | null; shotgun: number | null; no_huddle: number | null }
interface PlayDetails { source: ExampleSource; byId: Map<string, PlayDetail>; base_artifact_sha256: string }
type Filters = NonNullable<NflExampleArgs['coachingFilters']>;
const TEAMS = ['NYG', 'KC', 'DAL'];
const id = (play: { game_id: string; play_id: number }) => `${play.game_id}:${play.play_id}`;
const pct = (n: number, d: number) => d ? `${(100 * n / d).toFixed(1)}%` : 'Not available (n=0)';
const rate = (n: number, d: number) => d ? (n / d).toFixed(2) : 'Not available (n=0)';
const distance = (play: NflExamplePlay) => play.ydstogo == null || play.ydstogo < 1 ? 'unknown' : play.ydstogo <= 3 ? 'short' : play.ydstogo <= 6 ? 'medium' : play.ydstogo <= 10 ? 'long' : 'very_long';
const zone = (play: NflExamplePlay) => play.yardline_100 == null || play.yardline_100 <= 0 || play.yardline_100 > 99 ? 'unknown' : play.yardline_100 <= 20 ? 'red_zone' : play.yardline_100 >= 80 ? 'backed_up' : 'open_field';
const outcome = (play: NflExamplePlay) => play.down !== 3 ? 'not_third_down' : play.third_down_converted === 1 ? 'converted' : play.third_down_converted === 0 ? 'failed' : 'unknown';
const stratum = (play: NflExamplePlay) => play.down == null || distance(play) === 'unknown' || zone(play) === 'unknown' ? null : `down ${play.down} / ${distance(play)} / ${zone(play)}`;

/** Descriptions join only to the exact reviewed base artifact and source bytes. */
export async function loadPlayDetails(data: CoachingSnapshot): Promise<PlayDetails> {
  const raw = await readFile(new URL('../../../data/nfl-examples/coaching.json', import.meta.url));
  const details = JSON.parse(await readFile(new URL('../../../data/nfl-examples/coaching-play-details.json', import.meta.url), 'utf8'));
  const hash = createHash('sha256').update(raw).digest('hex');
  if (details.schema !== 'nfl_examples_play_details.v1' || details.all_existing_fields_verified !== true || details.base_artifact_sha256 !== hash || details.base_source_sha256 !== data.sources[0].sha256 || details.source?.sha256 !== data.sources[0].sha256 || !Array.isArray(details.plays)) throw new Error('Play detail provenance does not match the reviewed snapshot');
  const byId = new Map<string, PlayDetail>(details.plays.map((play: PlayDetail) => [id(play), play]));
  if (byId.size !== data.plays.length || details.plays.length !== data.plays.length || data.plays.some(play => !byId.has(id(play)) || typeof byId.get(id(play))!.description !== 'string')) throw new Error('Play detail identities do not match the reviewed snapshot');
  return { byId, source: details.source, base_artifact_sha256: hash };
}

function filterError(filters: Filters): string | null {
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) return 'coachingFilters must be an object.';
  const supported = ['outcome', 'distanceBuckets', 'minYardsToGo', 'maxYardsToGo', 'fieldZone', 'playType', 'gameIds', 'playIds', 'reviewLimit'];
  const unknown = Object.keys(filters).filter(key => !supported.includes(key));
  if (unknown.length) return `Unsupported coaching filter fields: ${unknown.join(', ')}. No alternative field was substituted.`;
  for (const [key, values] of [['outcome', ['all', 'converted', 'failed', 'unknown']], ['fieldZone', ['all', 'red_zone', 'backed_up', 'open_field']], ['playType', ['all', 'dropback', 'designed_run']]] as const) {
    if (filters[key] != null && !values.includes(filters[key] as never)) return `Unsupported ${key}: ${String(filters[key])}.`;
  }
  if (filters.distanceBuckets != null && (!Array.isArray(filters.distanceBuckets) || !filters.distanceBuckets.length || filters.distanceBuckets.some(bucket => !['short', 'medium', 'long', 'very_long'].includes(bucket)))) return 'distanceBuckets must contain short (1–3), medium (4–6), long (7–10) or very_long (11+).';
  for (const key of ['minYardsToGo', 'maxYardsToGo'] as const) if (filters[key] != null && (!Number.isInteger(filters[key]) || filters[key]! < 1 || filters[key]! > 100)) return `${key} must be an integer from 1 through 100.`;
  if (filters.minYardsToGo != null && filters.maxYardsToGo != null && filters.minYardsToGo > filters.maxYardsToGo) return 'minYardsToGo cannot exceed maxYardsToGo.';
  for (const key of ['gameIds', 'playIds'] as const) if (filters[key] != null && (!Array.isArray(filters[key]) || !filters[key]!.length || filters[key]!.some(value => typeof value !== 'string' || !value.trim()))) return `${key} must be a non-empty list of exact captured identifiers.`;
  if (filters.reviewLimit != null && (!Number.isInteger(filters.reviewLimit) || filters.reviewLimit < 1 || filters.reviewLimit > 50)) return 'reviewLimit must be an integer from 1 through 50.';
  return null;
}

function applyFilters(play: NflExamplePlay, filters: Filters) {
  return (!filters.outcome || filters.outcome === 'all' || outcome(play) === filters.outcome)
    && (!filters.distanceBuckets || filters.distanceBuckets.includes(distance(play) as never))
    && (filters.minYardsToGo == null || (play.ydstogo != null && play.ydstogo >= filters.minYardsToGo))
    && (filters.maxYardsToGo == null || (play.ydstogo != null && play.ydstogo <= filters.maxYardsToGo))
    && (!filters.fieldZone || filters.fieldZone === 'all' || zone(play) === filters.fieldZone)
    && (!filters.playType || filters.playType === 'all' || (filters.playType === 'dropback' ? play.qb_dropback === 1 : play.play_type === 'run' && play.qb_dropback === 0))
    && (!filters.gameIds || filters.gameIds.includes(play.game_id))
    && (!filters.playIds || filters.playIds.includes(id(play)));
}

function balancedQueue(plays: NflExamplePlay[], teams: string[], limit: number) {
  const sort = (a: NflExamplePlay, b: NflExamplePlay) => Number(outcome(b) === 'failed') - Number(outcome(a) === 'failed') || a.game_id.localeCompare(b.game_id) || a.play_id - b.play_id;
  const groups = teams.map(team => plays.filter(play => play.posteam === team).sort(sort));
  const queue: NflExamplePlay[] = [];
  for (let index = 0; queue.length < limit && groups.some(group => index < group.length); index++) for (const group of groups) if (group[index] && queue.length < limit) queue.push(group[index]);
  return queue;
}

export function coachingWorkflow(args: NflExampleArgs, data: CoachingSnapshot, details: PlayDetails): FactualAnswer {
  if (/\b(defensive tendencies|defense only|defensive self[- ]scout)\b/i.test(args.question)) return unavailable('This captured coaching comparison covers offenses. Defensive tendencies require a separately defined defensive sample.');
  // A team code embedded in a game/play identity names a participant in that game,
  // not necessarily the offense the user asked to analyze. Resolve literal IDs first.
  const literalIdPattern = /\b20\d{2}_\d{1,3}_[A-Za-z][A-Za-z0-9]{1,9}_[A-Za-z][A-Za-z0-9]{1,9}(?::[A-Za-z0-9_-]*(?:\.\d+)?)?(?![A-Za-z0-9_])/g;
  const literalIds = [...new Set(args.question.match(literalIdPattern) ?? [])];
  const literalPlayIds = literalIds.filter(value => value.includes(':'));
  const literalGameIds = literalIds.filter(value => !value.includes(':'));
  const byPlayId = new Map(data.plays.map(play => [id(play), play]));
  const capturedGames = new Set(data.plays.map(play => play.game_id));
  const missingLiteralIds = [...literalPlayIds.filter(value => !byPlayId.has(value)), ...literalGameIds.filter(value => !capturedGames.has(value))];
  if (missingLiteralIds.length) return unavailable(`Literal game/play IDs are not captured: ${missingLiteralIds.join(', ')}. No replacement plays were selected.`);
  const literalRows = data.plays.filter(play => literalPlayIds.includes(id(play)) || literalGameIds.includes(play.game_id));
  const literalOffenses = [...new Set(literalRows.map(play => play.posteam))];
  const idOpponentCodes = new Set(literalRows.map(play => play.defteam));
  const mentionedTeams = teamIdsFromQuestion(args.question.replace(literalIdPattern, ' '));
  const misreadOpponentCodes = [...new Set([args.teamId, args.comparisonTeamId].filter((team): team is string => !!team && !TEAMS.includes(team) && idOpponentCodes.has(team) && !mentionedTeams.includes(team)))];
  const requestedPrimary = args.teamId && !misreadOpponentCodes.includes(args.teamId) ? args.teamId : undefined;
  const requestedComparison = args.comparisonTeamId && !misreadOpponentCodes.includes(args.comparisonTeamId) ? args.comparisonTeamId : undefined;
  const primary = requestedPrimary ?? literalOffenses[0] ?? (/\b(self[- ]scout|our offense|own offense|giants (?:our |as (?:our |the )?)?primary offense)\b/i.test(args.question) ? 'NYG' : mentionedTeams.find(team => team !== 'NYG') ?? 'KC');
  const comparison = requestedComparison ?? mentionedTeams.find(team => team !== primary) ?? (literalIds.length ? literalOffenses.find(team => team !== primary) : 'NYG');
  const teams = [primary, ...(comparison ? [comparison] : [])];
  if (teams[0] === teams[1] && literalIds.length && misreadOpponentCodes.length) teams.splice(1, 1);
  else if (teams[0] === teams[1] && !requestedComparison) teams[1] = 'KC';
  if ([...teams, ...mentionedTeams].some(team => !TEAMS.includes(team))) return unavailable('Coaching evidence covers NYG, KC and DAL offenses only. The requested team is outside the captured 2025 Weeks 1–3 sample.', ['No alternative team was substituted.']);
  if (teams[0] === teams[1]) return unavailable('Choose two different captured offenses (NYG, KC or DAL) for the coaching comparison.');
  if ((args.season != null && args.season !== 2025) || [...args.question.matchAll(/\b(20\d{2})\b/g)].some(match => match[1] !== '2025')) return unavailable('Only historical 2025 coaching plays are captured. No play sample for the requested season was substituted.');
  const weekMatch = args.question.match(/\bweeks?\s+(\d+)(?:\s*(?:[-–]|to|through)\s*(\d+))?/i);
  const weekStart = args.weekStart ?? (weekMatch ? Number(weekMatch[1]) : 1);
  const weekEnd = args.weekEnd ?? (weekMatch ? Number(weekMatch[2] ?? weekMatch[1]) : args.weekStart ?? 3);
  if (weekMatch && [weekMatch[1], weekMatch[2]].filter(Boolean).some(week => Number(week) < 1 || Number(week) > 3)) return unavailable('The requested week is outside the captured 2025 Weeks 1–3 coaching sample.');
  if (![weekStart, weekEnd].every(week => Number.isInteger(week) && week >= 1 && week <= 3) || weekEnd < weekStart) return unavailable('The coaching sample covers 2025 regular-season Weeks 1–3 only. Choose a valid subset of that window.');
  const thirdRequested = /\b(third[- ]downs?|3rd[- ]downs?)\b/i.test(args.question);
  const redRequested = /\bred[- ]zone\b/i.test(args.question);
  let situation = args.situation ?? (thirdRequested && redRequested ? 'third_down_red_zone' : thirdRequested ? 'third_down' : redRequested ? 'red_zone' : 'all');
  if (!['all', 'third_down', 'red_zone', 'third_down_red_zone'].includes(situation)) return unavailable('Supported coaching situations are all, third_down, red_zone and third_down_red_zone.');
  const filters: Filters = { ...args.coachingFilters };
  if (args.coachingFilters != null) { const error = filterError(args.coachingFilters); if (error) return unavailable(error); }
  if (literalIds.length) {
    const unknownSuppliedIds = [...(filters.playIds?.filter(value => !byPlayId.has(value)) ?? []), ...(filters.gameIds?.filter(value => !capturedGames.has(value)) ?? [])];
    if (unknownSuppliedIds.length) return unavailable(`Requested game/play IDs are not captured: ${unknownSuppliedIds.join(', ')}. No replacement plays were selected.`);
    // The current literal identity replaces an earlier play-list selection. Other
    // explicit filters and the requested week window remain in force.
    if (literalPlayIds.length) filters.playIds = literalPlayIds;
    if (literalGameIds.length) filters.gameIds = literalGameIds;
  }
  const bothOutcomesRequested = /\bconverted\b/i.test(args.question) && /\b(?:failed|unconverted)\b/i.test(args.question);
  if (!filters.outcome && !bothOutcomesRequested && /\b(?:failed|unconverted)\s+(?:third|3rd)[- ]downs?\b/i.test(args.question)) filters.outcome = 'failed';
  if (!filters.outcome && !bothOutcomesRequested && /\bconverted\s+(?:third|3rd)[- ]downs?\b/i.test(args.question)) filters.outcome = 'converted';
  if (filters.outcome && filters.outcome !== 'all') situation = situation.includes('red_zone') ? 'third_down_red_zone' : 'third_down';
  if (args.coachingView != null && !['summary', 'converted_failed', 'review_queue', 'matched_situations'].includes(args.coachingView)) return unavailable('Supported coaching views are summary, converted_failed, review_queue and matched_situations.');
  const exactInspection = literalPlayIds.length > 0 && !/\b(match|matched|like[- ]for[- ]like)\b/i.test(args.question);
  const view = exactInspection ? 'review_queue' : args.coachingView ?? (/\b(match|matched|like[- ]for[- ]like)\b/i.test(args.question) ? 'matched_situations' : /\b(film|review queue|plays to review|play list)\b/i.test(args.question) ? 'review_queue' : /\b(converted|failed|conversion|distance buckets)\b/i.test(args.question) ? 'converted_failed' : 'summary');
  if (!['summary', 'converted_failed', 'review_queue', 'matched_situations'].includes(view)) return unavailable('Supported coaching views are summary, converted_failed, review_queue and matched_situations.');
  if (args.comparisonMode != null && !['unadjusted', 'matched_down_distance_field_position'].includes(args.comparisonMode)) return unavailable('Unsupported comparison mode. Matching is available by down, distance bucket and field-position zone only.');
  const comparisonMode = exactInspection ? 'unadjusted' : args.comparisonMode ?? (view === 'matched_situations' ? 'matched_down_distance_field_position' : 'unadjusted');
  if (!['unadjusted', 'matched_down_distance_field_position'].includes(comparisonMode)) return unavailable('Unsupported comparison mode. Matching is available by down, distance bucket and field-position zone only.');
  const raw = data.plays.filter(play => teams.includes(play.posteam) && play.week >= weekStart && play.week <= weekEnd);
  const inScopeGameIds = new Set(raw.map(play => play.game_id));
  const inScopePlayIds = new Set(raw.map(id));
  const missingGames = filters.gameIds?.filter(game => !inScopeGameIds.has(game)) ?? [];
  const missingPlays = filters.playIds?.filter(play => !inScopePlayIds.has(play)) ?? [];
  if (missingGames.length || missingPlays.length) return unavailable(`Requested IDs are missing from the selected team/week scope: ${[...missingGames, ...missingPlays].join(', ')}. No replacement plays were selected.`);
  const qualifying = raw.filter(isQualifyingExamplePlay);
  const situated = qualifying.filter(play => (!situation.includes('third_down') || play.down === 3) && (!situation.includes('red_zone') || zone(play) === 'red_zone'));
  const filtered = situated.filter(play => applyFilters(play, filters));
  const cells = new Map<string, NflExamplePlay[]>();
  for (const play of filtered) { const key = stratum(play); if (key) cells.set(key, [...(cells.get(key) ?? []), play]); }
  const common = [...cells.entries()].filter(([, plays]) => teams.every(team => plays.some(play => play.posteam === team))).sort(([a], [b]) => a.localeCompare(b));
  const matchedIds = new Set(common.flatMap(([, plays]) => plays.map(id)));
  const selected = comparisonMode === 'matched_down_distance_field_position' ? filtered.filter(play => matchedIds.has(id(play))) : filtered;
  const summary = teams.map(team => ({ team, ...summarizeExamplePlays(selected.filter(play => play.posteam === team)), raw_rows: raw.filter(play => play.posteam === team).length, qualifying_before_situation: qualifying.filter(play => play.posteam === team).length }));
  const split = teams.flatMap(team => ['short', 'medium', 'long', 'very_long', 'unknown'].flatMap(bucket => {
    const plays = selected.filter(play => play.posteam === team && play.down === 3 && distance(play) === bucket);
    if (!plays.length) return [];
    const converted = plays.filter(play => outcome(play) === 'converted').length;
    const failed = plays.filter(play => outcome(play) === 'failed').length;
    return [{ team, distance_bucket: bucket, plays: plays.length, converted, failed, unknown: plays.length - converted - failed, play_ids: plays.map(id) }];
  }));
  const queue = balancedQueue(selected, teams, filters.reviewLimit ?? 12);
  const sources = sourceRows(data.sources, 'COACHING');
  const label = `Historical 2025 Weeks ${weekStart}–${weekEnd} · ${situation.replaceAll('_', ' ')}`;
  const query: NflExampleArgs = { domain: 'coaching', question: args.question, season: 2025, teamId: teams[0], comparisonTeamId: teams[1], weekStart, weekEnd, situation, coachingView: view, comparisonMode, coachingFilters: filters };
  const followupActions = [
    { label: 'Split third downs by distance and outcome', tool: 'get_nfl_example_evidence', args: { ...query, question: `Compare ${teams.join(' and ')} converted and failed third downs by distance in 2025 Weeks ${weekStart}–${weekEnd}.`, situation: situation.includes('red_zone') ? 'third_down_red_zone' : 'third_down', coachingView: 'converted_failed', coachingFilters: { ...filters, outcome: 'all' } } },
    { label: 'Review failed third-down plays', tool: 'get_nfl_example_evidence', args: { ...query, question: `Show ${teams.join(' and ')} failed third downs as a film review queue in 2025 Weeks ${weekStart}–${weekEnd}.`, situation: situation.includes('red_zone') ? 'third_down_red_zone' : 'third_down', coachingView: 'review_queue', coachingFilters: { ...filters, outcome: 'failed' } } },
    { label: 'Match down, distance and field position', tool: 'get_nfl_example_evidence', args: { ...query, question: `Match ${teams.join(' and ')} situations by down, distance and field position in 2025 Weeks ${weekStart}–${weekEnd}.`, coachingView: 'matched_situations', comparisonMode: 'matched_down_distance_field_position' } },
  ];
  const matchedRows = common.flatMap(([key, plays]) => teams.map(team => {
    const stats = summarizeExamplePlays(plays.filter(play => play.posteam === team));
    return [key, team, stats.plays, stats.dropbacks, stats.third_down_conversions, stats.known_third_down_rows - stats.third_down_conversions, stats.third_downs - stats.known_third_down_rows, stats.known_third_down_rows === stats.third_downs ? pct(stats.third_down_conversions, stats.third_downs) : 'Missing data'];
  }));
  const namedFindings = summary.map(stats => ({ label: `${stats.team} · selected historical plays`, body: `${stats.team}: ${stats.plays} counted plays across ${stats.games} represented games; ${stats.third_down_conversions} converted of ${stats.third_downs} third downs. ${stats.known_third_down_rows === stats.third_downs ? `${stats.third_downs - stats.third_down_conversions} failed third downs.` : 'Some third-down outcomes are unknown.'}`, source_refs: [1] }));
  const playFindings = literalPlayIds.length ? selected.map(play => ({ label: `Recorded play · ${id(play)}`, body: `${id(play)}: ${play.posteam} offense against ${play.defteam}; down ${play.down ?? 'unknown'}, ${play.ydstogo ?? 'unknown'} yards to go, ${play.yards_gained ?? 'unknown'} yards gained; source third-down outcome ${outcome(play)}. Original description: ${details.byId.get(id(play))!.description}`, source_refs: [1] })) : [];
  const hypotheses = literalPlayIds.length ? [
    { hypothesis: 'The reason for this recorded outcome is not established by the play text.', test: 'Inspect the identified play on film for coverage, pressure timing, protection responsibility, routes, assignments and the ball-carrier decision; then review comparable plays before treating it as a recurring issue.', observation_changes_recommendation: 'A verified assignment or decision error would direct a specific coaching correction. Repeated evidence in comparable situations would be needed before changing the broader coaching plan; one play alone does not establish a tendency.', status: 'Open coaching question; no causal finding from the recorded description' },
  ] : [
    { hypothesis: 'Distance or field-position composition contributes to the conversion gap.', test: 'Compare each shared down/distance/field-position cell and its sample size, then review the failed plays inside those cells.', observation_changes_recommendation: 'If the apparent gap changes after comparing shared situations, prioritize how the offense arrives in those situations before changing the third-down call menu.', status: 'Testable investigation hypothesis; no causal conclusion' },
    { hypothesis: 'Execution or call/defense interaction explains repeated failures within comparable situations.', test: 'Chart coverage, pressure timing, route/assignment, protection responsibility and result for the identified plays.', observation_changes_recommendation: 'Consistent pressure before route development would move the review toward protection; clean protection with repeated route/coverage problems would move it toward concept or execution review.', status: 'Requires user or staff film charting; these fields are not captured' },
  ];
  sources[0].data!.numeric_provenance = { source_row_count: data.source_row_count, captured_row_count: data.captured_row_count, source_selection: data.selection, executed_selection: { teams, weekStart, weekEnd, situation, filters, comparisonMode }, counts: { raw: raw.length, qualifying: qualifying.length, after_situation: situated.length, after_filters: filtered.length, after_matching: selected.length, displayed_queue: queue.length }, team_aggregates: summary, outcome_distance_splits: split, selected_play_ids: selected.map(id), excluded_requested_play_ids: filters.playIds?.filter(play => !selected.some(row => id(row) === play)) ?? [], artifact: 'data/nfl-examples/coaching.json' };
  sources[0].data!.play_details_capture = { ...details.source, base_artifact_sha256: details.base_artifact_sha256, all_existing_fields_verified: true };
  sources[0].data!.factual_assertions = [...namedFindings, ...playFindings].map(finding => ({ entity: finding.label.split(' · ')[0], claim: finding.body, source_refs: finding.source_refs }));
  sources[0].data!.counterfacts = [{ rejected_claim: 'Pressure, coverage, routes or assignments caused these failures', reason: 'The saved play-by-play has no charted fields establishing those causes. Play text can guide film review but is not a complete pressure/coverage chart.', source_refs: [1, 2] }, { rejected_claim: 'Matched results remove all confounding or establish a game-plan prescription', reason: 'Matching uses down, distance bucket and field-position zone only; opponent, score, personnel and availability are not controlled.', source_refs: [1] }];
  sources[0].data!.followup_actions = followupActions;
  sources[0].data!.workflow = { view, comparisonMode, literal_id_resolution: literalIds.length ? { play_ids: literalPlayIds, game_ids: literalGameIds, recorded_offenses: literalOffenses, ignored_opponent_argument_codes: misreadOpponentCodes, basis: 'Literal IDs are resolved against captured rows. Opponent codes embedded in an ID do not request that offense.' } : null, review_queue_rule: 'Failures first within each offense, then game/play ID; alternate offenses up to reviewLimit. Queue display does not change analytical denominators.', review_queue: queue.map(play => ({ ...details.byId.get(id(play)), evidence_id: id(play), posteam: play.posteam, defteam: play.defteam, down: play.down, ydstogo: play.ydstogo, yardline_100: play.yardline_100, yards_gained: play.yards_gained, qb_dropback: play.qb_dropback, outcome: outcome(play), distance_bucket: distance(play), field_zone: zone(play) })), matched_situations: { keys: ['down', 'distance_bucket', 'field_zone'], common_cells: common.map(([key, plays]) => ({ key, team_counts: Object.fromEntries(teams.map(team => [team, plays.filter(play => play.posteam === team).length])), play_ids: plays.map(id) })), excluded_plays_without_shared_cell: filtered.length - matchedIds.size, weighting: 'No weighting or causal adjustment; compare the displayed cells and their counts.' }, hypotheses, missing_charting_fields: ['coverage', 'pressure timing', 'route and assignment', 'protection responsibility', 'personnel grouping'], user_charting: { status: 'not connected', accepted_as_source: false, next_step: 'Use the exact review-queue game/play IDs when attaching attributed film observations. Unverified notes do not become official play-by-play facts.' } };
  const definitions = 'Counted plays are run/pass rows excluding kneels, spikes, aborted and deleted plays. Sacks and scrambles remain. Dropbacks use qb_dropback=1. Third-down conversion is the source third_down_converted flag; unknown flags remain unknown. Red zone starts 1–20 yards from the opponent goal; backed up starts 80–99 yards away; open field is 21–79. Distance buckets are short 1–3, medium 4–6, long 7–10 and very long 11+ yards.';
  return { body: factualBody({
    example_query: query as unknown as Record<string, unknown>,
    answer: `${label}: ${summary.map(stats => `${stats.team} has ${stats.plays} qualifying offensive ${stats.plays === 1 ? 'play' : 'plays'}`).join(' and ')}. ${comparisonMode === 'matched_down_distance_field_position' ? `Only ${common.length} shared down/distance/field-position cells remain; ${filtered.length - selected.length} unmatched plays are excluded.` : 'The saved plays are recalculated for the selected filters.'} ${view === 'review_queue' ? `The review queue shows ${queue.length} identified plays with their original descriptions.` : 'Use the converted/failed distance split and identified plays to choose the next film question.'}`,
    key_findings: [...namedFindings, ...playFindings, { label: 'Selection and denominators', body: `${raw.length} source rows → ${qualifying.length} qualifying plays → ${situated.length} after situation → ${filtered.length} after detailed filters → ${selected.length} after comparison mode. ${queue.length} plays are displayed in the review queue; its display limit does not change these counts.`, source_refs: [1] }, { label: 'Next coaching question', body: literalPlayIds.length ? 'The original description establishes the reported event and recorded result. Inspect film for coverage, pressure timing, protection responsibility, routes and decisions before assigning a cause; review comparable plays before changing the broader coaching plan.' : 'Check whether the conversion gap persists within shared down, distance and field-position groups. If it does, chart the identified failed plays before attributing the difference to pressure, coverage or assignments.', source_refs: [1, 2] }, { label: 'Metric definitions', body: definitions, source_refs: [1, 2] }],
    tables: [
      { title: `${label} · offense comparison`, columns: ['Offense', 'Represented games', 'Plays', 'Dropbacks', 'Dropback share', 'Yards', 'Yards / play', 'Third-down conversions / plays', 'Third-down conversion share', 'Offensive TD plays'], rows: summary.map(stats => [stats.team, stats.games, stats.plays, stats.dropbacks, stats.known_dropback_rows === stats.plays ? pct(stats.dropbacks, stats.plays) : 'Missing data', stats.known_yards_rows === stats.plays ? stats.yards : null, stats.known_yards_rows === stats.plays ? rate(stats.yards, stats.plays) : 'Missing data', `${stats.third_down_conversions} / ${stats.third_downs}`, stats.known_third_down_rows === stats.third_downs ? pct(stats.third_down_conversions, stats.third_downs) : 'Missing data', stats.offensive_touchdowns]), source_refs: [1, 2] },
      { title: `${label} · third-down converted / failed by distance`, columns: ['Offense', 'Distance bucket', 'Third-down plays', 'Converted', 'Failed', 'Unknown', 'Conversion share'], rows: split.map(row => [row.team, row.distance_bucket, row.plays, row.converted, row.failed, row.unknown, row.unknown ? 'Missing data' : pct(row.converted, row.plays)]), source_refs: [1, 2] },
      ...(view === 'matched_situations' || comparisonMode === 'matched_down_distance_field_position' ? [{ title: `${label} · shared situations only`, columns: ['Matched situation', 'Offense', 'Plays', 'Dropbacks', 'Third-down converted', 'Third-down failed', 'Third-down unknown', 'Third-down conversion share'], rows: matchedRows, source_refs: [1, 2] }] : []),
      { title: `${label} · film review queue (${queue.length} displayed of ${selected.length}; original descriptions)`, columns: ['Offense', 'Game / play ID', 'Outcome', 'Down', 'To go', 'Yards from opponent goal', 'Quarter', 'Score difference before play', 'Original play description'], rows: queue.map(play => { const detail = details.byId.get(id(play))!; return [play.posteam, id(play), outcome(play), play.down, play.ydstogo, play.yardline_100, detail.qtr, detail.score_differential, detail.description]; }), source_refs: [1] },
      ...(view === 'review_queue' || view === 'matched_situations' ? [{ title: `${label} · hypotheses for film review`, columns: ['Hypothesis', 'How to test it', 'Observation that changes the recommendation', 'Evidence status'], rows: hypotheses.map(hypothesis => [hypothesis.hypothesis, hypothesis.test, hypothesis.observation_changes_recommendation, hypothesis.status]), source_refs: [] }] : []),
    ],
    calculations: summary.flatMap(stats => [
      { label: `${stats.team}: dropback share`, formula: `${stats.dropbacks} dropbacks / ${stats.plays} counted plays × 100`, value: stats.known_dropback_rows === stats.plays ? pct(stats.dropbacks, stats.plays) : 'Missing data', source_refs: [1, 2] },
      { label: `${stats.team}: yards per play`, formula: `${stats.yards} yards / ${stats.plays} counted plays`, value: stats.known_yards_rows === stats.plays ? rate(stats.yards, stats.plays) : 'Missing data', source_refs: [1] },
      { label: `${stats.team}: third-down conversion share in selected sample`, formula: `${stats.third_down_conversions} converted / ${stats.third_downs} selected third-down plays × 100`, value: stats.known_third_down_rows === stats.third_downs ? pct(stats.third_down_conversions, stats.third_downs) : 'Missing data', source_refs: [1, 2] },
    ]),
    caveats: [`Base sample captured ${data.captured_at.slice(0, 10)}; original descriptions and game context verified ${details.source.captured_at.slice(0, 10)} against the same source bytes and all 765 saved rows. Only NYG/KC/DAL offense, 2025 REG Weeks 1–3 is captured. No current tendencies are established.`, 'These are offensive samples against each team’s opponents in that window, not exclusively head-to-head plays. Matching, when selected, uses down, distance bucket and field-position zone; opponent quality, score, personnel and player availability are not adjusted.', 'Penalty/no-play rows are excluded, so denominators can differ from official gamebook totals. Third-down and red-zone results are descriptive small samples, not stable rates or game-plan prescriptions. Red-zone counts are plays, not possessions or scoring trips.', 'Original play descriptions can identify events for film review. They do not establish coverage, pressure rate, route concepts or individual assignment responsibility. Those charting fields are not connected.', 'Selecting converted or failed outcomes conditions on the result. The resulting rate is not the offense’s overall third-down conversion rate; use the unfiltered converted/failed split for that comparison.', ...summary.filter(stats => stats.plays < 30).map(stats => `${stats.team} has only ${stats.plays} selected plays; a few outcomes materially change the displayed rates.`), ...(selected.length === 0 ? ['No plays satisfy this exact query. Filters were retained; no broader sample was substituted.'] : [])],
    followups: followupActions.map(action => action.args.question),
  }), sources };
}
