import { readFile } from 'node:fs/promises';
import type { FactualAnswer } from '../nfl_facts/answer.js';
import { factualBody } from '@shared/nflFacts';
import { teamIdsFromQuestion } from '../nfl_transactions/question.js';

export type NflExampleDomain = 'college' | 'availability' | 'coaching';
export type NflExampleSituation = 'all' | 'third_down' | 'red_zone' | 'third_down_red_zone';
export interface NflExampleArgs {
  domain: NflExampleDomain;
  question: string;
  collegePriority?: 'receiving' | 'movement_blocking' | 'production';
  teamId?: string;
  comparisonTeamId?: string;
  situation?: NflExampleSituation;
  weekStart?: number;
  weekEnd?: number;
  season?: number;
  draftClass?: number;
  playerName?: string;
  assumedUnavailable?: boolean;
}

export const nflExampleCoverage = {
  college: { status: 'bounded_historical_example', draft_class: 2025, stat_season: 2024, players: ['Tyler Warren', 'Colston Loveland'], priorities: ['production', 'receiving', 'movement_blocking'], current_eligibility_verified: false },
  availability: { status: 'bounded_historical_example', team_id: 'NYG', game_date: '2025-09-21', practice_dates: ['2025-09-17', '2025-09-18', '2025-09-19'], report_players: 13, live_injury_feed: false },
  coaching: { status: 'bounded_historical_example', season: 2025, season_type: 'REG', teams: ['NYG', 'KC', 'DAL'], weeks: [1, 2, 3], captured_rows: 765, qualifying_plays: 572, situations: ['all', 'third_down', 'red_zone', 'third_down_red_zone'], route_coverage_personnel_charting: false },
} as const;

export const nflExampleTool = {
  name: 'get_nfl_example_evidence',
  description: 'Read bounded historical football evidence. College: Warren/Loveland 2025 draft class with 2024 official stats and attributed public scouting, optionally refocused on receiving or movement blocking. Availability: Giants Sept17–21 2025 official report and observed snaps; no live injury feed, prognosis or probabilities. Coaching: actual NYG/KC/DAL 2025 REG Week1–3 offensive PBP, third down/red zone/self-scout; no charted routes/coverage/personnel. Unsupported players, teams and windows must not be substituted. These examples do not establish current eligibility, availability, coaching tendencies or team-private evaluations. Pass the user question plus explicit bounded options; use a separate roster tool for a user-assumed absence scenario.',
  input_schema: {
    type: 'object' as const,
    properties: {
      domain: { type: 'string', enum: ['college', 'availability', 'coaching'] },
      question: { type: 'string' },
      collegePriority: { type: 'string', enum: ['production', 'receiving', 'movement_blocking'] },
      teamId: { type: 'string', description: 'Requested offense for coaching (NYG, KC or DAL), or NYG for availability. Preserve unsupported requests so the tool can refuse substitution.' },
      comparisonTeamId: { type: 'string', description: 'Second offense: NYG, KC or DAL. Defaults to NYG for opponent comparison, KC for a Giants self-scout comparison.' },
      situation: { type: 'string', enum: ['all', 'third_down', 'red_zone', 'third_down_red_zone'] },
      weekStart: { type: 'integer', minimum: 1, maximum: 3 },
      weekEnd: { type: 'integer', minimum: 1, maximum: 3 },
      season: { type: 'integer', description: 'Only 2025 is captured for coaching and availability.' },
      draftClass: { type: 'integer', description: 'Only the historical 2025 draft class is captured.' },
      playerName: { type: 'string', description: 'College: one of the two captured names. Availability: a captured Giants report player, or all. Default Andrew Thomas.' },
      assumedUnavailable: { type: 'boolean', description: 'User-supplied scenario only; never a medical finding. Does not overwrite historical observations.' },
    },
    required: ['domain', 'question'],
    additionalProperties: false,
  },
};

interface ExampleSource { id: string; source_url: string; title: string; effective_date: string; captured_at: string; sha256: string; bytes: number; last_modified: string | null }
interface CollegePlayer {
  name: string; school: string; position: string; games: number; receptions: number; receiving_yards: number; receiving_touchdowns: number; height_inches: number; weight_pounds: number;
  stats_source_id: string; measurement_source_id: string; stats_locator: string; measurement_locator: string;
  assessment: { author: string; source_id: string; published_on: string; original_url: string; receiving: string; movement_blocking: string };
}
interface CollegeSnapshot { schema: string; captured_at: string; draft_class: number; stat_season: number; measurement_basis: string; sources: ExampleSource[]; players: CollegePlayer[] }
interface AvailabilityPlayer {
  name: string; position: string; reported_injury: string; practice: Array<{ date: string; status: string }>; game_status: string; gameday: string;
  offensive_snaps: number | null; reported_offensive_snap_percent: number | null; offense_team_snaps: number | null;
}
interface AvailabilitySnapshot { schema: string; captured_at: string; sources: ExampleSource[]; players: AvailabilityPlayer[]; observed_offensive_usage: Array<{ name: string; snaps: number; team_snaps: number }>; role_observation: string }
export interface NflExamplePlay {
  play_id: number; game_id: string; game_date: string; week: number; posteam: string; defteam: string; home_team: string; away_team: string; season_type: string;
  down: number | null; ydstogo: number | null; yardline_100: number | null; play_type: string | null; yards_gained: number | null;
  qb_dropback: number | null; qb_scramble: number | null; qb_kneel: number | null; qb_spike: number | null; sack: number | null;
  third_down_converted: number | null; first_down: number | null; touchdown: number | null; pass_touchdown: number | null; rush_touchdown: number | null; aborted_play: number | null; play_deleted: number | null;
}
interface CoachingSnapshot { schema: string; captured_at: string; season: number; source_row_count: number; captured_row_count: number; sources: ExampleSource[]; selection: string; games: string[]; plays: NflExamplePlay[] }

const TEAMS = ['NYG', 'KC', 'DAL'];
const normalize = (value: string) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
const pct = (numerator: number, denominator: number) => denominator ? `${(100 * numerator / denominator).toFixed(1)}%` : 'Not available (n=0)';
const rate = (numerator: number, denominator: number) => denominator ? (numerator / denominator).toFixed(2) : 'Not available (n=0)';
const date = (value: string) => value.slice(0, 10);

async function snapshot<T>(name: string, schema: string): Promise<T> {
  const value = JSON.parse(await readFile(new URL(`../../../data/nfl-examples/${name}.json`, import.meta.url), 'utf8'));
  if (value.schema !== schema) throw new Error('Unsupported evidence snapshot');
  return value as T;
}
function sourceRows(sources: ExampleSource[], kind: string): FactualAnswer['sources'] {
  return sources.map((source, i) => ({ ref_index: i + 1, kind, source: source.title, title: source.title, updated_at: source.effective_date, data: { ...source, sourceURL: source.source_url, freshness: 'historical evidence captured from public source', rows: [{ k: 'Effective period', v: source.effective_date }, { k: 'Captured', v: source.captured_at }] } }));
}
function unavailable(answer: string, caveats: string[] = []): FactualAnswer {
  return { body: factualBody({ answer, key_findings: [], tables: [], calculations: [], caveats, followups: [] }), sources: [] };
}
function matchName(name: string, candidates: string[]): string | undefined {
  const input = normalize(name);
  const exact = candidates.find(candidate => normalize(candidate) === input);
  if (exact) return exact;
  const surname = candidates.filter(candidate => normalize(candidate.split(' ').at(-1)!) === input);
  return surname.length === 1 ? surname[0] : undefined;
}
function questionName(question: string, names: string[]): string | undefined {
  const normalized = normalize(question);
  const matched = names.filter(name => normalized.includes(normalize(name)) || new RegExp(`\\b${name.split(' ').at(-1)!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(question));
  return matched.length === 1 ? matched[0] : undefined;
}

/** Supplies evidence and deterministic calculations; the chat model owns synthesis. */
export async function buildNflExampleEvidence(args: NflExampleArgs): Promise<FactualAnswer> {
  if (!args || typeof args.question !== 'string' || !['college', 'availability', 'coaching'].includes(args.domain)) return unavailable('Choose college, availability or coaching evidence and include the question.');
  try {
    if (args.domain === 'college') return collegeEvidence(args, await snapshot<CollegeSnapshot>('college', 'nfl_examples_college.v1'));
    if (args.domain === 'availability') return availabilityEvidence(args, await snapshot<AvailabilitySnapshot>('availability', 'nfl_examples_availability.v1'));
    return coachingEvidence(args, await snapshot<CoachingSnapshot>('coaching', 'nfl_examples_coaching.v1'));
  } catch {
    return unavailable('The saved historical football evidence could not be loaded. No replacement facts were generated.');
  }
}

function collegeEvidence(args: NflExampleArgs, data: CollegeSnapshot): FactualAnswer {
  const requestedClass = args.draftClass ?? Number(args.question.match(/\b(20\d{2})\s+(?:nfl\s+)?draft\b/i)?.[1] ?? 2025);
  if (requestedClass !== 2025) return unavailable(`The college example covers only the historical 2025 draft class. No ${requestedClass} prospect data is captured.`, ['Current eligibility and draft availability are not verified.']);
  const priority = args.collegePriority ?? (/\b(block|blocking|short[- ]yardage|inline|in-line|movement)\b/i.test(args.question) ? 'movement_blocking' : /\b(detached|receiving|route|routes|separation)\b/i.test(args.question) ? 'receiving' : 'production');
  if (!['production', 'receiving', 'movement_blocking'].includes(priority)) return unavailable('Supported college priorities are production, receiving and movement blocking.');
  const named = args.playerName && args.playerName.toLowerCase() !== 'all' ? matchName(args.playerName, data.players.map(p => p.name)) : undefined;
  if (args.playerName && args.playerName.toLowerCase() !== 'all' && !named) return unavailable(`No captured college record for ${args.playerName}. The historical 2025 draft example contains Tyler Warren and Colston Loveland only.`);
  const players = data.players.filter(player => !named || player.name === named);
  // Source-led role focus changes presentation, never a synthetic grade or ranking.
  if (priority === 'receiving') players.sort((a, b) => Number(b.name === 'Colston Loveland') - Number(a.name === 'Colston Loveland'));
  const sources = sourceRows(data.sources, 'COLLEGE');
  sources.forEach(source => {
    source.data!.numeric_provenance = players.filter(p => p.stats_source_id === source.data!.id).map(p => ({ player: p.name, season: 2024, games: p.games, receptions: p.receptions, receiving_yards: p.receiving_yards, receiving_touchdowns: p.receiving_touchdowns, height_inches: p.height_inches, weight_pounds: p.weight_pounds, stats_locator: p.stats_locator, measurement_locator: p.measurement_locator }));
    if (source.data!.id === 'scouting') source.data!.attribution = players.map(p => ({ player: p.name, ...p.assessment, evidence_status: 'public attributed assessment; not a team grade or measured performance' }));
  });
  const statsRefs = players.map(p => data.sources.findIndex(s => s.id === p.stats_source_id) + 1);
  const role = priority === 'receiving' ? 'detached receiving' : priority === 'movement_blocking' ? 'movement blocking / short-yardage' : 'recorded production';
  const answer = priority === 'production'
    ? 'Historical 2025 draft class: Warren recorded 104 catches for 1,233 yards in 16 games in 2024; Loveland recorded 56 for 582 in 10. Per-game rates account for the different game counts, but do not adjust for opportunity or competition.'
    : `Historical 2025 draft class, ${role} focus. Lance Zierlein’s public assessment: ${players.map(p => `${p.name}: ${p.assessment[priority]}`).join(' ')} These are attributed role observations, not a prospect ranking or an NFL outcome prediction.`;
  return { body: factualBody({
    example_query:{domain:'college',question:args.question,draftClass:2025,collegePriority:priority,playerName:named??'all'},
    answer: named && priority === 'production' ? `Historical 2025 draft class: ${named}'s official 2024 college record, with per-game calculations.` : answer,
    key_findings: [{ label: `2025 draft class · ${role}`, body: priority === 'production' ? 'Official 2024 college roster measurements are kept separate from combine measurements. The compared receiving totals use the same stat season.' : 'Lance Zierlein is the evaluator; Saints.com reproduced these NFL.com profiles on April 22, 2025. Reported strengths and limitations remain paired.', source_refs: priority === 'production' ? statsRefs : [3] }],
    tables: [
      { title: 'Historical 2025 draft class · official 2024 college production', columns: ['Player', 'School', 'Games', 'Receptions', 'Rec yards', 'Rec TD', 'Rec / game', 'Yards / game', 'College height (in)', 'College weight (lb)'], rows: players.map(p => [p.name, p.school, p.games, p.receptions, p.receiving_yards, p.receiving_touchdowns, rate(p.receptions, p.games), rate(p.receiving_yards, p.games), p.height_inches, p.weight_pounds]), source_refs: statsRefs },
      { title: `Historical 2025 draft class · public role assessments (April 22, 2025)`, columns: ['Player', priority === 'movement_blocking' ? 'Focus: movement / blocking' : 'Focus: receiving', priority === 'movement_blocking' ? 'Receiving context' : 'Movement / blocking context', 'Evaluator'], rows: players.map(p => [p.name, priority === 'movement_blocking' ? p.assessment.movement_blocking : p.assessment.receiving, priority === 'movement_blocking' ? p.assessment.receiving : p.assessment.movement_blocking, p.assessment.author]), source_refs: [3] },
    ],
    calculations: players.flatMap(p => {
      const ref = data.sources.findIndex(s => s.id === p.stats_source_id) + 1;
      return [{ label: `${p.name}: 2024 receiving yards per game`, formula: `${p.receiving_yards} receiving yards / ${p.games} games`, value: rate(p.receiving_yards, p.games), source_refs: [ref] }, { label: `${p.name}: 2024 receptions per game`, formula: `${p.receptions} receptions / ${p.games} games`, value: rate(p.receptions, p.games), source_refs: [ref] }];
    }),
    caveats: [`Captured ${date(data.captured_at)}. Historical 2025 draft class with 2024 statistics; these players are not presented as current college prospects or available draft targets.`, data.measurement_basis, 'Targets, routes, blocking grades, competition adjustment and team-private scouting are not captured. Rate differences do not establish better NFL performance or probability of success.', 'Public scouting assessments are attributed opinions as of April 2025, not verified forecasts or current player evaluations.'],
    followups: priority === 'movement_blocking' ? ['Change the 2025 college example to detached receiving; retain each prospect’s limitations.'] : ['Change the 2025 college example to movement blocking and short-yardage responsibilities.', 'Show the 2024 per-game receiving production for the same two prospects.'],
  }), sources };
}

function availabilityEvidence(args: NflExampleArgs, data: AvailabilitySnapshot): FactualAnswer {
  const explicitTeams = teamIdsFromQuestion(args.question);
  if ((args.teamId && args.teamId !== 'NYG') || explicitTeams.some(team => team !== 'NYG' && team !== 'KC')) return unavailable('The availability example contains the Giants official September 17–21, 2025 report only. No report for the requested team was captured.');
  if ((args.season != null && args.season !== 2025) || (args.weekStart != null && args.weekStart !== 3) || (args.weekEnd != null && args.weekEnd !== 3)) return unavailable('The availability example covers 2025 Week 3 only: September 17–21 practice/game status and September 21 observed usage.');
  const request = args.playerName ?? questionName(args.question, data.players.map(p => p.name)) ?? (/\b(all|everyone|report|changes|flags)\b/i.test(args.question) ? 'all' : 'Andrew Thomas');
  const name = request.toLowerCase() === 'all' ? undefined : matchName(request, data.players.map(p => p.name));
  if (request.toLowerCase() !== 'all' && !name) return unavailable(`No captured September 2025 injury-report row for ${request}. The tool will not substitute a different player.`, ['Absence from this captured report does not establish health, active status or future availability.']);
  const players = data.players.filter(p => !name || p.name === name);
  const sources = sourceRows(data.sources, 'AVAILABILITY');
  sources[0].data!.numeric_provenance = players.map(p => ({ player: p.name, locator: `NEW YORK GIANTS table / ${p.name}`, practice: p.practice, game_status: p.game_status, reported_injury: p.reported_injury }));
  sources[1].data!.gameday_provenance = players.filter(p => p.gameday === 'Inactive' || p.name === 'Andrew Thomas').map(p => ({ player: p.name, observation: p.gameday === 'Inactive' ? 'Official inactive list' : 'Explicitly reported active' }));
  sources[2].data!.numeric_provenance = players.filter(p => p.gameday === 'Observed offensive participation').map(p => ({ player: p.name, offensive_snaps: p.offensive_snaps, offense_team_snaps: p.offense_team_snaps, reported_percent: p.reported_offensive_snap_percent, locator: `Giants.com Week 3 snap counts / ${p.name}` }));
  const changes = (player: AvailabilityPlayer) => player.practice.slice(1).flatMap((entry, i) => entry.status !== player.practice[i].status ? [`${player.practice[i].date} ${player.practice[i].status} → ${entry.date} ${entry.status}`] : []);
  const selectedThomas = name === 'Andrew Thomas';
  const scenario = args.assumedUnavailable === true;
  return { body: factualBody({
    example_query:{domain:'availability',question:args.question,season:2025,teamId:'NYG',playerName:name??'all',assumedUnavailable:scenario},
    answer: `Historical September 2025 availability example. ${selectedThomas ? 'Andrew Thomas was limited in all three practices, listed Questionable, then recorded 28 of 66 offensive snaps against Kansas City on September 21 (42.4%).' : `${players.length} Giants report ${players.length === 1 ? 'row is' : 'rows are'} shown with dated practice changes and observed game usage.`}${scenario ? ` User scenario: assume ${name ?? 'the selected player'} is unavailable; that assumption is separate from the historical report.` : ''}`,
    key_findings: [{ label: 'Practice participation changes', body: players.flatMap(p => changes(p).map(change => `${p.name}: ${change}`)).join('; ') || 'No change among the selected players’ three reported practice participation labels.', source_refs: [1] }, { label: 'Use of the report', body: 'A practice label, game designation and recorded game participation describe different observations. None is a medical prognosis or current availability determination.', source_refs: [1, 2, 3] }],
    tables: [{ title: 'Historical Sept 17–21, 2025 · Giants practice and observed game participation', columns: ['Player', 'Reported injury', 'Sept 17', 'Sept 18', 'Sept 19', 'Game designation', 'Observed Sept 21', 'Offensive snaps', 'Offensive snap share', 'Change flag'], rows: players.map(p => [p.name, p.reported_injury, ...p.practice.map(e => e.status), p.game_status, p.gameday, p.offensive_snaps, p.offense_team_snaps == null ? p.gameday === 'Inactive' ? 'Inactive' : 'Not captured' : pct(p.offensive_snaps!, p.offense_team_snaps), changes(p).join('; ') || 'No practice-label change']), source_refs: [1, 2, 3] }, ...(selectedThomas ? [{ title: 'Historical Sept 21, 2025 · observed tackle usage', columns: ['Player', 'Offensive snaps', 'Team offensive snaps', 'Share'], rows: data.observed_offensive_usage.map(p => [p.name, p.snaps, p.team_snaps, pct(p.snaps, p.team_snaps)]), source_refs: [3] }] : [])],
    calculations: players.filter(p => p.offensive_snaps != null && p.offense_team_snaps != null).map(p => ({ label: `${p.name}: September 21 offensive snap share`, formula: `${p.offensive_snaps} / ${p.offense_team_snaps} × 100`, value: pct(p.offensive_snaps!, p.offense_team_snaps!), source_refs: [3] })),
    caveats: [`Captured ${date(data.captured_at)}; report effective September 17–21, 2025. This is not the current injury report.`, 'DNP = did not participate; LP = limited participation; FP = full participation. A missing game designation does not establish unrestricted workload.', 'Change flags compare reported labels only. They do not infer severity, injury risk, recovery, a return date or probability of playing.', 'Missing observed usage remains unknown. Inactive players have zero offensive snaps based on the official inactive list; defensive snap counts are not captured here.', 'nflverse documentation says its injury source stopped after 2024; this example uses dated official Giants reports rather than assuming a live injury feed.', ...(selectedThomas ? [data.role_observation] : []), ...(scenario ? ['The unavailability assumption is supplied by the user. Current roster assignments and contracts must come from a separate roster/cap check before considering a replacement scenario.'] : [])],
    followups: ['Show all Giants practice-label changes in that September 2025 report.', 'Show Gunner Olszewski’s reported participation and actual usage in the same game.', 'Assume Andrew Thomas is unavailable and examine roster coverage as a separate scenario.'],
  }), sources };
}

export function isQualifyingExamplePlay(play: NflExamplePlay): boolean {
  return ['pass', 'run'].includes(play.play_type ?? '') && ![play.qb_kneel, play.qb_spike, play.aborted_play, play.play_deleted].includes(1);
}
export function summarizeExamplePlays(plays: readonly NflExamplePlay[]) {
  const third = plays.filter(p => p.down === 3);
  return {
    plays: plays.length, games: [...new Set(plays.map(p => p.game_id))].length,
    dropbacks: plays.filter(p => p.qb_dropback === 1).length, known_dropback_rows: plays.filter(p => p.qb_dropback === 0 || p.qb_dropback === 1).length,
    yards: plays.reduce((sum, p) => sum + (p.yards_gained ?? 0), 0), known_yards_rows: plays.filter(p => p.yards_gained != null).length,
    third_downs: third.length, third_down_conversions: third.filter(p => p.third_down_converted === 1).length, known_third_down_rows: third.filter(p => p.third_down_converted === 0 || p.third_down_converted === 1).length,
    offensive_touchdowns: plays.filter(p => p.pass_touchdown === 1 || p.rush_touchdown === 1).length,
    play_ids: plays.map(p => `${p.game_id}:${p.play_id}`),
  };
}
function coachingEvidence(args: NflExampleArgs, data: CoachingSnapshot): FactualAnswer {
  if (/\b(defensive tendencies|defense only|defensive self[- ]scout)\b/i.test(args.question)) return unavailable('This captured coaching comparison covers offenses. Defensive tendencies require a separately defined defensive sample.');
  const mentionedTeams = teamIdsFromQuestion(args.question);
  const primary = args.teamId ?? (/\b(self[- ]scout|our offense|own offense|giants (?:our |as (?:our |the )?)?primary offense)\b/i.test(args.question) ? 'NYG' : mentionedTeams.find(t => t !== 'NYG') ?? 'KC');
  const teams = [primary, args.comparisonTeamId ?? mentionedTeams.find(t => t !== primary) ?? 'NYG'];
  if (teams[0] === teams[1] && !args.comparisonTeamId) teams[1] = 'KC';
  if ([...teams, ...mentionedTeams].some(t => !TEAMS.includes(t))) return unavailable(`Coaching evidence covers NYG, KC and DAL offenses only. The requested team is outside the captured 2025 Weeks 1–3 sample.`, ['No alternative team was substituted.']);
  if (teams[0] === teams[1]) return unavailable('Choose two different captured offenses (NYG, KC or DAL) for the coaching comparison.');
  const explicitYears = [...args.question.matchAll(/\b(20\d{2})\b/g)].map(m => Number(m[1]));
  if ((args.season != null && args.season !== 2025) || explicitYears.some(y => y !== 2025)) return unavailable('Only historical 2025 coaching plays are captured. No play sample for the requested season was substituted.');
  const weekMatch = args.question.match(/\bweeks?\s+(\d+)(?:\s*(?:[-–]|to|through)\s*(\d+))?/i);
  const weekStart = args.weekStart ?? (weekMatch ? Number(weekMatch[1]) : 1);
  const weekEnd = args.weekEnd ?? (weekMatch ? Number(weekMatch[2] ?? weekMatch[1]) : args.weekStart ?? 3);
  if (weekMatch && [weekMatch[1], weekMatch[2]].filter(Boolean).some(w => Number(w) < 1 || Number(w) > 3)) return unavailable('The requested week is outside the captured 2025 Weeks 1–3 coaching sample.');
  if (![weekStart, weekEnd].every(w => Number.isInteger(w) && w >= 1 && w <= 3) || weekEnd < weekStart) return unavailable('The coaching sample covers 2025 regular-season Weeks 1–3 only. Choose a valid subset of that window.');
  const thirdRequested = /\b(third[- ]downs?|3rd[- ]downs?)\b/i.test(args.question);
  const redRequested = /\bred[- ]zone\b/i.test(args.question);
  const situation = args.situation ?? (thirdRequested && redRequested ? 'third_down_red_zone' : thirdRequested ? 'third_down' : redRequested ? 'red_zone' : 'all');
  if (!['all', 'third_down', 'red_zone', 'third_down_red_zone'].includes(situation)) return unavailable('Supported coaching situations are all, third_down, red_zone and third_down_red_zone.');
  const raw = data.plays.filter(p => teams.includes(p.posteam) && p.week >= weekStart && p.week <= weekEnd);
  const qualifying = raw.filter(isQualifyingExamplePlay);
  const selected = qualifying.filter(p => (situation === 'all' || !situation.includes('third_down') || p.down === 3) && (!situation.includes('red_zone') || (p.yardline_100 != null && p.yardline_100 > 0 && p.yardline_100 <= 20)));
  const summary = teams.map(team => ({ team, ...summarizeExamplePlays(selected.filter(p => p.posteam === team)), raw_rows: raw.filter(p => p.posteam === team).length, qualifying_before_situation: qualifying.filter(p => p.posteam === team).length }));
  const sources = sourceRows(data.sources, 'COACHING');
  const label = `Historical 2025 Weeks ${weekStart}–${weekEnd} · ${situation.replaceAll('_', ' ')}`;
  sources[0].data!.numeric_provenance = { source_row_count: data.source_row_count, captured_row_count: data.captured_row_count, source_selection: data.selection, executed_selection: { teams, weekStart, weekEnd, situation }, team_aggregates: summary, artifact: 'data/nfl-examples/coaching.json' };
  const definitions = 'Counted plays are run/pass rows excluding kneels, spikes, aborted and deleted plays. Sacks and scrambles remain. Dropback share uses qb_dropback=1 over counted plays (pass attempts, sacks and scrambles). Third down means down=3; conversion is the source third_down_converted flag. Red zone means the play starts 1–20 yards from the opponent goal line. Red-zone counts are plays, not possessions or scoring trips.';
  return { body: factualBody({
    example_query:{domain:'coaching',question:args.question,season:2025,teamId:teams[0],comparisonTeamId:teams[1],weekStart,weekEnd,situation},
    answer: `${label}: ${teams[0]} has ${summary[0].plays} qualifying offensive plays and ${teams[1]} has ${summary[1].plays}. The comparison recalculates from those captured plays; it describes this historical sample, not current coaching tendencies.`,
    key_findings: [{ label: 'Selection and denominators', body: `${raw.length} source rows in the selected team/week scope → ${qualifying.length} qualifying scrimmage plays → ${selected.length} after the situation filter. Each offense played three games in the full Weeks 1–3 window; filtering can leave fewer represented games.`, source_refs: [1] }, { label: 'Metric definitions', body: definitions, source_refs: [1, 2] }],
    tables: [{ title: `${label} · offense comparison`, columns: ['Offense', 'Represented games', 'Plays', 'Dropbacks', 'Dropback share', 'Yards', 'Yards / play', 'Third-down conversions / plays', 'Third-down conversion share', 'Offensive TD plays'], rows: summary.map(s => [s.team, s.games, s.plays, s.dropbacks, s.known_dropback_rows === s.plays ? pct(s.dropbacks, s.plays) : 'Missing data', s.known_yards_rows === s.plays ? s.yards : null, s.known_yards_rows === s.plays ? rate(s.yards, s.plays) : 'Missing data', `${s.third_down_conversions} / ${s.third_downs}`, s.known_third_down_rows === s.third_downs ? pct(s.third_down_conversions, s.third_downs) : 'Missing data', s.offensive_touchdowns]), source_refs: [1, 2] },
      { title: `${label} · captured play audit (first 6 per offense; not a separate sample)`, columns: ['Offense', 'Game / play ID', 'Down', 'To go', 'Yards from opponent goal', 'Play type', 'Dropback', 'Yards gained'], rows: teams.flatMap(team => selected.filter(p => p.posteam === team).slice(0, 6).map(p => [p.posteam, `${p.game_id} / ${p.play_id}`, p.down, p.ydstogo, p.yardline_100, p.play_type, p.qb_dropback, p.yards_gained])), source_refs: [1] }],
    calculations: summary.flatMap(s => [
      { label: `${s.team}: dropback share`, formula: `${s.dropbacks} dropbacks / ${s.plays} counted plays × 100`, value: s.known_dropback_rows === s.plays ? pct(s.dropbacks, s.plays) : 'Missing data', source_refs: [1, 2] },
      { label: `${s.team}: yards per play`, formula: `${s.yards} yards / ${s.plays} counted plays`, value: s.known_yards_rows === s.plays ? rate(s.yards, s.plays) : 'Missing data', source_refs: [1] },
      { label: `${s.team}: third-down conversion share in selected sample`, formula: `${s.third_down_conversions} converted / ${s.third_downs} selected third-down plays × 100`, value: s.known_third_down_rows === s.third_downs ? pct(s.third_down_conversions, s.third_downs) : 'Missing data', source_refs: [1, 2] },
    ]),
    caveats: [`Captured ${date(data.captured_at)}. Only NYG/KC/DAL offense, 2025 REG Weeks 1–3; 765 captured source rows and 572 qualifying plays in the full saved sample. No 2026 tendencies are established.`, 'These are offensive samples against each team’s opponents in that window, not exclusively head-to-head plays. Opponent quality, game state and player availability are not adjusted.', 'Penalty/no-play rows are excluded, so these denominators can differ from official gamebook totals. Third-down and red-zone results are descriptive small samples, not stable rates or game-plan prescriptions.', 'Routes, defensive coverage, personnel groupings, pressure and individual assignments require charting that is not connected. nflverse participation data releases only after the postseason; no current participation feed is assumed.', ...summary.filter(s => s.plays < 30).map(s => `${s.team} has only ${s.plays} selected plays; a few outcomes materially change the displayed rates.`)],
    followups: ['Use third downs only in the same 2025 Weeks 1–3 sample.', 'Compare Dallas with the Giants in the red zone for 2025 Weeks 1–3.', 'Use the Giants as the self-scout offense and compare Week 3 with Kansas City.'],
  }), sources };
}
