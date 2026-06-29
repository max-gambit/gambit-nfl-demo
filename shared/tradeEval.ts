export const TRADE_EVAL_SCHEMA_VERSION = 1;
export const TRADE_EVAL_CORPUS_ID = 'nba-trade-corpus-v0';

export const TRADE_EVAL_PROMPT_TYPES = [
  'legality',
  'diagnosis',
  'repair',
  'decision_support',
] as const;

export type TradeEvalPromptType = typeof TRADE_EVAL_PROMPT_TYPES[number];

export const TRADE_EVAL_RULE_TAGS = [
  'salary_matching',
  'second_apron',
  'hard_cap',
  'sign_and_trade',
  'trade_exception',
  'multi_team',
  'clean_control',
  'source_needed',
] as const;

export type TradeEvalRuleTag = typeof TRADE_EVAL_RULE_TAGS[number];

export type TradeEvalLegality = 'legal' | 'illegal' | 'uncertain' | 'source_needed';
export type TradeEvalLabelStatus = 'unlabeled' | 'manual_pending' | 'labeled' | 'source_needed';
export type TradeEvalLabelConfidence = 'realgm' | 'human_reviewed' | 'heuristic' | 'source_gap' | 'unverified';
export type TradeEvalSourceBehavior = 'cite_current_cap_cba' | 'refuse_without_source' | 'realgm_or_internal_oracle' | 'state_uncertainty';
export type TradeEvalAssetKind = 'player' | 'pick' | 'cash' | 'exception' | 'sign_and_trade_rights';
export type TradeEvalSalarySourceStatus = 'captured' | 'source-needed' | 'not-available' | 'not-applicable' | 'manual';
export type TradeEvalAnswerScoreStatus = 'pass' | 'warning' | 'fail';

export interface TradeEvalSourceDataVersion {
  season: string;
  as_of_date: string;
  source_name: string;
  source_url: string;
  retrieved_at: string;
}

export interface TradeEvalFixtureMeta {
  schema_version: typeof TRADE_EVAL_SCHEMA_VERSION;
  corpus_id: typeof TRADE_EVAL_CORPUS_ID;
  generated_at: string;
  scenario_count: number;
  prompt_count?: number;
  label_count?: number;
  source_data_version: TradeEvalSourceDataVersion;
  generation_policy: {
    subject_team_id: string;
    realgm_policy: string;
    notes: string[];
  };
}

export interface TradeEvalAsset {
  kind: TradeEvalAssetKind;
  team_id: string;
  direction: 'outgoing' | 'incoming';
  player_name?: string;
  nba_player_id?: number | null;
  salary_amount?: number | null;
  salary_source_status?: TradeEvalSalarySourceStatus;
  label: string;
  notes?: string;
}

export interface TradeEvalTeamLeg {
  team_id: string;
  sends: TradeEvalAsset[];
  receives: TradeEvalAsset[];
}

export interface TradeEvalTeamSalaryTotal {
  team_id: string;
  known_salary_out: number;
  known_salary_in: number;
  net_salary_delta: number;
  payroll_before: number | null;
  payroll_after: number | null;
  second_apron: number | null;
  second_apron_before_distance: number | null;
  second_apron_after_distance: number | null;
}

export interface TradeEvalOracleExpectation {
  expected_legality: TradeEvalLegality;
  expected_failure_reasons: string[];
  expected_repair_hints: string[];
  gold_label_confidence: TradeEvalLabelConfidence;
  label_status: TradeEvalLabelStatus;
  evidence_paths: string[];
}

export interface TradeEvalScenario {
  id: string;
  title: string;
  summary: string;
  snapshot_date: string;
  season: string;
  subject_team_id: string;
  teams: string[];
  construction: TradeEvalTeamLeg[];
  salary_totals: TradeEvalTeamSalaryTotal[];
  known_salary_gap_count: number;
  rule_tags: TradeEvalRuleTag[];
  intended_edge: string;
  source_data_version: TradeEvalSourceDataVersion;
  oracle: TradeEvalOracleExpectation;
}

export interface TradeEvalScenarioFixture {
  meta: TradeEvalFixtureMeta;
  scenarios: TradeEvalScenario[];
}

export interface TradeEvalPromptExpectation {
  expected_legality: TradeEvalLegality;
  must_mention: string[];
  must_not_claim: string[];
  expected_source_behavior: TradeEvalSourceBehavior;
  allowed_uncertainty: string[];
  repair_hints: string[];
}

export interface TradeEvalPrompt {
  id: string;
  scenario_id: string;
  prompt_type: TradeEvalPromptType;
  prompt: string;
  expected: TradeEvalPromptExpectation;
}

export interface TradeEvalPromptFixture {
  meta: TradeEvalFixtureMeta;
  prompts: TradeEvalPrompt[];
}

export interface TradeEvalLabel {
  scenario_id: string;
  scenario_signature: string | null;
  source: 'realgm_tradechecker' | 'internal_heuristic' | 'human_review';
  status: TradeEvalLabelStatus;
  expected_legality: TradeEvalLegality;
  checked_at: string | null;
  reason_text: string;
  screenshot_path: string | null;
  page_text_path: string | null;
  label_confidence: TradeEvalLabelConfidence;
  reviewer_notes: string;
}

export interface TradeEvalLabelFixture {
  meta: TradeEvalFixtureMeta;
  labels: TradeEvalLabel[];
}

export interface TradeEvalQueueItem {
  scenario_id: string;
  title: string;
  teams: string[];
  rule_tags: TradeEvalRuleTag[];
  realgm_url: string;
  recommended_action: 'check_in_realgm' | 'skip_until_salary_source';
  stop_conditions: string[];
}

export interface TradeEvalLabelingQueue {
  meta: TradeEvalFixtureMeta;
  policy: {
    max_batch_size: number;
    min_delay_seconds: number;
    no_captcha_bypass: boolean;
    no_scaled_scraping: boolean;
  };
  items: TradeEvalQueueItem[];
}

export interface TradeEvalAnswerScore {
  prompt_id: string;
  scenario_id: string;
  prompt_type: TradeEvalPromptType;
  status: TradeEvalAnswerScoreStatus;
  total_score: number;
  subscores: {
    legality: number;
    rule_diagnosis: number;
    repair_quality: number;
    source_behavior: number;
    operator_usefulness: number;
    uncertainty_discipline: number;
  };
  failure_modes: string[];
}

export interface TradeEvalAnswerInput {
  prompt_id: string;
  answer: string;
}

export interface TradeEvalReport {
  corpus_id: typeof TRADE_EVAL_CORPUS_ID;
  generated_at: string;
  prompt_count: number;
  pass_count: number;
  warning_count: number;
  fail_count: number;
  scores: TradeEvalAnswerScore[];
  by_rule_family: Record<string, {
    prompt_count: number;
    average_score: number;
    failure_modes: string[];
  }>;
}

export function tradeEvalScenarioSignature(scenario: TradeEvalScenario): string {
  const payload = JSON.stringify({
    id: scenario.id,
    snapshot_date: scenario.snapshot_date,
    season: scenario.season,
    teams: scenario.teams,
    rule_tags: scenario.rule_tags,
    source_data_version: scenario.source_data_version,
    construction: scenario.construction.map((leg) => ({
      team_id: leg.team_id,
      sends: leg.sends.map(signatureAsset),
      receives: leg.receives.map(signatureAsset),
    })),
  });
  return `scenario:v1:${hashText(payload)}:${payload.length}`;
}

export function parseTradeEvalScenarioFixture(value: unknown): TradeEvalScenarioFixture {
  const fixture = expectRecord(value, 'scenario fixture');
  const meta = parseMeta(fixture.meta, 'scenario fixture meta');
  const scenarios = expectArray(fixture.scenarios, 'scenarios').map((item, index) => parseScenario(item, `scenarios[${index}]`));
  if (meta.scenario_count !== scenarios.length) {
    throw new Error(`scenario fixture count mismatch: meta=${meta.scenario_count} actual=${scenarios.length}`);
  }
  assertUnique(scenarios.map((scenario) => scenario.id), 'scenario id');
  return { meta, scenarios };
}

export function parseTradeEvalPromptFixture(value: unknown): TradeEvalPromptFixture {
  const fixture = expectRecord(value, 'prompt fixture');
  const meta = parseMeta(fixture.meta, 'prompt fixture meta');
  const prompts = expectArray(fixture.prompts, 'prompts').map((item, index) => parsePrompt(item, `prompts[${index}]`));
  if (meta.prompt_count != null && meta.prompt_count !== prompts.length) {
    throw new Error(`prompt fixture count mismatch: meta=${meta.prompt_count} actual=${prompts.length}`);
  }
  assertUnique(prompts.map((prompt) => prompt.id), 'prompt id');
  return { meta, prompts };
}

export function parseTradeEvalLabelFixture(value: unknown): TradeEvalLabelFixture {
  const fixture = expectRecord(value, 'label fixture');
  const meta = parseMeta(fixture.meta, 'label fixture meta');
  const labels = expectArray(fixture.labels, 'labels').map((item, index) => parseLabel(item, `labels[${index}]`));
  if (meta.label_count != null && meta.label_count !== labels.length) {
    throw new Error(`label fixture count mismatch: meta=${meta.label_count} actual=${labels.length}`);
  }
  assertUnique(labels.map((label) => label.scenario_id), 'label scenario_id');
  return { meta, labels };
}

function parseMeta(value: unknown, path: string): TradeEvalFixtureMeta {
  const meta = expectRecord(value, path);
  const schemaVersion = expectNumber(meta.schema_version, `${path}.schema_version`);
  if (schemaVersion !== TRADE_EVAL_SCHEMA_VERSION) throw new Error(`${path}.schema_version must be ${TRADE_EVAL_SCHEMA_VERSION}`);
  const corpusId = expectString(meta.corpus_id, `${path}.corpus_id`);
  if (corpusId !== TRADE_EVAL_CORPUS_ID) throw new Error(`${path}.corpus_id must be ${TRADE_EVAL_CORPUS_ID}`);
  const generationPolicy = expectRecord(meta.generation_policy, `${path}.generation_policy`);
  return {
    schema_version: TRADE_EVAL_SCHEMA_VERSION,
    corpus_id: TRADE_EVAL_CORPUS_ID,
    generated_at: expectString(meta.generated_at, `${path}.generated_at`),
    scenario_count: expectNumber(meta.scenario_count, `${path}.scenario_count`),
    prompt_count: optionalNumber(meta.prompt_count, `${path}.prompt_count`),
    label_count: optionalNumber(meta.label_count, `${path}.label_count`),
    source_data_version: parseSourceDataVersion(meta.source_data_version, `${path}.source_data_version`),
    generation_policy: {
      subject_team_id: expectString(generationPolicy.subject_team_id, `${path}.generation_policy.subject_team_id`),
      realgm_policy: expectString(generationPolicy.realgm_policy, `${path}.generation_policy.realgm_policy`),
      notes: expectArray(generationPolicy.notes, `${path}.generation_policy.notes`).map((item, index) => expectString(item, `${path}.generation_policy.notes[${index}]`)),
    },
  };
}

function parseSourceDataVersion(value: unknown, path: string): TradeEvalSourceDataVersion {
  const source = expectRecord(value, path);
  return {
    season: expectString(source.season, `${path}.season`),
    as_of_date: expectString(source.as_of_date, `${path}.as_of_date`),
    source_name: expectString(source.source_name, `${path}.source_name`),
    source_url: expectString(source.source_url, `${path}.source_url`),
    retrieved_at: expectString(source.retrieved_at, `${path}.retrieved_at`),
  };
}

function parseScenario(value: unknown, path: string): TradeEvalScenario {
  const scenario = expectRecord(value, path);
  const teams = expectArray(scenario.teams, `${path}.teams`).map((item, index) => expectString(item, `${path}.teams[${index}]`));
  const construction = expectArray(scenario.construction, `${path}.construction`).map((item, index) => parseTeamLeg(item, `${path}.construction[${index}]`));
  const salaryTotals = expectArray(scenario.salary_totals, `${path}.salary_totals`).map((item, index) => parseSalaryTotal(item, `${path}.salary_totals[${index}]`));
  const ruleTags = expectArray(scenario.rule_tags, `${path}.rule_tags`).map((item, index) => expectEnum(item, TRADE_EVAL_RULE_TAGS, `${path}.rule_tags[${index}]`));
  return {
    id: expectString(scenario.id, `${path}.id`),
    title: expectString(scenario.title, `${path}.title`),
    summary: expectString(scenario.summary, `${path}.summary`),
    snapshot_date: expectString(scenario.snapshot_date, `${path}.snapshot_date`),
    season: expectString(scenario.season, `${path}.season`),
    subject_team_id: expectString(scenario.subject_team_id, `${path}.subject_team_id`),
    teams,
    construction,
    salary_totals: salaryTotals,
    known_salary_gap_count: expectNumber(scenario.known_salary_gap_count, `${path}.known_salary_gap_count`),
    rule_tags: ruleTags,
    intended_edge: expectString(scenario.intended_edge, `${path}.intended_edge`),
    source_data_version: parseSourceDataVersion(scenario.source_data_version, `${path}.source_data_version`),
    oracle: parseOracle(scenario.oracle, `${path}.oracle`),
  };
}

function parseTeamLeg(value: unknown, path: string): TradeEvalTeamLeg {
  const leg = expectRecord(value, path);
  return {
    team_id: expectString(leg.team_id, `${path}.team_id`),
    sends: expectArray(leg.sends, `${path}.sends`).map((item, index) => parseAsset(item, `${path}.sends[${index}]`)),
    receives: expectArray(leg.receives, `${path}.receives`).map((item, index) => parseAsset(item, `${path}.receives[${index}]`)),
  };
}

function parseAsset(value: unknown, path: string): TradeEvalAsset {
  const asset = expectRecord(value, path);
  return {
    kind: expectEnum(asset.kind, ['player', 'pick', 'cash', 'exception', 'sign_and_trade_rights'] as const, `${path}.kind`),
    team_id: expectString(asset.team_id, `${path}.team_id`),
    direction: expectEnum(asset.direction, ['outgoing', 'incoming'] as const, `${path}.direction`),
    player_name: optionalString(asset.player_name, `${path}.player_name`),
    nba_player_id: optionalNullableNumber(asset.nba_player_id, `${path}.nba_player_id`),
    salary_amount: optionalNullableNumber(asset.salary_amount, `${path}.salary_amount`),
    salary_source_status: optionalEnum(asset.salary_source_status, ['captured', 'source-needed', 'not-available', 'not-applicable', 'manual'] as const, `${path}.salary_source_status`),
    label: expectString(asset.label, `${path}.label`),
    notes: optionalString(asset.notes, `${path}.notes`),
  };
}

function parseSalaryTotal(value: unknown, path: string): TradeEvalTeamSalaryTotal {
  const total = expectRecord(value, path);
  return {
    team_id: expectString(total.team_id, `${path}.team_id`),
    known_salary_out: expectNumber(total.known_salary_out, `${path}.known_salary_out`),
    known_salary_in: expectNumber(total.known_salary_in, `${path}.known_salary_in`),
    net_salary_delta: expectNumber(total.net_salary_delta, `${path}.net_salary_delta`),
    payroll_before: optionalNullableNumber(total.payroll_before, `${path}.payroll_before`),
    payroll_after: optionalNullableNumber(total.payroll_after, `${path}.payroll_after`),
    second_apron: optionalNullableNumber(total.second_apron, `${path}.second_apron`),
    second_apron_before_distance: optionalNullableNumber(total.second_apron_before_distance, `${path}.second_apron_before_distance`),
    second_apron_after_distance: optionalNullableNumber(total.second_apron_after_distance, `${path}.second_apron_after_distance`),
  };
}

function parseOracle(value: unknown, path: string): TradeEvalOracleExpectation {
  const oracle = expectRecord(value, path);
  return {
    expected_legality: expectEnum(oracle.expected_legality, ['legal', 'illegal', 'uncertain', 'source_needed'] as const, `${path}.expected_legality`),
    expected_failure_reasons: expectArray(oracle.expected_failure_reasons, `${path}.expected_failure_reasons`).map((item, index) => expectString(item, `${path}.expected_failure_reasons[${index}]`)),
    expected_repair_hints: expectArray(oracle.expected_repair_hints, `${path}.expected_repair_hints`).map((item, index) => expectString(item, `${path}.expected_repair_hints[${index}]`)),
    gold_label_confidence: expectEnum(oracle.gold_label_confidence, ['realgm', 'human_reviewed', 'heuristic', 'source_gap', 'unverified'] as const, `${path}.gold_label_confidence`),
    label_status: expectEnum(oracle.label_status, ['unlabeled', 'manual_pending', 'labeled', 'source_needed'] as const, `${path}.label_status`),
    evidence_paths: expectArray(oracle.evidence_paths, `${path}.evidence_paths`).map((item, index) => expectString(item, `${path}.evidence_paths[${index}]`)),
  };
}

function parsePrompt(value: unknown, path: string): TradeEvalPrompt {
  const prompt = expectRecord(value, path);
  const expected = expectRecord(prompt.expected, `${path}.expected`);
  return {
    id: expectString(prompt.id, `${path}.id`),
    scenario_id: expectString(prompt.scenario_id, `${path}.scenario_id`),
    prompt_type: expectEnum(prompt.prompt_type, TRADE_EVAL_PROMPT_TYPES, `${path}.prompt_type`),
    prompt: expectString(prompt.prompt, `${path}.prompt`),
    expected: {
      expected_legality: expectEnum(expected.expected_legality, ['legal', 'illegal', 'uncertain', 'source_needed'] as const, `${path}.expected.expected_legality`),
      must_mention: expectArray(expected.must_mention, `${path}.expected.must_mention`).map((item, index) => expectString(item, `${path}.expected.must_mention[${index}]`)),
      must_not_claim: expectArray(expected.must_not_claim, `${path}.expected.must_not_claim`).map((item, index) => expectString(item, `${path}.expected.must_not_claim[${index}]`)),
      expected_source_behavior: expectEnum(expected.expected_source_behavior, ['cite_current_cap_cba', 'refuse_without_source', 'realgm_or_internal_oracle', 'state_uncertainty'] as const, `${path}.expected.expected_source_behavior`),
      allowed_uncertainty: expectArray(expected.allowed_uncertainty, `${path}.expected.allowed_uncertainty`).map((item, index) => expectString(item, `${path}.expected.allowed_uncertainty[${index}]`)),
      repair_hints: expectArray(expected.repair_hints, `${path}.expected.repair_hints`).map((item, index) => expectString(item, `${path}.expected.repair_hints[${index}]`)),
    },
  };
}

function parseLabel(value: unknown, path: string): TradeEvalLabel {
  const label = expectRecord(value, path);
  return {
    scenario_id: expectString(label.scenario_id, `${path}.scenario_id`),
    scenario_signature: optionalNullableString(label.scenario_signature, `${path}.scenario_signature`),
    source: expectEnum(label.source, ['realgm_tradechecker', 'internal_heuristic', 'human_review'] as const, `${path}.source`),
    status: expectEnum(label.status, ['unlabeled', 'manual_pending', 'labeled', 'source_needed'] as const, `${path}.status`),
    expected_legality: expectEnum(label.expected_legality, ['legal', 'illegal', 'uncertain', 'source_needed'] as const, `${path}.expected_legality`),
    checked_at: optionalNullableString(label.checked_at, `${path}.checked_at`),
    reason_text: expectString(label.reason_text, `${path}.reason_text`),
    screenshot_path: optionalNullableString(label.screenshot_path, `${path}.screenshot_path`),
    page_text_path: optionalNullableString(label.page_text_path, `${path}.page_text_path`),
    label_confidence: expectEnum(label.label_confidence, ['realgm', 'human_reviewed', 'heuristic', 'source_gap', 'unverified'] as const, `${path}.label_confidence`),
    reviewer_notes: expectText(label.reviewer_notes, `${path}.reviewer_notes`),
  };
}

function expectRecord(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object`);
  return value as Record<string, unknown>;
}

function expectArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value;
}

function expectString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${path} must be a non-empty string`);
  return value;
}

function expectText(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new Error(`${path} must be a string`);
  return value;
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  return expectString(value, path);
}

function optionalNullableString(value: unknown, path: string): string | null {
  if (value === null || value === undefined) return null;
  return expectString(value, path);
}

function expectNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${path} must be a finite number`);
  return value;
}

function optionalNumber(value: unknown, path: string): number | undefined {
  if (value === undefined) return undefined;
  return expectNumber(value, path);
}

function optionalNullableNumber(value: unknown, path: string): number | null {
  if (value === null || value === undefined) return null;
  return expectNumber(value, path);
}

function expectEnum<const T extends readonly string[]>(value: unknown, allowed: T, path: string): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new Error(`${path} must be one of ${allowed.join(', ')}`);
  }
  return value;
}

function optionalEnum<const T extends readonly string[]>(value: unknown, allowed: T, path: string): T[number] | undefined {
  if (value === undefined) return undefined;
  return expectEnum(value, allowed, path);
}

function assertUnique(values: string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

function signatureAsset(asset: TradeEvalAsset): Record<string, unknown> {
  return {
    kind: asset.kind,
    team_id: asset.team_id,
    direction: asset.direction,
    player_name: asset.player_name ?? null,
    nba_player_id: asset.nba_player_id ?? null,
    salary_amount: asset.salary_amount ?? null,
    salary_source_status: asset.salary_source_status ?? null,
    label: asset.label,
  };
}

function hashText(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
