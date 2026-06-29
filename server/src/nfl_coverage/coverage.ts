import type {
  NflCoverageDomain,
  NflCoverageDomainSummary,
  NflCoverageGap,
  NflCoverageMatrixResponse,
  NflCoveragePositionGroupSummary,
  NflCoverageQuestionReadiness,
  NflCoverageReadinessKey,
  NflCoverageSourceMode,
  NflCoverageSourceRef,
  NflCoverageStatus,
  NflCoverageTeamRow,
} from '@shared/types';
import {
  loadCurrentNflDataWithMode,
  snapshot,
  type NflCapRow,
  type NflCurrentDataLoadResult,
  type NflDemoSeed,
  type NflPlayerMetricRow,
  type NflRosterEntry,
} from '../nfl_data/seed.js';
import { loadNflRulesCorpus } from '../nfl_rules/seed.js';
import { listTeamContextPreferences, type TeamPreferenceStoreOptions } from '../context_graph/preferences.js';

const REQUIRED_RULE_FAMILIES = [
  'restructure_conversion',
  'post_june_1_accounting',
  'franchise_transition_tag',
  'rookie_contract_options',
  'practice_squad_roster_management',
  'injury_lists',
  'waivers',
  'compensatory_picks',
  'trades',
  'salary_cap_accounting',
  'extensions',
];

const POSITION_GROUPS = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'EDGE/LB', 'LB', 'CB', 'S', 'ST', 'Other'];

const STATUS_SCORE: Record<NflCoverageStatus, number> = {
  blocked: 0,
  weak: 1,
  directional: 2,
  strong: 3,
};

const TARGET_READINESS_SCORE = 9;

export interface BuildNflCoverageMatrixOptions extends TeamPreferenceStoreOptions {
  data?: NflCurrentDataLoadResult;
  generatedAt?: Date;
}

export async function buildNflCoverageMatrix(
  options: BuildNflCoverageMatrixOptions = {},
): Promise<NflCoverageMatrixResponse> {
  const [{ seed, source_mode, fallback_reason }, rulesCorpus, graph] = await Promise.all([
    options.data ? Promise.resolve(options.data) : loadCurrentNflDataWithMode(),
    loadNflRulesCorpus(),
    listTeamContextPreferences(options),
  ]);

  const rulesDomain = rulesCoverage(rulesCorpus.rules.map((rule) => rule.rule_family), rulesCorpus.rules.length);
  const teamRows = seed.teams.map((team) => {
    const graphTeam = graph.teams.find((candidate) => candidate.team_id === team.team_id) ?? null;
    return teamCoverage(seed, team.team_id, rulesDomain, graphTeam);
  });
  const playerCapRows = seed.cap_rows.filter((row) => row.player_id);
  const leagueContractCoverage = contractCoverage(playerCapRows);
  const sellerStrongCount = teamRows.filter((team) => domainById(team, 'seller_thesis').readiness_score >= TARGET_READINESS_SCORE).length;
  const materialReadinessScore = roundScore(Math.min(
    rulesDomain.readiness_score,
    ...teamRows.flatMap((team) => team.domains.map((domain) => domain.readiness_score)),
  ));
  const leagueReadinessScore = roundScore(Math.min(
    averageScore(teamRows.map((team) => team.readiness_score)),
    globalCapSourceReadinessScore(playerCapRows),
    sellerStrongCount >= 28 ? 10 : Math.max(6, 10 - ((28 - sellerStrongCount) * 0.3)),
    materialReadinessScore,
  ));
  const leagueStatus = statusFromReadinessScore(leagueReadinessScore);
  const leagueTopGap = leagueToNineTenGap(teamRows, playerCapRows);

  return {
    snapshot: snapshot(seed),
    source_mode: source_mode as NflCoverageSourceMode,
    fallback_reason,
    generated_at: (options.generatedAt ?? new Date()).toISOString(),
    league: {
      status: leagueStatus,
      readiness_score: leagueReadinessScore,
      target_score: TARGET_READINESS_SCORE,
      gap_to_9_10: gapToTarget(leagueReadinessScore),
      to_9_10: leagueTopGap,
      team_count: seed.teams.length,
      roster_row_count: seed.roster_entries.length,
      cap_row_count: playerCapRows.length,
      player_metric_row_count: seed.player_metrics.length,
      source_needed_cap_row_count: playerCapRows.filter((row) => row.source_status === 'source-needed').length,
      contract_field_coverage: leagueContractCoverage,
      rules_status: rulesDomain.status,
      intel_status: minimumStatus(teamRows.map((team) => domainById(team, 'intel').status)),
      seller_thesis_team_count: sellerStrongCount,
    },
    teams: teamRows,
    rules: rulesDomain,
    sources: coverageSources(seed, source_mode as NflCoverageSourceMode, fallback_reason, rulesCorpus, graph.metadata),
  };
}

export async function buildNflCoverageTeam(
  teamId: string,
  options: BuildNflCoverageMatrixOptions = {},
): Promise<NflCoverageMatrixResponse & { team: NflCoverageTeamRow | null }> {
  const matrix = await buildNflCoverageMatrix(options);
  const normalized = teamId.toUpperCase();
  return {
    ...matrix,
    team: matrix.teams.find((team) => team.team_id === normalized) ?? null,
  };
}

function teamCoverage(
  seed: NflDemoSeed,
  teamId: string,
  rulesDomain: NflCoverageDomainSummary,
  graphTeam: Awaited<ReturnType<typeof listTeamContextPreferences>>['teams'][number] | null,
): NflCoverageTeamRow {
  const team = seed.teams.find((row) => row.team_id === teamId);
  if (!team) throw new Error(`Unknown NFL coverage team ${teamId}`);
  const rosterRows = seed.roster_entries.filter((row) => row.team_id === teamId);
  const capRows = seed.cap_rows.filter((row) => row.team_id === teamId && row.player_id);
  const metricRows = seed.player_metrics.filter((row) => row.team_id === teamId);
  const domains = [
    rosterCoverage(rosterRows, capRows),
    capContractCoverage(rosterRows, capRows),
    playerMetricsCoverage(rosterRows, metricRows),
    { ...rulesDomain },
    intelCoverage(graphTeam),
    sellerThesisCoverage(graphTeam),
  ];
  const positionGroups = buildPositionGroups(rosterRows, capRows, metricRows, graphTeam);
  const readiness = buildReadiness(domains);
  const topGaps = topCoverageGaps([...domains.flatMap((domain) => domain.gaps), ...readiness.flatMap((item) => item.gaps)]);
  const readinessScore = roundScore(Math.min(...domains.map((domain) => domain.readiness_score)));
  const teamStatus = statusFromReadinessScore(readinessScore);
  return {
    ...team,
    status: teamStatus,
    readiness_score: readinessScore,
    target_score: TARGET_READINESS_SCORE,
    gap_to_9_10: gapToTarget(readinessScore),
    to_9_10: teamToNineTenGap(domains, topGaps),
    demo_safe_prompts: demoSafePrompts(readiness, positionGroups, teamId),
    roster_count: rosterRows.length,
    cap_row_count: capRows.length,
    player_metric_row_count: metricRows.length,
    source_needed_cap_row_count: capRows.filter((row) => row.source_status === 'source-needed').length,
    contract_field_coverage: contractCoverage(capRows),
    domains,
    position_groups: positionGroups,
    readiness,
    top_gaps: topGaps,
    graph_roster_count: graphTeam?.roster_summary.roster_count ?? 0,
    trade_market_intel_group_count: graphTeam?.preferences.trade_market_intel?.position_group_stance.length ?? 0,
  };
}

function rosterCoverage(rosterRows: NflRosterEntry[], capRows: NflCapRow[]): NflCoverageDomainSummary {
  const gaps: NflCoverageGap[] = [];
  const parity = playerUniverseParity(rosterRows, capRows);
  if (rosterRows.length === 0) {
    gaps.push(gap('roster_missing', 'Roster missing', 'blocked', 'No current roster rows are loaded for this team.'));
  }
  if (rosterRows.length > 0 && rosterRows.length < 70) {
    gaps.push(gap('roster_low_count', 'Roster count low', 'weak', `Only ${rosterRows.length} current roster rows are loaded.`, rosterRows.length));
  }
  if (!parity.matches) {
    gaps.push(gap(
      'roster_cap_parity',
      'Roster/cap parity gap',
      'weak',
      parity.detail,
      parity.affected_count,
      parity.affected_players,
    ));
  }
  const status = gaps.some((item) => item.severity === 'blocked')
    ? 'blocked'
    : gaps.length
      ? 'weak'
      : 'strong';
  return domain('roster', status, rosterRows.length, 0, gaps, `Current roster rows: ${rosterRows.length}; cap player-universe parity: ${parity.matches ? 'yes' : 'no'}.`);
}

function capContractCoverage(rosterRows: NflRosterEntry[], capRows: NflCapRow[]): NflCoverageDomainSummary {
  const gaps: NflCoverageGap[] = [];
  const parity = playerUniverseParity(rosterRows, capRows);
  const coverage = contractCoverage(capRows);
  const sourceNeeded = capRows.filter((row) => row.source_status === 'source-needed');
  const total = coverage.total_player_cap_rows;
  const completeRows = capRows.filter(hasCoreContractFields);
  const completeRatio = total === 0 ? 0 : completeRows.length / total;
  const sourceNeededRatio = total === 0 ? 1 : sourceNeeded.length / total;
  const highCapMissing = capRows.filter((row) => (
    (row.cap_number_2026 ?? 0) > 5_000_000
    && !hasCoreContractFields(row)
  ));

  if (total === 0) gaps.push(gap('cap_missing', 'Cap rows missing', 'blocked', 'No player cap rows are loaded for this team.'));
  if (!parity.matches) gaps.push(gap('cap_roster_parity', 'Cap/roster parity gap', 'weak', parity.detail, parity.affected_count, parity.affected_players));
  if (completeRatio < 0.95) gaps.push(gap('contract_fields_incomplete', 'Contract fields incomplete', 'directional', `${completeRows.length}/${total} rows have years, dead/cut, post-June, and trade fields.`, total - completeRows.length, missingContractFieldPlayers(capRows)));
  if (sourceNeededRatio >= 0.05) gaps.push(gap('source_needed_cap_rows', 'Cap rows need source review', 'directional', `${sourceNeeded.length}/${total} cap rows need source review.`, sourceNeeded.length, sourceNeeded.map((row) => row.player_name).slice(0, 8)));
  if (highCapMissing.length) gaps.push(gap('high_cap_ledger_gaps', 'High-cap ledger gaps', 'weak', `${highCapMissing.length} rows above $5M are missing required ledger fields.`, highCapMissing.length, highCapMissing.map((row) => row.player_name).slice(0, 8)));

  const readinessScore = capContractReadinessScore({
    total,
    completeRows: completeRows.length,
    sourceNeeded: sourceNeeded.length,
    highCapMissing: highCapMissing.length,
    parityMatches: parity.matches,
  });
  return domain(
    'cap_contracts',
    statusFromReadinessScore(readinessScore),
    total,
    sourceNeeded.length,
    gaps,
    `${completeRows.length}/${total} cap rows expose core contract mechanics; ${sourceNeeded.length} rows need source review.`,
    readinessScore,
    capContractsToNineTen(readinessScore, sourceNeeded.length, total, highCapMissing.length),
  );
}

function playerMetricsCoverage(rosterRows: NflRosterEntry[], metricRows: NflPlayerMetricRow[]): NflCoverageDomainSummary {
  const gaps: NflCoverageGap[] = [];
  const parity = playerUniverseParity(rosterRows, metricRows);
  const statuses = metricRows.map((row) => row.source_status ?? 'roster-derived');
  const captured = statuses.filter((status) => status === 'captured').length;
  const sourceNeeded = metricRows.filter((row) => row.source_status === 'source-needed');
  const contributors = metricRows.filter(isMetricContributor);
  const strongScorecards = contributors.filter((row) => row.metric_coverage_level === 'strong');
  const directionalScorecards = contributors.filter((row) => row.metric_coverage_level === 'directional');
  const gapContributors = contributors.filter((row) => row.metric_coverage_level === 'gap' || row.source_status === 'source-needed');
  const publicCeilingDirectional = directionalScorecards.filter(isPublicCeilingMetricRow);
  const justifiedNoSampleContributors = gapContributors.filter(isJustifiedNoPublicSampleMetricGap);
  const trueGapContributors = gapContributors.filter((row) => !isJustifiedNoPublicSampleMetricGap(row));
  const readyScorecards = strongScorecards.length + publicCeilingDirectional.length;
  const readinessScore = playerMetricReadinessScore({
    totalRows: metricRows.length,
    contributors: contributors.length,
    readyScorecards,
    trueGapContributors: trueGapContributors.length,
    parityMatches: parity.matches,
    captured,
  });
  if (metricRows.length === 0) {
    gaps.push(gap('metrics_missing', 'Player metrics missing', 'blocked', 'No player metric rows are loaded for this team.'));
  }
  if (!parity.matches) {
    gaps.push(gap('metrics_roster_parity', 'Metric/roster parity gap', 'weak', parity.detail, parity.affected_count, parity.affected_players));
  }
  if (captured === 0 && metricRows.length > 0) {
    gaps.push(gap('performance_metrics_not_captured', 'Player-quality metrics not captured', 'directional', 'Metric rows are roster-derived placeholders, not a captured performance/snap feed.', metricRows.length));
  }
  if (captured > 0 && sourceNeeded.length > 0) {
    gaps.push(gap(
      'metric_rows_need_context',
      'Some player metrics need context',
      'directional',
      `${captured}/${metricRows.length} rows have captured public 2025 scorecard/snap metrics; ${sourceNeeded.length} rows are rookies, no-snap/offseason bodies, or unmatched public rows.`,
      sourceNeeded.length,
      sourceNeeded.map((row) => row.player_name).slice(0, 8),
    ));
  }
  if (trueGapContributors.length > 0) {
    gaps.push(gap(
      'contributor_metric_gaps',
      'Contributor metric gaps',
      trueGapContributors.length / Math.max(contributors.length, 1) > 0.05 ? 'weak' : 'directional',
      `${trueGapContributors.length}/${Math.max(contributors.length, 1)} likely contributors lack source-backed public player-quality scorecards and are not just rookie/no-sample public-ceiling rows.`,
      trueGapContributors.length,
      trueGapContributors.map((row) => row.player_name).slice(0, 8),
      {
        current_score: readinessScore,
        next_source_family: 'nflverse player identity crosswalk or position-specific public stat family',
      },
    ));
  }
  if (justifiedNoSampleContributors.length > 0) {
    gaps.push(gap(
      'public_sample_ceiling_rows',
      'Public sample ceiling rows',
      'directional',
      `${justifiedNoSampleContributors.length} likely contributors are rookies or no-2025-snap players; keep them visible but do not make NFL performance claims from them.`,
      justifiedNoSampleContributors.length,
      justifiedNoSampleContributors.map((row) => row.player_name).slice(0, 8),
      {
        current_score: readinessScore,
        next_source_family: 'public draft/combine/prospect context',
        public_ceiling: true,
      },
    ));
  }
  if (directionalScorecards.length > 0) {
    gaps.push(gap(
      'directional_position_scorecards',
      'Directional position scorecards',
      'directional',
      `${directionalScorecards.length}/${Math.max(contributors.length, 1)} likely contributors are usage, role, availability, or continuity-only; OL remains continuity-only without a public blocking-quality source.`,
      directionalScorecards.length,
      directionalScorecards.map((row) => row.player_name).slice(0, 8),
      {
        current_score: readinessScore,
        next_source_family: 'public OL pressure-allowed/blocking source or richer position-specific charting',
        public_ceiling: true,
      },
    ));
  }
  return domain(
    'player_metrics',
    statusFromReadinessScore(readinessScore),
    metricRows.length,
    statuses.filter((item) => item === 'source-needed').length,
    gaps,
    contributors.length > 0
      ? `${readyScorecards}/${contributors.length} likely contributors are covered by strong scorecards or public-ceiling role/continuity context; ${trueGapContributors.length} true contributor gaps remain and ${justifiedNoSampleContributors.length} are rookie/no-sample caveats.`
      : `${captured}/${metricRows.length} rows have captured public 2025 scorecard/snap metrics; player-quality claims should cite captured rows and caveat no-sample rows.`,
    readinessScore,
    playerMetricsToNineTen(readinessScore, contributors.length, readyScorecards, trueGapContributors.length),
  );
}

function rulesCoverage(ruleFamilies: string[], rowCount: number): NflCoverageDomainSummary {
  const missing = REQUIRED_RULE_FAMILIES.filter((family) => !ruleFamilies.includes(family));
  const gaps = missing.length
    ? [gap('rules_missing_families', 'Rules families missing', missing.length > 3 ? 'weak' : 'directional', `Missing rule families: ${missing.join(', ')}.`, missing.length)]
    : [];
  const status: NflCoverageStatus = missing.length === 0 ? 'strong' : missing.length > 3 ? 'weak' : 'directional';
  return domain('rules', status, rowCount, 0, gaps, missing.length === 0 ? 'Required NFL rules families are loaded.' : `${rowCount} rule rows loaded; ${missing.length} required families missing.`);
}

function intelCoverage(
  graphTeam: Awaited<ReturnType<typeof listTeamContextPreferences>>['teams'][number] | null,
): NflCoverageDomainSummary {
  if (!graphTeam) {
    return domain('intel', 'blocked', 0, 0, [gap('intel_missing', 'Intel missing', 'blocked', 'No context graph row exists for this team.')], 'No context graph row exists.');
  }
  const gaps: NflCoverageGap[] = [];
  const postureSources = graphTeam.preferences.strategic_posture.derived_from ?? [];
  if (graphTeam.validation.status !== 'pass') {
    gaps.push(gap('intel_validation_failed', 'Intel validation failed', 'weak', `${graphTeam.validation.error_count} errors and ${graphTeam.validation.warning_count} warnings remain.`));
  }
  if (postureSources.length === 0) {
    gaps.push(gap('intel_posture_source_needed', 'Posture source thin', 'directional', 'Strategic posture does not expose reviewed source anchors.'));
  }
  if ((graphTeam.roster_summary.roster_count ?? 0) <= 4) {
    gaps.push(gap('graph_roster_is_mini_roster', 'Graph mini-roster only', 'directional', 'Context graph roster rows are posture examples only and do not count as current roster coverage.', graphTeam.roster_summary.roster_count));
  }
  const status: NflCoverageStatus = graphTeam.validation.status !== 'pass'
    ? 'weak'
    : postureSources.length > 0
      ? 'strong'
      : 'directional';
  return domain('intel', status, 1, 0, gaps, graphTeam.validation.status === 'pass' ? 'Context graph validates; use it for posture and preferences, not roster counts.' : 'Context graph needs validation repair.');
}

function sellerThesisCoverage(
  graphTeam: Awaited<ReturnType<typeof listTeamContextPreferences>>['teams'][number] | null,
): NflCoverageDomainSummary {
  const intel = graphTeam?.preferences.trade_market_intel;
  if (!intel) {
    return domain('seller_thesis', 'weak', 0, 0, [gap('seller_thesis_missing', 'Seller thesis missing', 'weak', 'No trade-market Intel is loaded for this team.', undefined, undefined, {
      next_source_family: 'source-backed trade_market_intel context graph section',
    })], 'No seller-thesis coverage is loaded.', 3, 'Add source-backed seller posture and position-group stances.');
  }
  const stanceRows = intel.position_group_stance ?? [];
  const genericRows = stanceRows.filter((stance) => isGenericIntelText([
    stance.stance,
    stance.seller_depth_notes,
    stance.sell_threshold,
    stance.source,
  ]));
  const gaps: NflCoverageGap[] = [];
  if (stanceRows.length === 0) gaps.push(gap('seller_position_groups_missing', 'Seller group stances missing', 'weak', 'Trade-market Intel has no position-group stances.'));
  if (genericRows.length > 0) gaps.push(gap('seller_thesis_generic', 'Seller thesis generic', 'directional', `${genericRows.length} seller thesis rows look generic or template-like.`, genericRows.length));
  const status: NflCoverageStatus = stanceRows.length === 0
    ? 'weak'
    : genericRows.length > 0
      ? 'directional'
      : 'strong';
  const readinessScore = sellerThesisReadinessScore(stanceRows.length, genericRows.length);
  return domain(
    'seller_thesis',
    status,
    stanceRows.length,
    0,
    gaps,
    `${stanceRows.length} trade-facing position-group stances are loaded.`,
    readinessScore,
    readinessScore >= TARGET_READINESS_SCORE ? 'Trade-market Intel meets the 9/10 threshold.' : 'Add source-backed group stances for DL/interior, EDGE/LB, DB, WR, and OL.',
  );
}

function buildPositionGroups(
  rosterRows: NflRosterEntry[],
  capRows: NflCapRow[],
  metricRows: NflPlayerMetricRow[],
  graphTeam: Awaited<ReturnType<typeof listTeamContextPreferences>>['teams'][number] | null,
): NflCoveragePositionGroupSummary[] {
  return POSITION_GROUPS.map((group) => {
    const roster = rosterRows.filter((row) => normalizePositionGroup(row.position) === group);
    const cap = capRows.filter((row) => normalizePositionGroup(row.position) === group);
    const metrics = metricRows.filter((row) => normalizePositionGroup(row.position) === group);
    if (roster.length === 0 && cap.length === 0 && metrics.length === 0) return null;
    const rosterCapParity = playerUniverseParity(roster, cap);
    const metricParity = playerUniverseParity(roster, metrics);
    const sellerStatus = sellerThesisStatusForGroup(graphTeam, group);
    const contractCount = cap.filter(hasCoreContractFields).length;
    const sourceNeeded = cap.filter((row) => row.source_status === 'source-needed');
    const metricStatus = metricSourceStatus(metrics);
    const topGaps: NflCoverageGap[] = [];
    if (!rosterCapParity.matches) topGaps.push(gap(`${group}_parity`, `${group} roster/cap mismatch`, 'weak', rosterCapParity.detail, rosterCapParity.affected_count, rosterCapParity.affected_players));
    if (!metricParity.matches) topGaps.push(gap(`${group}_metric_parity`, `${group} metric mismatch`, 'weak', metricParity.detail, metricParity.affected_count, metricParity.affected_players));
    if (cap.length > 0 && contractCount / cap.length < 0.95) topGaps.push(gap(`${group}_contract_fields`, `${group} contract fields directional`, 'directional', `${contractCount}/${cap.length} rows have core contract fields.`));
    const metricScorecardStatus = metricScorecardStatusForRows(metrics);
    if (metricScorecardStatus !== 'strong') {
      const contributors = metrics.filter(isMetricContributor);
      const sample = contributors.length > 0 ? contributors : metrics;
      const readyScorecards = sample.filter((row) => row.metric_coverage_level === 'strong' || isPublicCeilingMetricRow(row)).length;
      topGaps.push(gap(`${group}_metrics_directional`, `${group} metrics directional`, metricScorecardStatus, `${readyScorecards}/${Math.max(sample.length, 1)} ${contributors.length > 0 ? 'likely contributors' : 'rows'} have source-backed or public-ceiling position scorecards.`, undefined, undefined, {
        next_source_family: group === 'OL' ? 'public OL pressure-allowed/blocking source' : 'position-specific public stat family or player identity crosswalk',
        public_ceiling: group === 'OL',
      }));
    }
    if (sellerStatus !== 'strong') topGaps.push(gap(`${group}_seller_thesis`, `${group} seller thesis limited`, sellerStatus, 'Seller-thesis coverage is not strong for this group.'));
    const metricReadinessScore = metricRowsReadinessScore(metrics);
    const contractReadinessScore = cap.length > 0 ? (contractCount / cap.length >= 0.95 ? 10 : 8) : 0;
    const groupReadinessScore = roundScore(Math.min(
      roster.length === 0 ? 4 : 10,
      rosterCapParity.matches ? 10 : 4,
      metricParity.matches ? 10 : 4,
      contractReadinessScore,
      metricReadinessScore,
    ));
    const groupStatus = statusFromReadinessScore(groupReadinessScore);
    return {
      group,
      status: groupStatus,
      readiness_score: groupReadinessScore,
      target_score: TARGET_READINESS_SCORE,
      gap_to_9_10: gapToTarget(groupReadinessScore),
      to_9_10: groupToNineTenGap(group, groupReadinessScore, topGaps),
      roster_count: roster.length,
      cap_row_count: cap.length,
      player_metric_row_count: metrics.length,
      total_cap_number_2026: cap.reduce((total, row) => total + (row.cap_number_2026 ?? 0), 0),
      source_needed_cap_count: sourceNeeded.length,
      contract_field_count: contractCount,
      contract_field_total: cap.length,
      metric_source_status: metricStatus,
      seller_thesis_status: sellerStatus,
      top_gaps: topCoverageGaps(topGaps, 4),
    };
  }).filter((row): row is NflCoveragePositionGroupSummary => Boolean(row));
}

function buildReadiness(domains: NflCoverageDomainSummary[]): NflCoverageQuestionReadiness[] {
  const byDomain = new Map(domains.map((item) => [item.domain, item]));
  const readiness = (
    key: NflCoverageReadinessKey,
    label: string,
    requiredDomains: NflCoverageDomain[],
    detail: string,
  ): NflCoverageQuestionReadiness => {
    const required = requiredDomains.map((domainId) => byDomain.get(domainId)).filter((item): item is NflCoverageDomainSummary => Boolean(item));
    const readinessScore = roundScore(Math.min(...required.map((item) => item.readiness_score)));
    const status = statusFromReadinessScore(readinessScore);
    return {
      key,
      status,
      readiness_score: readinessScore,
      target_score: TARGET_READINESS_SCORE,
      gap_to_9_10: gapToTarget(readinessScore),
      label,
      detail,
      required_domains: requiredDomains,
      gaps: topCoverageGaps(required.flatMap((item) => item.gaps), 5),
    };
  };
  return [
    readiness('roster_cap_audit', 'Roster/cap audit', ['roster', 'cap_contracts'], 'Supports position-group roster/cap audits from current app data.'),
    readiness('cut_restructure', 'Cut/restructure mechanics', ['cap_contracts', 'rules'], 'Supports player-specific cap levers with NFL rules caveats.'),
    readiness('trade_outgoing', 'Outgoing trade screen', ['roster', 'cap_contracts'], 'Supports salary-out and depth-after-trade checks.'),
    readiness('seller_trade', 'Seller trade thesis', ['cap_contracts', 'intel', 'seller_thesis'], 'Supports counterparty seller reasoning only where graph-backed seller theses exist.'),
    readiness('player_quality', 'Player-quality evaluation', ['player_metrics'], 'Supports position-specific public scorecards where loaded; OL remains continuity-only unless a reviewed OL quality source exists.'),
    readiness('rules_question', 'NFL rules question', ['rules'], 'Supports loaded NFL transaction-rule families.'),
  ];
}

function coverageSources(
  seed: NflDemoSeed,
  sourceMode: NflCoverageSourceMode,
  fallbackReason: string | null,
  rulesCorpus: Awaited<ReturnType<typeof loadNflRulesCorpus>>,
  metadata: Awaited<ReturnType<typeof listTeamContextPreferences>>['metadata'],
): NflCoverageSourceRef[] {
  return [
    ...seed.source_refs.map((source) => ({
      id: source.id,
      name: source.name,
      url: source.url,
      source_type: 'app_data' as const,
      as_of_date: seed.as_of_date,
      notes: [],
    })),
    {
      id: 'nfl_coverage_source_mode',
      name: sourceMode === 'supabase_current_views' ? 'Supabase current NFL views' : 'Checked-in NFL snapshot',
      url: null,
      source_type: sourceMode === 'checked_in_snapshot_fallback' ? 'fallback' : 'derived',
      as_of_date: seed.as_of_date,
      notes: fallbackReason ? [fallbackReason] : [],
    },
    {
      id: rulesCorpus.document_id,
      name: rulesCorpus.source_name,
      url: rulesCorpus.source_url,
      source_type: 'rules',
      as_of_date: rulesCorpus.as_of_date,
      notes: rulesCorpus.notes,
    },
    {
      id: 'nfl_context_graph',
      name: 'Gambit NFL Intel graph',
      url: metadata.validation_report_path,
      source_type: 'context_graph',
      as_of_date: metadata.derived_updated_at,
      notes: [`Validation report: ${metadata.validation_report_path}`],
    },
  ];
}

function domain(
  domainId: NflCoverageDomain,
  status: NflCoverageStatus,
  rowCount: number,
  sourceNeededCount: number,
  gaps: NflCoverageGap[],
  detail: string,
  readinessScore = statusToReadinessScore(status),
  toNineTen?: string,
): NflCoverageDomainSummary {
  const score = roundScore(readinessScore);
  const derivedStatus = readinessScore === statusToReadinessScore(status) ? status : statusFromReadinessScore(score);
  return {
    domain: domainId,
    status: derivedStatus,
    score: STATUS_SCORE[derivedStatus],
    readiness_score: score,
    target_score: TARGET_READINESS_SCORE,
    gap_to_9_10: gapToTarget(score),
    to_9_10: toNineTen ?? defaultToNineTen(domainId, score),
    label: domainLabel(domainId),
    detail,
    row_count: rowCount,
    source_needed_count: sourceNeededCount,
    gaps: topCoverageGaps(gaps),
  };
}

function domainLabel(domainId: NflCoverageDomain): string {
  switch (domainId) {
    case 'roster': return 'Roster';
    case 'cap_contracts': return 'Cap/contracts';
    case 'player_metrics': return 'Player metrics';
    case 'rules': return 'NFL Rules';
    case 'intel': return 'Intel';
    case 'seller_thesis': return 'Seller thesis';
  }
}

function domainById(team: NflCoverageTeamRow, domainId: NflCoverageDomain): NflCoverageDomainSummary {
  const found = team.domains.find((domainItem) => domainItem.domain === domainId);
  if (!found) throw new Error(`Coverage domain missing: ${domainId}`);
  return found;
}

function contractCoverage(rows: NflCapRow[]): NflCoverageTeamRow['contract_field_coverage'] {
  return {
    rows_with_years: rows.filter((row) => (row.contract_years_remaining ?? row.years_remaining) != null).length,
    rows_with_dead_cut: rows.filter((row) => row.dead_money_if_cut_2026 != null && row.cut_savings_2026 != null).length,
    rows_with_post_june: rows.filter((row) => row.post_june_1_dead_money_2026 != null && row.post_june_1_cut_savings_2026 != null).length,
    rows_with_trade: rows.filter((row) => row.trade_dead_money_2026 != null && row.trade_savings_2026 != null).length,
    total_player_cap_rows: rows.length,
  };
}

function hasCoreContractFields(row: NflCapRow): boolean {
  return (row.contract_years_remaining ?? row.years_remaining) != null
    && row.dead_money_if_cut_2026 != null
    && row.cut_savings_2026 != null
    && row.post_june_1_dead_money_2026 != null
    && row.post_june_1_cut_savings_2026 != null
    && row.trade_dead_money_2026 != null
    && row.trade_savings_2026 != null;
}

function missingContractFieldPlayers(rows: NflCapRow[]): string[] {
  return rows.filter((row) => !hasCoreContractFields(row)).map((row) => row.player_name).slice(0, 8);
}

type PlayerUniverseRow = {
  player_id: string | null;
  player_name?: string;
  full_name?: string;
};

function playerUniverseParity(
  rosterRows: PlayerUniverseRow[],
  comparisonRows: PlayerUniverseRow[],
): {
  matches: boolean;
  detail: string;
  affected_count: number;
  affected_players: string[];
} {
  const rosterById = playerNameById(rosterRows);
  const comparisonById = playerNameById(comparisonRows);
  const missingFromComparison = [...rosterById.keys()].filter((playerId) => !comparisonById.has(playerId));
  const extraComparisonRows = [...comparisonById.keys()].filter((playerId) => !rosterById.has(playerId));
  const affectedPlayers = [
    ...missingFromComparison.map((playerId) => rosterById.get(playerId) ?? playerId),
    ...extraComparisonRows.map((playerId) => comparisonById.get(playerId) ?? playerId),
  ].slice(0, 8);
  const affectedCount = missingFromComparison.length + extraComparisonRows.length;
  return {
    matches: affectedCount === 0,
    detail: affectedCount === 0
      ? `Player universes match across ${rosterById.size} roster rows and ${comparisonById.size} comparison rows.`
      : `${missingFromComparison.length} roster players are missing from comparison rows and ${extraComparisonRows.length} comparison rows are not on the current roster.`,
    affected_count: affectedCount,
    affected_players: affectedPlayers,
  };
}

function playerNameById(rows: PlayerUniverseRow[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of rows) {
    if (!row.player_id) continue;
    out.set(String(row.player_id), row.player_name ?? row.full_name ?? String(row.player_id));
  }
  return out;
}

function sellerThesisStatusForGroup(
  graphTeam: Awaited<ReturnType<typeof listTeamContextPreferences>>['teams'][number] | null,
  group: string,
): NflCoverageStatus {
  const stances = graphTeam?.preferences.trade_market_intel?.position_group_stance ?? [];
  const matching = stances.filter((stance) => normalizePositionGroup(stance.group) === group || stance.group.toUpperCase().includes(group));
  if (matching.length === 0) return 'weak';
  return matching.some((stance) => isGenericIntelText([stance.stance, stance.seller_depth_notes, stance.sell_threshold, stance.source]))
    ? 'directional'
    : 'strong';
}

function metricSourceStatus(rows: NflPlayerMetricRow[]): NflCoveragePositionGroupSummary['metric_source_status'] {
  if (rows.length === 0) return 'missing';
  const statuses = new Set(rows.map((row) => row.source_status ?? 'roster-derived'));
  if (statuses.size === 1) return [...statuses][0] as NflCoveragePositionGroupSummary['metric_source_status'];
  return 'mixed';
}

function metricScorecardStatusForRows(rows: NflPlayerMetricRow[]): NflCoverageStatus {
  const contributors = rows.filter(isMetricContributor);
  const sample = contributors.length > 0 ? contributors : rows;
  if (sample.length === 0) return 'weak';
  const strong = sample.filter((row) => row.metric_coverage_level === 'strong').length;
  const gaps = sample.filter((row) => row.metric_coverage_level === 'gap' || row.source_status === 'source-needed').length;
  if (gaps > 0 && contributors.length > 0) return 'weak';
  if (strong === sample.length) return 'strong';
  return 'directional';
}

function isMetricContributor(row: NflPlayerMetricRow): boolean {
  return (row.snaps_2025 ?? 0) >= 250
    || (row.starts_2025 ?? 0) >= 4
    || (row.games_2025 ?? 0) >= 10
    || ['core_or_high_cap', 'rotation_or_specialist'].includes(row.role);
}

export function normalizePositionGroup(position: string | null | undefined): string {
  const pos = String(position ?? 'Other').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (pos === 'QB') return 'QB';
  if (pos === 'RB' || pos === 'FB' || pos === 'RBFB') return 'RB';
  if (pos === 'WR') return 'WR';
  if (pos === 'TE') return 'TE';
  if (['C', 'G', 'OG', 'OT', 'T', 'OL', 'IOL'].includes(pos)) return 'OL';
  if (['DT', 'NT', 'DL'].includes(pos)) return 'DL';
  if (['DE', 'EDGE', 'OLB'].includes(pos)) return 'EDGE/LB';
  if (['LB', 'ILB', 'MLB'].includes(pos)) return 'LB';
  if (pos === 'CB') return 'CB';
  if (['S', 'FS', 'SS', 'SAF'].includes(pos)) return 'S';
  if (pos === 'DB') return 'CB';
  if (['K', 'P', 'LS'].includes(pos)) return 'ST';
  if (pos.includes('DEFENSIVEINTERIOR') || pos.includes('INTERIOR')) return 'DL';
  return POSITION_GROUPS.includes(pos) ? pos : 'Other';
}

function isGenericIntelText(values: string[]): boolean {
  const haystack = values.join(' ').toLowerCase();
  return /internal demo synthesis|verify before external use|premium-position decisions|template|generic/.test(haystack);
}

function topCoverageGaps(gaps: NflCoverageGap[], limit = 6): NflCoverageGap[] {
  const seen = new Set<string>();
  return gaps
    .filter((item) => {
      if (seen.has(item.key)) return false;
      seen.add(item.key);
      return true;
    })
    .sort((a, b) => STATUS_SCORE[a.severity] - STATUS_SCORE[b.severity] || a.label.localeCompare(b.label))
    .slice(0, limit);
}

function gap(
  key: string,
  label: string,
  severity: NflCoverageStatus,
  detail: string,
  affectedCount?: number,
  affectedPlayers?: string[],
  extra: Partial<Pick<NflCoverageGap, 'current_score' | 'target_score' | 'gap_to_target' | 'next_source_family' | 'public_ceiling'>> = {},
): NflCoverageGap {
  const currentScore = extra.current_score;
  const targetScore = extra.target_score ?? TARGET_READINESS_SCORE;
  return {
    key,
    label,
    severity,
    detail,
    ...(affectedCount === undefined ? {} : { affected_count: affectedCount }),
    ...(affectedPlayers?.length ? { affected_players: affectedPlayers } : {}),
    ...(currentScore === undefined ? {} : { current_score: roundScore(currentScore) }),
    ...(extra.current_score === undefined && extra.target_score === undefined ? {} : { target_score: targetScore }),
    ...(currentScore === undefined ? {} : { gap_to_target: gapToTarget(currentScore, targetScore) }),
    ...(extra.next_source_family ? { next_source_family: extra.next_source_family } : {}),
    ...(extra.public_ceiling === undefined ? {} : { public_ceiling: extra.public_ceiling }),
  };
}

function capContractReadinessScore(input: {
  total: number;
  completeRows: number;
  sourceNeeded: number;
  highCapMissing: number;
  parityMatches: boolean;
}): number {
  if (input.total === 0) return 0;
  if (!input.parityMatches) return 4;
  const completeRate = input.completeRows / input.total;
  const sourceNeededRate = input.sourceNeeded / input.total;
  let score = 10;
  score -= Math.max(0, 0.99 - completeRate) * 25;
  score -= Math.max(0, sourceNeededRate - 0.05) * 35;
  score -= input.highCapMissing * 2;
  return clampScore(score);
}

function playerMetricReadinessScore(input: {
  totalRows: number;
  contributors: number;
  readyScorecards: number;
  trueGapContributors: number;
  parityMatches: boolean;
  captured: number;
}): number {
  if (input.totalRows === 0) return 0;
  if (!input.parityMatches) return 4;
  if (input.captured === 0) return 5;
  const contributorBase = Math.max(input.contributors, 1);
  const readyRate = input.readyScorecards / contributorBase;
  const trueGapRate = input.trueGapContributors / contributorBase;
  let score = 10;
  score -= Math.max(0, 0.9 - readyRate) * 12;
  if (trueGapRate > 0.05) score -= 0.5 + ((trueGapRate - 0.05) * 80);
  return clampScore(score);
}

function metricRowsReadinessScore(rows: NflPlayerMetricRow[]): number {
  if (rows.length === 0) return 0;
  const contributors = rows.filter(isMetricContributor);
  const sample = contributors.length > 0 ? contributors : rows;
  const ready = sample.filter((row) => row.metric_coverage_level === 'strong' || isPublicCeilingMetricRow(row)).length;
  const trueGaps = sample.filter((row) => (row.metric_coverage_level === 'gap' || row.source_status === 'source-needed') && !isJustifiedNoPublicSampleMetricGap(row)).length;
  return playerMetricReadinessScore({
    totalRows: rows.length,
    contributors: sample.length,
    readyScorecards: ready,
    trueGapContributors: trueGaps,
    parityMatches: true,
    captured: rows.filter((row) => row.source_status === 'captured').length,
  });
}

function sellerThesisReadinessScore(stanceCount: number, genericCount: number): number {
  if (stanceCount === 0) return 3;
  if (genericCount > 0) return 7;
  if (stanceCount < 4) return 9;
  return 10;
}

function globalCapSourceReadinessScore(rows: NflCapRow[]): number {
  const sourceNeeded = rows.filter((row) => row.source_status === 'source-needed');
  const highCapMissing = sourceNeeded.filter((row) => (row.cap_number_2026 ?? 0) > 5_000_000);
  if (highCapMissing.length > 0) return Math.max(4, 8 - highCapMissing.length);
  if (sourceNeeded.length <= 15) return 10;
  return clampScore(9 - ((sourceNeeded.length - 15) / 40));
}

function isPublicCeilingMetricRow(row: NflPlayerMetricRow): boolean {
  if (row.metric_coverage_level !== 'directional' || row.source_status !== 'captured') return false;
  const flags = new Set(row.quality_flags ?? []);
  return flags.has('ol_continuity_only_no_public_blocking_grade')
    || flags.has('role_availability_context_only_no_performance_scorecard')
    || flags.has('snap_usage_only_no_position_quality_fields')
    || flags.has('limited_snap_sample');
}

function isJustifiedNoPublicSampleMetricGap(row: NflPlayerMetricRow): boolean {
  return row.metric_gap_reason === 'rookie_or_no_2025_nfl_public_metric_sample';
}

function capContractsToNineTen(score: number, sourceNeeded: number, total: number, highCapMissing: number): string {
  if (score >= TARGET_READINESS_SCORE) return 'Cap/contracts meet the 9/10 threshold; remaining source-needed rows are below the demo-risk line.';
  if (highCapMissing > 0) return `Resolve ${highCapMissing} high-cap source-needed contract rows before strong cap recommendations.`;
  return `Reduce source-needed cap rows from ${sourceNeeded}/${total} below the 5% per-team threshold or add reviewed ledger notes.`;
}

function playerMetricsToNineTen(score: number, contributors: number, readyScorecards: number, trueGapContributors: number): string {
  if (score >= TARGET_READINESS_SCORE) return 'Player-quality coverage meets the 9/10 threshold with public scorecards plus explicit public-ceiling caveats.';
  return `Upgrade ${Math.max(0, Math.ceil(contributors * 0.9) - readyScorecards)} likely contributors to scorecard-ready and reduce true contributor gaps to ${Math.floor(contributors * 0.05)} or fewer; current true gaps: ${trueGapContributors}.`;
}

function groupToNineTenGap(group: string, score: number, gaps: NflCoverageGap[]): string {
  if (score >= TARGET_READINESS_SCORE) return `${group} meets the 9/10 coverage threshold for supported question types.`;
  const firstGap = topCoverageGaps(gaps, 1)[0];
  return firstGap?.next_source_family
    ? `${group}: add ${firstGap.next_source_family}.`
    : `${group}: ${firstGap?.detail ?? 'needs more reviewed source coverage.'}`;
}

function teamToNineTenGap(domains: NflCoverageDomainSummary[], gaps: NflCoverageGap[]): string {
  const lowest = [...domains].sort((a, b) => a.readiness_score - b.readiness_score)[0];
  if (!lowest || lowest.readiness_score >= TARGET_READINESS_SCORE) return 'Team meets the 9/10 threshold for currently supported demo workflows.';
  const gapItem = topCoverageGaps(gaps, 1)[0];
  return `${lowest.label}: ${lowest.to_9_10}${gapItem?.next_source_family ? ` Next source: ${gapItem.next_source_family}.` : ''}`;
}

function leagueToNineTenGap(teamRows: NflCoverageTeamRow[], playerCapRows: NflCapRow[]): string {
  const belowTarget = teamRows.filter((team) => team.readiness_score < TARGET_READINESS_SCORE);
  const capSourceNeeded = playerCapRows.filter((row) => row.source_status === 'source-needed').length;
  const sellerStrong = teamRows.filter((team) => domainById(team, 'seller_thesis').readiness_score >= TARGET_READINESS_SCORE).length;
  if (belowTarget.length === 0 && capSourceNeeded <= 15 && sellerStrong >= 28) return 'League coverage meets the 9/10 target across current public-source constraints.';
  const parts = [
    belowTarget.length ? `${belowTarget.length} teams below 9/10 readiness` : null,
    capSourceNeeded > 15 ? `${capSourceNeeded - 15} cap source-needed rows above target` : null,
    sellerStrong < 28 ? `${28 - sellerStrong} seller-thesis teams short of target` : null,
  ].filter(Boolean);
  return parts.join('; ') || 'Remaining 9/10 gaps are position-group specific.';
}

function demoSafePrompts(
  readiness: NflCoverageQuestionReadiness[],
  positionGroups: NflCoveragePositionGroupSummary[],
  teamId: string,
): string[] {
  const byKey = new Map(readiness.map((item) => [item.key, item]));
  const prompts: string[] = [];
  if ((byKey.get('roster_cap_audit')?.readiness_score ?? 0) >= TARGET_READINESS_SCORE) {
    prompts.push(`Run a ${teamId} position-group roster/cap audit and identify the cleanest cap levers.`);
  }
  if ((byKey.get('player_quality')?.readiness_score ?? 0) >= TARGET_READINESS_SCORE) {
    const strongGroups = positionGroups.filter((group) => group.readiness_score >= TARGET_READINESS_SCORE).map((group) => group.group).slice(0, 4);
    prompts.push(`Compare ${teamId} ${strongGroups.join('/')} player-quality evidence using public scorecards and caveat OL as continuity-only.`);
  }
  if ((byKey.get('seller_trade')?.readiness_score ?? 0) >= TARGET_READINESS_SCORE) {
    prompts.push(`Screen a ${teamId} trade target with seller thesis, cap fit, and depth-after-trade checks.`);
  }
  if ((byKey.get('rules_question')?.readiness_score ?? 0) >= TARGET_READINESS_SCORE) {
    prompts.push(`Answer an NFL rules question with loaded transaction-rule citations.`);
  }
  return prompts.slice(0, 4);
}

function defaultToNineTen(domainId: NflCoverageDomain, score: number): string {
  if (score >= TARGET_READINESS_SCORE) return `${domainLabel(domainId)} meets the 9/10 threshold.`;
  return `${domainLabel(domainId)} needs ${gapToTarget(score).toFixed(1)} more readiness points to reach 9/10.`;
}

function statusToReadinessScore(status: NflCoverageStatus): number {
  switch (status) {
    case 'strong': return 10;
    case 'directional': return 8;
    case 'weak': return 4;
    case 'blocked': return 0;
  }
}

function statusFromReadinessScore(score: number): NflCoverageStatus {
  if (score >= TARGET_READINESS_SCORE) return 'strong';
  if (score >= 7) return 'directional';
  if (score > 0) return 'weak';
  return 'blocked';
}

function averageScore(scores: number[]): number {
  if (scores.length === 0) return 0;
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

function gapToTarget(score: number, target = TARGET_READINESS_SCORE): number {
  return roundScore(Math.max(0, target - score));
}

function clampScore(score: number): number {
  return roundScore(Math.max(0, Math.min(10, score)));
}

function roundScore(score: number): number {
  return Number(score.toFixed(1));
}

function minimumStatus(statuses: NflCoverageStatus[]): NflCoverageStatus {
  if (statuses.length === 0) return 'blocked';
  return statuses.reduce((min, status) => (STATUS_SCORE[status] < STATUS_SCORE[min] ? status : min), 'strong' as NflCoverageStatus);
}
