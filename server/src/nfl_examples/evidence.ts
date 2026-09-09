import { readFile } from 'node:fs/promises';
import type { FactualAnswer } from '../nfl_facts/answer.js';
import { factualBody } from '@shared/nflFacts';
import { healthWorkflow } from './healthWorkflow.js';
import { coachingWorkflow, loadPlayDetails } from './coachingWorkflow.js';

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
  assumedUnavailablePlayer?: string;
  availabilityView?: 'timeline' | 'review_priority' | 'contingency';
  coachingView?: 'summary' | 'converted_failed' | 'review_queue' | 'matched_situations';
  comparisonMode?: 'unadjusted' | 'matched_down_distance_field_position';
  coachingFilters?: {
    outcome?: 'all' | 'converted' | 'failed' | 'unknown';
    distanceBuckets?: Array<'short' | 'medium' | 'long' | 'very_long'>;
    minYardsToGo?: number;
    maxYardsToGo?: number;
    fieldZone?: 'all' | 'red_zone' | 'backed_up' | 'open_field';
    playType?: 'all' | 'dropback' | 'designed_run';
    gameIds?: string[];
    playIds?: string[];
    reviewLimit?: number;
  };
}

/** Host-owned continuity only. Never populate this from tool/model arguments. */
export interface NflExampleTrustedContext {
  /** The validated example_query from a previously accepted same-domain result. */
  previousQuery?: Readonly<NflExampleArgs>;
}

export const nflExampleCoverage = {
  college: { status: 'bounded_historical_example', draft_class: 2025, stat_season: 2024, players: ['Tyler Warren', 'Colston Loveland'], priorities: ['production', 'receiving', 'movement_blocking'], current_eligibility_verified: false },
  availability: { status: 'bounded_historical_example', team_id: 'NYG', game_date: '2025-09-21', practice_dates: ['2025-09-17', '2025-09-18', '2025-09-19'], report_players: 13, live_injury_feed: false, views: ['timeline', 'review_priority', 'contingency'], earlier_usage_baseline: false },
  coaching: { status: 'bounded_historical_example', season: 2025, season_type: 'REG', teams: ['NYG', 'KC', 'DAL'], weeks: [1, 2, 3], captured_rows: 765, qualifying_plays: 572, situations: ['all', 'third_down', 'red_zone', 'third_down_red_zone'], route_coverage_personnel_charting: false, original_play_descriptions: true, views: ['summary', 'converted_failed', 'review_queue', 'matched_situations'], filters: ['outcome', 'distanceBuckets', 'minYardsToGo', 'maxYardsToGo', 'fieldZone', 'playType', 'gameIds', 'playIds', 'reviewLimit'] },
} as const;

export const nflExampleTool = {
  name: 'get_nfl_example_evidence',
  description: 'Read bounded historical football evidence. College: Warren/Loveland 2025 draft class with 2024 official stats and attributed public scouting, optionally refocused on receiving or movement blocking. Availability: Giants Sept17–21 2025 report, dated review priorities and explicit user-assumed absence staffing questions; no live feed, prognosis or snap trend without an earlier baseline. Coaching: NYG/KC/DAL 2025 REG Week1–3 offensive PBP with exact play IDs/original descriptions, converted/failed distance splits, detailed filters, film queue and matched down/distance/field-position cells. Pressure/coverage/routes/assignments are uncharted. Preserve the exact user question and explicit filter choices. Unsupported players, teams, IDs, fields and windows are refused without substitution. Current roster/contract feasibility requires separate verified evidence.',
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
      assumedUnavailablePlayer: { type: 'string', description: 'One captured player named in the explicit absence assumption. Independent of playerName, which selects report rows; use playerName=all to preserve a report-wide investigation while assuming only this player unavailable.' },
      availabilityView: { type: 'string', enum: ['timeline', 'review_priority', 'contingency'], description: 'Dated report investigation, review order or a user-assumed absence workflow.' },
      coachingView: { type: 'string', enum: ['summary', 'converted_failed', 'review_queue', 'matched_situations'] },
      comparisonMode: { type: 'string', enum: ['unadjusted', 'matched_down_distance_field_position'] },
      coachingFilters: {
        type: 'object', additionalProperties: false,
        properties: {
          outcome: { type: 'string', enum: ['all', 'converted', 'failed', 'unknown'], description: 'Third-down outcomes only, from the source conversion flag; choosing an outcome limits the sample to third downs.' },
          distanceBuckets: { type: 'array', items: { type: 'string', enum: ['short', 'medium', 'long', 'very_long'] }, minItems: 1 },
          minYardsToGo: { type: 'integer', minimum: 1, maximum: 100 },
          maxYardsToGo: { type: 'integer', minimum: 1, maximum: 100 },
          fieldZone: { type: 'string', enum: ['all', 'red_zone', 'backed_up', 'open_field'] },
          playType: { type: 'string', enum: ['all', 'dropback', 'designed_run'] },
          gameIds: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'Exact captured game IDs. Unknown or out-of-scope IDs are rejected, never replaced.' },
          playIds: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'Exact game_id:play_id values from a returned review queue.' },
          reviewLimit: { type: 'integer', minimum: 1, maximum: 50 },
        },
      },
    },
    required: ['domain', 'question'],
    additionalProperties: false,
  },
};

export interface ExampleSource { id: string; source_url: string; title: string; effective_date: string; captured_at: string; sha256: string; bytes: number; last_modified: string | null }
interface CollegePlayer {
  name: string; school: string; position: string; games: number; receptions: number; receiving_yards: number; receiving_touchdowns: number; height_inches: number; weight_pounds: number;
  stats_source_id: string; measurement_source_id: string; stats_locator: string; measurement_locator: string;
  assessment: { author: string; source_id: string; published_on: string; original_url: string; receiving: string; movement_blocking: string };
}
interface CollegeSnapshot { schema: string; captured_at: string; draft_class: number; stat_season: number; measurement_basis: string; sources: ExampleSource[]; players: CollegePlayer[] }
export interface AvailabilityPlayer {
  name: string; position: string; reported_injury: string; practice: Array<{ date: string; status: string }>; game_status: string; gameday: string;
  offensive_snaps: number | null; reported_offensive_snap_percent: number | null; offense_team_snaps: number | null;
}
export interface AvailabilitySnapshot { schema: string; captured_at: string; sources: ExampleSource[]; players: AvailabilityPlayer[]; observed_offensive_usage: Array<{ name: string; snaps: number; team_snaps: number }>; role_observation: string }
export interface NflExamplePlay {
  play_id: number; game_id: string; game_date: string; week: number; posteam: string; defteam: string; home_team: string; away_team: string; season_type: string;
  down: number | null; ydstogo: number | null; yardline_100: number | null; play_type: string | null; yards_gained: number | null;
  qb_dropback: number | null; qb_scramble: number | null; qb_kneel: number | null; qb_spike: number | null; sack: number | null;
  third_down_converted: number | null; first_down: number | null; touchdown: number | null; pass_touchdown: number | null; rush_touchdown: number | null; aborted_play: number | null; play_deleted: number | null;
}
export interface CoachingSnapshot { schema: string; captured_at: string; season: number; source_row_count: number; captured_row_count: number; sources: ExampleSource[]; selection: string; games: string[]; plays: NflExamplePlay[] }

const normalize = (value: string) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
const pct = (numerator: number, denominator: number) => denominator ? `${(100 * numerator / denominator).toFixed(1)}%` : 'Not available (n=0)';
const rate = (numerator: number, denominator: number) => denominator ? (numerator / denominator).toFixed(2) : 'Not available (n=0)';
const date = (value: string) => value.slice(0, 10);

async function snapshot<T>(name: string, schema: string): Promise<T> {
  const value = JSON.parse(await readFile(new URL(`../../../data/nfl-examples/${name}.json`, import.meta.url), 'utf8'));
  if (value.schema !== schema) throw new Error('Unsupported evidence snapshot');
  return value as T;
}
export function sourceRows(sources: ExampleSource[], kind: string): FactualAnswer['sources'] {
  return sources.map((source, i) => ({ ref_index: i + 1, kind, source: source.title, title: source.title, updated_at: source.effective_date, data: { ...source, sourceURL: source.source_url, freshness: 'historical evidence captured from public source', rows: [{ k: 'Effective period', v: source.effective_date }, { k: 'Captured', v: source.captured_at }] } }));
}
export function unavailable(answer: string, caveats: string[] = []): FactualAnswer {
  return { body: factualBody({ answer, key_findings: [], tables: [], calculations: [], caveats, followups: [] }), sources: [] };
}
export function matchName(name: string, candidates: string[]): string | undefined {
  const input = normalize(name);
  const exact = candidates.find(candidate => normalize(candidate) === input);
  if (exact) return exact;
  const surname = candidates.filter(candidate => normalize(candidate.split(' ').at(-1)!) === input);
  return surname.length === 1 ? surname[0] : undefined;
}
export function questionName(question: string, names: string[]): string | undefined {
  const normalized = normalize(question);
  const matched = names.filter(name => normalized.includes(normalize(name)) || new RegExp(`\\b${name.split(' ').at(-1)!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(question));
  return matched.length === 1 ? matched[0] : undefined;
}

/** Supplies evidence and deterministic calculations; the chat model owns synthesis. */
export async function buildNflExampleEvidence(args: NflExampleArgs, trustedContext?: NflExampleTrustedContext): Promise<FactualAnswer> {
  if (!args || typeof args.question !== 'string' || !['college', 'availability', 'coaching'].includes(args.domain)) return unavailable('Choose college, availability or coaching evidence and include the question.');
  const unknownFields = Object.keys(args).filter(key => !(key in nflExampleTool.input_schema.properties));
  if (unknownFields.length) return unavailable(`Unsupported example fields: ${unknownFields.join(', ')}. No different query was run.`);
  try {
    if (args.domain === 'college') return collegeEvidence(args, await snapshot<CollegeSnapshot>('college', 'nfl_examples_college.v1'));
    if (args.domain === 'availability') return healthWorkflow(args, await snapshot<AvailabilitySnapshot>('availability', 'nfl_examples_availability.v1'), trustedContext);
    const coaching = await snapshot<CoachingSnapshot>('coaching', 'nfl_examples_coaching.v1');
    return coachingWorkflow(args, coaching, await loadPlayDetails(coaching));
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
