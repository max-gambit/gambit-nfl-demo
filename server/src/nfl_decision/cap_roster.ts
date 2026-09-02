import type {
  NflCapRosterAction,
  NflCapRosterBranch,
  NflCapRosterDecisionRequest,
  NflCapRosterDecisionResponse,
  NflCapRosterLever,
  NflDecisionRuleReference,
} from '@shared/types';
import { buildNflDataHealth, type BuildNflDataHealthOptions } from '../nfl_coverage/data_health.js';
import { loadCurrentNflTeamDataWithMode, type NflCapRow, type NflDemoSeed } from '../nfl_data/seed.js';
import { loadNflRulesCorpus, type NflRuleRow } from '../nfl_rules/seed.js';

export interface BuildCapRosterDecisionOptions extends BuildNflDataHealthOptions {}

export async function buildCapRosterDecision(
  input: NflCapRosterDecisionRequest,
  options: BuildCapRosterDecisionOptions = {},
): Promise<NflCapRosterDecisionResponse> {
  validateRequest(input);
  const teamId = input.team_id.toUpperCase();
  const data = options.data ?? await loadCurrentNflTeamDataWithMode(teamId);
  const rules = options.rules ?? await loadNflRulesCorpus();
  const generatedAt = options.generatedAt ?? new Date();
  const health = await buildNflDataHealth(teamId, {
    data,
    rules,
    generatedAt,
    transactionMarket: options.transactionMarket,
  });
  const detail = teamSeed(data.seed, teamId);
  if (!detail.teamExists) throw new Error(`Unknown NFL team ${teamId}`);
  const protectedPlayers = new Set(input.protected_player_ids);
  const protectedGroups = new Set(input.protected_position_groups.map(normalizePosition));
  const metricByPlayer = new Map(detail.metrics.map((row) => [row.player_id, row]));
  const ruleByFamily = new Map(rules.rules.map((rule) => [rule.rule_family, rule]));
  const allowed = new Set(input.allowed_levers);
  const exactRows = detail.cap.filter(isExact);
  const excludedDirectional = detail.cap.length - exactRows.length;
  const candidates = bestActionPerPlayer(detail.cap.flatMap((row) => {
    if (!row.player_id || protectedPlayers.has(row.player_id) || protectedGroups.has(normalizePosition(row.position))) return [];
    return actionCandidates(row, allowed, metricByPlayer.get(row.player_id), ruleByFamily);
  }));
  const target = input.target_relief_dollars;
  const preservePool = candidates.filter((action) => action.depth_effect === 'none' || action.depth_effect === 'low');
  const balancedPool = [...candidates].sort(actionSortBalanced);
  const maximizePool = [...candidates].sort((a, b) => b.relief_dollars - a.relief_dollars || a.player_name.localeCompare(b.player_name));
  const commonBlockers = excludedDirectional
    ? [`${excludedDirectional} contract rows are directional or source-needed and cannot drive exact branch totals.`]
    : [];
  if (allowed.has('restructure')) commonBlockers.push('Restructure estimates are shown as a follow-up lever only until eligible salary and conversion terms are captured.');
  if (allowed.has('extension')) commonBlockers.push('Extension economics require sourced proposed terms or visibly user-entered assumptions.');
  const branches: NflCapRosterBranch[] = [
    makeBranch('hold', 'Hold', 'Preserve the current roster and create no modeled relief.', [], target, health.meeting_ready, commonBlockers, ['No cap relief is created.', 'All current depth is preserved.']),
    makeBranch('preserve_depth', 'Preserve depth', 'Use only verified positive-relief moves with low modeled depth impact.', takeUntil(preservePool, target), target, health.meeting_ready, commonBlockers, ['Protects starters and high-usage depth.', 'May leave the target unmet.']),
    makeBranch('balanced', 'Balanced', 'Mix verified relief with explicit depth tradeoffs.', takeUntil(balancedPool, target), target, health.meeting_ready, commonBlockers, ['Balances relief against role and snap context.', 'Requires football review for every medium-impact move.']),
    makeBranch('maximize_relief', 'Maximize relief', 'Show the maximum supported positive relief in the current public ledger.', maximizePool, target, health.meeting_ready, commonBlockers, ['Highest verified relief.', 'Largest modeled depth cost and replacement burden.']),
  ];
  assertBranchInvariants(branches, input);
  const preferred = (['preserve_depth', 'balanced', 'maximize_relief'] as const)
    .map((id) => branches.find((branch) => branch.id === id)!)
    .find((branch) => branch.target_met && branch.status === 'supported');
  const maximum = branches.find((branch) => branch.id === 'maximize_relief')!;
  const recommendedBranchId = health.meeting_ready ? preferred?.id ?? null : null;
  const status = !health.meeting_ready
    ? 'blocked'
    : recommendedBranchId
      ? 'ready'
      : 'insufficient_evidence';
  if (!maximum.target_met && !maximum.blockers.includes('The requested target exceeds the maximum supported relief in the loaded evidence.')) {
    maximum.blockers.push('The requested target exceeds the maximum supported relief in the loaded evidence.');
    maximum.status = 'insufficient_evidence';
  }

  return {
    schema_version: 'nfl_cap_roster_decision.v1',
    generated_at: generatedAt.toISOString(),
    status,
    team_id: teamId,
    public_demo_data: true,
    data_health: health,
    evidence: {
      source_refs: data.seed.source_refs,
      exact_contract_rows: exactRows.length,
      captured_contract_rows: exactRows.filter((row) => row.contract_ledger_confidence === 'captured').length,
      derived_contract_rows: exactRows.filter((row) => row.contract_ledger_confidence === 'derived').length,
      directional_contract_rows: detail.cap.filter((row) => !isExact(row) && row.source_status === 'estimated').length,
      source_needed_contract_rows: detail.cap.filter((row) => !isExact(row) && row.source_status !== 'estimated').length,
      rule_reference_count: new Set(branches.flatMap((branch) => branch.actions.flatMap((action) => action.rule_references.map((rule) => rule.rule_id)))).size,
    },
    baseline: {
      season: data.seed.season,
      as_of_date: data.seed.as_of_date,
      retrieved_at: data.seed.retrieved_at,
      roster_count: detail.rosterCount,
      total_cap_commitments_dollars: detail.cap.reduce((total, row) => total + (row.cap_number_2026 ?? 0), 0),
      complete_cap_rows: detail.cap.filter(isExact).length,
      incomplete_cap_rows: detail.cap.filter((row) => !isExact(row)).length,
    },
    branches,
    recommended_branch_id: recommendedBranchId,
    what_changes_the_call: [
      { id: 'ledger-refresh', trigger: 'A new contract or league cap ledger is captured.', effect: 'Recompute all relief and dead-money totals.', owner: 'Cap administration' },
      { id: 'depth-review', trigger: 'A protected player or position group changes.', effect: 'Remove prohibited actions and rebuild each branch.', owner: 'Football operations' },
      { id: 'medical-role', trigger: 'Medical, role, or replacement-cost evidence changes.', effect: 'Regrade depth impact before selecting a branch.', owner: 'Personnel and medical' },
      { id: 'target-change', trigger: 'The required cap target changes.', effect: 'Re-select the smallest supported action set that reaches it.', owner: 'General manager' },
    ],
    assumptions: input.assumptions ?? [],
    deterministic_summary: deterministicSummary(teamId, target, maximum.total_relief_dollars, recommendedBranchId, health.meeting_ready),
  };
}

function validateRequest(input: NflCapRosterDecisionRequest): void {
  if (!input || typeof input !== 'object') throw new Error('request body required');
  if (!input.team_id) throw new Error('team_id required');
  if (!Number.isSafeInteger(input.target_relief_dollars) || input.target_relief_dollars < 0) throw new Error('target_relief_dollars must be a non-negative integer dollar amount');
  if (!Array.isArray(input.protected_player_ids) || !Array.isArray(input.protected_position_groups) || !Array.isArray(input.allowed_levers)) throw new Error('protection and lever fields must be arrays');
  const levers = new Set<NflCapRosterLever>(['hold', 'restructure', 'extension', 'pre_june_cut', 'post_june_cut', 'trade']);
  if (input.allowed_levers.some((lever) => !levers.has(lever))) throw new Error('allowed_levers contains an unsupported lever');
  if (input.assumptions?.some((item) => item.source !== 'user_entered')) throw new Error('assumptions must be labeled user_entered');
}

function teamSeed(seed: NflDemoSeed, teamId: string) {
  return {
    teamExists: seed.teams.some((team) => team.team_id === teamId),
    rosterCount: seed.roster_entries.filter((row) => row.team_id === teamId).length,
    cap: seed.cap_rows.filter((row) => row.team_id === teamId && row.player_id),
    metrics: seed.player_metrics.filter((row) => row.team_id === teamId),
  };
}

function actionCandidates(
  row: NflCapRow,
  allowed: Set<NflCapRosterLever>,
  metric: NflDemoSeed['player_metrics'][number] | undefined,
  rules: Map<string, NflRuleRow>,
): NflCapRosterAction[] {
  if (!row.player_id || !isExact(row)) return [];
  const choices: Array<[NflCapRosterLever, number | null, number | null, string]> = [
    ['pre_june_cut', row.cut_savings_2026, row.dead_money_if_cut_2026, 'post_june_1_accounting'],
    ['post_june_cut', row.post_june_1_cut_savings_2026, row.post_june_1_dead_money_2026, 'post_june_1_accounting'],
    ['trade', row.trade_savings_2026, row.trade_dead_money_2026, 'trades'],
  ];
  return choices.flatMap(([lever, relief, dead, ruleFamily]) => {
    if (!allowed.has(lever) || relief == null || relief <= 0 || dead == null) return [];
    const rule = rules.get(ruleFamily);
    if (!rule) return [];
    return [{
      player_id: row.player_id!,
      player_name: row.player_name,
      position: row.position,
      lever: lever as NflCapRosterAction['lever'],
      relief_dollars: relief,
      dead_money_dollars: dead,
      cap_number_dollars: row.cap_number_2026!,
      depth_effect: depthEffect(metric),
      depth_evidence: depthEvidence(metric),
      confidence: row.contract_ledger_confidence,
      source_status: row.source_status,
      source_url: row.source_url,
      blockers: [],
      rule_references: [ruleReference(rule)],
      next_actions: ['Confirm the contract row with cap administration.', 'Confirm the football replacement plan before execution.'],
    }];
  });
}

function isExact(row: NflCapRow): boolean {
  return row.source_status === 'captured'
    && (row.contract_ledger_confidence === 'captured' || row.contract_ledger_confidence === 'derived')
    && row.cap_number_2026 != null
    && row.guaranteed_remaining != null
    && row.contract_end_year != null
    && row.contract_years_remaining != null
    && row.dead_money_if_cut_2026 != null
    && row.cut_savings_2026 != null
    && row.post_june_1_dead_money_2026 != null
    && row.post_june_1_cut_savings_2026 != null
    && row.trade_dead_money_2026 != null
    && row.trade_savings_2026 != null
    && rowArithmeticReconciles(row);
}

function bestActionPerPlayer(actions: NflCapRosterAction[]): NflCapRosterAction[] {
  const best = new Map<string, NflCapRosterAction>();
  for (const action of actions) {
    const current = best.get(action.player_id);
    if (!current || action.relief_dollars > current.relief_dollars) best.set(action.player_id, action);
  }
  return [...best.values()];
}

function takeUntil(actions: NflCapRosterAction[], target: number): NflCapRosterAction[] {
  if (target === 0) return [];
  const selected: NflCapRosterAction[] = [];
  let total = 0;
  for (const action of actions) {
    if (total >= target) break;
    selected.push(action);
    total += action.relief_dollars;
  }
  return selected;
}

function makeBranch(
  id: NflCapRosterBranch['id'], label: string, thesis: string, actions: NflCapRosterAction[], target: number,
  evidenceReady: boolean, blockers: string[], tradeoffs: string[],
): NflCapRosterBranch {
  const relief = actions.reduce((total, action) => total + action.relief_dollars, 0);
  const dead = actions.reduce((total, action) => total + action.dead_money_dollars, 0);
  return { id, label, thesis, status: evidenceReady ? 'supported' : 'insufficient_evidence', target_relief_dollars: target, total_relief_dollars: relief, total_dead_money_dollars: dead, target_met: relief >= target, actions, blockers: [...blockers], tradeoffs };
}

function actionSortBalanced(a: NflCapRosterAction, b: NflCapRosterAction): number {
  const impact = { none: 0, low: 1, medium: 2, high: 3, unknown: 4 };
  return impact[a.depth_effect] - impact[b.depth_effect] || b.relief_dollars - a.relief_dollars || a.player_name.localeCompare(b.player_name);
}

function depthEffect(metric: NflDemoSeed['player_metrics'][number] | undefined): NflCapRosterAction['depth_effect'] {
  if (!hasCapturedDepthEvidence(metric) || metric.snap_share_2025 == null) return 'unknown';
  if (metric.snap_share_2025 >= 0.65) return 'high';
  if (metric.snap_share_2025 >= 0.3) return 'medium';
  return 'low';
}

function depthEvidence(metric: NflDemoSeed['player_metrics'][number] | undefined): NflCapRosterAction['depth_evidence'] {
  if (!hasCapturedDepthEvidence(metric) || metric.snap_share_2025 == null) {
    return {
      source_status: 'source-needed',
      as_of_season: '2025',
      basis: 'No captured public 2025 snap-share sample is available; football impact remains unknown.',
      source_url: metric?.source_url ?? null,
    };
  }
  const percent = Math.round(metric.snap_share_2025 * 1000) / 10;
  const starts = metric.starts_2025 == null ? 'starts not reported' : `${metric.starts_2025} starts`;
  const games = metric.games_2025 == null ? 'games not reported' : `${metric.games_2025} games`;
  return {
    source_status: 'captured',
    as_of_season: '2025',
    basis: `${percent}% of team snaps across ${games}; ${starts}.`,
    source_url: metric.source_url,
  };
}

function hasCapturedDepthEvidence(metric: NflDemoSeed['player_metrics'][number] | undefined): metric is NflDemoSeed['player_metrics'][number] {
  return metric?.source_status === 'captured' && metric.metric_confidence !== 'source-needed';
}

function ruleReference(rule: NflRuleRow): NflDecisionRuleReference {
  return { rule_id: rule.rule_family, title: rule.title, locator: rule.source_locator, authoritative_url: rule.source_url };
}

function normalizePosition(position: string | null): string {
  const value = (position ?? 'Other').toUpperCase();
  if (['T', 'OT', 'G', 'OG', 'C', 'OL'].includes(value)) return 'OL';
  if (['DE', 'OLB', 'EDGE', 'LB', 'MLB', 'ILB'].includes(value)) return 'EDGE/LB';
  if (['DT', 'NT', 'DL'].includes(value)) return 'DL';
  if (['FS', 'SS', 'S', 'SAF'].includes(value)) return 'S';
  if (['CB', 'DB'].includes(value)) return 'CB';
  if (['FB', 'HB', 'RB'].includes(value)) return 'RB';
  return value;
}

function rowArithmeticReconciles(row: NflCapRow): boolean {
  if (row.cap_number_2026 == null) return false;
  return [
    [row.dead_money_if_cut_2026, row.cut_savings_2026],
    [row.post_june_1_dead_money_2026, row.post_june_1_cut_savings_2026],
    [row.trade_dead_money_2026, row.trade_savings_2026],
  ].every(([dead, relief]) => dead != null && relief != null && row.cap_number_2026! - dead === relief);
}

function assertBranchInvariants(branches: NflCapRosterBranch[], input: NflCapRosterDecisionRequest): void {
  const protectedPlayers = new Set(input.protected_player_ids);
  const protectedGroups = new Set(input.protected_position_groups.map(normalizePosition));
  for (const branch of branches) {
    const players = new Set<string>();
    let relief = 0;
    let dead = 0;
    for (const action of branch.actions) {
      if (action.relief_dollars <= 0) throw new Error('non-positive value cannot be labeled relief');
      if (players.has(action.player_id)) throw new Error(`duplicate transaction action for ${action.player_id}`);
      if (protectedPlayers.has(action.player_id) || protectedGroups.has(normalizePosition(action.position))) throw new Error(`protected player or position entered branch: ${action.player_id}`);
      players.add(action.player_id);
      relief += action.relief_dollars;
      dead += action.dead_money_dollars;
    }
    if (relief !== branch.total_relief_dollars || dead !== branch.total_dead_money_dollars) throw new Error(`branch totals do not reconcile for ${branch.id}`);
  }
}

function deterministicSummary(teamId: string, target: number, maximum: number, recommended: string | null, ready: boolean): string {
  if (!ready) return `${teamId} modeling is blocked by the data preflight. No branch is recommended.`;
  if (!recommended) return `${teamId} has ${formatDollars(maximum)} in maximum supported positive relief against a ${formatDollars(target)} target; evidence is insufficient to claim the target is met.`;
  return `${teamId} can meet the ${formatDollars(target)} target in the supported ${recommended.replace(/_/g, ' ')} branch. All figures are computed from the loaded contract rows.`;
}

function formatDollars(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
}
