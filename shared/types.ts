// Shared types used by both client (Vite/React) and server (Hono/Node).
// These mirror Supabase row shapes plus tool I/O contracts.

// ── Sessions ────────────────────────────────────────────────────────────────
export interface Session {
  id: string;
  user_id: string | null;
  label: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  // Derived (not in DB):
  count?: number;
  active?: boolean;
}

// ── Briefs ──────────────────────────────────────────────────────────────────
export type BriefStatus = 'generating' | 'ready' | 'partial' | 'failed';
export type BriefMode = 'brief' | 'data_analyst';
export type BriefProgressPhase =
  | 'queued'
  | 'collecting_evidence'
  | 'context_lookup'
  | 'drafting'
  | 'validating'
  | 'repairing'
  | 'enriching_candidates'
  | 'matching_sources'
  | 'saving'
  | 'ready'
  | 'failed';

export type BriefProgressEventKind = 'stage' | 'tool' | 'model' | 'data' | 'write' | 'error';

export interface BriefProgressEvent {
  at: string;
  phase: BriefProgressPhase;
  pct: number;
  label: string;
  detail?: string | null;
  kind: BriefProgressEventKind;
}

export interface BriefProgress {
  phase: BriefProgressPhase;
  pct: number;
  label: string;
  detail?: string | null;
  updated_at: string;
  events: BriefProgressEvent[];
}

export interface BriefProgressStreamEvent {
  brief_id: string;
  status: BriefStatus;
  progress: BriefProgress | null;
  updated_at: string;
  error: string | null;
}

export type BriefTemplateId =
  | 'decision_brief'
  | 'comparison_matrix'
  | 'options_table'
  | 'evidence_report'
  | 'staff_packet'
  | 'data_table'
  | 'custom';

export type BriefPresentationSectionKind = 'prose' | 'bullets' | 'table' | 'question_groups';

export interface BriefPresentationProseSection {
  kind: 'prose';
  title: string;
  body: string;
  source_refs?: number[];
}

export interface BriefPresentationBulletItem {
  label?: string;
  body: string;
  source_refs?: number[];
}

export interface BriefPresentationBulletsSection {
  kind: 'bullets';
  title: string;
  items: BriefPresentationBulletItem[];
}

export interface BriefPresentationTableSection {
  kind: 'table';
  title: string;
  columns: string[];
  rows: (string | number | null)[][];
  source_refs?: number[];
}

export interface BriefPresentationQuestionGroupsSection {
  kind: 'question_groups';
  title: string;
  groups: RecommendationNextQuestionGroup[];
}

export type BriefPresentationSection =
  | BriefPresentationProseSection
  | BriefPresentationBulletsSection
  | BriefPresentationTableSection
  | BriefPresentationQuestionGroupsSection;

export interface BriefPresentation {
  template_id: BriefTemplateId;
  title?: string;
  sections: BriefPresentationSection[];
}

export interface BriefTemplateSelection {
  template_id: BriefTemplateId;
  /** For custom templates, the curated template whose renderer/prompt shape it inherits. */
  base_template_id?: BriefTemplateId | null;
  custom_template_id?: string | null;
  instructions?: string | null;
}

export interface SavedBriefTemplate {
  id: string;
  user_id: string | null;
  name: string;
  base_template_id: BriefTemplateId;
  instructions: string;
  created_at: string;
  updated_at: string;
}

export interface BriefTemplateDefinition {
  id: BriefTemplateId;
  label: string;
  short_label: string;
  description: string;
  renderer: 'recommendation' | 'data_analysis';
}

export interface RecommendationBriefBody {
  kind?: 'brief';
  /** 1-3 paragraphs of reasoning. Inline citation markers `[N]` reference brief_options / brief_sources by ref_index. */
  reasoning: string;
  /** Optional CBA quote with attribution + the source ref_index it cites. */
  blockquote?: {
    text: string;
    source: string;
    cite_ref?: number;
  };
  /** 2-4 watch-points displayed in the "What I'm watching" section. */
  watching: { tag: string; body: string }[];
  /** Follow-up questions the GM can send to staff or ask Gambit next. */
  next_questions?: RecommendationNextQuestionGroup[];
  /** Optional template-specific render sections. Legacy briefs omit this and use the default recommendation renderer. */
  presentation?: BriefPresentation;
}

export interface RecommendationNextQuestionGroup {
  audience: 'analytics' | 'coaching' | 'scouting_front_office' | 'cap_contracts' | 'gambit' | string;
  questions: string[];
}

export interface DataAnalysisFinding {
  label: string;
  body: string;
  source_refs: number[];
}

export interface DataAnalysisTable {
  title: string;
  columns: string[];
  rows: (string | number | null)[][];
  source_refs: number[];
}

export interface DataAnalysisCalculation {
  label: string;
  formula?: string;
  value: string;
  source_refs: number[];
}

export interface DataAnalysisBriefBody {
  kind: 'data_analysis';
  answer: string;
  key_findings: DataAnalysisFinding[];
  tables: DataAnalysisTable[];
  calculations: DataAnalysisCalculation[];
  caveats: string[];
  followups: string[];
}

export type BriefBody = RecommendationBriefBody | DataAnalysisBriefBody;

export interface Brief {
  id: string;
  session_id: string;
  mode: BriefMode;
  template_id?: BriefTemplateId | null;
  template_base_id?: BriefTemplateId | null;
  custom_template_id?: string | null;
  template_instructions?: string | null;
  question: string;
  /** Compatibility field displayed as the brief's working thesis/current lean. */
  thesis: string | null;
  body: BriefBody | null;
  status: BriefStatus;
  progress: BriefProgress | null;
  error: string | null;
  duration_ms: number | null;
  created_at: string;
  updated_at: string;
  // Derived display fields (computed client-side):
  label?: string;       // short label for tabs (~20 chars)
  when?: string;        // 'Apr 12 · 12:47 PM'
  sources?: number;     // count
  duration?: string;    // '2.4s'
}

// ── Brief sharing ───────────────────────────────────────────────────────────
export type BriefShareAccessLevel = 'view';

export interface TeamMember {
  id: string;
  team_id: string;
  name: string;
  role: string | null;
  email: string | null;
  avatar_initials: string | null;
  created_at: string;
  updated_at: string;
}

export interface BriefShare {
  id: string;
  brief_id: string;
  team_member_id: string | null;
  recipient_name: string;
  access_level: BriefShareAccessLevel;
  created_at: string;
  updated_at: string;
  revoked_at: string | null;
}

export interface BriefShareLink {
  id: string;
  brief_id: string;
  token: string;
  access_level: BriefShareAccessLevel;
  created_at: string;
  updated_at: string;
  revoked_at: string | null;
}

export interface BriefShareSnapshot {
  team_members: TeamMember[];
  recipient_shares: BriefShare[];
  link: BriefShareLink | null;
}

export interface AddBriefShareRecipientRequest {
  team_member_id: string;
}

export interface BriefShareRecipientResponse {
  share: BriefShare;
}

export interface BriefShareLinkResponse {
  link: BriefShareLink;
}

export interface ResolveBriefShareLinkResponse {
  brief_id: string;
  session_id: string;
  link: BriefShareLink;
}

// ── Chat history ────────────────────────────────────────────────────────────
export type TurnRole = 'user' | 'assistant';

export interface ChatTurn {
  id: string;
  brief_id: string;
  role: TurnRole;
  content: string;
  tool_calls: ToolCall[] | null;
  created_at: string;
}

// ── Brief sources (LeftRail data) ───────────────────────────────────────────
export interface BriefSource {
  id: string;
  brief_id: string;
  ref_index: number;
  kind: string;           // 'CONTRACT' | 'CBA' | 'NEWS' | ...
  source: string | null;  // 'SPOTRAC' | ...
  title: string;
  data: Record<string, unknown> | null;
  updated_at: string | null;  // human label like '2H AGO'
}

// ── Brief options (OptionsTable rows) ───────────────────────────────────────
export type PillKind =
  | 'executable'
  | 'speculative'
  | 'plausible'
  | 'negative'
  | 'compete'
  | 'transition'
  | 'swing'
  | 'trade'
  | 'fa'
  | 'extension';

export interface BriefOptionDetails {
  decision_question: string;
  why_this: string;
  upside: string;
  downside: string;
  move_candidates?: BriefOptionMoveCandidate[];
  required_moves: string[];
  blockers: string[];
  watch_triggers: string[];
  next_step: string;
  evidence_refs: number[];
}

export interface BriefOptionMoveCandidate {
  label: string;
  subject_team_id?: string | null;
  target_player_names?: string[];
  target_team_id?: string | null;
  target_team_name?: string | null;
  outgoing_player_names?: string[];
  outgoing_package?: string | null;
  salary_match?: string | null;
  basketball_fit?: string | null;
  mechanism?: string | null;
  why?: string | null;
  cost?: string | null;
  constraints?: string | null;
  evidence_refs?: number[];
}

export interface BriefOption {
  id: string;
  brief_id: string;
  ref_index: number;
  title: string;
  subtitle: string | null;
  type_kind: PillKind | null;
  path_kind: PillKind | null;
  net_cap_num: number;
  net_cap_label: string;
  epm: string | null;
  cba_section: string | null;
  timing: string | null;
  src_count: number;
  likelihood_kind: PillKind;
  likelihood_pct: number;
  spark: number[];
  details: BriefOptionDetails | null;
}

// ── Agent runs (Tray data) ──────────────────────────────────────────────────
export type AgentKind = 'deck' | 'memo' | 'research' | 'comp_set' | 'synthesize' | 'change_my_mind' | 'staff_protocol';
export type AgentStatus =
  | 'queued'
  | 'running'
  | 'needs_input'
  | 'completed'
  | 'failed';

export interface AgentRun {
  id: string;
  brief_id: string | null;
  session_id: string | null;
  kind: AgentKind;
  status: AgentStatus;
  progress: number;            // 0-100
  title: string;
  sub: string | null;
  config: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
  just_finished: boolean;
}

// ── Artifacts ───────────────────────────────────────────────────────────────
export interface Artifact {
  id: string;
  agent_run_id: string;
  brief_id: string;
  name: string;
  kind: string;                 // 'doc' | 'deck' | 'data'
  storage_url: string | null;
  meta: Record<string, unknown> | null;
  created_at: string;
}

// ── Bookmarks ───────────────────────────────────────────────────────────────
export interface Bookmark {
  user_id: string | null;
  brief_id: string;
  created_at: string;
}

// ── Projects ────────────────────────────────────────────────────────────────
export const PROJECT_STEP_DEFINITIONS = [
  { id: 'research', label: 'Research' },
  { id: 'validate', label: 'Validate' },
  { id: 'feedback', label: 'Feedback' },
  { id: 'gm', label: 'GM' },
  { id: 'proposal', label: 'Proposal' },
] as const;

export type ProjectStepId = (typeof PROJECT_STEP_DEFINITIONS)[number]['id'];
export type ProjectStatus = 'active' | 'packaged' | 'archived';
export type ProjectPackageStatus = 'not_started' | 'drafted' | 'stale' | 'ready';
export type ProjectTaskSource = 'system' | 'ai' | 'user';
export type ProjectWorkflowType = 'inbound_trade' | 'decision';
export type ProjectTradeScenarioStatus = 'active' | 'shortlisted' | 'presented' | 'terms_agreed' | 'archived' | 'collapsed';
export type ProjectScenarioPlayerDirection = 'outgoing' | 'incoming';
export type ProjectScenarioAssetType = 'pick' | 'cash' | 'rights' | 'exception' | 'other';
export type ProjectScenarioValidationKind = 'app_advisory' | 'trade_builder' | 'internal_cap_sheet' | 'cba';
export type ProjectScenarioValidationStatus = 'not_run' | 'pass' | 'warning' | 'fail' | 'source_needed' | 'manual_pending';
export type ProjectArtifactType =
  | 'trade_builder_report'
  | 'internal_cap_sheet'
  | 'source_brief'
  | 'scout_intel'
  | 'performance_intel'
  | 'slack_note'
  | 'email_note'
  | 'other';
export type ProjectSalarySourceStatus = NbaCapSheetSourceStatus | 'manual';

export interface ProjectCounterpartyContext {
  apron_level: string;
  cap_room: string;
  aims: string;
  pressure: string;
  job_security: string;
  known_targets: string;
  signals: string;
}

export interface Project {
  id: string;
  user_id: string | null;
  title: string;
  question: string;
  objective: string;
  workflow_type: ProjectWorkflowType;
  subject_team_id: string;
  counterparty_team_id: string | null;
  inbound_player_id: number | null;
  trigger_summary: string;
  counterparty_context: ProjectCounterpartyContext;
  active_step: ProjectStepId;
  status: ProjectStatus;
  package_status: ProjectPackageStatus;
  source_brief_id: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectBrief {
  id: string;
  project_id: string;
  brief_id: string;
  step: ProjectStepId;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectBriefItem extends ProjectBrief {
  brief: Brief;
}

export interface ProjectWithItems extends Project {
  items: ProjectBriefItem[];
}

export interface ProjectSummary extends Project {
  linked_brief_count: number;
  task_count: number;
  completed_task_count: number;
  scenario_count: number;
  shortlisted_scenario_count: number;
}

export interface ProjectSourceBrief extends ProjectBrief {
  brief: Brief;
}

export interface ProjectStageNote {
  id: string;
  project_id: string;
  step: ProjectStepId;
  body: string;
  ai_draft: string;
  citation_refs: number[];
  created_at: string;
  updated_at: string;
}

export interface ProjectTask {
  id: string;
  project_id: string;
  step: ProjectStepId;
  label: string;
  required: boolean;
  completed_at: string | null;
  sort_order: number;
  source: ProjectTaskSource;
  created_at: string;
  updated_at: string;
}

export interface ProjectPackage {
  id: string;
  project_id: string;
  status: Exclude<ProjectPackageStatus, 'not_started'>;
  markdown: string;
  sections: ProjectPackageSection[];
  source_refs: ProjectPackageSourceRef[];
  generated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectPackageSection {
  title: string;
  body: string;
  citation_refs?: ProjectPackageSourceRef[];
}

export interface ProjectPackageSourceRef {
  brief_id?: string;
  source_ref?: number;
  label: string;
}

export interface ProjectTradeScenario {
  id: string;
  project_id: string;
  title: string;
  summary: string;
  status: ProjectTradeScenarioStatus;
  rank: number;
  participating_teams: string[];
  notes: string;
  basketball_fit: string;
  risks: string;
  phone_framing: string;
  walk_away: string;
  counter_range: string;
  validation_summary: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectScenarioPlayer {
  id: string;
  scenario_id: string;
  team_id: string;
  nba_player_id: number | null;
  player_name: string;
  direction: ProjectScenarioPlayerDirection;
  salary_amount: number | null;
  salary_source_status: ProjectSalarySourceStatus;
  manual_override: boolean;
  stats_snapshot: NbaPlayerStatRow | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectScenarioAsset {
  id: string;
  scenario_id: string;
  asset_type: ProjectScenarioAssetType;
  label: string;
  direction: ProjectScenarioPlayerDirection;
  team_id: string | null;
  amount: number | null;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectScenarioValidation {
  id: string;
  scenario_id: string;
  kind: ProjectScenarioValidationKind;
  status: ProjectScenarioValidationStatus;
  summary: string;
  details: Record<string, unknown>;
  source_refs: ProjectPackageSourceRef[];
  validated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectArtifact {
  id: string;
  project_id: string;
  scenario_id: string | null;
  artifact_type: ProjectArtifactType;
  title: string;
  url: string | null;
  notes: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ProjectTradeScenarioDetail extends ProjectTradeScenario {
  players: ProjectScenarioPlayer[];
  assets: ProjectScenarioAsset[];
  validations: ProjectScenarioValidation[];
}

export interface ProjectDetail {
  project: Project;
  source_briefs: ProjectSourceBrief[];
  stage_notes: ProjectStageNote[];
  tasks: ProjectTask[];
  scenarios: ProjectTradeScenarioDetail[];
  artifacts: ProjectArtifact[];
  latest_package: ProjectPackage | null;
}

export interface ProjectStageWarning {
  code: 'missing_stage_note' | 'required_tasks_incomplete' | 'no_linked_briefs' | 'package_not_ready';
  message: string;
  step?: ProjectStepId;
}

export interface ProjectDiagnosis {
  readiness: 'low' | 'medium' | 'high';
  summary: string;
  gaps: string[];
  next_actions: string[];
  warnings: ProjectStageWarning[];
}

// ── Monitors ────────────────────────────────────────────────────────────────
export type MonitorKind = 'rerun' | 'watch';
export type MonitorFrequency = 'hourly' | 'daily' | 'weekly';

export interface MonitorConfig {
  /** Original natural-language ask, for `watch` monitors. */
  query?: string;
  schedule?: MonitorFrequency;
  /** For `watch` monitors: which agent kind to run on each fire. */
  agent_kind?: 'research' | 'comp_set' | 'synthesize';
  /** Where alerts go. 'inline' = brief-tab badge; 'push' is reserved. */
  alert?: 'inline' | 'push';
}

export interface Monitor {
  id: string;
  brief_id: string | null;
  kind: MonitorKind;
  config: MonitorConfig;
  paused: boolean;
  last_fired: string | null;
  next_fire_at: string | null;
  alerts_count: number;
  created_at: string;
}

export interface CreateMonitorRequest {
  brief_id: string;
  kind: MonitorKind;
  config: MonitorConfig;
}

export interface CreateMonitorResponse {
  monitor: Monitor;
}

export interface ListMonitorsResponse {
  monitors: Monitor[];
}

export interface UpdateMonitorResponse {
  monitor: Monitor;
}

export interface AcknowledgeMonitorAlertsResponse {
  monitors: Monitor[];
}

// ── NFL context graph preferences ────────────────────────────────────────────
export type ContextGraphTeamId =
  | 'ARI'
  | 'ATL'
  | 'BAL'
  | 'BUF'
  | 'CAR'
  | 'CHI'
  | 'CIN'
  | 'CLE'
  | 'DAL'
  | 'DEN'
  | 'DET'
  | 'GB'
  | 'HOU'
  | 'IND'
  | 'JAX'
  | 'KC'
  | 'LAC'
  | 'LAR'
  | 'LV'
  | 'MIA'
  | 'MIN'
  | 'NE'
  | 'NO'
  | 'NYG'
  | 'NYJ'
  | 'PHI'
  | 'PIT'
  | 'SEA'
  | 'SF'
  | 'TB'
  | 'TEN'
  | 'WAS';

export type ContextGraphConfidence = 'high' | 'medium' | 'low';
export type ContextGraphSpendingPosture = 'aggressive_spender' | 'moderate' | 'conservative' | 'unknown';
export type ContextGraphTimeframe = 'contend_now' | 'contend_soon' | 'retool' | 'rebuild' | 'tank' | 'purgatory';
export type ContextGraphPriorityType = 'extension' | 'free_agency' | 'trade' | 'coaching_decision' | 'draft' | 'structural' | 'roster' | 'scheme' | 'cap_management';
export type ContextGraphPriorityTimeline = 'next_30_days' | 'this_offseason' | 'by_trade_deadline' | 'this_season' | 'next_season';
export type ContextGraphStability = 'high' | 'medium' | 'low';
export type ContextGraphPlayerFriendly = 'yes' | 'mixed' | 'no';
export type ContextGraphAnalyticsOrientation = 'heavy' | 'balanced' | 'traditional' | 'unknown';
export type ContextGraphRiskTolerance = 'aggressive' | 'moderate' | 'conservative';
export type ContextGraphSellerPosture =
  | 'buyer_hold'
  | 'selective_seller'
  | 'asset_accumulator'
  | 'cap_seller'
  | 'posture_change_only'
  | 'unknown';
export type ContextGraphRivalryType =
  | 'competitive_recent'
  | 'competitive_historical'
  | 'geographic'
  | 'personnel_grudge'
  | 'playoff_rematch'
  | 'media_manufactured'
  | 'incident_based';

export interface ContextGraphCodedDetail {
  reason_code: string;
  detail: string;
  weight: ContextGraphConfidence | string;
}

export interface ContextGraphTradeNote {
  date: string;
  summary: string;
}

export interface ContextGraphSignalValue<T extends string = string> {
  value: T;
  detail: string;
}

export interface ContextGraphPriority {
  priority: string;
  timeline: ContextGraphPriorityTimeline | string;
  type: ContextGraphPriorityType | string;
  detail: string;
  confidence: ContextGraphConfidence | string;
}

export interface ContextGraphRivalryNote {
  team_id: string;
  type: ContextGraphRivalryType | string;
  basis: string;
}

export interface ContextGraphPersonnelConnectionNote {
  person: string;
  connected_team: string;
  connection_type: string;
  detail: string;
}

export interface ContextGraphSellerPostureSignal {
  value: ContextGraphSellerPosture | string;
  confidence: ContextGraphConfidence | string;
  evidence: string;
  source: string;
}

export interface ContextGraphPositionGroupStance {
  group: string;
  stance: string;
  core_players: string[];
  movable_players: string[];
  seller_depth_notes: string;
  sell_threshold: string;
  confidence: ContextGraphConfidence | string;
  source: string;
}

export interface ContextGraphMarketPreferences {
  desired_return_types: string[];
  avoided_deal_types: string[];
  division_rivalry_friction: string;
  confidence: ContextGraphConfidence | string;
  source: string;
}

export interface ContextGraphTradeTrigger {
  trigger: string;
  implication: string;
  confidence: ContextGraphConfidence | string;
  source: string;
}

export interface ContextGraphAvailabilityValidation {
  check: string;
  owner: string;
  source: string;
}

export interface ContextGraphNoTradeGuardrail {
  guardrail: string;
  confidence: ContextGraphConfidence | string;
  source: string;
}

export interface ContextGraphTradeMarketIntel {
  seller_posture: ContextGraphSellerPostureSignal;
  position_group_stance: ContextGraphPositionGroupStance[];
  market_preferences: ContextGraphMarketPreferences;
  trade_triggers: ContextGraphTradeTrigger[];
  availability_validation: ContextGraphAvailabilityValidation[];
  no_trade_guardrails: ContextGraphNoTradeGuardrail[];
}

export type ContextGraphOnboardingStatus = 'not_started' | 'in_progress' | 'completed';
export type ContextGraphOnboardingSectionId =
  | 'identity_role'
  | 'team_snapshot'
  | 'strategic_priorities'
  | 'working_style'
  | 'stakeholders_rituals'
  | 'data_trust';

export interface ContextGraphOnboardingStakeholder {
  id: string;
  name: string;
  role: string;
  decision_areas: string[];
}

export interface ContextGraphOnboardingProfile {
  schema_version: 1;
  status: ContextGraphOnboardingStatus;
  team_id: ContextGraphTeamId | string;
  team_name: string;
  started_at: string | null;
  updated_at: string | null;
  completed_at: string | null;
  skipped_sections: ContextGraphOnboardingSectionId[];
  identity: {
    role: string;
    role_other: string;
    years_in_role: string;
    decision_authority: string;
  };
  team_snapshot: {
    lifecycle: string;
    secondary_lifecycles: string[];
    cap_posture: string;
    cornerstones: string[];
    active_scenarios: string[];
    star_extension_players: string;
    rookie_scale_extension_players: string;
    trade_deadline_window: string;
    other_scenarios: string[];
  };
  strategic_priorities: {
    ninety_day_decision: string;
    ranked_priorities: string[];
    decision_types: string[];
    recent_decision_help: string;
    other_decision_types: string[];
  };
  working_style: {
    recommendation_style: string;
    claim_requirements: string[];
    risk_posture: string;
    cadence: string;
    briefing_time: string;
    briefing_timezone: string;
    channels: string[];
    slack_workspace: string;
    slack_channel: string;
    other_channels: string[];
  };
  stakeholders_rituals: {
    skipped: boolean;
    people: ContextGraphOnboardingStakeholder[];
    authority: {
      cap_contracts: string;
      basketball_ops: string;
      draft: string;
      coaching_staff: string;
    };
    rituals: string[];
    other_rituals: string[];
    fire_drill_frequency: string;
  };
  data_trust: {
    skipped: boolean;
    trust_panel_acknowledged: boolean;
    sources: string[];
    other_sources: string[];
    off_limits: string[];
    off_limits_people: string;
    off_limits_topics: string;
    integrations: string[];
    other_integrations: string[];
  };
}

export interface ContextGraphOnboardingSectionStatus {
  id: ContextGraphOnboardingSectionId;
  label: string;
  required: boolean;
  complete: boolean;
  skipped: boolean;
  missing: string[];
}

export interface ContextGraphOnboardingPriorityOption {
  id: string;
  label: string;
  detail: string;
  type: ContextGraphPriorityType | string;
  timeline: ContextGraphPriorityTimeline | string;
  source: string;
}

export interface ContextGraphOnboardingDefaults {
  recommendation_style: string;
  claim_requirements: string[];
  timezone: string;
}

export interface ContextGraphOnboardingCapContext {
  current_status: string;
  current_status_label: string;
  current_payroll_estimate: number | null;
  hard_capped: string;
  hard_cap_reason: string;
  flexibility_windows: { season: string; projected_status: string }[];
  exceptions_available: string[];
  confidence: ContextGraphConfidence | string;
  source: string;
}

export interface ContextGraphOnboardingViewModel {
  team_id: ContextGraphTeamId | string;
  team_name: string;
  profile: ContextGraphOnboardingProfile;
  inferred_cap_context: ContextGraphOnboardingCapContext;
  sections: ContextGraphOnboardingSectionStatus[];
  generated_priority_options: ContextGraphOnboardingPriorityOption[];
  defaults: ContextGraphOnboardingDefaults;
  can_complete: boolean;
  next_section: ContextGraphOnboardingSectionId | null;
  warnings: string[];
}

export interface GetContextGraphOnboardingResponse {
  onboarding: ContextGraphOnboardingViewModel;
}

export interface PatchContextGraphOnboardingRequest {
  profile: DeepPartial<ContextGraphOnboardingProfile>;
}

export interface PatchContextGraphOnboardingResponse {
  onboarding: ContextGraphOnboardingViewModel;
}

export interface CompleteContextGraphOnboardingResponse {
  onboarding: ContextGraphOnboardingViewModel;
}

export interface ResetContextGraphOnboardingResponse {
  onboarding: ContextGraphOnboardingViewModel;
}

export interface TeamContextPreferenceValues {
  ownership: {
    spending_posture: ContextGraphSpendingPosture | string;
    spending_posture_evidence: string[];
    governance_notes: string;
    recent_transitions: string;
  };
  strategic_posture: {
    timeframe: ContextGraphTimeframe | string;
    confidence: ContextGraphConfidence | string;
    derived_from: string[];
    constraints: ContextGraphCodedDetail[];
    trigger_events: string[];
    last_reviewed: string;
  };
  trade_dna: {
    frequent_partners: string[];
    preferred_deal_archetypes: string[];
    recent_significant_trades: ContextGraphTradeNote[];
    confidence: ContextGraphConfidence | string;
  };
  cultural_signals: {
    stability: ContextGraphSignalValue<ContextGraphStability | string>;
    player_friendly: ContextGraphSignalValue<ContextGraphPlayerFriendly | string>;
    analytics_orientation: ContextGraphSignalValue<ContextGraphAnalyticsOrientation | string>;
    risk_tolerance: ContextGraphSignalValue<ContextGraphRiskTolerance | string>;
    notable_traits: string[];
    rationale: string;
    confidence: ContextGraphConfidence | string;
  };
  near_term_priorities: ContextGraphPriority[];
  narrative_summary: {
    one_paragraph: string;
    three_things_to_watch: string[];
  };
  team_team_relationships: {
    rivalries: ContextGraphRivalryNote[];
    notable_personnel_connections: ContextGraphPersonnelConnectionNote[];
  };
  trade_market_intel?: ContextGraphTradeMarketIntel;
  onboarding_profile: ContextGraphOnboardingProfile;
}

export type TeamContextPreferencePatch = DeepPartial<TeamContextPreferenceValues>;

export interface TeamContextPreferenceOverride {
  updated_at: string;
  preferences: TeamContextPreferencePatch;
}

export interface TeamContextPreferencesMetadata {
  schema_version: 1;
  derived_updated_at: string | null;
  validation_report_path: string;
  overrides_path: string;
  overrides_updated_at: string | null;
}

export interface TeamContextValidationStatus {
  status: 'pass' | 'fail';
  error_count: number;
  warning_count: number;
}

export interface TeamRelationshipSummary {
  trade_partners: { team_id: string; trade_count_recent: number; last_trade_date: string | null }[];
  rivalries: { team_id: string; rivalry_type: string; basis: string }[];
  personnel_connections: { person_name: string; connected_team: string; connection_type: string }[];
  historical_pursuits: { target_name: string; year: number | string; outcome: string }[];
  incoming_pick_count: number;
  outgoing_pick_count: number;
}

export interface TeamRosterSummary {
  roster_count: number;
  pending_free_agents_count: number;
  tier_counts: Record<string, number>;
}

export interface TeamContextPreferences {
  team_id: string;
  name: string;
  conference: string;
  division: string;
  market_tier: string;
  as_of_date: string;
  last_updated: string;
  has_overrides: boolean;
  override_updated_at: string | null;
  validation: TeamContextValidationStatus;
  roster_summary: TeamRosterSummary;
  relationship_summary: TeamRelationshipSummary;
  source_preferences: TeamContextPreferenceValues;
  preferences: TeamContextPreferenceValues;
  override: TeamContextPreferencePatch | null;
}

export interface EffectiveTeamContext {
  team_id: string;
  name: string;
  metadata: TeamContextPreferencesMetadata & {
    has_overrides: boolean;
    override_updated_at: string | null;
    source_as_of_date: string;
    source_last_updated: string;
  };
  validation: TeamContextValidationStatus;
  roster_summary: TeamRosterSummary;
  relationship_summary: TeamRelationshipSummary;
  source_team: Record<string, unknown>;
  source_preferences: TeamContextPreferenceValues;
  preferences: TeamContextPreferenceValues;
  override: TeamContextPreferencePatch | null;
}

export type TeamMemoryAssessmentStatus = 'not_started' | 'draft' | 'active';
export type TeamMemoryCardKind =
  | 'player_soft_context'
  | 'pairing_context'
  | 'coach_gut_hypothesis'
  | 'roster_decision_context'
  | 'full_assessment_placeholder';
export type TeamMemorySourceType = 'private_intake' | 'edited_by_user' | 'system_placeholder';

export interface TeamMemoryPlayerSignal {
  id: string;
  player_name: string;
  role: string;
  soft_traits: string[];
  context: string;
  confidence: ContextGraphConfidence | string;
  evidence_snippet: string;
  measurable_proxies: string[];
}

export interface TeamMemoryCard {
  id: string;
  kind: TeamMemoryCardKind;
  title: string;
  body: string;
  confidence: ContextGraphConfidence | string;
  evidence_snippet: string;
  source_type: TeamMemorySourceType;
  player_names: string[];
  tags: string[];
  measurable_proxies: string[];
  updated_at: string;
}

export interface TeamMemoryProfile {
  schema_version: 1;
  team_id: string;
  team_name: string;
  status: TeamMemoryAssessmentStatus;
  created_at: string;
  updated_at: string;
  source_label: string;
  privacy_note: string;
  summary: string;
  cards: TeamMemoryCard[];
  player_signals: TeamMemoryPlayerSignal[];
  completed_sections: string[];
  deferred_sections: string[];
}

export interface TeamMemoryTraceSummary {
  status: TeamMemoryAssessmentStatus;
  updated_at: string | null;
  card_count: number;
  player_signal_count: number;
  summary: string;
  snippets: string[];
}

export interface TeamMemoryIntakeRequest {
  input: string;
}

export interface TeamMemoryIntakeResponse {
  profile: TeamMemoryProfile;
  discarded_raw_input_chars: number;
  warnings: string[];
}

export type TeamMemoryInterviewStage = 'player' | 'pairing' | 'decision' | 'room_belief';

export interface TeamMemoryInterviewSelection {
  id: string;
  stage: TeamMemoryInterviewStage;
  label: string;
  detail: string;
  source: 'war_room' | 'saved_memory' | 'generated_option' | 'user';
  player_names: string[];
  tags: string[];
}

export interface TeamMemoryGeneratedOption {
  id: string;
  stage: TeamMemoryInterviewStage;
  title: string;
  body: string;
  confidence: ContextGraphConfidence | string;
  player_names: string[];
  tags: string[];
  measurable_proxies: string[];
  caveat: string;
  follow_up_questions: string[];
}

export interface TeamMemoryOptionsRequest {
  stage: TeamMemoryInterviewStage;
  selections: TeamMemoryInterviewSelection[];
  traits: string[];
  accepted_options: TeamMemoryGeneratedOption[];
  note?: string;
}

export interface TeamMemoryOptionsResponse {
  options: TeamMemoryGeneratedOption[];
  follow_up_questions: string[];
  warnings: string[];
}

export interface GetTeamMemoryResponse {
  profile: TeamMemoryProfile | null;
}

export interface UpdateTeamMemoryRequest {
  profile: TeamMemoryProfile;
}

export interface UpdateTeamMemoryResponse {
  profile: TeamMemoryProfile;
}

export interface DeleteTeamMemoryResponse {
  profile: null;
}

export interface ContextGraphPreferenceVocab {
  team_ids: string[];
  spending_posture: string[];
  timeframe: string[];
  confidence: string[];
  priority_type: string[];
  priority_timeline: string[];
  stability: string[];
  player_friendly: string[];
  analytics_orientation: string[];
  risk_tolerance: string[];
  rivalry_type: string[];
  seller_posture: string[];
}

export interface ListContextGraphPreferencesResponse {
  metadata: TeamContextPreferencesMetadata;
  teams: TeamContextPreferences[];
  vocab: ContextGraphPreferenceVocab;
}

export interface ContextGraphTraceTeam {
  team_id: string;
  name: string;
  validation_status: 'pass' | 'fail';
  validation_error_count: number;
  validation_warning_count: number;
  has_overrides: boolean;
  source_as_of_date: string;
  source_last_updated: string;
  override_updated_at: string | null;
  derived_updated_at: string | null;
  onboarding_status?: ContextGraphOnboardingStatus;
  onboarding_updated_at?: string | null;
  onboarding_priority_count?: number;
  private_memory?: TeamMemoryTraceSummary | null;
}

export interface ContextGraphTrace {
  tool_use_id: string;
  tool_name: 'lookup_context_graph_teams';
  teams: ContextGraphTraceTeam[];
  errors: { team_id: string; error: string }[];
}

export interface DataAnalystTraceDataset {
  dataset_id: string;
  label: string;
  as_of_date: string | null;
  source_name: string | null;
  team_ids: string[];
  row_count: number;
}

export interface DataAnalystTrace {
  tool_use_id: string;
  tool_name: 'list_available_datasets' | 'query_nba_data' | 'query_nfl_data' | 'query_brief_workspace';
  datasets: DataAnalystTraceDataset[];
  errors: { scope: string; error: string }[];
}

export type ContextGraphWarRoomTier = 'hot' | 'warm' | 'watch';
export type ContextGraphWarRoomEdgeType = 'trade_partner' | 'personnel' | 'rivalry' | 'pick' | 'pursuit';

export interface ContextGraphWarRoomCounterparty {
  team_id: string;
  name: string;
  score: number;
  tier: ContextGraphWarRoomTier;
  reasons: string[];
  relationship_types: ContextGraphWarRoomEdgeType[];
  dossier: {
    call_priority: string;
    likely_trade_lane: string;
    opening_question: string;
    leverage_notes: string[];
    risks: string[];
  };
  validation: TeamContextValidationStatus;
  has_overrides: boolean;
  override_updated_at: string | null;
  posture: string;
  spending_posture: string;
  trade_count_recent: number;
  last_trade_date: string | null;
}

export interface ContextGraphWarRoomRosterPressure {
  player_id: string;
  name: string;
  tier: string;
  movement_status: string;
  availability_status: string;
  trajectory: string;
  years_remaining: number | string | null;
  contract_leverage: string;
  pressure_score: number;
  action: 'protect' | 'monitor' | 'market' | 'decision';
  rationale: string[];
}

export interface ContextGraphWarRoomTension {
  title: string;
  severity: 'high' | 'medium' | 'low';
  signal: string;
  why_it_matters: string;
  winger_question: string;
}

export interface ContextGraphWarRoomScenarioLens {
  id: string;
  label: string;
  stance: string;
  focus: string[];
  prompt: string;
  team_ids: string[];
}

export interface ContextGraphWarRoomDecisionCard {
  title: string;
  signal: string;
  recommendation: string;
  action: string;
  severity: 'high' | 'medium' | 'low';
}

export interface ContextGraphWarRoomTopCall {
  team_id: string;
  name: string;
  priority: string;
  trade_lane: string;
  opening_question: string;
  score: number;
  tier: ContextGraphWarRoomTier;
  caveats: string[];
}

export interface ContextGraphWarRoomConfidence {
  status: 'high' | 'medium' | 'low';
  label: string;
  detail: string;
  source_as_of_date: string;
  source_last_updated: string;
  has_overrides: boolean;
  validation_status: 'pass' | 'fail';
}

export interface ContextGraphWarRoomExecutiveSummary {
  headline: string;
  recommended_posture: string;
  decision_cards: ContextGraphWarRoomDecisionCard[];
  top_calls: ContextGraphWarRoomTopCall[];
  confidence: ContextGraphWarRoomConfidence;
  caveats: string[];
}

export interface ContextGraphWarRoomNode {
  team_id: string;
  name: string;
  kind: 'subject' | 'counterparty';
  tier: ContextGraphWarRoomTier | 'subject';
  validation_status: 'pass' | 'fail';
  has_overrides: boolean;
}

export interface ContextGraphWarRoomEdge {
  id: string;
  type: ContextGraphWarRoomEdgeType;
  from_team_id: string;
  to_team_id: string;
  label: string;
  detail: string;
}

export interface ContextGraphWarRoomDemoPrompt {
  title: string;
  angle: string;
  prompt: string;
}

export interface ContextGraphWarRoomResponse {
  metadata: TeamContextPreferencesMetadata;
  subject: TeamContextPreferences;
  executive_summary: ContextGraphWarRoomExecutiveSummary;
  counterparties: ContextGraphWarRoomCounterparty[];
  roster_pressure: ContextGraphWarRoomRosterPressure[];
  strategic_tensions: ContextGraphWarRoomTension[];
  scenario_lenses: ContextGraphWarRoomScenarioLens[];
  graph: {
    nodes: ContextGraphWarRoomNode[];
    edges: ContextGraphWarRoomEdge[];
  };
  demo_prompts: ContextGraphWarRoomDemoPrompt[];
}

export interface UpdateTeamContextPreferencesRequest {
  preferences: TeamContextPreferencePatch;
}

export interface UpdateTeamContextPreferencesResponse {
  team: TeamContextPreferences;
  metadata: TeamContextPreferencesMetadata;
}

export interface ResetTeamContextPreferencesResponse {
  team: TeamContextPreferences;
  metadata: TeamContextPreferencesMetadata;
}

type DeepPartial<T> = T extends (infer U)[]
  ? DeepPartial<U>[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

// ── NBA roster database ────────────────────────────────────────────────────
export interface NbaTeam {
  team_id: string;
  nba_team_id: number;
  abbreviation: string;
  city: string;
  name: string;
  full_name: string;
  conference: string | null;
  division: string | null;
}

export interface NbaPlayer {
  nba_player_id: number;
  slug: string | null;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  height: string | null;
  weight_lbs: number | null;
  last_attended: string | null;
  country: string | null;
  jersey_number: string | null;
  source_url: string | null;
  source_row: Record<string, unknown>;
}

export interface NbaRosterSnapshot {
  id: string;
  season: string;
  as_of_date: string;
  source_name: string;
  source_url: string;
  retrieved_at: string;
  team_count: number;
  player_count: number;
  notes: string | null;
  source_meta: Record<string, unknown>;
}

export interface NbaPlayerStatSnapshot {
  id: string;
  season: string;
  season_type: string;
  as_of_date: string;
  source_name: string;
  source_url: string;
  retrieved_at: string;
  team_count: number;
  row_count: number;
  matched_player_count: number;
  unmatched_player_count: number;
  notes: { label: string; value: string | null }[];
  glossary: Record<string, string>;
  source_meta: Record<string, unknown>;
}

export interface NbaPlayerStatRow {
  team_id: string;
  nba_player_id: number | null;
  player_name: string;
  player_name_normalized: string;
  source_order: number;
  position: string | null;
  age: number;
  games_played: number;
  minutes: number;
  points_per_game: number;
  rebounds_per_game: number;
  assists_per_game: number;
  true_shooting_pct: number;
  effective_fg_pct: number;
  usage_pct: number;
  three_point_attempt_rate: number;
  free_throw_rate: number;
  offensive_rebound_pct: number;
  defensive_rebound_pct: number;
  rebound_pct: number;
  assist_pct: number;
  turnover_pct: number;
  offensive_rating: number;
  defensive_rating: number;
  net_rating: number;
  player_impact_estimate: number;
  defensive_win_shares: number;
  match_status: 'roster-matched' | 'stats-only';
  source_row: Record<string, unknown>;
}

export interface NbaPlayerStatTeamSummary {
  snapshot_id: string;
  season: string;
  season_type: string;
  as_of_date: string;
  source_name: string;
  source_url: string;
  retrieved_at: string;
  team: NbaTeam;
  stat_row_count: number;
  matched_player_count: number;
  stats_only_count: number;
  top_net_rating_player: string | null;
  top_net_rating: number | null;
  top_pie_player: string | null;
  top_pie: number | null;
}

export interface NbaPlayerStatTeamDetail {
  summary: NbaPlayerStatTeamSummary;
  rows: NbaPlayerStatRow[];
}

export interface ListCurrentNbaPlayerStatsResponse {
  snapshot: NbaPlayerStatSnapshot | null;
  teams: NbaPlayerStatTeamSummary[];
  totals: {
    team_count: number;
    player_stat_row_count: number;
    matched_player_count: number;
    stats_only_count: number;
  };
}

export interface GetCurrentNbaPlayerStatsTeamResponse {
  snapshot: NbaPlayerStatSnapshot | null;
  team: NbaPlayerStatTeamDetail | null;
}

export interface NbaRosterEntry {
  snapshot_id: string;
  team_id: string;
  nba_player_id: number;
  season: string;
  source_order: number;
  jersey_number: string | null;
  position: string | null;
  height: string | null;
  weight_lbs: number | null;
  last_attended: string | null;
  country: string | null;
  source_url: string | null;
  source_row: Record<string, unknown>;
  player: NbaPlayer;
  stats?: NbaPlayerStatRow | null;
}

export interface NbaRosterTeam {
  team: NbaTeam;
  official_roster_count: number;
  players: NbaRosterEntry[];
}

export interface ListCurrentNbaRostersResponse {
  snapshot: NbaRosterSnapshot | null;
  teams: NbaRosterTeam[];
  totals: {
    team_count: number;
    player_count: number;
  };
}

// ── NBA cap sheet database ──────────────────────────────────────────────────
export type NbaCapSheetSourceStatus = 'captured' | 'source-needed' | 'not-available' | 'not-applicable';

export interface NbaCapSheetSnapshot {
  id: string;
  season: string;
  as_of_date: string;
  source_name: string;
  source_url: string;
  retrieved_at: string;
  team_count: number;
  notes: string | null;
  source_meta: Record<string, unknown>;
}

export interface NbaCapSheetSourceRef {
  name: string;
  url: string | null;
  source_type: 'public_page' | 'reviewed_snapshot' | 'local_context_graph' | 'attached_example' | 'source-needed';
  retrieved_at: string | null;
  terms_status: 'reviewed' | 'restricted' | 'unknown' | 'not-applicable';
  robots_status: 'allowed' | 'blocked' | 'unknown' | 'not-applicable';
  notes: string[];
}

export interface NbaCapSheetMetric {
  key: string;
  label: string;
  value: string;
  amount: number | null;
  source_status: NbaCapSheetSourceStatus;
  source_url: string | null;
  note: string | null;
}

export interface NbaCapSheetSalaryCell {
  season: string;
  amount: number | null;
  label: string | null;
  option_type: string | null;
  is_guaranteed: boolean | null;
  source_status: NbaCapSheetSourceStatus;
  source_url: string | null;
  source_data: Record<string, unknown>;
}

export interface NbaCapSheetPlayerRow {
  id: string;
  nba_player_id: number | null;
  player_name: string;
  source_order: number;
  position: string | null;
  age: number | null;
  dob: string | null;
  yos: string | null;
  roster_status: string | null;
  fa_status: string | null;
  fa_year: string | null;
  bird_rights: string | null;
  restrictions: string[];
  how_acquired: string | null;
  agent: string | null;
  total_amount: number | null;
  source_status: 'captured' | 'source-needed' | 'not-available';
  source_url: string | null;
  source_data: Record<string, unknown>;
  salary_cells: NbaCapSheetSalaryCell[];
  stats?: NbaPlayerStatRow | null;
}

export interface NbaCapSheetSection {
  key: string;
  title: string;
  source_status: NbaCapSheetSourceStatus;
  source_url: string | null;
  notes: string[];
  rows: Record<string, unknown>[];
}

export interface NbaCapSheetTeamSummary {
  snapshot_id: string;
  season: string;
  as_of_date: string;
  source_name: string;
  source_url: string;
  retrieved_at: string;
  team: NbaTeam;
  official_roster_count: number;
  cap_status: string;
  tax_status: string;
  apron_status: string;
  payroll_amount: number | null;
  source_status: 'captured' | 'source-needed' | 'not-available';
  missing_sections: string[];
  missing_section_count: number;
  source_refs: NbaCapSheetSourceRef[];
}

export interface NbaCapSheet {
  summary: NbaCapSheetTeamSummary;
  source_refs: NbaCapSheetSourceRef[];
  metrics: NbaCapSheetMetric[];
  player_rows: NbaCapSheetPlayerRow[];
  player_stats: NbaPlayerStatRow[];
  sections: NbaCapSheetSection[];
  roster: NbaRosterTeam | null;
}

export interface ListCurrentNbaCapSheetsResponse {
  snapshot: NbaCapSheetSnapshot | null;
  teams: NbaCapSheetTeamSummary[];
  totals: {
    team_count: number;
    player_row_count: number;
    source_needed_section_count: number;
  };
}

export interface GetCurrentNbaCapSheetResponse {
  snapshot: NbaCapSheetSnapshot | null;
  cap_sheet: NbaCapSheet | null;
}

// ── NFL static demo database ─────────────────────────────────────────────────
export interface NflDemoSnapshot {
  season: string;
  as_of_date: string;
  source_name: string;
  source_url: string;
  retrieved_at: string;
  notes: string[];
}

export interface NflDemoTeam {
  team_id: string;
  abbreviation: string;
  full_name: string;
  conference: string | null;
  division: string | null;
  source_url: string | null;
}

export interface NflRosterEntry {
  team_id: string;
  player_id: string;
  player_name: string;
  position: string | null;
  age: number | null;
  roster_status: string;
  contract_status: string;
  source_order: number;
  source_url: string | null;
  source_note: string;
  jersey_number?: string | null;
  height_inches?: number | null;
  weight_lbs?: number | null;
  experience?: string | null;
  college?: string | null;
}

export interface NflCapRow {
  team_id: string;
  player_id: string | null;
  player_name: string;
  position: string | null;
  cap_number_2026: number | null;
  cash_due_2026: number | null;
  total_value_remaining: number | null;
  years_remaining: number | null;
  contract_end_year: number | null;
  contract_years_remaining: number | null;
  void_year_count: number | null;
  void_years_source_status: string;
  guaranteed_remaining: number | null;
  dead_money_if_cut_2026: number | null;
  cut_savings_2026: number | null;
  post_june_1_dead_money_2026: number | null;
  post_june_1_cut_savings_2026: number | null;
  trade_dead_money_2026: number | null;
  trade_savings_2026: number | null;
  post_june_1_trade_dead_money_2026: number | null;
  post_june_1_trade_savings_2026: number | null;
  restructure_savings_estimate_2026: number | null;
  extension_savings_estimate_2026: number | null;
  contract_ledger_status: string;
  contract_ledger_confidence: string;
  tag_eligible_2027: boolean;
  contract_lever: string;
  source_url: string | null;
  source_status: string;
  source_order?: number;
  source_note?: string;
  source_data?: Record<string, unknown>;
}

export interface NflPlayerMetricRow {
  team_id: string;
  player_id: string;
  player_name: string;
  position: string | null;
  snaps_2025: number | null;
  offense_snaps_2025?: number | null;
  defense_snaps_2025?: number | null;
  special_teams_snaps_2025?: number | null;
  snap_share_2025?: number | null;
  games_2025: number | null;
  starts_2025?: number | null;
  passing_yards_2025?: number | null;
  rushing_yards_2025?: number | null;
  receiving_yards_2025?: number | null;
  scrimmage_yards_2025?: number | null;
  tackles_2025?: number | null;
  sacks_2025?: number | null;
  interceptions_2025?: number | null;
  touchdowns_2025?: number | null;
  availability_risk: string;
  role: string;
  value_tier: string;
  metric_note: string;
  metric_source_family?: string | null;
  metric_gap_reason?: string | null;
  metric_coverage_level?: 'strong' | 'directional' | 'gap';
  metric_confidence?: 'captured' | 'derived' | 'source-needed';
  metric_families?: string[];
  position_metric_summary?: string | null;
  position_metrics?: Record<string, unknown>;
  quality_flags?: string[];
  source_url: string | null;
  source_status?: string;
  source_data?: Record<string, unknown>;
}

export interface NflSourceRef {
  id: string;
  name: string;
  url: string;
}

export interface NflDemoTotals {
  season: string;
  as_of_date: string;
  team_count: number;
  roster_row_count: number;
  cap_row_count: number;
  player_metric_row_count: number;
  source_needed_cap_row_count?: number;
}

export interface NflTeamListRow extends NflDemoTeam {
  roster_count: number;
  cap_row_count: number;
  player_metric_row_count: number;
  source_needed_cap_row_count?: number;
}

export interface ListCurrentNflDemoResponse {
  snapshot: NflDemoSnapshot;
  teams: NflTeamListRow[];
  totals: NflDemoTotals;
  rows: NflRosterEntry[] | NflCapRow[] | NflPlayerMetricRow[];
  source_mode?: NflCoverageSourceMode;
  fallback_reason?: string | null;
}

export interface GetCurrentNflTeamResponse {
  snapshot: NflDemoSnapshot;
  team: NflDemoTeam;
  roster_entries: NflRosterEntry[];
  cap_rows: NflCapRow[];
  player_metrics: NflPlayerMetricRow[];
  source_refs: NflSourceRef[];
  notes: string[];
  source_mode?: NflCoverageSourceMode;
  fallback_reason?: string | null;
}

export interface GetCurrentNflPlayerMetricsTeamResponse {
  snapshot: NflDemoSnapshot;
  team: NflDemoTeam;
  rows: NflPlayerMetricRow[];
  source_refs: NflSourceRef[];
  notes: string[];
  source_mode?: NflCoverageSourceMode;
  fallback_reason?: string | null;
}

// ── NFL coverage matrix ─────────────────────────────────────────────────────
export type NflCoverageStatus = 'strong' | 'directional' | 'weak' | 'blocked';
export type NflCoverageDomain = 'roster' | 'cap_contracts' | 'player_metrics' | 'rules' | 'intel' | 'seller_thesis';
export type NflCoverageReadinessKey =
  | 'roster_cap_audit'
  | 'cut_restructure'
  | 'trade_outgoing'
  | 'seller_trade'
  | 'player_quality'
  | 'rules_question';
export type NflCoverageSourceMode = 'supabase_current_views' | 'checked_in_snapshot' | 'checked_in_snapshot_fallback';

export interface NflCoverageGap {
  key: string;
  label: string;
  severity: NflCoverageStatus;
  detail: string;
  affected_count?: number;
  affected_players?: string[];
}

export interface NflCoverageSourceRef {
  id: string;
  name: string;
  url: string | null;
  source_type: 'app_data' | 'rules' | 'context_graph' | 'fallback' | 'derived';
  as_of_date: string | null;
  notes: string[];
}

export interface NflCoverageDomainSummary {
  domain: NflCoverageDomain;
  status: NflCoverageStatus;
  score: number;
  label: string;
  detail: string;
  row_count: number;
  source_needed_count: number;
  gaps: NflCoverageGap[];
}

export interface NflCoveragePositionGroupSummary {
  group: string;
  status: NflCoverageStatus;
  roster_count: number;
  cap_row_count: number;
  player_metric_row_count: number;
  total_cap_number_2026: number;
  source_needed_cap_count: number;
  contract_field_count: number;
  contract_field_total: number;
  metric_source_status: 'captured' | 'roster-derived' | 'source-needed' | 'mixed' | 'missing';
  seller_thesis_status: NflCoverageStatus;
  top_gaps: NflCoverageGap[];
}

export interface NflCoverageQuestionReadiness {
  key: NflCoverageReadinessKey;
  status: NflCoverageStatus;
  label: string;
  detail: string;
  required_domains: NflCoverageDomain[];
  gaps: NflCoverageGap[];
}

export interface NflCoverageTeamRow extends NflDemoTeam {
  status: NflCoverageStatus;
  roster_count: number;
  cap_row_count: number;
  player_metric_row_count: number;
  source_needed_cap_row_count: number;
  contract_field_coverage: {
    rows_with_years: number;
    rows_with_dead_cut: number;
    rows_with_post_june: number;
    rows_with_trade: number;
    total_player_cap_rows: number;
  };
  domains: NflCoverageDomainSummary[];
  position_groups: NflCoveragePositionGroupSummary[];
  readiness: NflCoverageQuestionReadiness[];
  top_gaps: NflCoverageGap[];
  graph_roster_count: number;
  trade_market_intel_group_count: number;
}

export interface NflCoverageMatrixResponse {
  snapshot: NflDemoSnapshot;
  source_mode: NflCoverageSourceMode;
  fallback_reason: string | null;
  generated_at: string;
  league: {
    status: NflCoverageStatus;
    team_count: number;
    roster_row_count: number;
    cap_row_count: number;
    player_metric_row_count: number;
    source_needed_cap_row_count: number;
    contract_field_coverage: {
      rows_with_years: number;
      rows_with_dead_cut: number;
      rows_with_post_june: number;
      rows_with_trade: number;
      total_player_cap_rows: number;
    };
    rules_status: NflCoverageStatus;
    intel_status: NflCoverageStatus;
    seller_thesis_team_count: number;
  };
  teams: NflCoverageTeamRow[];
  rules: NflCoverageDomainSummary;
  sources: NflCoverageSourceRef[];
}

export interface GetCurrentNflCoverageTeamResponse extends NflCoverageMatrixResponse {
  team: NflCoverageTeamRow | null;
}

// ── CBA reference corpus ────────────────────────────────────────────────────
export interface CbaDocument {
  id: string;
  title: string;
  source_url: string;
  effective_date: string;
  season_label: string;
  page_count: number;
}

export interface CbaArticle {
  id: string;
  label: string;
  body: string;
  document_id?: string | null;
  article?: string | null;
  section?: string | null;
  section_number?: string | null;
  page_start?: number | null;
  page_end?: number | null;
  sort_key?: number | null;
  aliases?: string[] | null;
  source_url?: string | null;
}

export interface CbaSection extends CbaArticle {
  document_id: string;
  article: string;
  section: string | null;
  section_number: string | null;
  page_start: number | null;
  page_end: number | null;
  sort_key: number;
  aliases: string[];
  source_url: string;
  snippet?: string | null;
  match_terms?: string[];
}

export interface CbaChunk {
  id: string;
  article_id: string;
  chunk_index: number;
  body: string;
  page_start: number | null;
  page_end: number | null;
}

export interface CbaCitation {
  article_id: string;
  chunk_id: string | null;
  label: string;
  page_start: number | null;
  page_end: number | null;
  quote: string;
}

export type CbaSearchMatchKind =
  | 'selected_chunk'
  | 'active_section'
  | 'heading'
  | 'exact_phrase'
  | 'metadata'
  | 'body';

export type CbaSupportLevel = 'strong' | 'medium' | 'weak';

export interface CbaSearchContextPayload {
  article_id: string;
  chunk_id: string;
  label: string;
  page_start: number | null;
  page_end: number | null;
  quote: string;
  score: number;
  match_kind: CbaSearchMatchKind;
  support_level: CbaSupportLevel;
}

export interface CbaTocResponse {
  document: CbaDocument | null;
  sections: CbaSection[];
}

export interface CbaSearchResponse {
  query: string;
  sections: CbaSection[];
}

export interface CbaArticleResponse {
  section: CbaSection;
  chunks: CbaChunk[];
}

export interface CbaChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CbaChatRequest {
  message: string;
  activeArticleId?: string | null;
  selectedChunkId?: string | null;
  history?: CbaChatMessage[];
}

export type CbaChatStreamEvent =
  | { type: 'context'; sections: CbaSection[]; citations: CbaCitation[]; contexts?: CbaSearchContextPayload[] }
  | { type: 'citation'; citation: CbaCitation }
  | { type: 'navigate'; article_id: string; chunk_id: string | null }
  | { type: 'boundary'; reason: string; action: 'open_analyze'; question: string }
  | { type: 'token'; text: string }
  | { type: 'error'; message: string; recoverable: boolean }
  | { type: 'done' };

// ── Claude tool-use payloads ────────────────────────────────────────────────
// These are the shapes Claude returns and our server consumes.

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  context_graph_trace?: ContextGraphTrace;
  data_analyst_trace?: DataAnalystTrace;
}

// Initial-brief generator: Claude calls this exactly once with the structured payload.
// The shape is the brief's renderable content + the per-brief options/sources.
export type SubmitBriefOption = Omit<BriefOption, 'id' | 'brief_id' | 'details'> & {
  details: BriefOptionDetails;
};

export interface SubmitBriefInput {
  /** One-line working thesis/current lean, displayed as the headline. */
  thesis: string;
  /** Body paragraphs of reasoning, assumptions, and tradeoffs. Use `[N]` markers to cite options/sources by ref_index. */
  reasoning: string;
  /** Optional CBA quote with attribution. */
  blockquote?: {
    text: string;
    source: string;
    cite_ref?: number;
  };
  /** 2-4 watch-points displayed in the "What I'm watching" grid. */
  watching: { tag: string; body: string }[];
  next_questions?: RecommendationNextQuestionGroup[];
  presentation?: BriefPresentation;
  /** Required strategic option rows that feed the shared Strategic options table. */
  options: SubmitBriefOption[];
  sources: Omit<BriefSource, 'id' | 'brief_id'>[];
}

export interface SubmitDataAnalysisInput {
  answer: string;
  key_findings: DataAnalysisFinding[];
  tables: DataAnalysisTable[];
  calculations: DataAnalysisCalculation[];
  sources: Omit<BriefSource, 'id' | 'brief_id'>[];
  caveats: string[];
  followups: string[];
}

// Lookup CBA article body inline during chat.
export interface LookupCbaInput {
  article_id: string;
}

// Run an agent (dispatches to /agent/run from inside chat tool-use).
export interface RunAgentInput {
  kind: AgentKind;
  brief_id: string;
  config: Record<string, unknown>;
}

// ── Streaming chat events (SSE wire format) ─────────────────────────────────
// Server emits these to the browser. Client decodes them in api/chat.ts.
export type ChatStreamEvent =
  | { type: 'turn_start'; turn_id: string }
  | { type: 'token'; text: string }
  | { type: 'tool_use'; tool: ToolCall }
  | { type: 'tool_result'; tool_use_id: string; result: unknown }
  | { type: 'turn_end'; turn_id: string }
  | { type: 'error'; message: string; recoverable: boolean };

// ── HTTP request/response shapes ────────────────────────────────────────────
export interface CreateBriefRequest {
  session_id: string;
  question: string;
  mode?: BriefMode;
  template?: BriefTemplateSelection | BriefTemplateId;
}

export interface CreateBriefResponse {
  brief: Brief;
}

export interface RegenerateBriefRequest {
  template?: BriefTemplateSelection | BriefTemplateId;
}

export interface ListProjectsResponse {
  projects: ProjectSummary[];
}

export interface CreateProjectRequest {
  title: string;
  question: string;
  objective: string;
  workflow_type?: ProjectWorkflowType;
  subject_team_id?: string;
  counterparty_team_id?: string | null;
  inbound_player_id?: number | null;
  trigger_summary?: string;
  counterparty_context?: Partial<ProjectCounterpartyContext>;
  source_brief_id?: string | null;
}

export interface CreateProjectResponse {
  project: ProjectDetail;
}

export interface AttachProjectBriefRequest {
  brief_id: string;
}

export interface AttachProjectBriefResponse {
  project: ProjectDetail;
  project_brief: ProjectSourceBrief;
  already_attached: boolean;
}

export interface MoveProjectBriefRequest {
  step: ProjectStepId;
}

export interface MoveProjectBriefResponse {
  project: ProjectDetail;
  project_brief: ProjectSourceBrief;
}

export interface GetProjectResponse {
  project: ProjectDetail;
}

export interface UpdateProjectRequest {
  title?: string;
  question?: string;
  objective?: string;
  workflow_type?: ProjectWorkflowType;
  subject_team_id?: string;
  counterparty_team_id?: string | null;
  inbound_player_id?: number | null;
  trigger_summary?: string;
  counterparty_context?: Partial<ProjectCounterpartyContext>;
  active_step?: ProjectStepId;
  status?: ProjectStatus;
}

export interface UpdateProjectResponse {
  project: ProjectDetail;
}

export interface UpdateProjectStageNoteRequest {
  body: string;
}

export interface UpdateProjectStageNoteResponse {
  project: ProjectDetail;
  note: ProjectStageNote;
}

export interface CreateProjectTaskRequest {
  step: ProjectStepId;
  label: string;
  required?: boolean;
  sort_order?: number;
}

export interface ProjectTaskResponse {
  project: ProjectDetail;
  task: ProjectTask;
}

export interface DeleteProjectTaskResponse {
  project: ProjectDetail;
}

export interface UpdateProjectTaskRequest {
  label?: string;
  completed?: boolean;
}

export interface AdvanceProjectRequest {
  step: ProjectStepId;
}

export interface AdvanceProjectResponse {
  project: ProjectDetail;
  warnings: ProjectStageWarning[];
}

export interface DiagnoseProjectResponse {
  diagnosis: ProjectDiagnosis;
}

export interface GenerateProjectPackageResponse {
  project: ProjectDetail;
  package: ProjectPackage;
}

export interface CreateProjectTradeScenarioRequest {
  title: string;
  summary?: string;
  status?: ProjectTradeScenarioStatus;
  rank?: number;
  participating_teams?: string[];
}

export interface UpdateProjectTradeScenarioRequest {
  title?: string;
  summary?: string;
  status?: ProjectTradeScenarioStatus;
  rank?: number;
  participating_teams?: string[];
  notes?: string;
  basketball_fit?: string;
  risks?: string;
  phone_framing?: string;
  walk_away?: string;
  counter_range?: string;
  validation_summary?: string;
}

export interface ProjectTradeScenarioResponse {
  project: ProjectDetail;
  scenario: ProjectTradeScenarioDetail;
}

export interface DuplicateProjectTradeScenarioResponse {
  project: ProjectDetail;
  scenario: ProjectTradeScenarioDetail;
}

export interface CreateProjectScenarioPlayerRequest {
  team_id: string;
  nba_player_id?: number | null;
  player_name: string;
  direction: ProjectScenarioPlayerDirection;
  salary_amount?: number | null;
  salary_source_status?: ProjectSalarySourceStatus;
  manual_override?: boolean;
  stats_snapshot?: NbaPlayerStatRow | null;
}

export interface UpdateProjectScenarioPlayerRequest {
  player_name?: string;
  direction?: ProjectScenarioPlayerDirection;
  salary_amount?: number | null;
  salary_source_status?: ProjectSalarySourceStatus;
  manual_override?: boolean;
  stats_snapshot?: NbaPlayerStatRow | null;
}

export interface ProjectScenarioPlayerResponse {
  project: ProjectDetail;
  scenario: ProjectTradeScenarioDetail;
  player: ProjectScenarioPlayer;
}

export interface DeleteProjectScenarioPlayerResponse {
  project: ProjectDetail;
}

export interface CreateProjectScenarioAssetRequest {
  asset_type: ProjectScenarioAssetType;
  label: string;
  direction: ProjectScenarioPlayerDirection;
  team_id?: string | null;
  amount?: number | null;
  notes?: string;
}

export interface UpdateProjectScenarioAssetRequest {
  asset_type?: ProjectScenarioAssetType;
  label?: string;
  direction?: ProjectScenarioPlayerDirection;
  team_id?: string | null;
  amount?: number | null;
  notes?: string;
}

export interface ProjectScenarioAssetResponse {
  project: ProjectDetail;
  scenario: ProjectTradeScenarioDetail;
  asset: ProjectScenarioAsset;
}

export interface DeleteProjectScenarioAssetResponse {
  project: ProjectDetail;
}

export interface UpdateProjectScenarioValidationRequest {
  status: ProjectScenarioValidationStatus;
  summary?: string;
  details?: Record<string, unknown>;
}

export interface ProjectScenarioValidationResponse {
  project: ProjectDetail;
  scenario: ProjectTradeScenarioDetail;
  validation: ProjectScenarioValidation;
}

export interface ValidateProjectScenarioResponse {
  project: ProjectDetail;
  scenario: ProjectTradeScenarioDetail;
  validation: ProjectScenarioValidation;
}

export interface CreateProjectArtifactRequest {
  scenario_id?: string | null;
  artifact_type: ProjectArtifactType;
  title: string;
  url?: string | null;
  notes?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateProjectArtifactRequest {
  scenario_id?: string | null;
  artifact_type?: ProjectArtifactType;
  title?: string;
  url?: string | null;
  notes?: string;
  metadata?: Record<string, unknown>;
}

export interface ProjectArtifactResponse {
  project: ProjectDetail;
  artifact: ProjectArtifact;
}

export interface DeleteProjectArtifactResponse {
  project: ProjectDetail;
}

export interface ListBriefTemplatesResponse {
  curated_templates: BriefTemplateDefinition[];
  saved_templates: SavedBriefTemplate[];
}

export interface CreateSavedBriefTemplateRequest {
  name: string;
  base_template_id: BriefTemplateId;
  instructions: string;
}

export interface CreateSavedBriefTemplateResponse {
  template: SavedBriefTemplate;
}

export interface RunAgentRequest {
  brief_id: string;
  kind: AgentKind;
  config: Record<string, unknown>;
}

export interface RunAgentResponse {
  run_id: string;
}
