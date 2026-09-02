import type {
  NflDataHealthDataset,
  NflDataHealthResponse,
  NflDataHealthStatus,
} from '@shared/types';
import {
  loadCurrentNflDataWithMode,
  type NflCapRow,
  type NflCurrentDataLoadResult,
} from '../nfl_data/seed.js';
import { loadNflRulesCorpus, type NflRulesCorpus } from '../nfl_rules/seed.js';

const ROSTER_MAX_AGE_HOURS = 48;

export interface BuildNflDataHealthOptions {
  data?: NflCurrentDataLoadResult;
  rules?: NflRulesCorpus;
  generatedAt?: Date;
}

export async function buildNflDataHealth(
  teamId: string,
  options: BuildNflDataHealthOptions = {},
): Promise<NflDataHealthResponse> {
  const normalizedTeamId = teamId.toUpperCase();
  const [{ seed, source_mode, fallback_reason }, rules] = await Promise.all([
    options.data ? Promise.resolve(options.data) : loadCurrentNflDataWithMode(),
    options.rules ? Promise.resolve(options.rules) : loadNflRulesCorpus(),
  ]);
  const generatedAt = options.generatedAt ?? new Date();
  const roster = seed.roster_entries.filter((row) => row.team_id === normalizedTeamId);
  const cap = seed.cap_rows.filter((row) => row.team_id === normalizedTeamId && row.player_id);
  const metrics = seed.player_metrics.filter((row) => row.team_id === normalizedTeamId);
  const ageHours = dateAgeHours(seed.as_of_date, generatedAt);
  const dbBacked = source_mode === 'supabase_current_views';
  const coreIncomplete = cap.filter((row) => isDecisionCritical(row) && !hasDecisionFields(row));
  const arithmeticFailures = cap.filter((row) => row.source_status === 'captured' && row.cap_number_2026 != null && !rowArithmeticReconciles(row));
  const rosterGaps = [];
  if (!dbBacked) rosterGaps.push({ code: 'not_db_backed', message: 'Roster is not loaded from the current database view.' });
  if (ageHours == null || ageHours > ROSTER_MAX_AGE_HOURS) rosterGaps.push({ code: 'roster_stale', message: 'Roster snapshot is older than 48 hours.' });
  if (roster.length === 0) rosterGaps.push({ code: 'roster_missing', message: 'No team roster rows are loaded.' });
  const capGaps = [];
  if (!dbBacked) capGaps.push({ code: 'not_db_backed', message: 'Cap contracts are not loaded from the current database view.' });
  if (ageHours == null || ageHours > ROSTER_MAX_AGE_HOURS) capGaps.push({ code: 'cap_stale', message: 'Cap snapshot is older than 48 hours.' });
  if (coreIncomplete.length) capGaps.push({ code: 'critical_contract_fields_missing', message: 'Some contract rows lack core cut, trade, post-June, guarantee, or term fields.', affected_count: coreIncomplete.length });
  if (arithmeticFailures.length) capGaps.push({ code: 'cap_arithmetic_failure', message: 'Some relief figures do not reconcile to cap number minus dead money.', affected_count: arithmeticFailures.length });
  const metricSourceNeeded = metrics.filter((row) => row.source_status === 'source-needed').length;
  const metricGaps = metricSourceNeeded
    ? [{ code: 'metric_context_incomplete', message: 'Historical performance rows with no public sample remain explicitly source-needed.', affected_count: metricSourceNeeded }]
    : [];
  const rulesMissing = rules.rules.filter((rule) => !rule.source_locator || !rule.source_url || !rule.effective_date);
  const ruleGaps = rulesMissing.length
    ? [{ code: 'rule_locator_missing', message: 'One or more rule rows lacks an authoritative URL, effective date, or exact locator.', affected_count: rulesMissing.length }]
    : [];

  const datasets: NflDataHealthDataset[] = [
    dataset('roster', 'Roster', blockingStatus(rosterGaps), source_mode, seed.source_name, seed.source_url, seed.as_of_date, seed.retrieved_at, 'Within 48 hours', ROSTER_MAX_AGE_HOURS, ageHours, roster.length, roster.length, 0, 0, rosterGaps),
    dataset('cap_contracts', 'Cap & contracts', blockingStatus(capGaps), source_mode, seed.source_name, seed.source_url, seed.as_of_date, seed.retrieved_at, 'Within 48 hours', ROSTER_MAX_AGE_HOURS, ageHours, cap.length, cap.filter(exactContractRow).length, cap.filter((row) => row.contract_ledger_confidence === 'derived').length, cap.filter((row) => !exactContractRow(row)).length, capGaps),
    dataset('player_metrics', 'Historical performance', metricGaps.length ? 'degraded' : 'ready', source_mode, seed.source_name, seed.source_url, seed.as_of_date, seed.retrieved_at, 'After each completed season and public-feed revision', null, null, metrics.length, metrics.filter((row) => row.source_status === 'captured').length, metrics.filter((row) => row.source_status === 'roster-derived').length, metricSourceNeeded, metricGaps),
    dataset('rules', 'Rule authority', ruleGaps.length ? 'blocked' : 'ready', 'authoritative_corpus', rules.source_name, rules.source_url, rules.as_of_date, rules.retrieved_at, 'On CBA, resolution, or league-calendar change', null, null, rules.rules.length, rules.rules.length - rulesMissing.length, 0, rulesMissing.length, ruleGaps),
  ];
  const blockers = datasets.flatMap((item) => item.status === 'blocked' ? item.gaps.map((gap) => gap.message) : []);
  const status: NflDataHealthStatus = blockers.length ? 'blocked' : datasets.some((item) => item.status === 'degraded') ? 'degraded' : 'ready';
  const meetingReady = blockers.length === 0;

  return {
    schema_version: 'nfl_data_health.v1',
    generated_at: generatedAt.toISOString(),
    team_id: normalizedTeamId,
    status,
    meeting_ready: meetingReady,
    source_mode,
    fallback_reason,
    datasets,
    rule_authority: {
      status: ruleGaps.length ? 'blocked' : 'ready',
      authoritative_url: rules.source_url,
      effective_date: rules.as_of_date,
      retrieved_at: rules.retrieved_at,
      rules_with_locators: rules.rules.length - rulesMissing.length,
      total_rules: rules.rules.length,
      gaps: ruleGaps,
    },
    blockers,
    remediation: remediationFor({ dbBacked, ageHours, coreIncomplete: coreIncomplete.length, arithmeticFailures: arithmeticFailures.length, rulesMissing: rulesMissing.length }),
  };
}

function dataset(
  id: NflDataHealthDataset['id'], label: string, status: NflDataHealthStatus,
  sourceMode: NflDataHealthDataset['source_mode'], sourceName: string, sourceUrl: string | null,
  asOfDate: string | null, retrievedAt: string | null, cadence: string, maxAge: number | null,
  ageHours: number | null, rowCount: number, captured: number, derived: number, sourceNeeded: number,
  gaps: NflDataHealthDataset['gaps'],
): NflDataHealthDataset {
  return { id, label, status, source_mode: sourceMode, source_name: sourceName, source_url: sourceUrl, as_of_date: asOfDate, retrieved_at: retrievedAt, expected_cadence: cadence, max_age_hours: maxAge, age_hours: ageHours, row_count: rowCount, captured_count: captured, derived_count: derived, source_needed_count: sourceNeeded, gaps, blocker: status === 'blocked' ? gaps[0]?.message ?? 'Blocked' : null };
}

function blockingStatus(gaps: NflDataHealthDataset['gaps']): NflDataHealthStatus {
  return gaps.length ? 'blocked' : 'ready';
}

function dateAgeHours(value: string, now: Date): number | null {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.round(((now.getTime() - parsed) / 3_600_000) * 10) / 10);
}

function hasDecisionFields(row: NflCapRow): boolean {
  return row.cap_number_2026 != null
    && row.guaranteed_remaining != null
    && row.contract_end_year != null
    && row.contract_years_remaining != null
    && row.dead_money_if_cut_2026 != null
    && row.cut_savings_2026 != null
    && row.post_june_1_dead_money_2026 != null
    && row.post_june_1_cut_savings_2026 != null
    && row.trade_dead_money_2026 != null
    && row.trade_savings_2026 != null;
}

function isDecisionCritical(row: NflCapRow): boolean {
  return Math.max(row.cut_savings_2026 ?? 0, row.post_june_1_cut_savings_2026 ?? 0, row.trade_savings_2026 ?? 0) >= 2_000_000;
}

function rowArithmeticReconciles(row: NflCapRow): boolean {
  if (row.cap_number_2026 == null) return false;
  const pairs: Array<[number | null, number | null]> = [
    [row.dead_money_if_cut_2026, row.cut_savings_2026],
    [row.post_june_1_dead_money_2026, row.post_june_1_cut_savings_2026],
    [row.trade_dead_money_2026, row.trade_savings_2026],
    [row.post_june_1_trade_dead_money_2026, row.post_june_1_trade_savings_2026],
  ];
  return pairs.every(([dead, relief]) => dead == null || relief == null || row.cap_number_2026! - dead === relief);
}

function exactContractRow(row: NflCapRow): boolean {
  return row.source_status === 'captured'
    && (row.contract_ledger_confidence === 'captured' || row.contract_ledger_confidence === 'derived')
    && hasDecisionFields(row)
    && rowArithmeticReconciles(row);
}

function remediationFor(input: { dbBacked: boolean; ageHours: number | null; coreIncomplete: number; arithmeticFailures: number; rulesMissing: number }): string[] {
  const result: string[] = [];
  if (!input.dbBacked) result.push('Load and verify the reviewed NFL snapshot in Supabase current views.');
  if (input.ageHours == null || input.ageHours > ROSTER_MAX_AGE_HOURS) result.push('Refresh roster and cap sources, then record a new as-of and retrieval time.');
  if (input.coreIncomplete) result.push(`Complete ${input.coreIncomplete} decision-critical contract rows before using them in an exact branch.`);
  if (input.arithmeticFailures) result.push(`Rebuild ${input.arithmeticFailures} contract rows whose cap arithmetic does not reconcile.`);
  if (input.rulesMissing) result.push(`Add exact official locators for ${input.rulesMissing} rule rows.`);
  return result;
}
