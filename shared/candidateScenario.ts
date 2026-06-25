import type {
  BriefOption,
  BriefOptionDetails,
  BriefOptionMoveCandidate,
  CreateProjectScenarioPlayerRequest,
  CreateProjectTradeScenarioRequest,
  NbaCapSheet,
  NbaCapSheetMetric,
  NbaCapSheetPlayerRow,
  NbaCapSheetSourceStatus,
  NbaPlayerStatRow,
  UpdateProjectTradeScenarioRequest,
} from './types';

export const DEFAULT_SCENARIO_SUBJECT_TEAM_ID = 'GSW';

export interface CandidateScenarioInput {
  subjectTeamId?: string | null;
  subjectSheet: NbaCapSheet | null;
  targetSheet: NbaCapSheet | null;
  allowOutgoingPackageFallback?: boolean;
}

export interface CandidateScenarioPlayer {
  name: string;
  team_id: string;
  nba_player_id: number | null;
  salary_amount: number | null;
  salary_label: string;
  source_status: NbaCapSheetSourceStatus;
  stats_snapshot: NbaPlayerStatRow | null;
}

export interface CandidateScenarioThreshold {
  key: 'luxury_tax' | 'first_apron' | 'second_apron';
  label: string;
  amount: number | null;
  before_distance: number | null;
  after_distance: number | null;
}

export interface CandidateScenarioTeamImpact {
  team_id: string;
  team_name: string;
  sends: CandidateScenarioPlayer[];
  receives: CandidateScenarioPlayer[];
  known_salary_out: number;
  known_salary_in: number;
  net_salary_delta: number;
  payroll_before: number | null;
  payroll_after: number | null;
  thresholds: CandidateScenarioThreshold[];
}

export interface CandidateScenarioModel {
  subject_team_id: string;
  target_team_id: string | null;
  target_label: string;
  construction: string | null;
  subject: CandidateScenarioTeamImpact;
  target: CandidateScenarioTeamImpact;
  flags: string[];
}

export interface CandidateProjectScenarioSeed {
  create: CreateProjectTradeScenarioRequest;
  update: UpdateProjectTradeScenarioRequest;
  players: CreateProjectScenarioPlayerRequest[];
  source_gaps: string[];
  model: CandidateScenarioModel;
}

const NBA_2025_26_THRESHOLDS = {
  luxury_tax: 187_895_000,
  first_apron: 195_945_000,
  second_apron: 207_824_000,
};

const THRESHOLD_LABELS: Record<CandidateScenarioThreshold['key'], string> = {
  luxury_tax: 'Tax',
  first_apron: '1st apron',
  second_apron: '2nd apron',
};

export function buildCandidateScenario(
  candidate: BriefOptionMoveCandidate,
  input: CandidateScenarioInput,
): CandidateScenarioModel {
  const subjectTeamId = normalizeTeamId(candidate.subject_team_id)
    ?? normalizeTeamId(input.subjectTeamId)
    ?? DEFAULT_SCENARIO_SUBJECT_TEAM_ID;
  const targetTeamId = normalizeTeamId(candidate.target_team_id)
    ?? normalizeTeamId(input.targetSheet?.summary.team.team_id)
    ?? null;
  const targetLabel = candidateTargetLabel(candidate);
  const outgoingNames = candidateOutgoingNames(candidate, input.subjectSheet, {
    allowPackageFallback: input.allowOutgoingPackageFallback ?? true,
  });
  const incomingNames = (candidate.target_player_names ?? []).map((name) => name.trim()).filter(Boolean);
  const outgoing = resolvePlayers(outgoingNames, input.subjectSheet);
  const incoming = resolvePlayers(incomingNames, input.targetSheet);
  const flags = scenarioFlags({
    candidate,
    subjectTeamId,
    targetTeamId,
    subjectSheet: input.subjectSheet,
    targetSheet: input.targetSheet,
    allowOutgoingPackageFallback: input.allowOutgoingPackageFallback ?? true,
    outgoingNames,
    incomingNames,
    outgoing,
    incoming,
  });

  return {
    subject_team_id: subjectTeamId,
    target_team_id: targetTeamId,
    target_label: targetLabel,
    construction: candidate.outgoing_package ?? candidate.mechanism ?? null,
    subject: teamImpact({
      teamId: subjectTeamId,
      sheet: input.subjectSheet,
      sends: outgoing,
      receives: incoming,
    }),
    target: teamImpact({
      teamId: targetTeamId ?? candidate.target_team_name ?? 'Counterparty',
      sheet: input.targetSheet,
      sends: incoming,
      receives: outgoing,
    }),
    flags,
  };
}

export function buildCandidateProjectScenarioSeed(
  option: BriefOption,
  details: BriefOptionDetails,
  candidate: BriefOptionMoveCandidate,
  evidenceRefs: number[],
  input: CandidateScenarioInput,
): CandidateProjectScenarioSeed {
  const model = buildCandidateScenario(candidate, {
    ...input,
    allowOutgoingPackageFallback: false,
  });
  const refs = uniqueNumbers(evidenceRefs.length ? evidenceRefs : details.evidence_refs);
  const sourceGaps = sourceGapNotes(model);
  const mechanism = candidate.mechanism ?? candidate.outgoing_package ?? null;
  const basketballFit = candidate.basketball_fit ?? candidate.why ?? details.upside;
  const risks = [
    candidate.constraints,
    details.downside,
    ...details.blockers,
  ].filter(isUsefulText).join('\n');
  const notes = [
    `Source option: [${option.ref_index}] ${option.title}`,
    refs.length ? `Evidence refs: ${refs.map((ref) => `[${ref}]`).join(' ')}` : null,
    mechanism ? `Mechanism: ${mechanism}` : null,
    candidate.salary_match ? `Salary/CBA: ${candidate.salary_match}` : null,
    details.required_moves.length ? `Required moves: ${details.required_moves.join('; ')}` : null,
    candidate.cost ? `Likely cost: ${candidate.cost}` : null,
    sourceGaps.length ? `Source gaps: ${sourceGaps.join('; ')}` : null,
  ].filter(isUsefulText).join('\n');
  const title = model.target_label || candidate.label || option.title;
  const summaryDetail = candidate.why ?? candidate.basketball_fit ?? details.why_this;

  return {
    create: {
      title,
      summary: `Option [${option.ref_index}] ${option.title}${summaryDetail ? ` - ${summaryDetail}` : ''}`,
      participating_teams: [model.subject_team_id, model.target_team_id].filter(isUsefulText),
    },
    update: {
      basketball_fit: basketballFit,
      risks,
      notes,
      counter_range: candidate.cost ?? '',
      validation_summary: `Seeded from strategic option [${option.ref_index}]; advisory only until Trade Builder/internal cap sheet validation.`,
    },
    players: [
      ...model.subject.sends.map((player) => projectPlayerInput(player, 'outgoing' as const)),
      ...model.subject.receives.map((player) => projectPlayerInput(player, 'incoming' as const)),
    ],
    source_gaps: sourceGaps,
    model,
  };
}

export function candidateOutgoingNames(
  candidate: BriefOptionMoveCandidate,
  subjectSheet: NbaCapSheet | null,
  opts: { allowPackageFallback?: boolean } = {},
): string[] {
  const explicit = uniqueStrings(candidate.outgoing_player_names ?? []);
  if (explicit.length) return explicit;
  if (opts.allowPackageFallback === false) return [];

  const packageText = normalizeName(candidate.outgoing_package ?? candidate.mechanism ?? '');
  if (!subjectSheet || !packageText) return [];

  return subjectSheet.player_rows
    .filter((row) => includesNormalizedPhrase(packageText, row.player_name))
    .map((row) => row.player_name);
}

export function salaryForScenarioRow(
  row: NbaCapSheetPlayerRow,
  season: string | null | undefined,
): Pick<CandidateScenarioPlayer, 'salary_amount' | 'salary_label' | 'source_status'> {
  const current = season
    ? row.salary_cells.find((cell) => cell.season === season && cell.amount != null)
    : null;
  const captured = row.salary_cells.find((cell) => cell.source_status === 'captured' && cell.amount != null);
  const fallback = row.salary_cells.find((cell) => cell.amount != null);
  const cell = current ?? captured ?? fallback ?? null;
  const amount = cell?.amount ?? row.total_amount ?? null;
  const sourceStatus = cell?.source_status ?? row.source_status;
  return {
    salary_amount: amount,
    salary_label: cell?.label ?? formatScenarioMoney(amount),
    source_status: sourceStatus,
  };
}

function teamImpact({
  teamId,
  sheet,
  sends,
  receives,
}: {
  teamId: string;
  sheet: NbaCapSheet | null;
  sends: CandidateScenarioPlayer[];
  receives: CandidateScenarioPlayer[];
}): CandidateScenarioTeamImpact {
  const knownSalaryOut = sumKnownSalary(sends);
  const knownSalaryIn = sumKnownSalary(receives);
  const payrollBefore = sheetPayroll(sheet);
  const netSalaryDelta = knownSalaryIn - knownSalaryOut;
  const payrollAfter = payrollBefore == null ? null : payrollBefore + netSalaryDelta;

  return {
    team_id: sheet?.summary.team.team_id ?? teamId,
    team_name: sheet?.summary.team.full_name ?? teamId,
    sends,
    receives,
    known_salary_out: knownSalaryOut,
    known_salary_in: knownSalaryIn,
    net_salary_delta: netSalaryDelta,
    payroll_before: payrollBefore,
    payroll_after: payrollAfter,
    thresholds: thresholdImpacts(sheet, payrollBefore, payrollAfter),
  };
}

function resolvePlayers(names: string[], sheet: NbaCapSheet | null): CandidateScenarioPlayer[] {
  if (!sheet) return [];
  const out: CandidateScenarioPlayer[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const row = resolveCapRow(sheet, name);
    if (!row) continue;
    const key = normalizeName(row.player_name);
    if (seen.has(key)) continue;
    seen.add(key);
    const salary = salaryForScenarioRow(row, sheet.summary.season);
    out.push({
      name: row.player_name,
      team_id: sheet.summary.team.team_id,
      nba_player_id: row.nba_player_id,
      stats_snapshot: row.stats ?? null,
      ...salary,
    });
  }
  return out;
}

function projectPlayerInput(
  player: CandidateScenarioPlayer,
  direction: 'outgoing' | 'incoming',
): CreateProjectScenarioPlayerRequest {
  return {
    team_id: player.team_id,
    nba_player_id: player.nba_player_id,
    player_name: player.name,
    direction,
    salary_amount: player.salary_amount,
    salary_source_status: player.source_status,
    stats_snapshot: player.stats_snapshot,
  };
}

function sourceGapNotes(model: CandidateScenarioModel): string[] {
  return model.flags
    .filter((flag) => !/^App-derived cap math only/i.test(flag))
    .filter((flag) => (
      /not found|source-needed|not loaded|missing|unresolved|fallback/i.test(flag)
    ));
}

function resolveCapRow(sheet: NbaCapSheet, name: string): NbaCapSheetPlayerRow | null {
  const normalized = normalizeName(name);
  if (!normalized) return null;
  return sheet.player_rows.find((row) => normalizeName(row.player_name) === normalized) ?? null;
}

function scenarioFlags({
  candidate,
  subjectTeamId,
  targetTeamId,
  subjectSheet,
  targetSheet,
  allowOutgoingPackageFallback,
  outgoingNames,
  incomingNames,
  outgoing,
  incoming,
}: {
  candidate: BriefOptionMoveCandidate;
  subjectTeamId: string;
  targetTeamId: string | null;
  subjectSheet: NbaCapSheet | null;
  targetSheet: NbaCapSheet | null;
  allowOutgoingPackageFallback: boolean;
  outgoingNames: string[];
  incomingNames: string[];
  outgoing: CandidateScenarioPlayer[];
  incoming: CandidateScenarioPlayer[];
}): string[] {
  const flags = ['App-derived cap math only; not a Trade Machine or CBA legality verdict.'];
  if (!subjectSheet) flags.push(`${subjectTeamId} cap sheet is not loaded.`);
  if (!targetTeamId) flags.push('Target team is missing from this candidate.');
  if (targetTeamId && !targetSheet) flags.push(`${targetTeamId} cap sheet is not loaded.`);
  if (!candidate.outgoing_player_names?.length && allowOutgoingPackageFallback) {
    flags.push('Outgoing player names were not structured on this candidate; exact-name fallback was used.');
  } else if (!candidate.outgoing_player_names?.length) {
    flags.push('Outgoing player names were not structured on this candidate; free-text package was left in notes.');
  }
  if (/filler|minimum|tbd|unknown/i.test(candidate.outgoing_package ?? '')) {
    flags.push('Outgoing package includes unresolved filler; salary impact may be partial.');
  }
  for (const name of outgoingNames) {
    if (!outgoing.some((player) => normalizeName(player.name) === normalizeName(name))) {
      flags.push(`${name} was not found on the subject-team cap sheet.`);
    }
  }
  for (const name of incomingNames) {
    if (!incoming.some((player) => normalizeName(player.name) === normalizeName(name))) {
      flags.push(`${name} was not found on the target-team cap sheet.`);
    }
  }
  for (const player of [...outgoing, ...incoming]) {
    if (player.salary_amount == null) flags.push(`${player.name} salary is source-needed.`);
  }
  if (subjectSheet && sheetPayroll(subjectSheet) == null) flags.push(`${subjectTeamId} payroll is source-needed.`);
  if (targetSheet && sheetPayroll(targetSheet) == null) flags.push(`${targetTeamId ?? targetSheet.summary.team.team_id} payroll is source-needed.`);
  if (subjectSheet && thresholdImpacts(subjectSheet, 0, 0).some((threshold) => threshold.amount == null)) {
    flags.push(`${subjectTeamId} tax/apron thresholds are source-needed.`);
  }
  if (targetSheet && thresholdImpacts(targetSheet, 0, 0).some((threshold) => threshold.amount == null)) {
    flags.push(`${targetTeamId ?? targetSheet.summary.team.team_id} tax/apron thresholds are source-needed.`);
  }
  return uniqueStrings(flags);
}

function thresholdImpacts(
  sheet: NbaCapSheet | null,
  payrollBefore: number | null,
  payrollAfter: number | null,
): CandidateScenarioThreshold[] {
  return (['luxury_tax', 'first_apron', 'second_apron'] as const).map((key) => {
    const amount = thresholdAmount(sheet, key);
    return {
      key,
      label: THRESHOLD_LABELS[key],
      amount,
      before_distance: payrollBefore == null || amount == null ? null : amount - payrollBefore,
      after_distance: payrollAfter == null || amount == null ? null : amount - payrollAfter,
    };
  });
}

function thresholdAmount(sheet: NbaCapSheet | null, key: CandidateScenarioThreshold['key']): number | null {
  const amount = metricAmount(sheet?.metrics.find((metric) => metric.key === key));
  if (amount != null) return amount;
  if (sheet?.summary.season === '2025-26') return NBA_2025_26_THRESHOLDS[key];
  return null;
}

function sheetPayroll(sheet: NbaCapSheet | null): number | null {
  return sheet?.summary.payroll_amount ?? metricAmount(sheet?.metrics.find((metric) => metric.key === 'payroll'));
}

function metricAmount(metric: NbaCapSheetMetric | undefined): number | null {
  return typeof metric?.amount === 'number' && Number.isFinite(metric.amount) ? metric.amount : null;
}

function sumKnownSalary(players: CandidateScenarioPlayer[]): number {
  return players.reduce((sum, player) => sum + (player.salary_amount ?? 0), 0);
}

function candidateTargetLabel(candidate: BriefOptionMoveCandidate): string {
  const names = (candidate.target_player_names ?? []).map((name) => name.trim()).filter(Boolean);
  const team = candidate.target_team_id ?? candidate.target_team_name ?? null;
  if (names.length) return [names.join(' / '), team].filter(Boolean).join(' · ');
  return candidate.label;
}

function includesNormalizedPhrase(haystack: string, needle: string): boolean {
  const normalizedNeedle = normalizeName(needle);
  if (!normalizedNeedle) return false;
  return new RegExp(`(^|\\s)${escapeRegExp(normalizedNeedle)}($|\\s)`).test(haystack);
}

function normalizeName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeTeamId(value: string | null | undefined): string | null {
  const text = value?.trim().toUpperCase();
  return text || null;
}

function uniqueStrings(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const text = value.trim();
    if (!text) continue;
    const key = normalizeName(text);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0))]
    .sort((a, b) => a - b);
}

function isUsefulText(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatScenarioMoney(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Source needed';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}K`;
  return `${sign}$${Math.round(abs)}`;
}
