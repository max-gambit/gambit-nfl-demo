import type { BriefSource, DataAnalystTrace, DataAnalystTraceDataset, EffectiveTeamContext } from '@shared/types';
import {
  loadCurrentNflData,
  type NflCapRow,
  type NflDemoSeed,
  type NflDemoTeam,
  type NflPlayerMetricRow,
  type NflRosterEntry,
} from '../nfl_data/seed.js';
import { getEffectiveTeamContext } from '../context_graph/preferences.js';
import { buildNflCoverageMatrix, normalizePositionGroup } from '../nfl_coverage/coverage.js';
import type { NflCoverageTeamRow } from '@shared/types';

export type CurrentNflEvidenceScope = 'roster_only' | 'transaction_full';

export const DEFAULT_NFL_EVIDENCE_TEAM_ID = 'NYG';

const NFL_EVIDENCE_TEAM_IDS = [
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE',
  'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC',
  'LAC', 'LAR', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG',
  'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WAS',
] as const;

type NflEvidenceTeamId = typeof NFL_EVIDENCE_TEAM_IDS[number];

const NFL_EVIDENCE_TEAM_ID_SET = new Set<string>(NFL_EVIDENCE_TEAM_IDS);

const NFL_EVIDENCE_TEAM_ALIASES: Record<string, NflEvidenceTeamId> = {
  ARI: 'ARI', CARDINALS: 'ARI', ARIZONA: 'ARI', 'ARIZONA CARDINALS': 'ARI',
  ATL: 'ATL', FALCONS: 'ATL', 'ATLANTA FALCONS': 'ATL',
  BAL: 'BAL', RAVENS: 'BAL', BALTIMORE: 'BAL', 'BALTIMORE RAVENS': 'BAL',
  BUF: 'BUF', BILLS: 'BUF', BUFFALO: 'BUF', 'BUFFALO BILLS': 'BUF',
  CAR: 'CAR', PANTHERS: 'CAR', CAROLINA: 'CAR', 'CAROLINA PANTHERS': 'CAR',
  CHI: 'CHI', BEARS: 'CHI', CHICAGO: 'CHI', 'CHICAGO BEARS': 'CHI',
  CIN: 'CIN', BENGALS: 'CIN', CINCINNATI: 'CIN', 'CINCINNATI BENGALS': 'CIN',
  CLE: 'CLE', BROWNS: 'CLE', CLEVELAND: 'CLE', 'CLEVELAND BROWNS': 'CLE',
  DAL: 'DAL', COWBOYS: 'DAL', DALLAS: 'DAL', 'DALLAS COWBOYS': 'DAL',
  DEN: 'DEN', BRONCOS: 'DEN', DENVER: 'DEN', 'DENVER BRONCOS': 'DEN',
  DET: 'DET', LIONS: 'DET', DETROIT: 'DET', 'DETROIT LIONS': 'DET',
  GB: 'GB', PACKERS: 'GB', 'GREEN BAY': 'GB', 'GREEN BAY PACKERS': 'GB',
  HOU: 'HOU', TEXANS: 'HOU', HOUSTON: 'HOU', 'HOUSTON TEXANS': 'HOU',
  IND: 'IND', COLTS: 'IND', INDIANAPOLIS: 'IND', 'INDIANAPOLIS COLTS': 'IND',
  JAX: 'JAX', JAGUARS: 'JAX', JAGS: 'JAX', JACKSONVILLE: 'JAX', 'JACKSONVILLE JAGUARS': 'JAX',
  KC: 'KC', CHIEFS: 'KC', 'KANSAS CITY': 'KC', 'KANSAS CITY CHIEFS': 'KC',
  LAC: 'LAC', CHARGERS: 'LAC', 'LA CHARGERS': 'LAC', 'LOS ANGELES CHARGERS': 'LAC',
  LAR: 'LAR', RAMS: 'LAR', 'LA RAMS': 'LAR', 'LOS ANGELES RAMS': 'LAR',
  LV: 'LV', RAIDERS: 'LV', 'LAS VEGAS': 'LV', 'LAS VEGAS RAIDERS': 'LV',
  MIA: 'MIA', DOLPHINS: 'MIA', MIAMI: 'MIA', 'MIAMI DOLPHINS': 'MIA',
  MIN: 'MIN', VIKINGS: 'MIN', MINNESOTA: 'MIN', 'MINNESOTA VIKINGS': 'MIN',
  NE: 'NE', PATRIOTS: 'NE', PATS: 'NE', 'NEW ENGLAND': 'NE', 'NEW ENGLAND PATRIOTS': 'NE',
  NO: 'NO', SAINTS: 'NO', 'NEW ORLEANS': 'NO', 'NEW ORLEANS SAINTS': 'NO',
  NYG: 'NYG', GIANTS: 'NYG', 'NEW YORK GIANTS': 'NYG',
  NYJ: 'NYJ', JETS: 'NYJ', 'NEW YORK JETS': 'NYJ',
  PHI: 'PHI', EAGLES: 'PHI', PHILADELPHIA: 'PHI', 'PHILADELPHIA EAGLES': 'PHI',
  PIT: 'PIT', STEELERS: 'PIT', PITTSBURGH: 'PIT', 'PITTSBURGH STEELERS': 'PIT',
  SEA: 'SEA', SEAHAWKS: 'SEA', SEATTLE: 'SEA', 'SEATTLE SEAHAWKS': 'SEA',
  SF: 'SF', '49ERS': 'SF', NINERS: 'SF', 'SAN FRANCISCO': 'SF', 'SAN FRANCISCO 49ERS': 'SF',
  TB: 'TB', BUCCANEERS: 'TB', BUCS: 'TB', 'TAMPA BAY': 'TB', 'TAMPA BAY BUCCANEERS': 'TB',
  TEN: 'TEN', TITANS: 'TEN', TENNESSEE: 'TEN', 'TENNESSEE TITANS': 'TEN',
  WAS: 'WAS', WSH: 'WAS', COMMANDERS: 'WAS', WASHINGTON: 'WAS', 'WASHINGTON COMMANDERS': 'WAS',
};

const TRANSACTION_NFL_EVIDENCE_RE =
  /\b(cap|cap room|cap space|cap sheet|cap number|cap hit|cap ledger|contract|contracts|contract lever|guarantees?|cash due|dead money|cut|cuts|release|post[-\s]?june 1|cut savings|restructure|convert salary|signing bonus|extension|extend|tag|franchise tag|transition tag|tender|trade|audit|position[-\s]?group|spend share|over[-\s]?invested|under[-\s]?invested|roster\/cap|salary)\b/i;

const ROSTER_NFL_EVIDENCE_RE =
  /\b(roster|current players?|offseason roster|depth chart|position groups?|who do we have|player-team membership|active roster|practice squad|injury|availability)\b/i;

const ALL_NFL_TEAMS_RE =
  /\b(all\s+32|every\s+nfl\s+team|all\s+nfl\s+teams|league[-\s]?wide|whole\s+league)\b/i;

export class NflAppDataRequiredError extends Error {
  readonly code = 'nfl_app_data_required';

  constructor(message: string) {
    super(`nfl_app_data_required: ${message}`);
    this.name = 'NflAppDataRequiredError';
  }
}

export interface CurrentNflEvidenceOptions {
  teamIds?: string[];
  scope?: CurrentNflEvidenceScope;
  consumer?: 'brief' | 'chat';
  dataSource?: CurrentNflEvidenceDataSource;
}

export interface CurrentNflEvidenceDataSource {
  seed(): Promise<NflDemoSeed>;
}

export interface CurrentNflEvidencePack {
  team_ids: string[];
  scope: CurrentNflEvidenceScope;
  systemBlock: string;
  sources: Omit<BriefSource, 'id' | 'brief_id'>[];
  reserved_max_ref_index: number;
  trace_datasets: DataAnalystTraceDataset[];
}

export interface NflTradeGoalScreen {
  subject_team_id: string;
  objective: string;
  outgoing_hierarchy: string[];
  depth_after_trade: string[];
  named_target_lanes: string[];
  target_lanes: NflTradeTargetLane[];
  counterparty_intel_team_ids: string[];
  counterparty_intel_summary: string[];
  bad_cap_relief_trades: string[];
  answer_requirements: string[];
  row_count: number;
}

export type NflTradeMotivationTier = 'credible_call' | 'monitor_only' | 'long_shot_unless_posture_changes';
export type NflTradeMotivationConfidence = 'high' | 'medium' | 'low';
export type NflTradeRecommendedAction = 'call_now' | 'check_call' | 'monitor' | 'posture_change_only' | 'do_not_lead';

export interface NflTradeTargetLane {
  target_player_name: string;
  target_team_id: string;
  position: string | null;
  cap_number_2026: number | null;
  trade_savings_2026: number | null;
  contract_years_remaining: number | null;
  contract_fit: string;
  seller_depth_consequence: string;
  intel_posture: string;
  intel_cap_status: string;
  motivation_tier: NflTradeMotivationTier;
  motivation_confidence: NflTradeMotivationConfidence;
  motivation_score: number;
  recommended_action: NflTradeRecommendedAction;
  seller_case: string;
  seller_objection: string;
  validation_trigger: string;
  reasons: string[];
  blockers: string[];
  why_would_they_say_yes: string;
  what_they_lose: string;
  availability_validation: string;
  source_refs: string[];
}

export interface NflTradeMotivationInput {
  subject_team_id: string;
  target_team_id: string;
  player_name: string;
  position: string | null;
  cap_number_2026: number | null;
  trade_savings_2026: number | null;
  contract_years_remaining: number | null;
  contract_lever: string;
  target_rank_in_group: number;
  seller_group_depth_after: number;
  intel_posture: string;
  intel_cap_status: string;
  seller_posture: string;
  preferred_deal_archetypes: string[];
  frequent_partners: string[];
  intel_confidence: string;
  generic_intel: boolean;
}

export interface NflTradeMotivationScore {
  tier: NflTradeMotivationTier;
  confidence: NflTradeMotivationConfidence;
  score: number;
  reasons: string[];
  blockers: string[];
}

interface TeamEvidence {
  team_id: string;
  scope: CurrentNflEvidenceScope;
  team: NflDemoTeam;
  rosterRows: NflRosterEntry[];
  capRows: NflCapRow[];
  playerMetrics: NflPlayerMetricRow[];
  sourceNeededCapRows: NflCapRow[];
  positionRollups: PositionGroupRollup[];
  tradeGoalScreen: NflTradeGoalScreen | null;
  coverage: NflCoverageTeamRow | null;
  rosterRefIndex: number;
  capRefIndex: number | null;
  metricRefIndex: number | null;
  coverageRefIndex: number | null;
  tradeRefIndex: number | null;
  intelRefIndex: number | null;
  seed: NflDemoSeed;
}

interface PositionGroupRollup {
  group: string;
  roster_count: number;
  cap_row_count: number;
  cap_total: number;
  source_needed_count: number;
  top_contracts: string[];
}

interface ContractLedgerCompleteness {
  row_count: number;
  guarantee_count: number;
  dead_money_count: number;
  post_june_count: number;
  trade_count: number;
  contract_year_count: number;
  void_year_count: number;
  confidence_counts: Record<string, number>;
}

interface PlayerMetricCompleteness {
  row_count: number;
  captured_count: number;
  source_needed_count: number;
  roster_derived_count: number;
  snap_count: number;
  production_count: number;
  gap_counts: Record<string, number>;
}

interface TradeCandidate {
  row: NflCapRow;
  group: string;
  painRank: number;
  line: string;
  depthLine: string;
}

export function defaultNflEvidenceTeamId(): string {
  return DEFAULT_NFL_EVIDENCE_TEAM_ID;
}

export function requiresCurrentNflEvidence(question: string): boolean {
  return currentNflEvidenceTeamIds(question).length > 0;
}

export function hasCurrentNflEvidenceTrigger(question: string): boolean {
  return currentNflEvidenceScopeForQuestion(question) !== null;
}

export function currentNflEvidenceScopeForQuestion(question: string): CurrentNflEvidenceScope | null {
  if (TRANSACTION_NFL_EVIDENCE_RE.test(question)) return 'transaction_full';
  if (ROSTER_NFL_EVIDENCE_RE.test(question)) return 'roster_only';
  return null;
}

export function isNflTradeGoalQuestion(question: string): boolean {
  return /\b(trade|trades|traded|trading|acquire|acquisition|buyer|seller|counterpart(?:y|ies)|salary[-\s]?out|pick[-\s]?led|target lanes?)\b/i
    .test(question);
}

export function currentNflEvidenceTeamIds(
  question: string,
  defaultTeamId: string | null = DEFAULT_NFL_EVIDENCE_TEAM_ID,
): string[] {
  if (!hasCurrentNflEvidenceTrigger(question)) return [];
  if (ALL_NFL_TEAMS_RE.test(question)) return [...NFL_EVIDENCE_TEAM_IDS];
  const explicitTeamIds = extractNflTeamIds(question);
  const normalizedDefault = normalizeNflEvidenceTeamId(defaultTeamId);
  const firstPerson = isFirstPersonTeamQuestion(question);
  if (!normalizedDefault || !firstPerson) return explicitTeamIds;
  const declaredSubjectTeamId = declaredFirstPersonNflSubjectTeamId(question);
  if (declaredSubjectTeamId) {
    return [
      declaredSubjectTeamId,
      ...explicitTeamIds.filter((teamId) => teamId !== declaredSubjectTeamId),
    ];
  }
  if (explicitTeamIds.length === 0) return [normalizedDefault];
  if (explicitTeamIds.includes(normalizedDefault)) return explicitTeamIds;
  return [normalizedDefault, ...explicitTeamIds];
}

export function isFirstPersonTeamQuestion(question: string): boolean {
  return /\b(we|our|ours|us)\b/i.test(question);
}

export function extractNflTeamIds(question: string): string[] {
  const hits = new Map<string, number>();
  const aliases = Object.keys(NFL_EVIDENCE_TEAM_ALIASES).sort((a, b) => b.length - a.length);

  for (const alias of aliases) {
    const teamId = normalizeNflEvidenceTeamAlias(alias);
    if (!teamId) continue;
    const exactCase = requiresExactCaseTeamAlias(alias);
    const pattern = new RegExp(`(^|[^A-Za-z0-9])(${escapeRegExp(alias)})(?=$|[^A-Za-z0-9])`, exactCase ? 'g' : 'gi');
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(question)) !== null) {
      if (exactCase && match[2] !== alias) continue;
      const index = match.index + (match[1]?.length ?? 0);
      const current = hits.get(teamId);
      if (current === undefined || index < current) hits.set(teamId, index);
    }
  }

  return [...hits.entries()]
    .sort((a, b) => a[1] - b[1] || teamSortIndex(a[0]) - teamSortIndex(b[0]))
    .map(([teamId]) => teamId);
}

function declaredFirstPersonNflSubjectTeamId(question: string): string | null {
  const aliases = Object.keys(NFL_EVIDENCE_TEAM_ALIASES).sort((a, b) => b.length - a.length);
  for (const alias of aliases) {
    const teamId = normalizeNflEvidenceTeamAlias(alias);
    if (!teamId) continue;
    const exactCase = requiresExactCaseTeamAlias(alias);
    const pattern = new RegExp(
      `\\b(?:we(?:'re| are)|our team is|as)\\s+(?:the\\s+)?${escapeRegExp(alias)}(?=$|[^A-Za-z0-9])`,
      exactCase ? 'g' : 'gi',
    );
    if (pattern.test(question)) return teamId;
  }
  return null;
}

export async function buildCurrentNflEvidence(
  question: string,
  options: CurrentNflEvidenceOptions = {},
): Promise<CurrentNflEvidencePack | null> {
  const dataSource = options.dataSource ?? defaultCurrentNflEvidenceDataSource();
  const seed = await dataSource.seed();
  const teamIds = normalizeEvidenceTeamIds(options.teamIds ?? currentNflEvidenceTeamIds(question), seed);
  if (teamIds.length === 0) return null;
  const scope = options.scope ?? currentNflEvidenceScopeForQuestion(question) ?? 'transaction_full';
  const coverageMatrix = await buildNflCoverageMatrix();

  let nextRefIndex = 1;
  const tradeGoalSubjectTeamId = isNflTradeGoalQuestion(question) ? teamIds[0] : null;
  const teamEvidence = await Promise.all(teamIds.map(async (teamId): Promise<TeamEvidence> => {
    const team = seed.teams.find((row) => row.team_id === teamId);
    if (!team) throw new NflAppDataRequiredError(`unknown NFL team_id ${teamId}`);
    const rosterRows = seed.roster_entries
      .filter((row) => row.team_id === teamId)
      .sort((a, b) => a.source_order - b.source_order);
    const capRows = seed.cap_rows
      .filter((row) => row.team_id === teamId && row.player_id)
      .sort((a, b) => (a.source_order ?? 9999) - (b.source_order ?? 9999));
    const playerMetrics = seed.player_metrics
      .filter((row) => row.team_id === teamId)
      .sort((a, b) => a.player_name.localeCompare(b.player_name));
    const sourceNeededCapRows = capRows.filter((row) => row.source_status === 'source-needed');
    const missing: string[] = [];
    if (rosterRows.length === 0) missing.push('roster rows');
    if (scope === 'transaction_full') {
      if (capRows.length === 0) missing.push('cap rows');
      if (capRows.length !== rosterRows.length) {
        missing.push(`roster/cap row parity (roster=${rosterRows.length} cap=${capRows.length})`);
      }
    }
    if (missing.length > 0) {
      throw new NflAppDataRequiredError(`${teamId} missing required current NFL app data: ${missing.join(', ')}`);
    }

    const rosterRefIndex = nextRefIndex++;
    const capRefIndex = scope === 'transaction_full' ? nextRefIndex++ : null;
    const metricRefIndex = nextRefIndex++;
    const coverage = coverageMatrix.teams.find((row) => row.team_id === teamId) ?? null;
    const coverageRefIndex = nextRefIndex++;
    const tradeGoalScreen = scope === 'transaction_full' && teamId === tradeGoalSubjectTeamId
      ? await buildNflTradeGoalScreen(seed, teamId, question)
      : null;
    const tradeRefIndex = tradeGoalScreen ? nextRefIndex++ : null;
    const intelRefIndex = tradeGoalScreen ? nextRefIndex++ : null;
    return {
      team_id: teamId,
      scope,
      team,
      rosterRows,
      capRows,
      playerMetrics,
      sourceNeededCapRows,
      positionRollups: buildPositionGroupRollups(rosterRows, capRows),
      tradeGoalScreen,
      coverage,
      rosterRefIndex,
      capRefIndex,
      metricRefIndex,
      coverageRefIndex,
      tradeRefIndex,
      intelRefIndex,
      seed,
    };
  }));

  const sources = teamEvidence.flatMap((team) => evidenceSourcesForTeam(team));
  return {
    team_ids: teamIds,
    scope,
    systemBlock: renderCurrentNflEvidenceBlock(teamEvidence, options.consumer ?? 'brief'),
    sources,
    reserved_max_ref_index: nextRefIndex - 1,
    trace_datasets: traceDatasetsForSources(sources),
  };
}

export function currentNflEvidenceToDataAnalystTrace(
  evidence: CurrentNflEvidencePack,
  toolUseId = 'preloaded_current_nfl_evidence',
): DataAnalystTrace {
  return {
    tool_use_id: toolUseId,
    tool_name: 'query_nfl_data',
    datasets: evidence.trace_datasets,
    errors: [],
  };
}

function defaultCurrentNflEvidenceDataSource(): CurrentNflEvidenceDataSource {
  return {
    seed: () => loadCurrentNflData(),
  };
}

function renderCurrentNflEvidenceBlock(
  teamEvidence: TeamEvidence[],
  consumer: 'brief' | 'chat',
): string {
  const sourceRefs = teamEvidence.flatMap((team) => (
    [
      team.rosterRefIndex,
      ...(team.capRefIndex ? [team.capRefIndex] : []),
      ...(team.metricRefIndex ? [team.metricRefIndex] : []),
      ...(team.coverageRefIndex ? [team.coverageRefIndex] : []),
      ...(team.tradeRefIndex ? [team.tradeRefIndex] : []),
      ...(team.intelRefIndex ? [team.intelRefIndex] : []),
    ]
  ));
  const scope = teamEvidence[0]?.scope ?? 'transaction_full';
  const lines = [
    '=== CURRENT NFL APP EVIDENCE (MANDATORY) ===',
    `This prompt is ${scope === 'roster_only' ? 'roster-sensitive' : 'roster/cap-sensitive'}. Reserved source refs: ${sourceRefs.map((ref) => `[${ref}]`).join(' ')}.`,
    'The current NFL roster/cap file is authoritative for roster counts, cap completeness, player-team membership, position groups, and player contract/cap facts.',
    'NFL Intel/context graph is lower-precedence posture context only. Do not use Intel roster narrative to override, replace, or count the current roster/cap file.',
    'Do not say the Giants have only 4 rostered players, or that a NYG cap audit is blocked on ingestion, when the current file below has matching roster and cap coverage.',
    'Rows needing source review are caveats inside the audit, not a reason to reject the whole audit when current roster/cap coverage matches.',
    'Coverage matrix status is mandatory readiness context: strong means the current app can support the claim; directional means caveat it; weak/blocked means do not make a strong claim without explicitly limiting the answer.',
    'Visible answer style: translate data-quality labels into front-office language. Say "high confidence", "directional", "needs source review", "one unpriced row", or "priced in the current cap file"; avoid leading with product/schema terms like "Contract Ledger v1", "captured", "derived", "estimated", "source-needed", "row parity", "app rows", or "source status".',
    'Trade-goal answers must run four checks before recommending a move: depth after trading the outgoing player; lower-pain outgoing hierarchy before premium starters; named target/counterparty lanes from the current cap file; and clean caveat logic for negative trade economics.',
    'Trade-goal target lanes must also pass seller-thesis cards from counterparty Intel. Lead only with call_now or check_call actions. Treat monitor as a watch/check lane, posture_change_only as high impact but low probability, and do_not_lead as a lane to reject unless a new seller signal appears. Do not recite internal motivation_tier labels in visible prose.',
    consumer === 'brief'
      ? 'The server will persist the reserved NFL app-data source refs automatically. Submit additional sources only for non-reserved external evidence.'
      : 'The server has already emitted this NFL app-data lookup in the chat trust trail. Answer directly from it.',
    ...(consumer === 'brief'
      ? ['Any sources submitted through submit_brief must use ref_index values greater than the reserved refs above.']
      : []),
    '',
    `Required team_ids: ${teamEvidence.map((team) => team.team_id).join(', ')}`,
    '',
  ];

  for (const team of teamEvidence) {
    lines.push(renderTeamAppEvidence(team));
    lines.push('');
    if (team.tradeGoalScreen) {
      lines.push(renderTradeGoalScreen(team.tradeGoalScreen, team.tradeRefIndex));
      lines.push('');
    }
  }

  return lines.join('\n');
}

function renderTeamAppEvidence(team: TeamEvidence): string {
  const rosterNames = team.rosterRows.map((row) => `${row.player_name} (${row.position ?? 'UNK'})`);
  const sourceNeededNames = team.sourceNeededCapRows.map((row) => row.player_name);
  const lines = [
    `[${team.rosterRefIndex}] ANALYST_DATA - ${team.team_id} current NFL app roster`,
    `Snapshot: season=${team.seed.season}; as_of=${team.seed.as_of_date}; source=${team.seed.source_name}`,
    `Roster rows: ${team.rosterRows.length}`,
    `Roster players: ${rosterNames.join('; ')}`,
  ];

  if (team.scope === 'transaction_full') {
    lines.push(`[${team.capRefIndex}] ANALYST_DATA - ${team.team_id} current NFL app cap/contracts`);
    lines.push(`Cap rows: ${team.capRows.length}`);
    lines.push(`Source-needed cap rows: ${team.sourceNeededCapRows.length}${sourceNeededNames.length ? ` (${sourceNeededNames.join('; ')})` : ''}`);
    lines.push(`Contract field coverage: ${formatContractLedgerCompleteness(contractLedgerCompleteness(team.capRows))}`);
    lines.push(`Top cap contracts: ${topCapRows(team.capRows).join(' | ')}`);
    lines.push(`Position-group cap rollups: ${team.positionRollups.map(formatRollup).join(' | ')}`);
  }
  if (team.metricRefIndex) {
    lines.push(`[${team.metricRefIndex}] ANALYST_DATA - ${team.team_id} current NFL player metrics`);
    lines.push(`Player metric rows: ${team.playerMetrics.length}`);
    lines.push(`Player metric coverage: ${formatPlayerMetricCompleteness(playerMetricCompleteness(team.playerMetrics))}`);
    lines.push(`Top captured player metrics: ${topMetricRows(team.playerMetrics).join(' | ') || 'none'}`);
  }
  if (team.coverage && team.coverageRefIndex) {
    lines.push(`[${team.coverageRefIndex}] ANALYST_DATA - ${team.team_id} NFL coverage matrix`);
    lines.push(`Coverage status: ${team.coverage.status}`);
    lines.push(`Question readiness: ${team.coverage.readiness.map((item) => `${item.key}=${item.status}`).join('; ')}`);
    lines.push(`Coverage gaps: ${team.coverage.top_gaps.map((item) => `${item.label}: ${item.detail}`).join(' | ') || 'none'}`);
    lines.push(`Position-group readiness: ${team.coverage.position_groups.map((item) => `${item.group}=${item.status}; metrics=${item.metric_source_status}; seller=${item.seller_thesis_status}`).join(' | ')}`);
  }

  return lines.join('\n');
}

function evidenceSourcesForTeam(team: TeamEvidence): Omit<BriefSource, 'id' | 'brief_id'>[] {
  const rosterSource: Omit<BriefSource, 'id' | 'brief_id'> = {
    ref_index: team.rosterRefIndex,
    kind: 'ANALYST_DATA',
    source: 'GAMBIT_APP_DATA',
    title: `Current NFL app roster - ${team.team_id} - ${team.team.full_name}`,
    updated_at: team.seed.as_of_date,
    data: {
      rows: [
        { k: 'Dataset', v: 'nfl_rosters_current' },
        { k: 'Team', v: `${team.team_id} - ${team.team.full_name}` },
        { k: 'Roster rows', v: String(team.rosterRows.length) },
        { k: 'Roster source', v: team.seed.source_name },
        { k: 'Roster as of', v: team.seed.as_of_date },
        { k: 'Roster players', v: team.rosterRows.map((row) => row.player_name).join(', ') },
        { k: 'Roster precedence', v: 'NFL app roster rows override Intel roster narrative.' },
      ],
      current_nfl_evidence: {
        dataset_id: 'nfl_rosters_current',
        team_id: team.team_id,
        row_count: team.rosterRows.length,
        as_of_date: team.seed.as_of_date,
        source_name: team.seed.source_name,
      },
    },
  };
  const metricSources = team.metricRefIndex ? [metricSourceForTeam(team, team.metricRefIndex)] : [];
  const coverageSources = team.coverage && team.coverageRefIndex
    ? [coverageSourceForTeam(team, team.coverage, team.coverageRefIndex)]
    : [];
  if (team.scope === 'roster_only') return [rosterSource, ...metricSources, ...coverageSources];

  const capSource: Omit<BriefSource, 'id' | 'brief_id'> = {
    ref_index: team.capRefIndex ?? team.rosterRefIndex + 1,
    kind: 'ANALYST_DATA',
    source: 'GAMBIT_APP_DATA',
    title: `Current NFL app cap/contracts - ${team.team_id} - ${team.team.full_name}`,
    updated_at: team.seed.as_of_date,
    data: {
      rows: [
        { k: 'Dataset', v: 'nfl_cap_sheets_current' },
        { k: 'Team', v: `${team.team_id} - ${team.team.full_name}` },
        { k: 'Cap rows', v: String(team.capRows.length) },
        { k: 'Source-needed cap rows', v: String(team.sourceNeededCapRows.length) },
        { k: 'Contract field coverage', v: formatContractLedgerCompleteness(contractLedgerCompleteness(team.capRows)) },
        { k: 'Top cap contracts', v: topCapRows(team.capRows).join(', ') },
        { k: 'Position-group cap rollups', v: team.positionRollups.map(formatRollup).join(' | ') },
        { k: 'Cap precedence', v: 'NFL app cap rows override Intel roster narrative for cap/completeness claims.' },
      ],
      current_nfl_evidence: {
        dataset_id: 'nfl_cap_sheets_current',
        team_id: team.team_id,
        row_count: team.capRows.length,
        source_needed_count: team.sourceNeededCapRows.length,
        as_of_date: team.seed.as_of_date,
        source_name: team.seed.source_name,
      },
    },
  };

  return [
    rosterSource,
    capSource,
    ...metricSources,
    ...coverageSources,
    ...(team.tradeGoalScreen && team.tradeRefIndex ? [tradeGoalSourceForTeam(team, team.tradeGoalScreen, team.tradeRefIndex)] : []),
    ...(team.tradeGoalScreen && team.intelRefIndex ? [tradeGoalIntelSourceForTeam(team, team.tradeGoalScreen, team.intelRefIndex)] : []),
  ];
}

function metricSourceForTeam(
  team: TeamEvidence,
  refIndex: number,
): Omit<BriefSource, 'id' | 'brief_id'> {
  const completeness = playerMetricCompleteness(team.playerMetrics);
  return {
    ref_index: refIndex,
    kind: 'ANALYST_DATA',
    source: 'GAMBIT_APP_DATA',
    title: `Current NFL player metrics - ${team.team_id} - ${team.team.full_name}`,
    updated_at: team.seed.as_of_date,
    data: {
      rows: [
        { k: 'Dataset', v: 'nfl_player_metrics_current' },
        { k: 'Team', v: `${team.team_id} - ${team.team.full_name}` },
        { k: 'Metric rows', v: String(team.playerMetrics.length) },
        { k: 'Metric coverage', v: formatPlayerMetricCompleteness(completeness) },
        { k: 'Top captured metrics', v: topMetricRows(team.playerMetrics).join(' | ') || 'None' },
        { k: 'Metric precedence', v: 'Use captured public snap/stat rows for player-quality claims; caveat rows with no 2025 public sample.' },
      ],
      current_nfl_evidence: {
        dataset_id: 'nfl_player_metrics_current',
        team_id: team.team_id,
        row_count: team.playerMetrics.length,
        captured_count: completeness.captured_count,
        as_of_date: team.seed.as_of_date,
        source_name: team.seed.source_name,
      },
    },
  };
}

function coverageSourceForTeam(
  team: TeamEvidence,
  coverage: NflCoverageTeamRow,
  refIndex: number,
): Omit<BriefSource, 'id' | 'brief_id'> {
  return {
    ref_index: refIndex,
    kind: 'ANALYST_DATA',
    source: 'GAMBIT_APP_DATA',
    title: `NFL coverage matrix - ${team.team_id} - ${team.team.full_name}`,
    updated_at: team.seed.as_of_date,
    data: {
      rows: [
        { k: 'Dataset', v: 'nfl_coverage_current' },
        { k: 'Team', v: `${team.team_id} - ${team.team.full_name}` },
        { k: 'Overall status', v: coverage.status },
        { k: 'Readiness', v: coverage.readiness.map((item) => `${item.key}: ${item.status}`).join(' | ') },
        { k: 'Position groups', v: coverage.position_groups.map((item) => `${item.group}: ${item.status}; metrics=${item.metric_source_status}; seller=${item.seller_thesis_status}`).join(' | ') },
        { k: 'Top gaps', v: coverage.top_gaps.map((item) => `${item.label}: ${item.detail}`).join(' | ') || 'None' },
        { k: 'Coverage precedence', v: 'Use readiness to decide how strong the answer can be before making a roster, cap, trade, rules, or player-quality claim.' },
      ],
      current_nfl_evidence: {
        dataset_id: 'nfl_coverage_current',
        team_id: team.team_id,
        row_count: coverage.position_groups.length,
        as_of_date: team.seed.as_of_date,
        source_name: 'Gambit NFL Coverage Matrix',
      },
    },
  };
}

function tradeGoalSourceForTeam(
  team: TeamEvidence,
  screen: NflTradeGoalScreen,
  refIndex: number,
): Omit<BriefSource, 'id' | 'brief_id'> {
  return {
    ref_index: refIndex,
    kind: 'ANALYST_DATA',
    source: 'GAMBIT_APP_DATA',
    title: `Current NFL trade-goal screen - ${team.team_id} - ${team.team.full_name}`,
    updated_at: team.seed.as_of_date,
    data: {
      rows: [
        { k: 'Dataset', v: 'nfl_trade_screen_current' },
        { k: 'Team', v: `${team.team_id} - ${team.team.full_name}` },
        { k: 'Objective', v: screen.objective },
        { k: 'Lower-pain outgoing hierarchy', v: screen.outgoing_hierarchy.join(' | ') },
        { k: 'Depth-after-trade checks', v: screen.depth_after_trade.join(' | ') },
        { k: 'Seller thesis cards', v: screen.named_target_lanes.join(' | ') },
        { k: 'Counterparty Intel teams', v: screen.counterparty_intel_team_ids.join(', ') },
        { k: 'Counterparty seller summaries', v: screen.counterparty_intel_summary.join(' | ') },
        { k: 'Bad cap-relief trades', v: screen.bad_cap_relief_trades.join(' | ') },
        { k: 'Required answer checks', v: screen.answer_requirements.join(' | ') },
      ],
      current_nfl_evidence: {
        dataset_id: 'nfl_trade_screen_current',
        team_id: team.team_id,
        row_count: screen.row_count,
        as_of_date: team.seed.as_of_date,
        source_name: team.seed.source_name,
      },
    },
  };
}

function tradeGoalIntelSourceForTeam(
  team: TeamEvidence,
  screen: NflTradeGoalScreen,
  refIndex: number,
): Omit<BriefSource, 'id' | 'brief_id'> {
  return {
    ref_index: refIndex,
    kind: 'ANALYST_DATA',
    source: 'GAMBIT_APP_DATA',
    title: `Current NFL counterparty Intel - ${team.team_id} trade screen`,
    updated_at: team.seed.as_of_date,
    data: {
      rows: [
        { k: 'Dataset', v: 'nfl_context_graph' },
        { k: 'Subject team', v: `${team.team_id} - ${team.team.full_name}` },
        { k: 'Counterparty Intel teams', v: screen.counterparty_intel_team_ids.join(', ') },
        { k: 'Seller thesis summaries', v: screen.counterparty_intel_summary.join(' | ') },
        { k: 'Intel precedence', v: 'Use for counterparty motivation and posture only; current roster/cap rows remain authoritative for player-team and cap claims.' },
      ],
      current_nfl_evidence: {
        dataset_id: 'nfl_context_graph',
        team_id: team.team_id,
        team_ids: screen.counterparty_intel_team_ids,
        row_count: screen.counterparty_intel_team_ids.length,
        as_of_date: team.seed.as_of_date,
        source_name: 'Gambit Intel',
      },
    },
  };
}

function renderTradeGoalScreen(screen: NflTradeGoalScreen, refIndex: number | null): string {
  const ref = refIndex ? `[${refIndex}] ` : '';
  return [
    `${ref}ANALYST_DATA - ${screen.subject_team_id} trade-goal checks`,
    `Objective: ${screen.objective}`,
    `Depth-after-trade checks: ${screen.depth_after_trade.join(' | ')}`,
    `Lower-pain outgoing hierarchy: ${screen.outgoing_hierarchy.join(' | ')}`,
    `Seller thesis cards: ${screen.named_target_lanes.join(' | ')}`,
    `Counterparty seller screen: ${screen.counterparty_intel_summary.join(' | ')}`,
    `Bad cap-relief/non-core guardrails: ${screen.bad_cap_relief_trades.join(' | ')}`,
    `Required answer structure: ${screen.answer_requirements.join(' | ')}`,
  ].join('\n');
}

function traceDatasetsForSources(
  sources: Omit<BriefSource, 'id' | 'brief_id'>[],
): DataAnalystTraceDataset[] {
  const out: DataAnalystTraceDataset[] = [];
  for (const source of sources) {
    const currentEvidence = isRecord(source.data) ? source.data.current_nfl_evidence : null;
    if (!isRecord(currentEvidence)) continue;
    const datasetId = typeof currentEvidence.dataset_id === 'string' ? currentEvidence.dataset_id : null;
    const teamId = typeof currentEvidence.team_id === 'string' ? currentEvidence.team_id : null;
    const teamIds = Array.isArray(currentEvidence.team_ids)
      ? currentEvidence.team_ids.filter((item): item is string => typeof item === 'string')
      : null;
    const rowCount = typeof currentEvidence.row_count === 'number' ? currentEvidence.row_count : 0;
    const sourceName = typeof currentEvidence.source_name === 'string' ? currentEvidence.source_name : source.source;
    if (!datasetId || !teamId) continue;
    out.push({
      dataset_id: datasetId,
      label: nflEvidenceDatasetLabel(datasetId),
      source_name: sourceName,
      as_of_date: typeof currentEvidence.as_of_date === 'string' ? currentEvidence.as_of_date : source.updated_at,
      team_ids: teamIds?.length ? teamIds : [teamId],
      row_count: rowCount,
    });
  }
  return out;
}

function nflEvidenceDatasetLabel(datasetId: string): string {
  if (datasetId === 'nfl_rosters_current') return 'NFL offseason rosters';
  if (datasetId === 'nfl_trade_screen_current') return 'NFL trade-goal screen';
  if (datasetId === 'nfl_context_graph') return 'NFL counterparty Intel';
  if (datasetId === 'nfl_coverage_current') return 'NFL coverage matrix';
  if (datasetId === 'nfl_player_metrics_current') return 'NFL player metrics';
  return 'NFL cap and contract rows';
}

export async function buildNflTradeGoalScreen(
  seed: NflDemoSeed,
  subjectTeamId: string,
  question = '',
): Promise<NflTradeGoalScreen | null> {
  const teamId = normalizeNflEvidenceTeamId(subjectTeamId);
  if (!teamId) return null;
  const rosterRows = seed.roster_entries.filter((row) => row.team_id === teamId);
  const capRows = seed.cap_rows.filter((row) => row.team_id === teamId && row.player_id);
  if (rosterRows.length === 0 || capRows.length === 0) return null;
  const rollups = buildPositionGroupRollups(rosterRows, capRows);
  const goalProtectedGroups = goalProtectedPositionGroups(question);
  const outgoingCandidates = selectTradeGoalCandidates(
    buildOutgoingTradeCandidates(capRows, rollups, goalProtectedGroups, teamId),
  );
  const badCapReliefTrades = buildBadCapReliefTradeLines(capRows, teamId).slice(0, 7);
  const targetRows = buildNamedTargetLaneRows(seed, teamId, question).slice(0, 20);
  const counterpartyContexts = await loadCounterpartyContexts([teamId, ...targetRows.map((row) => row.team_id)]);
  const scoredTargetLaneRows = targetRows
    .map((row) => buildNflTradeTargetLane(seed, row, teamId, counterpartyContexts.get(row.team_id)))
    .sort((a, b) => (
      motivationTierRank(a.motivation_tier) - motivationTierRank(b.motivation_tier)
      || b.motivation_score - a.motivation_score
      || (b.contract_fit.includes('high impact') ? 1 : 0) - (a.contract_fit.includes('high impact') ? 1 : 0)
      || a.target_player_name.localeCompare(b.target_player_name)
    ));
  const targetLaneRows = selectCounterpartyTargetLanes(scoredTargetLaneRows);
  const namedTargetLanes = targetLaneRows.map(formatTargetLane);
  const depthAfterTrade = outgoingCandidates.slice(0, 5).map((candidate) => candidate.depthLine);

  const outgoingHierarchy = outgoingCandidates.length
    ? outgoingCandidates.map((candidate) => candidate.line)
    : ['No lower-pain outgoing trade lever passed the current cap-file screen; answer should favor pick-led or no-trade paths.'];
  const targetLanes = namedTargetLanes.length
    ? namedTargetLanes
    : ['No named target lane passed the current cap-file screen; answer must say target availability is unconfirmed rather than inventing a counterparty.'];
  const counterpartyIntelTeamIds = [
    teamId,
    ...targetLaneRows.map((lane) => lane.target_team_id),
  ].filter((candidate, index, arr) => arr.indexOf(candidate) === index);
  const counterpartyIntelSummary = targetLaneRows.length
    ? targetLaneRows.map((lane) => `${lane.target_team_id} ${lane.target_player_name}: action=${lane.recommended_action}; seller_case=${lane.seller_case}; objection=${lane.seller_objection}`)
    : ['No counterparty Intel-backed target lanes available.'];

  return {
    subject_team_id: teamId,
    objective: tradeGoalObjective(question),
    outgoing_hierarchy: outgoingHierarchy,
    depth_after_trade: depthAfterTrade.length ? depthAfterTrade : ['No outgoing depth check available from current roster/cap file.'],
    named_target_lanes: targetLanes,
    target_lanes: targetLaneRows,
    counterparty_intel_team_ids: counterpartyIntelTeamIds,
    counterparty_intel_summary: counterpartyIntelSummary,
    bad_cap_relief_trades: badCapReliefTrades.length ? badCapReliefTrades : ['No bad cap-relief guardrails identified from current cap file.'],
    answer_requirements: [
      'Show a salary-out construction, a pick-led acquisition construction, and a stay-disciplined/no-trade path when the user asks for trade constructions.',
      'Before recommending Adebo/Holland or another premium starter, compare lower-pain outgoing contracts first and name the post-trade position-depth consequence.',
      'Name target/counterparty lanes from the current cap file and Intel graph or state that target availability is unconfirmed; do not stop at generic buyer/seller profiles.',
      'Do not lead with a target unless the seller-thesis card says call_now or check_call. If the best football target is monitor, posture_change_only, or do_not_lead, say so plainly.',
      'For every named target, answer from the seller-thesis card: why would they say yes, what do they lose, and what validates availability.',
      'If a target keeps 2027 clean, make that conditional on no extension, restructure, or new-money component being added to the acquisition.',
      'If trade impact is negative on a high-confidence row, call it bad economics, not a source-review issue.',
    ],
    row_count: outgoingHierarchy.length + targetLanes.length + badCapReliefTrades.length + counterpartyIntelTeamIds.length,
  };
}

function tradeGoalObjective(question: string): string {
  if (/\b(interior|3[-\s]?tech|dt|defensive tackle|inside pass|interior pass)\b/i.test(question)) {
    return /\b2027|future cap|new money|long deal|backloaded\b/i.test(question)
      ? 'add interior pass-rush juice without creating a 2027 cap problem'
      : 'add interior defensive-line/pass-rush help';
  }
  if (/\bpass[-\s]?rush|pressure|rush\b/i.test(question)) return 'add pass-rush pressure while preserving cap flexibility';
  return 'evaluate trade constructions with roster-depth and cap-discipline checks';
}

function buildOutgoingTradeCandidates(
  capRows: NflCapRow[],
  rollups: PositionGroupRollup[],
  goalProtectedGroups: Set<string>,
  subjectTeamId: string,
): TradeCandidate[] {
  return capRows
    .filter((row) => (
      row.player_id
      && row.source_status === 'captured'
      && row.trade_savings_2026 != null
      && row.trade_savings_2026 > 0
      && !isCoreTradeGuardrail(row, subjectTeamId)
    ))
    .map((row) => tradeCandidate(row, capRows, rollups, goalProtectedGroups))
    .filter((candidate) => candidate.painRank < 4)
    .sort((a, b) => (
      a.painRank - b.painRank
      || (b.row.trade_savings_2026 ?? 0) - (a.row.trade_savings_2026 ?? 0)
      || a.row.player_name.localeCompare(b.row.player_name)
    ));
}

function selectTradeGoalCandidates(candidates: TradeCandidate[]): TradeCandidate[] {
  const selected: TradeCandidate[] = [];
  for (const candidate of candidates.filter((item) => item.painRank <= 2 && (item.row.trade_savings_2026 ?? 0) >= 3_000_000).slice(0, 5)) {
    selected.push(candidate);
  }
  for (const candidate of candidates.filter((item) => item.painRank >= 3 && (item.row.trade_savings_2026 ?? 0) >= 5_000_000).slice(0, 5)) {
    if (!selected.some((item) => item.row.player_id === candidate.row.player_id)) selected.push(candidate);
  }
  return selected.slice(0, 10);
}

function tradeCandidate(
  row: NflCapRow,
  capRows: NflCapRow[],
  rollups: PositionGroupRollup[],
  goalProtectedGroups: Set<string>,
): TradeCandidate {
  const group = positionGroup(row.position);
  const painRank = tradePainRank(row, capRows, rollups, goalProtectedGroups);
  const painLabel = tradePainLabel(painRank);
  const depthLine = depthAfterTradeLine(row, capRows, rollups);
  const reason = outgoingTradeReason(row, capRows, goalProtectedGroups);
  const years = row.contract_years_remaining ?? row.years_remaining;
  const yearLabel = years == null ? 'years need review' : `${years} yr${years === 1 ? '' : 's'} left`;
  return {
    row,
    group,
    painRank,
    depthLine,
    line: `${row.player_name} (${row.position ?? 'UNK'}; ${formatMoney(row.trade_savings_2026) ?? 'unknown'} trade room; ${yearLabel}; ${painLabel}) - ${reason}`,
  };
}

function tradePainRank(
  row: NflCapRow,
  capRows: NflCapRow[],
  rollups: PositionGroupRollup[],
  goalProtectedGroups: Set<string>,
): number {
  const group = positionGroup(row.position);
  if (goalProtectedGroups.has(group)) return 3;
  const rank = capRankInGroup(row, capRows);
  const cap = row.cap_number_2026 ?? 0;
  const years = row.contract_years_remaining ?? row.years_remaining;
  const groupRollup = rollups.find((rollup) => rollup.group === group);
  if (row.contract_lever === 'cut_candidate') return 1;
  if (rank <= 2 && cap >= 8_000_000 && group !== 'WR') return 3;
  if (years === 1 && (row.trade_savings_2026 ?? 0) >= 3_000_000) return 1;
  if ((groupRollup?.roster_count ?? 0) >= 10 && (row.trade_savings_2026 ?? 0) >= 4_000_000) return 2;
  if (rank <= 2 && cap >= 8_000_000) return 2;
  return 2;
}

function tradePainLabel(rank: number): string {
  if (rank <= 1) return 'lower pain';
  if (rank === 2) return 'moderate football cost';
  return 'high football cost';
}

function outgoingTradeReason(
  row: NflCapRow,
  capRows: NflCapRow[],
  goalProtectedGroups: Set<string>,
): string {
  const group = positionGroup(row.position);
  const rank = capRankInGroup(row, capRows);
  if (goalProtectedGroups.has(group)) return `would thin the ${group} room you are trying to improve`;
  if (row.contract_lever === 'cut_candidate') return 'cleaner salary-out lever; compare against cut path and replacement cost';
  if ((row.contract_years_remaining ?? row.years_remaining) === 1) return 'short-dated contract; lower future-cap risk if market exists';
  if (rank <= 2 && (row.cap_number_2026 ?? 0) >= 8_000_000) return 'moves a top-priced starter, so do not recommend without depth replacement';
  return 'usable only if role/depth replacement is covered';
}

function depthAfterTradeLine(
  row: NflCapRow,
  capRows: NflCapRow[],
  rollups: PositionGroupRollup[],
): string {
  const group = positionGroup(row.position);
  const rollup = rollups.find((item) => item.group === group);
  const groupRowsAfter = capRows
    .filter((candidate) => candidate.player_id && candidate.player_id !== row.player_id && positionGroup(candidate.position) === group)
    .sort((a, b) => (b.cap_number_2026 ?? -1) - (a.cap_number_2026 ?? -1))
    .slice(0, 3)
    .map((candidate) => `${candidate.player_name} ${formatMoney(candidate.cap_number_2026) ?? 'unpriced'}`);
  const rosterCount = Math.max(0, (rollup?.roster_count ?? 0) - 1);
  const capCount = Math.max(0, (rollup?.cap_row_count ?? 0) - 1);
  return `${row.player_name}: ${group} after trade = ${rosterCount} roster rows/${capCount} cap rows; top remaining ${groupRowsAfter.join(', ') || 'none'}`;
}

function buildBadCapReliefTradeLines(
  capRows: NflCapRow[],
  subjectTeamId: string,
): string[] {
  return capRows
    .filter((row) => (
      row.player_id
      && row.cap_number_2026 != null
      && row.cap_number_2026 >= 3_000_000
      && (
        isCoreTradeGuardrail(row, subjectTeamId)
        || (row.trade_savings_2026 != null && row.trade_savings_2026 <= 0)
      )
    ))
    .sort((a, b) => (
      badTradePriority(a, subjectTeamId) - badTradePriority(b, subjectTeamId)
      || Math.abs(b.trade_savings_2026 ?? 0) - Math.abs(a.trade_savings_2026 ?? 0)
      || a.player_name.localeCompare(b.player_name)
    ))
    .map((row) => {
      const tradeImpact = row.trade_savings_2026 == null ? 'unknown trade impact' : `${formatMoney(row.trade_savings_2026)} trade impact`;
      const reason = (row.trade_savings_2026 ?? 0) < 0
        ? 'bad 2026 cap-relief trade because acceleration overwhelms savings'
        : 'core/ascending contract; only discuss as a football blockbuster, not a cap lever';
      return `${row.player_name} (${row.position ?? 'UNK'}; ${tradeImpact}; ${friendlyLedgerConfidence(row.contract_ledger_confidence)}) - ${reason}`;
    });
}

function badTradePriority(row: NflCapRow, subjectTeamId: string): number {
  if (row.player_name === 'Brian Burns') return 0;
  if (row.player_name === 'Andrew Thomas') return 1;
  if (isCoreTradeGuardrail(row, subjectTeamId)) return 2;
  return 3;
}

function buildNamedTargetLaneRows(
  seed: NflDemoSeed,
  subjectTeamId: string,
  question: string,
): NflCapRow[] {
  const targetPositions = targetPositionsForQuestion(question);
  if (!targetPositions) return [];
  const maxYears = /\b2027|future cap|new money|long deal|backloaded\b/i.test(question) ? 1 : 2;
  return seed.cap_rows
    .filter((row) => (
      row.player_id
      && row.team_id !== subjectTeamId
      && row.source_status === 'captured'
      && targetPositions.has(normalizedPosition(row.position))
      && row.cap_number_2026 != null
      && row.cap_number_2026 >= 3_000_000
      && row.contract_years_remaining != null
      && row.contract_years_remaining <= maxYears
      && row.trade_savings_2026 != null
      && row.trade_savings_2026 >= 2_000_000
      && row.contract_lever !== 'core_contract'
    ))
    .sort((a, b) => (
      (a.contract_years_remaining ?? 99) - (b.contract_years_remaining ?? 99)
      || (b.trade_savings_2026 ?? 0) - (a.trade_savings_2026 ?? 0)
      || (b.cap_number_2026 ?? 0) - (a.cap_number_2026 ?? 0)
      || a.player_name.localeCompare(b.player_name)
    ))
    .slice(0, 20);
}

function selectCounterpartyTargetLanes(lanes: NflTradeTargetLane[]): NflTradeTargetLane[] {
  const selected: NflTradeTargetLane[] = [];
  const addLane = (lane: NflTradeTargetLane) => {
    if (!selected.some((item) => item.target_team_id === lane.target_team_id && item.target_player_name === lane.target_player_name)) {
      selected.push(lane);
    }
  };

  for (const lane of lanes.filter((item) => item.motivation_tier === 'credible_call').slice(0, 4)) addLane(lane);
  for (const lane of lanes.filter((item) => item.motivation_tier === 'monitor_only').slice(0, 6)) addLane(lane);
  const topLongShots = lanes
    .filter((item) => item.motivation_tier === 'long_shot_unless_posture_changes' && item.contract_fit.includes('high impact'))
    .sort((a, b) => (
      (b.cap_number_2026 ?? 0) - (a.cap_number_2026 ?? 0)
      || (b.trade_savings_2026 ?? 0) - (a.trade_savings_2026 ?? 0)
      || b.motivation_score - a.motivation_score
      || a.target_player_name.localeCompare(b.target_player_name)
    ))
    .slice(0, 2);
  for (const lane of topLongShots) addLane(lane);

  return selected
    .sort((a, b) => (
      motivationTierRank(a.motivation_tier) - motivationTierRank(b.motivation_tier)
      || b.motivation_score - a.motivation_score
      || (b.contract_fit.includes('high impact') ? 1 : 0) - (a.contract_fit.includes('high impact') ? 1 : 0)
      || a.target_player_name.localeCompare(b.target_player_name)
    ))
    .slice(0, 9);
}

async function loadCounterpartyContexts(teamIds: string[]): Promise<Map<string, EffectiveTeamContext>> {
  const out = new Map<string, EffectiveTeamContext>();
  const uniqueTeamIds = teamIds.filter((teamId, index, arr) => arr.indexOf(teamId) === index);
  await Promise.all(uniqueTeamIds.map(async (teamId) => {
    try {
      out.set(teamId, await getEffectiveTeamContext(teamId));
    } catch {
      // Missing Intel is scored conservatively downstream; the trace will show
      // only successfully loaded context teams.
    }
  }));
  return out;
}

function buildNflTradeTargetLane(
  seed: NflDemoSeed,
  row: NflCapRow,
  subjectTeamId: string,
  context: EffectiveTeamContext | undefined,
): NflTradeTargetLane {
  const targetCapRows = seed.cap_rows.filter((candidate) => candidate.team_id === row.team_id && candidate.player_id);
  const targetRosterRows = seed.roster_entries.filter((candidate) => candidate.team_id === row.team_id);
  const targetRollups = buildPositionGroupRollups(targetRosterRows, targetCapRows);
  const group = positionGroup(row.position);
  const rollup = targetRollups.find((item) => item.group === group);
  const sellerDepthAfter = Math.max(0, (rollup?.roster_count ?? 0) - 1);
  const rank = capRankInGroup(row, targetCapRows);
  const contextSignals = tradeContextSignals(context);
  const sellerDepthConsequence = sellerDepthAfterTradeLine(row, targetCapRows, targetRollups);
  const motivation = scoreNflTradeTargetMotivation({
    subject_team_id: subjectTeamId,
    target_team_id: row.team_id,
    player_name: row.player_name,
    position: row.position,
    cap_number_2026: row.cap_number_2026,
    trade_savings_2026: row.trade_savings_2026,
    contract_years_remaining: row.contract_years_remaining ?? row.years_remaining,
    contract_lever: row.contract_lever,
    target_rank_in_group: rank,
    seller_group_depth_after: sellerDepthAfter,
    intel_posture: contextSignals.posture,
    intel_cap_status: contextSignals.capStatus,
    seller_posture: contextSignals.sellerPosture,
    preferred_deal_archetypes: contextSignals.preferredDealArchetypes,
    frequent_partners: contextSignals.frequentPartners,
    intel_confidence: contextSignals.confidence,
    generic_intel: contextSignals.generic,
  });
  const tradeStance = tradeMarketStanceForRow(row, contextSignals);
  const recommendedAction = recommendedActionForTradeLane(motivation, contextSignals, tradeStance, row, subjectTeamId);
  const sellerCase = sellerCaseForTradeLane(row, motivation, contextSignals, tradeStance);
  const sellerObjection = sellerObjectionForTradeLane(row, motivation, contextSignals, tradeStance, sellerDepthConsequence);
  const validationTrigger = validationTriggerForTradeLane(row, motivation, contextSignals, tradeStance);

  const years = row.contract_years_remaining ?? row.years_remaining;
  const yearLabel = years == null ? 'years need review' : `${years} yr${years === 1 ? '' : 's'} left`;
  const sourceRefs = [
    'nfl_cap_sheets_current',
    'nfl_rosters_current',
    `nfl_context_graph:${row.team_id}`,
  ];

  return {
    target_player_name: row.player_name,
    target_team_id: row.team_id,
    position: row.position,
    cap_number_2026: row.cap_number_2026,
    trade_savings_2026: row.trade_savings_2026,
    contract_years_remaining: years,
    contract_fit: `${formatMoney(row.cap_number_2026) ?? 'unknown'} current cap; ${yearLabel}; seller trade room ${formatMoney(row.trade_savings_2026) ?? 'unknown'}; ${rank <= 2 ? 'high impact/top-of-room' : 'role/rotation target'}; ${friendlyLedgerConfidence(row.contract_ledger_confidence)}`,
    seller_depth_consequence: sellerDepthConsequence,
    intel_posture: contextSignals.posture,
    intel_cap_status: contextSignals.capStatus,
    motivation_tier: motivation.tier,
    motivation_confidence: motivation.confidence,
    motivation_score: motivation.score,
    recommended_action: recommendedAction,
    seller_case: sellerCase,
    seller_objection: sellerObjection,
    validation_trigger: validationTrigger,
    reasons: motivation.reasons,
    blockers: motivation.blockers,
    why_would_they_say_yes: sellerCase,
    what_they_lose: whatSellerLoses(row, rank, sellerDepthConsequence),
    availability_validation: validationTrigger,
    source_refs: sourceRefs,
  };
}

export function scoreNflTradeTargetMotivation(input: NflTradeMotivationInput): NflTradeMotivationScore {
  const reasons: string[] = [];
  const blockers: string[] = [];
  let score = 0;
  const posture = input.intel_posture || 'unknown';
  const capStatus = input.intel_cap_status || 'unknown';
  const years = input.contract_years_remaining;

  if (['retool', 'rebuild', 'tank'].includes(posture)) {
    score += 3;
    reasons.push(`counterparty posture is ${posture}`);
  } else if (posture === 'purgatory') {
    score += 1;
    reasons.push('counterparty posture suggests decision pressure');
  } else if (['contend_now', 'contend_soon'].includes(posture)) {
    score -= 3;
    blockers.push(`counterparty posture is ${posture}, so useful trench starters are harder to extract`);
  } else {
    blockers.push('counterparty posture is not specific enough to infer seller motivation');
  }

  if (['asset_accumulator', 'cap_seller'].includes(input.seller_posture)) {
    score += 2;
    reasons.push(`seller Intel posture is ${input.seller_posture}`);
  } else if (input.seller_posture === 'selective_seller') {
    score += 1;
    reasons.push('seller Intel posture allows selective veteran movement');
  } else if (input.seller_posture === 'buyer_hold') {
    score -= 1;
    blockers.push('seller Intel posture is buyer-hold');
  } else if (input.seller_posture === 'posture_change_only') {
    score -= 3;
    blockers.push('seller Intel says this is posture-change only');
  }

  if (['near_cap', 'over_cap', 'restructure_needed', 'cash_constrained'].includes(capStatus)) {
    score += 1;
    reasons.push(`counterparty cap posture is ${capStatus}`);
  } else if (capStatus === 'cap_room') {
    score -= 1;
    blockers.push('counterparty has cap room, so cap relief is not a strong seller motive');
  }

  if (years != null && years <= 1) {
    score += 1;
    reasons.push('target is on an expiring/one-year contract');
  }
  if ((input.trade_savings_2026 ?? 0) >= 5_000_000) {
    score += 1;
    reasons.push(`seller can clear ${formatMoney(input.trade_savings_2026)} in 2026 trade room`);
  } else if ((input.trade_savings_2026 ?? 0) < 0) {
    score -= 2;
    blockers.push('seller trade economics are negative');
  }

  const topOfRoom = input.target_rank_in_group <= 2 && (input.cap_number_2026 ?? 0) >= 8_000_000;
  if (input.contract_lever === 'core_contract') {
    score -= 4;
    blockers.push('target is marked as a core contract');
  } else if (topOfRoom) {
    score -= input.target_rank_in_group === 1 ? 3 : 2;
    blockers.push(`target is a top-of-room ${input.position ?? 'position'} contract`);
  } else if (['cut_candidate', 'monitor', 'depth_contract'].includes(input.contract_lever)) {
    score += 2;
    reasons.push(`contract lever is ${input.contract_lever}`);
  }

  if (input.seller_group_depth_after >= 10) {
    score += 1;
    reasons.push(`seller keeps ${input.seller_group_depth_after} same-group roster rows after the move`);
  } else if (input.seller_group_depth_after < 6) {
    score -= 2;
    blockers.push(`seller depth would fall to ${input.seller_group_depth_after} same-group roster rows`);
  }

  if (input.preferred_deal_archetypes.some((item) => /draft-capital-for-veteran-player/i.test(item))) {
    score += 1;
    reasons.push('Intel trade DNA includes draft-capital-for-veteran-player deals');
  }
  if (input.frequent_partners.includes(input.subject_team_id)) {
    score += 1;
    reasons.push('Intel shows a recurring trade relationship with the subject team');
  }
  if (input.generic_intel) {
    blockers.push('Intel is generic or medium-confidence, so availability cannot be inferred from posture alone');
  }

  let tier: NflTradeMotivationTier = 'monitor_only';
  if (
    score >= 5
    && !input.generic_intel
    && !blockers.some((blocker) => /contend|top-of-room|core contract|not specific|buyer-hold|posture-change/i.test(blocker))
  ) {
    tier = 'credible_call';
  }
  if (
    blockers.some((blocker) => /contend|posture-change/.test(blocker))
    && blockers.some((blocker) => /top-of-room|core contract|posture-change/.test(blocker))
  ) {
    tier = 'long_shot_unless_posture_changes';
  } else if (score <= -2 || blockers.some((blocker) => /core contract/.test(blocker))) {
    tier = 'long_shot_unless_posture_changes';
  }
  if (input.generic_intel && tier === 'credible_call') tier = 'monitor_only';

  const confidence: NflTradeMotivationConfidence = input.generic_intel || input.intel_confidence !== 'high'
    ? 'low'
    : tier === 'credible_call'
      ? 'high'
      : 'medium';

  return {
    tier,
    confidence,
    score,
    reasons: reasons.length ? reasons : ['contract profile passes the initial cap screen'],
    blockers: blockers.length ? blockers : ['availability still requires direct seller confirmation'],
  };
}

interface TradeMarketIntelSignals {
  seller_posture: {
    value: string;
    confidence: string;
    evidence: string;
    source: string;
  };
  position_group_stance: Array<{
    group: string;
    stance: string;
    core_players: string[];
    movable_players: string[];
    seller_depth_notes: string;
    sell_threshold: string;
    confidence: string;
    source: string;
  }>;
  market_preferences: {
    desired_return_types: string[];
    avoided_deal_types: string[];
    division_rivalry_friction: string;
    confidence: string;
    source: string;
  };
  trade_triggers: Array<{
    trigger: string;
    implication: string;
    confidence: string;
    source: string;
  }>;
  availability_validation: Array<{
    check: string;
    owner: string;
    source: string;
  }>;
  no_trade_guardrails: Array<{
    guardrail: string;
    confidence: string;
    source: string;
  }>;
}

function tradeMarketIntelSignals(context: EffectiveTeamContext): TradeMarketIntelSignals | null {
  const intel = context.preferences.trade_market_intel;
  if (!intel) return null;
  return {
    seller_posture: {
      value: String(intel.seller_posture?.value ?? 'unknown'),
      confidence: String(intel.seller_posture?.confidence ?? 'low'),
      evidence: String(intel.seller_posture?.evidence ?? ''),
      source: String(intel.seller_posture?.source ?? ''),
    },
    position_group_stance: (intel.position_group_stance ?? []).map((stance) => ({
      group: String(stance.group ?? ''),
      stance: String(stance.stance ?? ''),
      core_players: stance.core_players ?? [],
      movable_players: stance.movable_players ?? [],
      seller_depth_notes: String(stance.seller_depth_notes ?? ''),
      sell_threshold: String(stance.sell_threshold ?? ''),
      confidence: String(stance.confidence ?? 'low'),
      source: String(stance.source ?? ''),
    })),
    market_preferences: {
      desired_return_types: intel.market_preferences?.desired_return_types ?? [],
      avoided_deal_types: intel.market_preferences?.avoided_deal_types ?? [],
      division_rivalry_friction: String(intel.market_preferences?.division_rivalry_friction ?? ''),
      confidence: String(intel.market_preferences?.confidence ?? 'low'),
      source: String(intel.market_preferences?.source ?? ''),
    },
    trade_triggers: (intel.trade_triggers ?? []).map((trigger) => ({
      trigger: String(trigger.trigger ?? ''),
      implication: String(trigger.implication ?? ''),
      confidence: String(trigger.confidence ?? 'low'),
      source: String(trigger.source ?? ''),
    })),
    availability_validation: (intel.availability_validation ?? []).map((validation) => ({
      check: String(validation.check ?? ''),
      owner: String(validation.owner ?? ''),
      source: String(validation.source ?? ''),
    })),
    no_trade_guardrails: (intel.no_trade_guardrails ?? []).map((guardrail) => ({
      guardrail: String(guardrail.guardrail ?? ''),
      confidence: String(guardrail.confidence ?? 'low'),
      source: String(guardrail.source ?? ''),
    })),
  };
}

function tradeContextSignals(context: EffectiveTeamContext | undefined): {
  posture: string;
  capStatus: string;
  sellerPosture: string;
  preferredDealArchetypes: string[];
  frequentPartners: string[];
  confidence: string;
  generic: boolean;
  tradeMarketIntel: TradeMarketIntelSignals | null;
} {
  if (!context) {
    return {
      posture: 'unknown',
      capStatus: 'unknown',
      sellerPosture: 'unknown',
      preferredDealArchetypes: [],
      frequentPartners: [],
      confidence: 'low',
      generic: true,
      tradeMarketIntel: null,
    };
  }
  const tradeMarketIntel = tradeMarketIntelSignals(context);
  const posture = context.preferences.strategic_posture.timeframe || 'unknown';
  const capStatus = stringAt(context.source_team, 'cap_situation.current_status') || 'unknown';
  const preferredDealArchetypes = context.preferences.trade_dna.preferred_deal_archetypes ?? [];
  const frequentPartners = context.preferences.trade_dna.frequent_partners ?? [];
  const confidence = lowestConfidence([
    context.preferences.strategic_posture.confidence,
    context.preferences.trade_dna.confidence,
    stringAt(context.source_team, 'cap_situation.confidence'),
    tradeMarketIntel?.seller_posture.confidence ?? 'low',
  ]);
  const generic = !tradeMarketIntel
    || /static internal-demo|verify before external use|internal demo synthesis|premium-position decisions/i.test(JSON.stringify(tradeMarketIntel));
  return {
    posture,
    capStatus,
    sellerPosture: tradeMarketIntel?.seller_posture.value ?? 'unknown',
    preferredDealArchetypes,
    frequentPartners,
    confidence,
    generic,
    tradeMarketIntel,
  };
}

function tradeMarketStanceForRow(
  row: NflCapRow,
  signals: ReturnType<typeof tradeContextSignals>,
): TradeMarketIntelSignals['position_group_stance'][number] | null {
  const stances = signals.tradeMarketIntel?.position_group_stance ?? [];
  if (stances.length === 0) return null;
  const group = positionGroup(row.position).toUpperCase();
  return stances.find((stance) => {
    const rawGroup = stance.group.toUpperCase();
    if (rawGroup === group) return true;
    if (group === 'DL' && /\b(DL|DT|INTERIOR_FRONT|DEFENSIVE_LINE)\b/.test(rawGroup)) return true;
    if (group === 'EDGE/LB' && /\b(EDGE|OLB|PASS_RUSH|OUTSIDE_LINEBACKER)\b/.test(rawGroup)) return true;
    if ((group === 'CB' || group === 'S') && /\b(DB|CB|SAF|SAFETY|SECONDARY)\b/.test(rawGroup)) return true;
    return false;
  }) ?? null;
}

function recommendedActionForTradeLane(
  motivation: NflTradeMotivationScore,
  signals: ReturnType<typeof tradeContextSignals>,
  stance: TradeMarketIntelSignals['position_group_stance'][number] | null,
  row: NflCapRow,
  subjectTeamId: string,
): NflTradeRecommendedAction {
  const friction = signals.tradeMarketIntel?.market_preferences.division_rivalry_friction ?? '';
  const divisionFriction = subjectTeamId === 'NYG' && /\bNFC East\b|division/i.test(friction);
  if (!signals.tradeMarketIntel || !stance || signals.generic) {
    return motivation.tier === 'long_shot_unless_posture_changes' ? 'posture_change_only' : 'monitor';
  }
  if (signals.sellerPosture === 'posture_change_only') return 'posture_change_only';
  if (signals.sellerPosture === 'buyer_hold' && divisionFriction) return 'do_not_lead';
  if (motivation.tier === 'long_shot_unless_posture_changes') return signals.sellerPosture === 'buyer_hold' ? 'do_not_lead' : 'posture_change_only';
  if (motivation.tier === 'credible_call' && signals.sellerPosture === 'cap_seller') {
    return 'call_now';
  }
  if (motivation.tier === 'credible_call' && ['asset_accumulator', 'selective_seller'].includes(signals.sellerPosture)) {
    return 'check_call';
  }
  if (
    ['asset_accumulator', 'cap_seller', 'selective_seller'].includes(signals.sellerPosture)
    && (row.contract_years_remaining ?? row.years_remaining ?? 99) <= 1
  ) {
    return 'check_call';
  }
  return 'monitor';
}

function sellerCaseForTradeLane(
  row: NflCapRow,
  motivation: NflTradeMotivationScore,
  signals: ReturnType<typeof tradeContextSignals>,
  stance: TradeMarketIntelSignals['position_group_stance'][number] | null,
): string {
  if (signals.tradeMarketIntel?.seller_posture.evidence && stance?.stance) {
    const returnTypes = signals.tradeMarketIntel.market_preferences.desired_return_types
      .slice(0, 2)
      .map((item) => item.replace(/[. ]+$/g, ''))
      .join(' or ');
    const returnClause = returnTypes ? ` The ask should be framed around ${returnTypes}.` : '';
    return `${stance.stance}${returnClause}`;
  }
  return whyWouldSellerSayYesFromScore(row, motivation);
}

function sellerObjectionForTradeLane(
  row: NflCapRow,
  motivation: NflTradeMotivationScore,
  signals: ReturnType<typeof tradeContextSignals>,
  stance: TradeMarketIntelSignals['position_group_stance'][number] | null,
  sellerDepthConsequence: string,
): string {
  const guardrail = signals.tradeMarketIntel?.no_trade_guardrails[0]?.guardrail;
  if (guardrail) return guardrail;
  if (stance?.seller_depth_notes || stance?.sell_threshold) {
    return [stance.seller_depth_notes, stance.sell_threshold].filter(Boolean).join(' ');
  }
  const blocker = motivation.blockers[0] ?? 'seller intent is unconfirmed';
  return `${blocker}; ${sellerDepthConsequence}`;
}

function validationTriggerForTradeLane(
  row: NflCapRow,
  motivation: NflTradeMotivationScore,
  signals: ReturnType<typeof tradeContextSignals>,
  stance: TradeMarketIntelSignals['position_group_stance'][number] | null,
): string {
  const validation = signals.tradeMarketIntel?.availability_validation[0]?.check;
  const trigger = signals.tradeMarketIntel?.trade_triggers[0];
  if (validation && trigger) return `${validation} Trigger to upgrade: ${trigger.trigger} -> ${trigger.implication}`;
  if (validation) return validation;
  if (stance?.sell_threshold) return `Validate seller threshold: ${stance.sell_threshold}`;
  if (motivation.tier === 'credible_call') {
    return 'Confirm seller asking price, medicals, role, and whether draft capital beats their comp/depth alternatives.';
  }
  return `Confirm availability before treating ${row.player_name} as a real target; current evidence supports only a lane, not seller intent.`;
}

function formatTargetLane(lane: NflTradeTargetLane): string {
  return [
    `${lane.target_team_id} ${lane.target_player_name} (${lane.position ?? 'UNK'}; ${lane.contract_fit}; recommended_action=${lane.recommended_action}; posture=${lane.intel_posture}; cap_status=${lane.intel_cap_status})`,
    `Seller case: ${lane.seller_case}`,
    `Seller objection: ${lane.seller_objection}`,
    `What they lose: ${lane.what_they_lose}`,
    `Validate availability: ${lane.validation_trigger}`,
  ].join(' - ');
}

function whyWouldSellerSayYesFromScore(row: NflCapRow, motivation: NflTradeMotivationScore): string {
  if (motivation.tier === 'credible_call') {
    return `draft capital plus ${formatMoney(row.trade_savings_2026) ?? '2026'} cap relief could fit their posture`;
  }
  if (motivation.tier === 'long_shot_unless_posture_changes') {
    return 'not obvious; only if their competitive posture changes or the draft premium is far above a normal rental price';
  }
  return 'a check call is reasonable, but they need a seller signal beyond contract fit';
}

function whatSellerLoses(row: NflCapRow, rank: number, sellerDepthConsequence: string): string {
  const group = positionGroup(row.position);
  if (rank <= 2) return `a top-of-room ${group} piece; ${sellerDepthConsequence}`;
  return `a same-group rotation body; ${sellerDepthConsequence}`;
}

function sellerDepthAfterTradeLine(
  row: NflCapRow,
  capRows: NflCapRow[],
  rollups: PositionGroupRollup[],
): string {
  return depthAfterTradeLine(row, capRows, rollups);
}

function motivationTierRank(tier: NflTradeMotivationTier): number {
  if (tier === 'credible_call') return 0;
  if (tier === 'monitor_only') return 1;
  return 2;
}

function targetPositionsForQuestion(question: string): Set<string> | null {
  if (/\b(interior|3[-\s]?tech|dt|defensive tackle|inside pass|interior pass)\b/i.test(question)) {
    return new Set(['DT', 'NT', 'DL']);
  }
  if (/\b(edge|outside rush|pass[-\s]?rush|pressure)\b/i.test(question)) {
    return new Set(['DE', 'EDGE', 'OLB', 'LB']);
  }
  if (/\b(wide receiver|receiver|wideout|wr)\b/i.test(question)) return new Set(['WR']);
  if (/\b(tight end|te)\b/i.test(question)) return new Set(['TE']);
  if (/\b(running back|tailback|rb)\b/i.test(question)) return new Set(['RB']);
  if (/\b(corner|cornerback|cb)\b/i.test(question)) return new Set(['CB', 'DB']);
  if (/\b(safety|safeties|free safety|strong safety|fs|ss)\b/i.test(question)) {
    return new Set(['S', 'SAF', 'FS', 'SS', 'DB']);
  }
  if (/\b(linebacker|off[-\s]?ball|lb)\b/i.test(question)) return new Set(['LB', 'ILB', 'MLB', 'OLB']);
  if (/\b(offensive line|o-line|ol|guard|center|tackle|interior offensive line|iOL)\b/i.test(question)) {
    return new Set(['OL', 'G', 'C', 'OT', 'T']);
  }
  if (/\b(quarterback|qb)\b/i.test(question)) return new Set(['QB']);
  return null;
}

function goalProtectedPositionGroups(question: string): Set<string> {
  const groups = new Set<string>();
  if (/\b(interior|3[-\s]?tech|dt|defensive tackle|inside pass|interior pass)\b/i.test(question)) groups.add('DL');
  if (/\b(edge|outside rush|pass[-\s]?rush|pressure)\b/i.test(question) && !groups.has('DL')) groups.add('EDGE/LB');
  return groups;
}

function capRankInGroup(row: NflCapRow, capRows: NflCapRow[]): number {
  const group = positionGroup(row.position);
  const ordered = capRows
    .filter((candidate) => candidate.player_id && positionGroup(candidate.position) === group)
    .sort((a, b) => (b.cap_number_2026 ?? -1) - (a.cap_number_2026 ?? -1));
  return ordered.findIndex((candidate) => candidate.player_id === row.player_id) + 1 || 999;
}

function isCoreTradeGuardrail(row: NflCapRow, subjectTeamId: string): boolean {
  if (row.contract_lever === 'core_contract') return true;
  if (subjectTeamId !== 'NYG') return false;
  return new Set([
    'Brian Burns',
    'Andrew Thomas',
    'Abdul Carter',
    'Malik Nabers',
    'Jaxson Dart',
    'Kayvon Thibodeaux',
  ]).has(row.player_name);
}

function normalizedPosition(position: string | null): string {
  return (position ?? 'UNK').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function buildPositionGroupRollups(
  rosterRows: NflRosterEntry[],
  capRows: NflCapRow[],
): PositionGroupRollup[] {
  const rosterByGroup = new Map<string, number>();
  for (const row of rosterRows) {
    const group = positionGroup(row.position);
    rosterByGroup.set(group, (rosterByGroup.get(group) ?? 0) + 1);
  }

  const capByGroup = new Map<string, NflCapRow[]>();
  for (const row of capRows) {
    const group = positionGroup(row.position);
    const rows = capByGroup.get(group) ?? [];
    rows.push(row);
    capByGroup.set(group, rows);
  }

  const groups = new Set([...rosterByGroup.keys(), ...capByGroup.keys()]);
  return [...groups].map((group) => {
    const rows = capByGroup.get(group) ?? [];
    const capTotal = rows.reduce((total, row) => total + (row.cap_number_2026 ?? 0), 0);
    return {
      group,
      roster_count: rosterByGroup.get(group) ?? 0,
      cap_row_count: rows.length,
      cap_total: capTotal,
      source_needed_count: rows.filter((row) => row.source_status === 'source-needed').length,
      top_contracts: topCapRows(rows, 3),
    };
  }).sort((a, b) => b.cap_total - a.cap_total || a.group.localeCompare(b.group));
}

function topCapRows(rows: NflCapRow[], limit = 8): string[] {
  return rows
    .slice()
    .sort((a, b) => (
      (b.cap_number_2026 ?? -1) - (a.cap_number_2026 ?? -1)
      || (a.source_order ?? 9999) - (b.source_order ?? 9999)
    ))
    .slice(0, limit)
    .map((row) => {
      const cap = formatMoney(row.cap_number_2026) ?? 'source-needed';
      const cut = formatMoney(row.cut_savings_2026) ?? 'unknown cut savings';
      const dead = formatMoney(row.dead_money_if_cut_2026) ?? 'unknown dead money';
      const guarantee = formatMoney(row.guaranteed_remaining) ?? 'unknown guarantees';
      const postJune = formatMoney(row.post_june_1_cut_savings_2026) ?? 'unknown post-June savings';
      const trade = formatMoney(row.trade_savings_2026) ?? 'unknown trade savings';
      const restructure = formatMoney(row.restructure_savings_estimate_2026) ?? 'unknown restructure';
      const years = row.contract_years_remaining ?? row.years_remaining ?? 'unknown';
      const voids = row.void_year_count ?? 'unknown';
      return `${row.player_name} (${row.position ?? 'UNK'}; cap=${cap}; guarantees=${guarantee}; dead_cut=${dead}; cut_savings=${cut}; post_june_cut_savings=${postJune}; trade_savings=${trade}; restructure=${restructure}; years=${years}; void_years=${voids} ${friendlyVoidStatus(row.void_years_source_status)}; evidence_quality=${friendlyLedgerConfidence(row.contract_ledger_confidence)}; source=${friendlySourceStatus(row.source_status)})`;
    });
}

function formatRollup(rollup: PositionGroupRollup): string {
  return `${rollup.group}: roster=${rollup.roster_count}; cap_rows=${rollup.cap_row_count}; cap=${formatMoney(rollup.cap_total) ?? '$0.00M'}; source_needed=${rollup.source_needed_count}; top=${rollup.top_contracts.join(', ') || 'none'}`;
}

function playerMetricCompleteness(rows: NflPlayerMetricRow[]): PlayerMetricCompleteness {
  const gapCounts: Record<string, number> = {};
  for (const row of rows) {
    const key = row.metric_gap_reason || 'none';
    gapCounts[key] = (gapCounts[key] ?? 0) + 1;
  }
  return {
    row_count: rows.length,
    captured_count: rows.filter((row) => row.source_status === 'captured').length,
    source_needed_count: rows.filter((row) => row.source_status === 'source-needed').length,
    roster_derived_count: rows.filter((row) => (row.source_status ?? 'roster-derived') === 'roster-derived').length,
    snap_count: rows.filter((row) => (row.snaps_2025 ?? 0) > 0).length,
    production_count: rows.filter((row) => [
      row.passing_yards_2025,
      row.rushing_yards_2025,
      row.receiving_yards_2025,
      row.tackles_2025,
      row.sacks_2025,
      row.interceptions_2025,
      row.touchdowns_2025,
    ].some((value) => value != null && value !== 0)).length,
    gap_counts: gapCounts,
  };
}

function formatPlayerMetricCompleteness(completeness: PlayerMetricCompleteness): string {
  const denominator = completeness.row_count;
  const gaps = Object.entries(completeness.gap_counts)
    .filter(([key]) => key !== 'none')
    .sort((a, b) => b[1] - a[1])
    .map(([key, value]) => `${key}=${value}`)
    .join(', ');
  return [
    `captured_public_metrics=${completeness.captured_count}/${denominator}`,
    `snap_rows=${completeness.snap_count}/${denominator}`,
    `production_rows=${completeness.production_count}/${denominator}`,
    `needs_metric_context=${completeness.source_needed_count}/${denominator}`,
    `metric_gaps(${gaps || 'none'})`,
  ].join('; ');
}

function topMetricRows(rows: NflPlayerMetricRow[], limit = 8): string[] {
  return rows
    .filter((row) => row.source_status === 'captured')
    .slice()
    .sort((a, b) => (b.snaps_2025 ?? 0) - (a.snaps_2025 ?? 0) || a.player_name.localeCompare(b.player_name))
    .slice(0, limit)
    .map((row) => {
      const production = [
        row.passing_yards_2025 ? `pass=${row.passing_yards_2025}` : null,
        row.rushing_yards_2025 ? `rush=${row.rushing_yards_2025}` : null,
        row.receiving_yards_2025 ? `rec=${row.receiving_yards_2025}` : null,
        row.tackles_2025 ? `tkl=${row.tackles_2025}` : null,
        row.sacks_2025 ? `sacks=${row.sacks_2025}` : null,
        row.interceptions_2025 ? `int=${row.interceptions_2025}` : null,
        row.touchdowns_2025 ? `td=${row.touchdowns_2025}` : null,
      ].filter(Boolean).join(', ');
      return `${row.player_name} (${row.position ?? 'UNK'}; snaps=${row.snaps_2025 ?? 0}; games=${row.games_2025 ?? 'unknown'}; ${production || 'production=n/a'}; source=${row.metric_source_family ?? 'public metrics'})`;
    });
}

function contractLedgerCompleteness(rows: NflCapRow[]): ContractLedgerCompleteness {
  const confidenceCounts: Record<string, number> = {};
  for (const row of rows) {
    const confidence = row.contract_ledger_confidence ?? 'unknown';
    confidenceCounts[confidence] = (confidenceCounts[confidence] ?? 0) + 1;
  }
  return {
    row_count: rows.length,
    guarantee_count: rows.filter((row) => row.guaranteed_remaining != null).length,
    dead_money_count: rows.filter((row) => row.dead_money_if_cut_2026 != null && row.cut_savings_2026 != null).length,
    post_june_count: rows.filter((row) => row.post_june_1_dead_money_2026 != null && row.post_june_1_cut_savings_2026 != null).length,
    trade_count: rows.filter((row) => row.trade_dead_money_2026 != null && row.trade_savings_2026 != null).length,
    contract_year_count: rows.filter((row) => (row.contract_years_remaining ?? row.years_remaining) != null).length,
    void_year_count: rows.filter((row) => row.void_year_count != null).length,
    confidence_counts: confidenceCounts,
  };
}

function formatContractLedgerCompleteness(completeness: ContractLedgerCompleteness): string {
  const denominator = completeness.row_count;
  const confidence = Object.entries(completeness.confidence_counts)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, value]) => `${friendlyLedgerConfidence(key)}=${value}`)
    .join(', ');
  return [
    `guarantees=${completeness.guarantee_count}/${denominator}`,
    `dead/cut=${completeness.dead_money_count}/${denominator}`,
    `post-June=${completeness.post_june_count}/${denominator}`,
    `trade=${completeness.trade_count}/${denominator}`,
    `contract_years=${completeness.contract_year_count}/${denominator}`,
    `void_years=${completeness.void_year_count}/${denominator}`,
    `evidence_quality_counts(${confidence || 'none'})`,
  ].join('; ');
}

function friendlyLedgerConfidence(confidence: string | null | undefined): string {
  switch ((confidence ?? '').toLowerCase()) {
    case 'captured':
      return 'high confidence';
    case 'derived':
      return 'directional from captured seasons';
    case 'estimated':
      return 'directional estimate';
    case 'source-needed':
      return 'needs source review';
    default:
      return confidence || 'unknown';
  }
}

function friendlySourceStatus(status: string | null | undefined): string {
  switch ((status ?? '').toLowerCase()) {
    case 'captured':
      return 'priced in current cap file';
    case 'estimated':
      return 'directional low-cap estimate';
    case 'source-needed':
      return 'needs source review';
    case 'not-available':
      return 'not available';
    default:
      return status || 'unknown';
  }
}

function friendlyVoidStatus(status: string | null | undefined): string {
  switch ((status ?? '').toLowerCase()) {
    case 'captured':
      return 'voids reviewed';
    case 'derived':
      return 'voids directional';
    case 'estimated':
      return 'voids estimated';
    case 'source-needed':
      return 'voids need review';
    default:
      return status || 'void status unknown';
  }
}

function positionGroup(position: string | null): string {
  return normalizePositionGroup(position);
}

function normalizeEvidenceTeamIds(teamIds: string[], seed: NflDemoSeed): string[] {
  const allowed = new Set(seed.teams.map((team) => team.team_id));
  const out: string[] = [];
  for (const raw of teamIds) {
    const teamId = normalizeNflEvidenceTeamId(raw);
    if (teamId && allowed.has(teamId) && !out.includes(teamId)) out.push(teamId);
  }
  return out;
}

function normalizeNflEvidenceTeamId(teamId: string | null | undefined): NflEvidenceTeamId | null {
  const normalized = String(teamId ?? '').trim().toUpperCase();
  return NFL_EVIDENCE_TEAM_ID_SET.has(normalized) ? normalized as NflEvidenceTeamId : null;
}

function normalizeNflEvidenceTeamAlias(alias: string): NflEvidenceTeamId | null {
  return NFL_EVIDENCE_TEAM_ALIASES[alias.trim().toUpperCase()] ?? null;
}

function requiresExactCaseTeamAlias(alias: string): boolean {
  return NFL_EVIDENCE_TEAM_ID_SET.has(alias) && alias.length <= 3;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function recordAt(record: Record<string, unknown>, path: string): Record<string, unknown> | null {
  let current: unknown = record;
  for (const part of path.split('.')) {
    if (!isRecord(current)) return null;
    current = current[part];
  }
  return isRecord(current) ? current : null;
}

function stringAt(record: Record<string, unknown>, path: string): string {
  const parts = path.split('.');
  const leaf = parts.pop();
  const parent = parts.length ? recordAt(record, parts.join('.')) : record;
  if (!leaf || !parent) return '';
  return typeof parent[leaf] === 'string' ? parent[leaf] : '';
}

function lowestConfidence(values: string[]): string {
  if (values.some((value) => value === 'low')) return 'low';
  if (values.some((value) => value !== 'high')) return 'medium';
  return 'high';
}

function formatMoney(amount: number | null): string | null {
  if (amount === null || !Number.isFinite(amount)) return null;
  const millions = amount / 1_000_000;
  const rounded = Math.abs(millions) >= 10 ? millions.toFixed(1) : millions.toFixed(2);
  return `$${rounded}M`;
}

function teamSortIndex(teamId: string): number {
  return NFL_EVIDENCE_TEAM_IDS.indexOf(teamId as NflEvidenceTeamId);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
