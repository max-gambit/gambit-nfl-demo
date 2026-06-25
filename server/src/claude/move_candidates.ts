import type Anthropic from '@anthropic-ai/sdk';
import type {
  BriefOptionDetails,
  BriefOptionMoveCandidate,
  BriefSource,
  SubmitBriefInput,
  SubmitBriefOption,
} from '@shared/types';
import { db } from '../db/client.js';
import type {
  CurrentCapSheetPlayerRowRecord,
  CurrentCapSheetSalaryCellRow,
} from '../nba_cap_sheets/seed.js';
import type { CurrentPlayerStatViewRow } from '../nba_player_stats/seed.js';
import { BRIEF_MODEL, createClaudeMessage } from './client.js';

const MAX_CAP_PLAYER_ROWS = 650;
const MAX_SALARY_ROWS = 1400;
const MAX_STAT_ROWS = 650;
const MAX_TARGET_POOL_PLAYERS = 110;
const MAX_OUTGOING_POOL_PLAYERS = 18;
const MAX_CANDIDATES_PER_OPTION = 4;

const TRANSACTION_OPTION_RE =
  /\b(trade|trading|acquire|acquisition|salary[- ]?match|salary matching|aggregate|send|outgoing|incoming|free agent|free agency|sign[- ]and[- ]trade|extension|mid[- ]level|\bmle\b|buyout|minimum deal|exception)\b/i;

const ARCHETYPE_RE =
  /\b(archetype|profile|type of|player type|prototype|generic|placeholder|tbd|to be determined|unnamed|unknown target|market target|candidate target)\b/i;

const MOVE_CANDIDATE_TOOL: Anthropic.Tool = {
  name: 'submit_move_candidates',
  description: 'Submit specific, source-backed candidate moves for already-generated strategic options.',
  input_schema: {
    type: 'object',
    properties: {
      options: {
        type: 'array',
        maxItems: 6,
        items: {
          type: 'object',
          properties: {
            option_ref: {
              type: 'integer',
              description: 'The strategic option ref_index these candidates belong to.',
            },
            candidates: {
              type: 'array',
              maxItems: MAX_CANDIDATES_PER_OPTION,
              description:
                '0-4 specific, named player/team move constructions. Return an empty array when no named construction is supportable from the supplied candidate pool.',
              items: {
                type: 'object',
                properties: {
                  label: {
                    type: 'string',
                    description: 'Short specific label, for example "Malcolm Brogdon via Moody-led match".',
                  },
                  subject_team_id: {
                    type: 'string',
                    description: 'Subject team_id for the team considering this move. Use the supplied subject_team_id.',
                  },
                  target_player_names: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 3,
                    items: { type: 'string' },
                    description: 'Specific target player name or names from the candidate pool.',
                  },
                  target_team_id: {
                    type: 'string',
                    description: 'Current team_id for the target player from the candidate pool.',
                  },
                  target_team_name: {
                    type: 'string',
                    description: 'Readable current team name for the target player.',
                  },
                  outgoing_package: {
                    type: 'string',
                    description: 'Specific outgoing subject-team package or salary construction to test. Use full player names for named outgoing players.',
                  },
                  outgoing_player_names: {
                    type: 'array',
                    maxItems: 4,
                    items: { type: 'string' },
                    description: 'Full subject-team player names included in the outgoing package when supportable from the candidate pool. Leave unnamed filler in outgoing_package and constraints.',
                  },
                  salary_match: {
                    type: 'string',
                    description: 'Salary/CBA mechanics using only supplied salary data and stated option constraints.',
                  },
                  basketball_fit: {
                    type: 'string',
                    description: 'Why this target fits the option in basketball terms.',
                  },
                  cost: {
                    type: 'string',
                    description: 'Likely asset/opportunity cost or explicit cost unknown.',
                  },
                  constraints: {
                    type: 'string',
                    description: 'Hard-cap, seller, medical, availability, roster-depth, or evidence limitation.',
                  },
                  evidence_refs: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 8,
                    items: { type: 'integer' },
                    description: 'Source ref_index values. Must include the candidate-pool ref.',
                  },
                },
                required: [
                  'label',
                  'subject_team_id',
                  'target_player_names',
                  'target_team_id',
                  'target_team_name',
                  'outgoing_package',
                  'salary_match',
                  'basketball_fit',
                  'cost',
                  'constraints',
                  'evidence_refs',
                ],
              },
            },
          },
          required: ['option_ref', 'candidates'],
        },
      },
    },
    required: ['options'],
  },
};

interface MoveCandidateEnrichmentArgs {
  input: SubmitBriefInput;
  existingSources: Omit<BriefSource, 'id' | 'brief_id'>[];
  subjectTeamId: string | null;
}

interface MoveCandidateEnrichmentResult {
  input: SubmitBriefInput;
  candidatePoolSource: Omit<BriefSource, 'id' | 'brief_id'> | null;
}

interface CandidatePoolPlayer {
  player_name: string;
  team_id: string;
  team_name: string | null;
  position: string | null;
  age: number | null;
  roster_status: string | null;
  fa_status: string | null;
  fa_year: string | null;
  bird_rights: string | null;
  restrictions: string[];
  total_contract: string | null;
  salary: string | null;
  salary_amount: number | null;
  salary_season: string | null;
  ppg: number | null;
  apg: number | null;
  usage_pct: number | null;
  true_shooting_pct: number | null;
  assist_pct: number | null;
  net_rating: number | null;
  defensive_win_shares: number | null;
  role_tags: string[];
}

interface CandidatePool {
  subject_team_id: string | null;
  target_players: CandidatePoolPlayer[];
  outgoing_players: CandidatePoolPlayer[];
}

export function optionNeedsSpecificMoveCandidates(option: SubmitBriefOption): boolean {
  const details = option.details;
  const text = [
    option.title,
    option.subtitle ?? '',
    option.type_kind ?? '',
    option.path_kind ?? '',
    option.cba_section ?? '',
    details?.decision_question ?? '',
    details?.why_this ?? '',
    details?.upside ?? '',
    details?.downside ?? '',
    ...(details?.required_moves ?? []),
  ].join(' ');
  return TRANSACTION_OPTION_RE.test(text);
}

export function isSpecificMoveCandidate(candidate: unknown): candidate is BriefOptionMoveCandidate {
  return coerceSpecificMoveCandidate(candidate) !== null;
}

export function sanitizeMoveCandidates(candidates: unknown): BriefOptionMoveCandidate[] {
  if (!Array.isArray(candidates)) return [];
  const out: BriefOptionMoveCandidate[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const normalized = coerceSpecificMoveCandidate(candidate);
    if (!normalized) continue;
    const key = candidateIdentityKey(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
    if (out.length >= MAX_CANDIDATES_PER_OPTION) break;
  }
  return out;
}

export function sanitizeSubmitBriefMoveCandidates(input: SubmitBriefInput): SubmitBriefInput {
  return {
    ...input,
    options: (input.options ?? []).map((option) => ({
      ...option,
      details: {
        ...option.details,
        move_candidates: sanitizeMoveCandidates(option.details?.move_candidates),
      },
    })),
  };
}

export function mergeMoveCandidateEnrichment(
  input: SubmitBriefInput,
  enrichment: unknown,
  candidatePoolRef?: number,
  subjectTeamId?: string | null,
): SubmitBriefInput {
  if (!isRecord(enrichment) || !Array.isArray(enrichment.options)) {
    return sanitizeSubmitBriefMoveCandidates(input);
  }

  const byRef = new Map<number, BriefOptionMoveCandidate[]>();
  for (const entry of enrichment.options) {
    if (!isRecord(entry)) continue;
    const optionRef = Number(entry.option_ref);
    if (!Number.isInteger(optionRef) || optionRef <= 0) continue;
    const candidates = sanitizeMoveCandidatesWithRef(entry.candidates, candidatePoolRef, subjectTeamId);
    byRef.set(optionRef, candidates);
  }

  return {
    ...input,
    options: (input.options ?? []).map((option) => {
      const enriched = byRef.get(Number(option.ref_index));
      return {
        ...option,
        details: {
          ...option.details,
          move_candidates: enriched ?? sanitizeMoveCandidates(option.details?.move_candidates),
        },
      };
    }),
  };
}

export async function enrichSpecificMoveCandidates(
  args: MoveCandidateEnrichmentArgs,
): Promise<MoveCandidateEnrichmentResult> {
  const sanitized = sanitizeSubmitBriefMoveCandidates(args.input);
  const relevantOptions = sanitized.options.filter(optionNeedsSpecificMoveCandidates);
  if (relevantOptions.length === 0) {
    return { input: sanitized, candidatePoolSource: null };
  }

  try {
    const pool = await loadCandidatePool(args.subjectTeamId, relevantOptions);
    if (pool.target_players.length === 0) {
      return { input: sanitized, candidatePoolSource: null };
    }

    const candidatePoolRef = nextSourceRef(args.existingSources);
    const candidatePoolSource = buildCandidatePoolSource(candidatePoolRef, pool);
    const response = await createClaudeMessage({
      model: BRIEF_MODEL,
      max_tokens: 4096,
      system: moveCandidateEnrichmentSystem(candidatePoolRef),
      tools: [MOVE_CANDIDATE_TOOL],
      tool_choice: { type: 'tool', name: 'submit_move_candidates' },
      messages: [{
        role: 'user',
        content: moveCandidateEnrichmentPrompt({
          options: relevantOptions,
          candidatePoolRef,
          pool,
          sources: [...args.existingSources, candidatePoolSource],
        }),
      }],
    });

    const toolUse = response.content.find((block) => (
      block.type === 'tool_use' && block.name === 'submit_move_candidates'
    ));
    if (!toolUse || toolUse.type !== 'tool_use' || toolUse.name !== 'submit_move_candidates') {
      return { input: sanitized, candidatePoolSource: null };
    }

    const input = mergeMoveCandidateEnrichment(sanitized, toolUse.input, candidatePoolRef, args.subjectTeamId);
    const hasCandidatePoolCites = input.options.some((option) => (
      option.details.move_candidates?.some((candidate) => (
        candidate.evidence_refs?.includes(candidatePoolRef)
      ))
    ));

    return {
      input,
      candidatePoolSource: hasCandidatePoolCites ? candidatePoolSource : null,
    };
  } catch (error) {
    console.warn('[move-candidates] enrichment skipped:', error instanceof Error ? error.message : String(error));
    return { input: sanitized, candidatePoolSource: null };
  }
}

function moveCandidateEnrichmentSystem(candidatePoolRef: number): string {
  return [
    'You enrich already-generated NBA strategic options with concrete candidate moves.',
    'Return only specific named player/team constructions supported by the supplied candidate pool.',
    'Do not return archetypes, generic profiles, placeholder targets, or market categories as candidates.',
    'If no named construction is supportable for an option, return an empty candidates array for that option.',
    'Do not invent private seller availability, medical clearance, exact asking prices, or final trade value.',
    `Every returned candidate evidence_refs array must include [${candidatePoolRef}].`,
  ].join('\n');
}

function moveCandidateEnrichmentPrompt(args: {
  options: SubmitBriefOption[];
  candidatePoolRef: number;
  pool: CandidatePool;
  sources: Omit<BriefSource, 'id' | 'brief_id'>[];
}): string {
  const sourceRefs = args.sources
    .slice()
    .sort((a, b) => a.ref_index - b.ref_index)
    .map((source) => `[${source.ref_index}] ${source.kind} · ${source.title}`)
    .join('\n');

  return [
    `Candidate-pool source ref: [${args.candidatePoolRef}]`,
    '',
    'Strategic options to enrich:',
    JSON.stringify(args.options.map(optionSummaryForModel), null, 2),
    '',
    'Candidate pool. Targets must come from target_players. Outgoing packages should use outgoing_players when possible.',
    'When a named outgoing player is part of the construction, include the full subject-team player name in outgoing_player_names and in outgoing_package. Leave unnamed/minimum filler in outgoing_package and constraints.',
    JSON.stringify(args.pool, null, 2),
    '',
    'Available source refs:',
    sourceRefs,
    '',
    'Return submit_move_candidates only. For each option, return 0-4 specific candidates. Do not include any candidate without a named target player and current target team. Use subject_team_id from the candidate pool.',
  ].join('\n');
}

function optionSummaryForModel(option: SubmitBriefOption): Record<string, unknown> {
  const details = option.details;
  return {
    option_ref: option.ref_index,
    title: option.title,
    subtitle: option.subtitle,
    path_kind: option.path_kind,
    type_kind: option.type_kind,
    cap: option.net_cap_label,
    cba_section: option.cba_section,
    timing: option.timing,
    decision_question: details.decision_question,
    upside: details.upside,
    downside: details.downside,
    required_moves: details.required_moves,
    blockers: details.blockers,
    evidence_refs: details.evidence_refs,
  };
}

async function loadCandidatePool(
  subjectTeamId: string | null,
  options: SubmitBriefOption[],
): Promise<CandidatePool> {
  const [{ data: playerRows, error: playerError }, { data: salaryRows, error: salaryError }, { data: statRows, error: statError }] = await Promise.all([
    db
      .from('nba_current_cap_sheet_player_rows')
      .select('id,team_id,nba_player_id,player_name,source_order,position,age,roster_status,fa_status,fa_year,bird_rights,restrictions,total_amount,source_status')
      .order('team_id', { ascending: true })
      .order('source_order', { ascending: true })
      .limit(MAX_CAP_PLAYER_ROWS),
    db
      .from('nba_current_cap_sheet_salary_cells')
      .select('player_row_id,team_id,season,amount,label,option_type,is_guaranteed,source_status')
      .order('team_id', { ascending: true })
      .order('season', { ascending: true })
      .limit(MAX_SALARY_ROWS),
    db
      .from('nba_current_player_stats')
      .select('team_id,full_name,nba_player_id,player_name,position,age,games_played,minutes,points_per_game,assists_per_game,true_shooting_pct,usage_pct,assist_pct,net_rating,defensive_win_shares,match_status')
      .order('team_id', { ascending: true })
      .order('source_order', { ascending: true })
      .limit(MAX_STAT_ROWS),
  ]);

  if (playerError) throw new Error(`candidate cap rows: ${playerError.message}`);
  if (salaryError) throw new Error(`candidate salary rows: ${salaryError.message}`);
  if (statError) throw new Error(`candidate stat rows: ${statError.message}`);

  const salariesByPlayerRow = groupSalaryRows((salaryRows ?? []) as CurrentCapSheetSalaryCellRow[]);
  const statsByPlayer = groupStats((statRows ?? []) as CurrentPlayerStatViewRow[]);
  const intent = intentForOptions(options);
  const players = ((playerRows ?? []) as CurrentCapSheetPlayerRowRecord[])
    .filter((row) => row.source_status === 'captured')
    .map((row) => candidatePoolPlayerFromRows(row, salariesByPlayerRow.get(row.id) ?? [], statsByPlayer.get(playerKey(row.team_id, row.player_name)) ?? null));

  const outgoingPlayers = players
    .filter((player) => subjectTeamId && player.team_id === subjectTeamId)
    .sort((a, b) => (b.salary_amount ?? 0) - (a.salary_amount ?? 0))
    .slice(0, MAX_OUTGOING_POOL_PLAYERS);

  const targetPlayers = players
    .filter((player) => !subjectTeamId || player.team_id !== subjectTeamId)
    .map((player) => ({ player, score: candidateScore(player, intent) }))
    .filter(({ player, score }) => score > 0 || player.salary_amount !== null)
    .sort((a, b) => b.score - a.score || (b.player.salary_amount ?? 0) - (a.player.salary_amount ?? 0))
    .slice(0, MAX_TARGET_POOL_PLAYERS)
    .map(({ player }) => player);

  return {
    subject_team_id: subjectTeamId,
    target_players: targetPlayers,
    outgoing_players: outgoingPlayers,
  };
}

function candidatePoolPlayerFromRows(
  row: CurrentCapSheetPlayerRowRecord,
  salaryRows: CurrentCapSheetSalaryCellRow[],
  stats: CurrentPlayerStatViewRow | null,
): CandidatePoolPlayer {
  const salary = preferredSalaryCell(salaryRows);
  const roleTags = roleTagsFor(row, stats, salary?.amount ?? null);
  return {
    player_name: row.player_name,
    team_id: row.team_id,
    team_name: stats?.full_name ?? null,
    position: row.position ?? stats?.position ?? null,
    age: row.age ?? stats?.age ?? null,
    roster_status: row.roster_status,
    fa_status: row.fa_status,
    fa_year: row.fa_year,
    bird_rights: row.bird_rights,
    restrictions: Array.isArray(row.restrictions) ? row.restrictions : [],
    total_contract: formatMoney(row.total_amount),
    salary: salary?.label ?? formatMoney(salary?.amount ?? null),
    salary_amount: salary?.amount ?? null,
    salary_season: salary?.season ?? null,
    ppg: finiteNumber(stats?.points_per_game),
    apg: finiteNumber(stats?.assists_per_game),
    usage_pct: finiteNumber(stats?.usage_pct),
    true_shooting_pct: finiteNumber(stats?.true_shooting_pct),
    assist_pct: finiteNumber(stats?.assist_pct),
    net_rating: finiteNumber(stats?.net_rating),
    defensive_win_shares: finiteNumber(stats?.defensive_win_shares),
    role_tags: roleTags,
  };
}

function buildCandidatePoolSource(
  refIndex: number,
  pool: CandidatePool,
): Omit<BriefSource, 'id' | 'brief_id'> {
  return {
    ref_index: refIndex,
    kind: 'ANALYST_DATA',
    source: 'GAMBIT CURRENT NBA DB',
    title: 'Current app candidate pool for named move construction',
    data: {
      candidate_pool: pool,
      note: 'Generated from current roster, cap-sheet salary, and player-stat rows before option candidate enrichment. This supports player/team/salary identity, not seller availability.',
    },
    updated_at: 'CURRENT APP SNAPSHOT',
  };
}

function coerceSpecificMoveCandidate(
  candidate: unknown,
  requiredEvidenceRef?: number,
  fallbackSubjectTeamId?: string | null,
): BriefOptionMoveCandidate | null {
  if (!isRecord(candidate)) return null;

  const label = stringValue(candidate.label);
  const subjectTeamId = stringValue(candidate.subject_team_id) ?? stringValue(fallbackSubjectTeamId);
  const targetPlayerNames = stringArray(candidate.target_player_names)
    .filter((name) => !ARCHETYPE_RE.test(name));
  const targetTeamId = stringValue(candidate.target_team_id);
  const targetTeamName = stringValue(candidate.target_team_name);
  const outgoingPlayerNames = stringArray(candidate.outgoing_player_names)
    .filter((name) => !ARCHETYPE_RE.test(name));
  const outgoingPackage = stringValue(candidate.outgoing_package);
  const salaryMatch = stringValue(candidate.salary_match);
  const basketballFit = stringValue(candidate.basketball_fit) ?? stringValue(candidate.why);
  const cost = stringValue(candidate.cost);
  const constraints = stringValue(candidate.constraints);
  const refs = evidenceRefs(candidate.evidence_refs, requiredEvidenceRef);
  const searchableText = [
    label,
    ...targetPlayerNames,
    subjectTeamId,
    targetTeamId,
    targetTeamName,
    ...outgoingPlayerNames,
    outgoingPackage,
    salaryMatch,
    basketballFit,
    cost,
    constraints,
  ].filter(Boolean).join(' ');

  if (!label || ARCHETYPE_RE.test(searchableText)) return null;
  if (targetPlayerNames.length === 0) return null;
  if (!targetTeamId && !targetTeamName) return null;
  if (!outgoingPackage || !salaryMatch || !basketballFit || !cost || !constraints) return null;
  if (refs.length === 0) return null;

  return {
    label,
    subject_team_id: subjectTeamId,
    target_player_names: targetPlayerNames,
    target_team_id: targetTeamId,
    target_team_name: targetTeamName,
    outgoing_player_names: outgoingPlayerNames,
    outgoing_package: outgoingPackage,
    salary_match: salaryMatch,
    basketball_fit: basketballFit,
    mechanism: stringValue(candidate.mechanism) ?? outgoingPackage,
    why: stringValue(candidate.why) ?? basketballFit,
    cost,
    constraints,
    evidence_refs: refs,
  };
}

function sanitizeMoveCandidatesWithRef(
  candidates: unknown,
  requiredEvidenceRef?: number,
  subjectTeamId?: string | null,
): BriefOptionMoveCandidate[] {
  if (!Array.isArray(candidates)) return [];
  const out: BriefOptionMoveCandidate[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const normalized = coerceSpecificMoveCandidate(candidate, requiredEvidenceRef, subjectTeamId);
    if (!normalized) continue;
    const key = candidateIdentityKey(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
    if (out.length >= MAX_CANDIDATES_PER_OPTION) break;
  }
  return out;
}

function candidateIdentityKey(candidate: BriefOptionMoveCandidate): string {
  return [
    ...(candidate.target_player_names ?? [candidate.label]),
    candidate.target_team_id ?? candidate.target_team_name ?? '',
    candidate.outgoing_package ?? '',
  ].map((part) => normalizeText(part)).join('|');
}

function evidenceRefs(value: unknown, requiredEvidenceRef?: number): number[] {
  const refs = Array.isArray(value)
    ? value.map((ref) => Number(ref)).filter((ref) => Number.isInteger(ref) && ref > 0)
    : [];
  if (requiredEvidenceRef && !refs.includes(requiredEvidenceRef)) refs.push(requiredEvidenceRef);
  return [...new Set(refs)].sort((a, b) => a - b);
}

function intentForOptions(options: SubmitBriefOption[]): Set<string> {
  const text = options.map((option) => [
    option.title,
    option.subtitle ?? '',
    option.details.decision_question,
    option.details.upside,
    option.details.downside,
    ...option.details.required_moves,
  ].join(' ')).join(' ').toLowerCase();
  const tags = new Set<string>();
  if (/\bguard|combo|ball[- ]?handl|creator|on[- ]?ball|point\b/.test(text)) tags.add('guard');
  if (/\bwing|forward|3[- ]?and[- ]?d|defensive wing\b/.test(text)) tags.add('wing');
  if (/\bbig|center|rim|frontcourt\b/.test(text)) tags.add('big');
  if (/\bcreator|shotmaker|late[- ]?clock|half[- ]court|usage|assist\b/.test(text)) tags.add('creator');
  if (/\bdefense|defensive|stopper|point[- ]of[- ]attack|poa\b/.test(text)) tags.add('defense');
  if (/\bshoot|spacing|three|3pt|catch[- ]and[- ]shoot\b/.test(text)) tags.add('shooting');
  return tags;
}

function candidateScore(player: CandidatePoolPlayer, intent: Set<string>): number {
  let score = 0;
  const pos = (player.position ?? '').toUpperCase();
  const salary = player.salary_amount ?? 0;
  if (salary >= 2_000_000 && salary <= 35_000_000) score += 8;
  if (player.roster_status && /active|standard/i.test(player.roster_status)) score += 4;
  if (intent.has('guard') && /\bG\b/.test(pos)) score += 18;
  if (intent.has('wing') && /F|G-F|F-G/.test(pos)) score += 16;
  if (intent.has('big') && /C|F-C|C-F/.test(pos)) score += 16;
  if (intent.has('creator')) {
    if ((player.usage_pct ?? 0) >= 18) score += 8;
    if ((player.assist_pct ?? 0) >= 14 || (player.apg ?? 0) >= 3.5) score += 10;
    if ((player.ppg ?? 0) >= 10) score += 6;
  }
  if (intent.has('defense')) {
    if ((player.defensive_win_shares ?? 0) >= 1) score += 8;
    if ((player.net_rating ?? -99) >= 0) score += 4;
  }
  if (intent.has('shooting')) {
    if ((player.true_shooting_pct ?? 0) >= 0.56) score += 8;
    if ((player.ppg ?? 0) >= 8) score += 4;
  }
  score += Math.min(8, Math.max(0, (player.ppg ?? 0) / 4));
  return score;
}

function roleTagsFor(
  row: CurrentCapSheetPlayerRowRecord,
  stats: CurrentPlayerStatViewRow | null,
  salaryAmount: number | null,
): string[] {
  const tags = new Set<string>();
  const pos = (row.position ?? stats?.position ?? '').toUpperCase();
  if (/\bG\b/.test(pos)) tags.add('guard');
  if (/F|G-F|F-G/.test(pos)) tags.add('wing');
  if (/C|F-C|C-F/.test(pos)) tags.add('big');
  if ((stats?.usage_pct ?? 0) >= 18 || (stats?.assist_pct ?? 0) >= 14) tags.add('creation');
  if ((stats?.true_shooting_pct ?? 0) >= 0.56) tags.add('efficiency');
  if ((stats?.defensive_win_shares ?? 0) >= 1) tags.add('defense');
  if (salaryAmount !== null && salaryAmount <= 15_000_000) tags.add('mid-salary');
  if (row.fa_year) tags.add(`fa-${row.fa_year}`);
  return [...tags].slice(0, 6);
}

function groupSalaryRows(rows: CurrentCapSheetSalaryCellRow[]): Map<string, CurrentCapSheetSalaryCellRow[]> {
  const grouped = new Map<string, CurrentCapSheetSalaryCellRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.player_row_id) ?? [];
    list.push(row);
    grouped.set(row.player_row_id, list);
  }
  return grouped;
}

function groupStats(rows: CurrentPlayerStatViewRow[]): Map<string, CurrentPlayerStatViewRow> {
  const grouped = new Map<string, CurrentPlayerStatViewRow>();
  for (const row of rows) {
    grouped.set(playerKey(row.team_id, row.player_name), row);
  }
  return grouped;
}

function preferredSalaryCell(rows: CurrentCapSheetSalaryCellRow[]): CurrentCapSheetSalaryCellRow | null {
  const captured = rows
    .filter((row) => row.source_status === 'captured' && row.amount !== null)
    .sort((a, b) => a.season.localeCompare(b.season));
  return captured.find((row) => row.season === '2026-27')
    ?? captured.find((row) => row.season === '2025-26')
    ?? captured[0]
    ?? null;
}

function nextSourceRef(sources: Omit<BriefSource, 'id' | 'brief_id'>[]): number {
  return sources.reduce((max, source) => Math.max(max, Number(source.ref_index) || 0), 0) + 1;
}

function playerKey(teamId: string, playerName: string): string {
  return `${teamId}:${normalizeText(playerName)}`;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => stringValue(item)).filter((item): item is string => !!item);
}

function stringValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text ? text : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function formatMoney(amount: number | null | undefined): string | null {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return null;
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${Math.round(amount / 1_000)}K`;
  return `$${amount}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
