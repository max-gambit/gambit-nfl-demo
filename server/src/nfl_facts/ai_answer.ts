import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema';
import { cleanNflAnalystProse } from '@shared/nflReceiverPresentation';
import { searchNflAuthority } from '../nfl_authority/index.js';
import { describeNflIllustrativeTerms, getNflContractDossier, getNflContractDossierCoverage, NFL_CONTRACT_SCENARIO_TOOL_SCHEMA, nflContractComparisonTool, type NflContractScenarioArgs, type NflContractScenarioResult } from '../nfl_contracts/index.js';
import { contractDossiersEvidence, executeCapStrategy, executeContractComparison, executeContractScenario, explicitPlayerProtections } from '../nfl_conversation/contract_tools.js';
import { nflCapStrategyTool } from '../nfl_contracts/tool_schema.js';
import {observationsFromScenario} from '../nfl_contracts/funding_observations.js';
import { readSavedNflContract, readSavedNflContractTool, savedContractSource } from '../nfl_contracts/saved.js';
import { buildNflExampleEvidence, nflExampleTool, nflExampleCoverage, type NflExampleArgs } from '../nfl_examples/evidence.js';
import { buildNflReceiverComparison, nflReceiverTool, officialReceivingTotals } from '../nfl_scouting/evidence.js';
import { nflScenarioTool, updateNflConversationState, userMoneyAmounts } from '../nfl_conversation/state.js';
import { collectEvidenceFacts, validateSourcedParagraphs, evidenceFingerprint, type SourcedParagraph } from '../nfl_conversation/claims.js';
import { categoricalGroundingIssues, reviewNflAnalystSemantics, type AnalystAuthoredProse } from '../nfl_conversation/semantic_grounding.js';
import { evaluationCostsFromContracts } from '../nfl_conversation/evaluation_tools.js';
import { buildNflOptionEvaluation, nflEvaluationTool, type NflEvaluationState, type NflOptionEvaluationArgs } from '../nfl_evaluation/index.js';
import type Anthropic from '@anthropic-ai/sdk';
import type { DataAnalysisBriefBody, DataAnalysisTable, NflTransactionTradePackage } from '@shared/types';
import type { NflFactualQuery, NflRosterNumericFilter } from '@shared/nflFacts';
import { ANALYST_MODEL, ANALYST_EFFORT, AnalystProviderError, createAnalystMessage, analystModelMetadata } from '../nfl_conversation/model.js';
import { loadCurrentNflDataWithMode, type NflDemoSeed } from '../nfl_data/seed.js';
import { rosterFactsAnswer, historicalPackageAnswer, type FactualAnswer } from './answer.js';
import { buildNflCurrentAnswer } from '../nfl_current/analysis.js';
import { buildNflRuleAnswer } from '../nfl_rules/analysis.js';
import { analyzeNflTransactionMarket } from '../nfl_transactions/analyze.js';
import { loadCurrentNflTransactionMarketSnapshot } from '../nfl_transactions/seed.js';
import { factualMarketAnswer } from '@shared/nflAnswerDepth';
import { deterministicMarketSourceRows, deterministicMarketEventSourceRows } from '../claude/nfl_transaction_market_guardrails.js';

export interface AnalystTurn { question: string; body: DataAnalysisBriefBody | null }
export interface AnalystOptions {
  pipeline?: 'legacy' | 'candidate';
  onEvidence?: (evidence: unknown[]) => void;
  onTrace?: (event: Record<string, unknown>) => void;
  history?: AnalystTurn[];
  sessionId?: string;
  readSavedContract?: typeof readSavedNflContract;
  savedContractScope?: { created_before: string; exclude_brief_id: string };
  pinnedSavedContract?: DataAnalysisBriefBody['saved_contract_reference'];
  initialEvidence?: FactualAnswer;
  loadData?: typeof loadCurrentNflDataWithMode;
  loadTradeSnapshot?: typeof loadCurrentNflTransactionMarketSnapshot;
  callModel?: typeof createAnalystMessage;
  deadlineMs?: number;
  prefetch?: boolean;
  reviewDraft?: (draft: FactualAnswer, evidence: unknown[]) => Promise<string[]>;
}
interface Evidence extends FactualAnswer { id: string; rowRefs?: number[][]; executed?: boolean }
// Original wording can contain a different budget or funding limit. It remains
// in the saved source/UI, while model context receives the validated fields.
const currentTermsText=(value:string)=>value.split('\n').filter(line=>!line.startsWith('Original user input, retained as provenance;')).join('\n');
function contractArgsForModel(args:NflContractScenarioArgs|undefined){
  if(!args)return undefined;
  return {...args,moves:args.moves.map(move=>{
    if(!move.illustrative_terms)return move;
    const {user_input,...compensation}=move.illustrative_terms;
    return {...move,illustrative_terms:compensation};
  })};
}
/** Evidence packs may carry source refs in named facts, workflow metadata and
 * saved calculation artifacts as well as the visible tables. Remap all of them
 * together; preserve structured (non-integer) source descriptors verbatim. */
function remapEvidenceRefs<T>(value: T, remap: (refs: number[]) => number[]): T {
  if (Array.isArray(value)) return value.map(item => remapEvidenceRefs(item, remap)) as T;
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    ['source_refs', 'answer_source_refs'].includes(key) && Array.isArray(item) && item.every(Number.isInteger)
      ? remap(item) : remapEvidenceRefs(item, remap),
  ])) as T;
}
const positions = ['QB', 'RB', 'WR', 'TE', 'OT', 'IOL', 'EDGE', 'IDL', 'LB', 'CB', 'S', 'ST'];
const numericFields = ['age', 'cap_2026', 'starts_2025', 'snaps_2025', 'games_2025', 'receiving_yards_2025'];
const sorts = ['name', 'cap_asc', 'cap_desc', 'starts_asc', 'starts_desc', 'snaps_asc', 'snaps_desc', 'games_asc', 'games_desc', 'age_asc', 'age_desc', 'receiving_yards_desc', 'receiving_yards_asc'];
const strings = (description: string) => ({ type: 'array', items: { type: 'string' }, description });
const integerRefs = { type: 'array', items: { type: 'integer', minimum: 1 } };

export const NFL_ANALYST_SYSTEM = `You are Gambit's football analyst for the New York Giants front office. Understand the decision, investigate the available evidence, and explain a useful working recommendation. The user can challenge the recommendation or change the objective in ordinary language.

INVESTIGATE
- Treat we/our/us as NYG unless the user specifies another team. Distinguish the scenario subject from acquisition candidates. A supplied absence is an assumption, not a diagnosis.
- For open-ended player decisions, search the applicable whole recorded population, then investigate a small useful shortlist and compare internal options. Use receiving_yards_desc for production-led receiving research, not total snaps or a low cap charge as a proxy for talent. Search outside NYG for acquisitions. Prepared dossiers enrich the search; they do not define it. For named comparisons or compatible follow-ups, use the relevant existing scope directly.
- For an open-ended receiver acquisition question, your first lookup must search_player_records with team_ids:[], position_groups:['WR'], exclude_nyg:true. Do not start by naming familiar prepared receivers. Compare the resulting candidates, including missing enrichment honestly.
- Decide what evidence the question needs. Use independent lookups together, reuse successful evidence, and finish once the material questions are supported. Read the Giants cap observations for cap-sensitive decisions and sourced rules for transaction mechanics. A table limit is a displayed sample, not the size of the researched population.
- Keep explicit filters, exclusions, budgets, reserve and protections. A vague preference is not a numeric cutoff. Change the scope when the objective changes. Use set_scenario before a dependent calculation, and restore an earlier scenario explicitly when requested. Saved illustrative terms are distinct from actual reported contracts and current budget constraints.
- Retrieve fresh evidence for each turn, including short follow-ups. Prior answer text and tables provide context, but prior source refs and lookup IDs are not current evidence. Only initial_evidence and this turn's tool results may be cited. When comparing a prior package or scenario with a new one, retrieve both.
- Use historical/snapshot dates as supplied. An old model recommendation is not evidence. Missing data limits the affected claim; continue useful supported work. Ask a focused question only for an input needed to complete the decision.

REASON
- State a defensible working recommendation, why it fits the objective, credible alternatives (including internal or hold), and the assumption or evidence that would change the choice. Conditional football judgments are welcome when their premise is supported; confirmed seller interest is not required to investigate a candidate. Do not invent seller intent, role/scouting traits, prices, health or forecasts.
- Dated public cap observations with conflicting bases do not establish that NYG is currently over the cap or must clear room. Keep any cost-pressure inference conditional on reconciling the ledger.
- Explain contract term separately from guaranteed liability, current-team cap separately from incoming cost, and cap recognition separately from cash. A budget alone cannot establish actual incoming price. Use executed contract comparisons and funding calculations for numerical scenarios; never supply new financial inputs the user did not provide.
- A low current-team cap charge cannot justify a contained-cost acquisition or less future Giants commitment. Snapshot end years may include voids; only dossier active years establish active term. State a conditional investigation premise, not a price conclusion.
- A single season of production supports a volume/workload comparison, not an improving trend, consistency claim or specific football role. Explain a conditional role hypothesis and the evaluation needed to test it.
- Compare like metrics, periods and cohorts. Production is not a scouting grade. A player can lead in receptions while another leads in yards; specify the metric. Attribute scouting evaluations and distinguish user-supplied grades from verified team assessments.
- Availability reports support staff questions, not medical conclusions. Coaching outcomes support review hypotheses; film/charting is required for coverage, assignment or causal claims. Limited practice is not full participation, and one observed game cannot establish a workload trend.


WRITE
- Use set_scenario only for an explicit assumption or restored scenario not already represented by executed tools. Batch it with independent reads when possible.
- Omit empty optional fields and qualifications already present in the inherited evidence.
- Put the reasoning in answer_paragraphs. Avoid restating those paragraphs as key_findings; use an empty findings list when redundant. Select compact table IDs without repeating their cells.
- Answer naturally in connected paragraphs. A simple question usually needs 60–140 words; a substantial comparison may need 200–350. These are guidance, not quotas. Lead with the recommendation or answer in a short opening paragraph. Spend the remaining words on the decisive tradeoff, credible alternatives and what would change the choice. A short refinement should lead with what changed and its consequence. Preserve important conditions and uncertainty; do not impose a rigid template.
- Let the selected tables and their charts carry the full numerical comparison. Explain only the numbers that change the decision, rather than narrating every row. Select clear comparable metrics with their existing units and periods. The interface can chart receiving/workload comparisons, cap alternatives, third-down outcomes and practice participation directly from those tables. Do not describe the charting process or repeat the answer in findings.
- Explain meaningful numbers in prose with their subject, metric, time period and accounting basis. Every factual quantity must come from a labelled tool fact or executed calculation. Do not perform new arithmetic. Use source_refs on each answer_paragraph; Prefer source_refs alone; include fact_ids only to resolve an ambiguous binding. The server checks the exact bindings, including rounding. For a rule or compound calculated statement, you can select its exact text from answer_statements and explain its implication.
- For an acquisition/funding question, name the incoming player's current-year cap charge and cash payment in the opening, with the illustrative basis when applicable. Separate those costs from additional cap space needed after using the budget and reserve. Say "no salary conversion is needed" when the deal already fits; never lead with "minimum funding is $0" or label a paid acquisition "without funding." A no-acquisition row has zero added obligations because the player is not acquired.
- Lead with the decision, not methodology, data-policy language or a statistics roll call. Keep material conditions beside the affected claim and put routine methodology in supporting evidence. Do not substitute canned rule/calculation text for answering the question.
- Use finish_analysis with answer_paragraphs [{text,source_refs,fact_ids?}], relevant labelled tables, and up to three useful executable follow-ups. answer may be omitted when paragraphs are supplied. evidence_id preserves the main executed artifact; continuation_query_id preserves the intended search or scenario. Table rows and values come from tools. Preserve attribution. Do not include raw tool markup.
- Before finishing, check that the opening, findings and tables agree and that the proposed next action is actually supported. If validation identifies a material issue, repair that issue using the existing evidence, preserving the supported explanation. Communicate through tool calls only.`;

const contractToolGuidance = {"saved": "- Contracts already saved in the database are callable through read_saved_contract. If the user refers to a saved hypothetical contract absent from previous_contract_scenario, call read_saved_contract with that player before asking for terms or attempting calculations. It loads exact saved compensation across accessible Giants conversations, separately from public reported contracts. The tool result identifies the chosen record; cite that source. Current budget/reserve/protections still apply, not the saved deal's old funding plan. After a successful read, call find_minimum_cap_funding with {} when funding is requested; do not transcribe or invent the saved terms. A lookup alone does not complete a requested calculation. If the database reports not_found, finish with that exact gap and the needed input; do not repeatedly retry or substitute public cap charges.", "comparison": "- For a contract comparison, call nfl_contract_comparison directly. It calculates hold and requested alternatives and loads the controlling rules. Omit budget when none was supplied. A separate set_scenario call is unnecessary if the calculator can bind the current explicit inputs.", "funding": "- For minimum funding, financing discovery, sensitivity, or what would change a financing recommendation, use find_minimum_cap_funding directly. Omit scenario when retaining the last acquisition terms; current explicit budget/reserve changes are read by the tool. Do not reuse an old maximum or specified conversion as the recommendation. Only this tool derives conversion amounts and sensitivity cases; the ordinary scenario tools still require literal user amounts. Explain the preferred single conversion, including no funding when acquisition already fits, and distinguish an unsupported funding fit from an unavailable player. This search does not optimize roster removals or combined conversions. Do not say uncalculated multiple conversions, releases/trades or extensions would close the gap; they require separate evaluation. Describe the budget, reserve or price changes that the sensitivity rows actually tested. Preserve all future-year allocations and the supplied player protections.\n- For a follow-up changing only budget or reserve, call find_minimum_cap_funding with {}. The server reads those changes and retains compensation and validated funding observations. Do not copy prior moves or supply unpaid_salary_available, credited_seasons, or a conversion amount. Unknown observations stay omitted, never zero or an estimate from reported salary."};

export const nflAnalystTools: Anthropic.Tool[] = [
  {
    name: 'search_player_records', description: 'Search current roster/contract snapshots and recorded 2025 usage. This is read-only. Provide complete selection fields, or inherit the previous player selection and change only specified fields. Numeric filters, when supplied, replace the full numeric-filter list, so include retained bounds. Empty team_ids means all teams. cap_2026 is CURRENT TEAM cap, not acquiring-team cost.',
    input_schema: { type: 'object', properties: {
      inherit_previous: { type: 'boolean' },
      team_ids: strings('Standard team IDs. Omitted defaults to NYG; [] searches leaguewide.'),
      player_names: strings('Exact full player names, case insensitive. Use [] for a cohort; scenario subjects are not acquisition targets.'),
      position_groups: { type: 'array', items: { type: 'string', enum: positions } },
      exclude_nyg: { type: 'boolean' }, veterans_only: { type: 'boolean' },
      excluded_team_ids: strings('Teams to exclude without changing positive scope.'),
      excluded_player_names: strings('Players to exclude.'),
      roster_statuses: strings('Recorded status codes, for example active or practice_squad. Omitted/empty includes all statuses.'),
      numeric_filters: { type: 'array', items: { type: 'object', properties: {
        field: { type: 'string', enum: numericFields }, operator: { type: 'string', enum: ['lt', 'lte', 'gt', 'gte', 'eq'] }, value: { type: 'number', minimum: 0 },
      }, required: ['field', 'operator', 'value'], additionalProperties: false } },
      sort: { type: 'string', enum: sorts }, limit: { type: 'integer', minimum: 1, maximum: 50 },
    }, additionalProperties: false },
  },
  nflReceiverTool,
  { ...nflEvaluationTool, input_schema:{...nflEvaluationTool.input_schema, required:[], properties:{...(nflEvaluationTool.input_schema.properties as Record<string,unknown>),inherit_previous:{type:'boolean',description:'Keep the previous validated role and domain for a grade, weight or threshold change; omit unchanged fields. A changed role clears old judgments.'}}} } as Anthropic.Tool,
  {...nflScenarioTool,description:'Persist explicit user assumptions or restore an earlier scenario. Calculations already record their validated budget, protections and terms. Batch independent reads with this update when no read depends on it.'} as Anthropic.Tool,
  {...readSavedNflContractTool,description:readSavedNflContractTool.description+'\n'+contractToolGuidance.saved} as Anthropic.Tool,
  {name:'read_contract_dossiers',description:'Inspect all years, active versus void, guarantees and source conflicts in the eight deep public contract dossiers. Includes originals from other teams; never implies incoming cost.',input_schema:{type:'object',properties:{player_names:{type:'array',items:{type:'string'}}},additionalProperties:false}},
  {name:'calculate_contract_scenario',description:'Read-only simulation, never a real transaction. Call even for a protected-player conflict to show the explicit blocked result. Calculate hold, trade, release, salary-conversion restructure or an acquisition with complete literal user-supplied illustrative terms. Code owns all figures and future-year obligations. This replaces broad estimated lever columns for numerical scenarios. Every new amount must be supplied by the user; incomplete incoming terms remain blocked.',input_schema:NFL_CONTRACT_SCENARIO_TOOL_SCHEMA as unknown as Anthropic.Tool.InputSchema},
  {...nflContractComparisonTool,description:nflContractComparisonTool.description+'\n'+contractToolGuidance.comparison} as unknown as Anthropic.Tool,
  {...nflCapStrategyTool,description:nflCapStrategyTool.description+'\n'+contractToolGuidance.funding} as unknown as Anthropic.Tool,
  { ...nflExampleTool, input_schema: {...nflExampleTool.input_schema, properties:{...nflExampleTool.input_schema.properties, inherit_previous:{type:'boolean',description:'Retain the previous example scope and change only supplied fields.'}}}} as Anthropic.Tool,
  { name: 'read_giants_cap', description: 'Read dated public Giants cap observations, their disagreement and verified arithmetic. Not a live certified ledger.', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'read_nfl_rules', description: 'Look up sourced NFL CBA/transaction rules. Ask a focused rules question, e.g. acquiring obligations in a trade, practice squad signing, waiver claim or June 1 accounting.', input_schema: { type: 'object', properties: { question: { type: 'string' }, domain:{type:'string',enum:['cba','playing_rules','league_dates']} }, required: ['question'], additionalProperties: false } },
  { name: 'read_trade_history', description: 'Execute a recorded historical trade comparison and optionally inspect named complete packages. The result is historical evidence, not a current price quote.', input_schema: { type: 'object', properties: {
    start_year: { type: 'integer', minimum: 1994, maximum: 2025 }, end_year: { type: 'integer', minimum: 1994, maximum: 2025 },
    position_groups: { type: 'array', items: { type: 'string', enum: positions } },
    package_question: { type: 'string', description: 'Optional request to inspect specific complete packages in this historical period.' },
  }, required: ['start_year', 'end_year', 'position_groups'], additionalProperties: false } },
  { name: 'finish_analysis', description: 'Submit evidence-backed prose plus exact tool-owned tables. Copy row_ids (r0, r1, etc.) and column_names from the selected table. These IDs are distinct from numeric source refs. Empty row_ids selects all returned rows; keep visible tables compact. evidence_id preserves any underlying market/scenario artifact. continuation_query_id identifies the player search or receiver comparison whose selection follows into the next turn.', input_schema: { type: 'object', properties: {
    scenario: nflScenarioTool.input_schema,
    answer_statements: {type:'array', maxItems:4, items:{type:'string'}, description:'Optional exact statement IDs, such as lookup_1:answer. Never copy the statement text here. Omit when the prose already explains the result.'},
    answer: { type: 'string' },
    answer_paragraphs: {type:'array',maxItems:8,items:{type:'object',properties:{text:{type:'string'},source_refs:integerRefs,fact_ids:strings('Optional exact numerical fact IDs from the evidence.')},required:['text','source_refs'],additionalProperties:false}},
    answer_source_refs: integerRefs,
    key_findings: { type: 'array', maxItems: 5, items: { type: 'object', properties: { label: { type: 'string' }, body: { type: 'string' }, source_refs: integerRefs }, required: ['label', 'body', 'source_refs'], additionalProperties: false } },
    tables: { type: 'array', maxItems: 4, items: { type: 'object', properties: { table_id: { type: 'string' }, title: { type: 'string',description:'Optional; code preserves the original evidence title.' }, row_ids: strings('Omit to keep every row. Otherwise exact row IDs, e.g. r0.'), column_names: strings('Omit to preserve the complete labelled evidence. Otherwise exact column names.') }, required: ['table_id'], additionalProperties: false } },
    evidence_id: { type: 'string' }, continuation_query_id: { type: 'string' },
    caveats: strings('Only material qualifications, expressed in plain English.'),
    assumptions: strings('User-supplied scenarios and clearly labeled working assumptions, never inferred medical facts.'),
    followups: { type: 'array', maxItems: 3, items: { type: 'string' } },
  }, required: ['evidence_id', 'continuation_query_id'], additionalProperties: false } },
];

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object.');
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, max = 6000): string {
  if (typeof value !== 'string' || value.length > max) throw new Error('Invalid ' + label + '.');
  return value.trim();
}
function stringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > 50 || value.some(item => typeof item !== 'string' || item.length > 1500)) throw new Error('Invalid ' + label + '.');
  return [...new Set(value.map(item => item.trim()))];
}
function integerList(value: unknown, length: number, label: string): number[] {
  if (!Array.isArray(value) || value.some(item => !Number.isInteger(item) || item < 0 || item >= length)) throw new Error('Unknown ' + label + '.');
  return [...new Set(value)];
}

/** Validate executable arguments, not the vocabulary of the user's request. */
export function analystPlayerQuery(input: unknown, seed: NflDemoSeed, previous: NflFactualQuery | null): NflFactualQuery {
  const args = object(input);
  const allowed = new Set(Object.keys(nflAnalystTools[0].input_schema.properties ?? {}));
  if (Object.keys(args).some(key => !allowed.has(key))) throw new Error('Unsupported search field; explain the gap or use a supported field.');
  if ('inherit_previous' in args && typeof args.inherit_previous !== 'boolean') throw new Error('inherit_previous must be boolean.');
  if (args.inherit_previous === true && !previous) throw new Error('There is no previous player selection. Supply a complete new search.');
  const query: NflFactualQuery = args.inherit_previous === true && previous ? structuredClone(previous) : {
    kind: 'roster', team_ids: ['NYG'], player_names: [], position_groups: [], exclude_nyg: false, veterans_only: false,
    limit: 30, sort: 'name', transaction: 'none', post_june: true, hypothetical_unavailable: false, max_cap: null, min_starts: null,
    numeric_filters: [], excluded_team_ids: [], excluded_player_names: [], roster_statuses: [],
  };
  // Old parser residuals are never carried forward as user intent. The original
  // user messages, concrete predicates and explicit assumptions are in context.
  query.unresolved_constraints = [];
  query.numeric_filters ??= [
    ...(query.max_cap == null ? [] : [{field:'cap_2026',operator:'lte',value:query.max_cap} as const]),
    ...(query.min_starts == null ? [] : [{field:'starts_2025',operator:'gte',value:query.min_starts} as const]),
  ];
  query.transaction = 'none';
  const allNames = new Map(seed.roster_entries.map(row => [row.player_name.toLowerCase(), row.player_name]));
  for (const key of ['team_ids', 'excluded_team_ids', 'player_names', 'excluded_player_names', 'position_groups', 'roster_statuses'] as const) {
    if (!(key in args)) continue;
    let values = stringList(args[key], key);
    if (key.includes('team_ids')) {
      values = values.map(value => value.toUpperCase());
      if (values.some(value => !seed.teams.some(team => team.team_id === value))) throw new Error('Unknown team ID. Use a standard loaded NFL team ID.');
    }
    if (key.includes('player_names')) {
      const unknown = values.filter(value => !allNames.has(value.toLowerCase()));
      if (unknown.length) throw new Error('No exact roster identity for ' + unknown.join(', ') + '. Do not replace that player with someone else.');
      values = values.map(value => allNames.get(value.toLowerCase())!);
    }
    if (key === 'position_groups' && values.some(value => !positions.includes(value))) throw new Error('Unsupported position group.');
    if (key === 'roster_statuses' && values.some(value => !seed.roster_entries.some(row => row.roster_status === value))) throw new Error('Unknown roster status; available codes: ' + [...new Set(seed.roster_entries.map(row => row.roster_status))].join(', '));
    (query[key] as string[]) = values;
  }
  for (const key of ['exclude_nyg', 'veterans_only'] as const) {
    if (!(key in args)) continue;
    if (typeof args[key] !== 'boolean') throw new Error('Invalid ' + key + '.');
    query[key] = args[key];
  }
  if ('numeric_filters' in args) {
    if (!Array.isArray(args.numeric_filters) || args.numeric_filters.length > 20) throw new Error('Invalid numeric filters.');
    query.numeric_filters = args.numeric_filters.map(value => {
      const filter = object(value);
      if (!numericFields.includes(String(filter.field)) || !['lt', 'lte', 'gt', 'gte', 'eq'].includes(String(filter.operator))
        || typeof filter.value !== 'number' || !Number.isFinite(filter.value) || filter.value < 0) throw new Error('Invalid numeric predicate.');
      return { field: filter.field, operator: filter.operator, value: filter.value } as NflRosterNumericFilter;
    });
  }
  if ('sort' in args) {
    if (!sorts.includes(String(args.sort))) throw new Error('Unsupported sort.');
    query.sort = args.sort as NflFactualQuery['sort'];
  }
  if ('limit' in args) {
    if (!Number.isInteger(args.limit) || Number(args.limit) < 1 || Number(args.limit) > 50) throw new Error('Search limit must be between 1 and 50.');
    query.limit = Number(args.limit);
  }
  query.max_cap = query.numeric_filters?.find(filter => filter.field === 'cap_2026' && ['lt', 'lte'].includes(filter.operator))?.value ?? null;
  query.min_starts = query.numeric_filters?.find(filter => filter.field === 'starts_2025' && ['gt', 'gte'].includes(filter.operator))?.value ?? null;
  return query;
}

export function analystPlayerEvidence(query: NflFactualQuery, seed: NflDemoSeed): FactualAnswer {
  // Depth-chart imports carry zero defaults without a historical snap sample.
  // Keep those missing before filtering/sorting as well as in displayed cells.
  seed = { ...seed, player_metrics: seed.player_metrics.map(metric => metric.metric_families?.includes('nflverse_snap_counts') ? metric : {
    ...metric, snaps_2025: null, offense_snaps_2025: null, defense_snaps_2025: null, special_teams_snaps_2025: null,
  }) };
  seed = {...seed, player_metrics:seed.player_metrics.map(metric=>{const official=officialReceivingTotals(metric.player_name);return official?{...metric,receiving_yards_2025:official.yards,games_2025:official.games,source_status:'captured' as const}:metric;})};
  const result = rosterFactsAnswer(query, seed);
  const table = result.body.tables[0];
  if (!table) return result;
  table.columns[4] = '2026 cap at current team';
  const receiving = query.position_groups.some(position => ['WR', 'TE'].includes(position)) || table.rows.every(row => ['WR', 'TE'].includes(String(row[2])));
  const money = (value: number | null | undefined) => value == null ? 'Not recorded' : '$' + value.toLocaleString('en-US');
  table.columns.push('2026 snapshot scheduled cash', 'Contract horizon (active dossier / unverified snapshot)', ...(receiving ? ['2025 receiving yards', '2025 offensive snaps'] : []), 'NFL experience (years)');
  for (const values of table.rows) {
    const cap = seed.cap_rows.find(row => row.player_name === values[0] && row.team_id === values[1]);
    const metric = seed.player_metrics.find(row => row.player_name === values[0] && row.team_id === values[1]);
    const officialReceiving=receiving?officialReceivingTotals(String(values[0])):null;
    if(officialReceiving){const i=table.columns.findIndex(c=>/games/i.test(c));if(i>=0)values[i]=String(officialReceiving.games);}
    if(metric&&!metric.metric_families?.includes('nflverse_snap_counts')){const i=table.columns.findIndex(c=>/snaps/i.test(c));if(i>=0)values[i]='Not recorded';}
    const capturedCap = cap?.source_status === 'captured' ? cap : null;
    const dossier=getNflContractDossier(String(values[0]));
    const conflict=dossier?.source_status==='source_conflict';
    const activeYears=dossier?.reported_years.filter(y=>!y.is_void).map(y=>y.year)??[];
    if(conflict)values[4]='Source conflict: calculation blocked';
    values.push(conflict?'Source conflict':money(capturedCap?.cash_due_2026),conflict?'Source conflict':activeYears.length?String(Math.max(...activeYears))+' · dossier':capturedCap?.contract_end_year==null?'Not recorded':String(capturedCap.contract_end_year)+' · snapshot; voids unverified');
    if(conflict)result.body.caveats.unshift(String(values[0])+': '+dossier!.conflicts.join(' '));
    if (receiving) values.push(officialReceiving?officialReceiving.yards.toLocaleString('en-US'):metric?.source_status==='captured'&&metric.receiving_yards_2025!=null?metric.receiving_yards_2025.toLocaleString('en-US'):'Not recorded',metric?.source_status==='captured'&&metric.metric_families?.includes('nflverse_snap_counts')&&metric.offense_snaps_2025!=null?metric.offense_snaps_2025.toLocaleString('en-US'):'Not recorded');
    const experience = seed.roster_entries.find(row => row.player_name === values[0] && row.team_id === values[1])?.experience;
    values.push(experience == null ? 'Not recorded' : String(experience));
    const source = result.sources.find(source => source.title === values[0] + ' · ' + values[1]);
    if(source&&dossier){const data=source.data as {rows:Array<{k:string;v:string}>;source_tables?:unknown};data.source_tables=dossier.source_tables;data.rows.push({k:'Dossier active years',v:activeYears.join(', ')||'Unresolved'},{k:'Dossier void years',v:dossier.reported_years.filter(y=>y.is_void).map(y=>y.year).join(', ')||'None reported'},{k:'Dossier inspected',v:dossier.inspected_at},{k:'Dossier source SHA256',v:dossier.source_sha256},{k:'Dossier source',v:dossier.source_url});}
    if(source&&officialReceiving){const data=source.data as {rows:Array<{k:string;v:string}>};data.rows.push({k:'Official whole-season receiving games and yards',v:officialReceiving.games+' games; '+officialReceiving.yards+' receiving yards; 2025 regular season; all team stints'},{k:'Official receiving source',v:officialReceiving.source_url},{k:'Official capture',v:officialReceiving.captured_at});}
    if (receiving && source && metric?.metric_families?.includes('nflverse_stats_player')) {
      const data = source.data as { rows: Array<{ k: string; v: string }> };
      data.rows.push({ k: '2025 receiving statistics source', v: 'https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_reg_2025.csv' });
    }
  }
  result.body.caveats.unshift('Cap figures are charges at each player’s current team, not the Giants’ cost to acquire him. Scheduled annual cash is not remaining unpaid salary. Trade availability and compensation are not established.');
  return result;
}

export async function analystTradeEvidence(input: unknown, loadSnapshot = loadCurrentNflTransactionMarketSnapshot): Promise<FactualAnswer> {
  const args = object(input);
  const start = Number(args.start_year), end = Number(args.end_year);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1994 || end > 2025 || start > end) throw new Error('Invalid historical period.');
  const groups = stringList(args.position_groups, 'positions');
  if (groups.some(value => !positions.includes(value))) throw new Error('Unknown position group.');
  // The comparison engine needs two years. A one-year request selects exact
  // packages from that supported window; it never presents the extra year.
  const market = await analyzeNflTransactionMarket({ analysis_mode: start === end ? 'comparables' : 'ten_year_trend',
    start_year: start === end ? Math.max(1994, start - 1) : start, end_year: start === end && start === 1994 ? 1995 : end,
    position_groups: groups as NflFactualQuery['position_groups'], transaction_types: ['trade'],
  }, { loadSnapshot });
  if (start === end || args.package_question) {
    const selected = historicalPackageAnswer(args.package_question ? text(args.package_question, 'package question') : 'Show the complete trade packages.', market);
    if(start===end)return historicalPackageAnswer('Only ' + start + '.', market, { ...selected.body.historical_selection!, years: [start] });
    // A named package enriches the requested market window; it does not replace its trend evidence.
    const broad=factualMarketAnswer(market);
    const broadSources=[...deterministicMarketSourceRows(market,1),...deterministicMarketEventSourceRows(market,market.source_refs.length+1)];
    const offset=broadSources.length;
    const packageBody=remapEvidenceRefs(selected.body,refs=>refs.map(ref=>ref+offset));
    const packageSources=selected.sources.map(source=>({...source,ref_index:source.ref_index+offset}));
    const assetRows=selected.sources.flatMap(source=>((source.data?.trade_package as NflTransactionTradePackage|undefined)?.assets??[]).map(asset=>[source.title?.split(' · ')[0]??'Trade',asset.pick_season??asset.event_year,asset.received_team_id,asset.asset_type==='player'?asset.pfr_name??'Recorded player':'Draft pick',asset.pick_round??'—',asset.pick_number??'—',asset.conditional===true?'Conditional':asset.conditional===false?'Unconditional':'Not recorded']));
    return {body:{...packageBody,answer:broad.answer+'\n\nNamed package: '+packageBody.answer,key_findings:[...broad.key_findings,...packageBody.key_findings],tables:[...broad.tables,{title:'Complete recorded trade assets',columns:['Player','Year','Received by','Asset','Round','Overall pick','Condition'],rows:assetRows,source_refs:packageSources.map(source=>source.ref_index)}]},sources:[...broadSources,...packageSources]};
  }
  return { body: factualMarketAnswer(market), sources: [...deterministicMarketSourceRows(market, 1), ...deterministicMarketEventSourceRows(market, market.source_refs.length + 1)] };
}

export async function buildNflAiAnswer(question: string, options: AnalystOptions = {}): Promise<FactualAnswer> {
  if ((options.pipeline ?? process.env.NYG_ANALYST_PIPELINE) === 'legacy') {
    const baseline = await import('./ai_answer_v1.js');
    const answer = await baseline.buildNflAiAnswer(question, options);
    if(answer.body.ai_analysis) answer.body.ai_analysis.pipeline_version='analyst_v1';
    return answer;
  }
  return buildNflAiAnswerV2(question,options);
}

export async function buildNflAiAnswerV2(question: string, options: AnalystOptions = {}): Promise<FactualAnswer> {
  const started = Date.now();
  const loaded = await (options.loadData ?? loadCurrentNflDataWithMode)();
  const seed = structuredClone(loaded.seed);
  for(const cap of seed.cap_rows){if(getNflContractDossier(cap.player_name)?.source_status==='source_conflict'){cap.source_status='source-needed';for(const key of Object.keys(cap)){if(typeof (cap as unknown as Record<string,unknown>)[key]==='number'&&key!=='source_order')(cap as unknown as Record<string,unknown>)[key]=null;}}}
  const history = options.history ?? [];
  const previousQuery = [...history].reverse().find(turn => turn.body?.factual_query)?.body?.factual_query ?? null;
  let lastPlayerQuery = previousQuery;
  let lastExampleQuery=history.at(-1)?.body?.example_query;
  let lastEvaluation = [...history].reverse().find(turn => turn.body?.evaluation_result)?.body?.evaluation_result?.state as NflEvaluationState | undefined;
  let priorContractBody=[...history].reverse().find(t=>t.body?.contract_scenario)?.body;
  let priorContractScenario=priorContractBody?.contract_scenario?.args as NflContractScenarioArgs|undefined;
  let savedContractReference=priorContractBody?.saved_contract_reference;
  const fundingObservationHistory=history.flatMap(turn=>{
    if(turn.body?.funding_observations)return [turn.body.funding_observations];
    const args=turn.body?.contract_scenario?.args as NflContractScenarioArgs|undefined;
    return args?[{team_id:args.team_id,season:args.season,observations:observationsFromScenario(args)}]:[];
  });
  let conversationState = structuredClone(history.at(-1)?.body?.conversation_state);
  const stateBeforeTurn = structuredClone(conversationState);
  let budgetBeforeTurn=structuredClone(stateBeforeTurn?.active.budget??priorContractScenario?.budget);
  if(conversationState)conversationState.active.protected_player_names=explicitPlayerProtections(question,conversationState.active.protected_player_names).names;
  const applyScenario=(input:unknown)=>{
    const next=updateNflConversationState(input,conversationState,question,budgetBeforeTurn);
    if(object(input).operation==='restore')budgetBeforeTurn=structuredClone(next.active.budget??undefined);
    const explicit=explicitPlayerProtections(question,conversationState?.active.protected_player_names??[],next.active.protected_player_names);
    // A refinement cannot silently remove a protection. New objectives are
    // isolated by updateNflConversationState; explicit changes apply now.
    if(object(input).operation==='restore')next.active.protected_player_names=explicitPlayerProtections(question,next.active.protected_player_names).names;
    else if(next.active.objective===conversationState?.active.objective||['acquisition','contract'].includes(next.active.objective)&&['acquisition','contract'].includes(conversationState?.active.objective??''))next.active.protected_player_names=explicit.names;
    else next.active.protected_player_names=explicitPlayerProtections(question,[],next.active.protected_player_names).names;
    conversationState=next;
  };
  const deadlineMs = options.deadlineMs ?? 300_000;
  const evidence = new Map<string, Evidence>();
  const sources: FactualAnswer['sources'] = [];
  const toolNames: string[] = [];
  let servingModel = ANALYST_MODEL;
  let servingConfig: ReturnType<typeof analystModelMetadata>;
  const stageMs={retrieval:0,generation:0,review:0,repair:0};
  const retrievalStart=Date.now();

  const register = (answer: FactualAnswer, isPlayerSearch = false, executed = false): Evidence => {
    const id = 'lookup_' + (evidence.size + 1);
    const sourceMap = new Map<number, number>();
    answer.sources.forEach((source, index) => sourceMap.set(source.ref_index, sources.length + index + 1));
    const remap = (refs: number[]) => refs.map(ref => sourceMap.get(ref)).filter((ref): ref is number => ref != null);
    const mappedSources = answer.sources.map(source => ({ ...source, ref_index: sourceMap.get(source.ref_index)!, ...(source.data ? {data: remapEvidenceRefs(source.data, remap)} : {}) }));
    sources.push(...mappedSources);
    const body = remapEvidenceRefs(answer.body, remap);
    const item: Evidence = { id, body, executed, sources: mappedSources,
      ...(isPlayerSearch && body.tables[0] ? { rowRefs: body.tables[0].rows.map((_, index) => [sourceMap.get(answer.sources[index]?.ref_index) ?? body.tables[0].source_refs[0]]) } : {}),
    };
    evidence.set(id, item);
    options.onEvidence?.([...evidence.values()].map(forModel));
    return item;
  };
  const adoptExecutedState=(item:Evidence)=>{
    const body=item.body;
    const contract=body.contract_scenario;
    const receiver=body.receiver_query;
    const example=body.example_query;
    const evaluation=body.evaluation_query;
    const rules=item.sources.some(s=>['CBA','NFL_RULEBOOK','NFL_CALENDAR'].includes(s.kind??''))&&!contract&&!body.seller_move_analysis;
    const objective=evaluation?evaluation.domain==='college'?'college':'acquisition':contract||body.seller_move_analysis?'contract':receiver?receiver.candidate_scope==='internal'?'internal_roster':'acquisition':example?String(example.domain):body.market_analysis?'history':body.factual_query?body.factual_query.team_ids.length===1&&body.factual_query.team_ids[0]==='NYG'&&!body.factual_query.exclude_nyg?'internal_roster':'acquisition':rules?'rules':undefined;
    if(!objective)return;
    const next=updateNflConversationState({objective},conversationState,question);
    if(receiver){next.active.candidate_scope=receiver.candidate_scope as 'external'|'internal'|'both';next.active.horizon=receiver.priority==='contract_horizon'?'Remaining reported active contract years':'2025 receiving evidence';next.active.transaction=receiver.candidate_scope==='internal'?'hold':'none';}
    if(example){next.active.horizon=String(example.domain==='college'?'Historical 2025 draft class':'Historical 2025 season');next.active.candidate_scope='unspecified';next.active.transaction='none';}
    if(evaluation){next.active.horizon=String(evaluation.role);next.active.transaction='none';next.active.unresolved_inputs=body.evaluation_result?.unresolved_inputs as string[] ?? [];}
    if(body.factual_query){const q=body.factual_query;next.active.candidate_scope=q.exclude_nyg?'external':q.team_ids.length===1&&q.team_ids[0]==='NYG'?'internal':'both';next.active.objective=next.active.candidate_scope==='internal'?'internal_roster':'acquisition';}
    if(contract){
      const a=contract.args as NflContractScenarioArgs;const r=contract.result as NflContractScenarioResult;
      next.active.team_id=a.team_id;next.active.budget=a.budget??null;next.active.transaction=a.moves.length===1?a.moves[0].action:'none';next.active.horizon=a.season+' and all modeled later contract years';
      next.active.candidate_scope=a.moves.some(m=>m.action==='acquire')?'external':'internal';
      next.active.protected_player_names=(a.protected_player_ids??[]).map(id=>getNflContractDossier(id)?.player_name??id);
      next.active.supplied_terms=a.moves.flatMap(m=>m.illustrative_terms?describeNflIllustrativeTerms(m):m.conversion_amount!=null?[(body.cap_strategy?'Calculated minimum conversion for ':'Requested conversion for ')+m.player_id+': $'+m.conversion_amount.toLocaleString('en-US')]:[]);
      for(const observation of body.funding_observations?.observations??[]){if(observation.unpaid_salary_available!=null)next.active.supplied_terms.push(observation.player_id+' · supplied unpaid salary available: $'+observation.unpaid_salary_available.toLocaleString('en-US'));if(observation.credited_seasons!=null)next.active.supplied_terms.push(observation.player_id+' · supplied credited seasons: '+observation.credited_seasons);}
      next.active.unresolved_inputs=r.issues.map(i=>i.message).slice(0,20);
    }
    next.active.protected_player_names=explicitPlayerProtections(question,next.active.protected_player_names).names;
    conversationState=next;
  };
  const forModel = (item: Evidence) => ({
    lookup_id: item.id, population:item.body.population, historical_scope:item.body.market_analysis?{query:item.body.market_analysis.query,coverage:item.body.market_analysis.coverage,yearly_series:item.body.market_analysis.yearly_series,package_selection:item.body.historical_selection}:undefined, fact_fields:['id','subject','metric','period','unit','value','source_refs'],facts:collectEvidenceFacts([item]).filter(f=>f.value!=null).map(f=>[f.id,f.subject,f.metric,f.period,f.unit,f.value,f.source_refs]), answer: item.body.answer, selection: item.body.factual_query,receiver_selection:item.body.receiver_query,example_selection:item.body.example_query,evaluation_selection:item.body.evaluation_query,
    answer_statements: [{id:item.id+':answer',text:item.body.answer}, ...item.body.key_findings.map((f,i)=>({id:item.id+':finding:'+i,label:f.label,text:currentTermsText(f.body)}))], findings: item.body.key_findings.map(f=>({...f,body:currentTermsText(f.body)})), supporting_details: item.body.supporting_details, calculations: item.body.calculations, caveats: item.body.caveats.map(currentTermsText).filter(Boolean),
    saved_contract_lookup: item.body.saved_contract_lookup?{...item.body.saved_contract_lookup,scenario_args:contractArgsForModel(item.body.saved_contract_lookup.scenario_args as NflContractScenarioArgs|undefined)}:undefined, saved_contract_reference: item.body.saved_contract_reference,
    tables: item.body.tables.map((table, index) => ({ table_id: item.id + ':' + index, title: table.title, columns: table.columns, rows: table.rows.map((values, rowIndex) => ({ row_id: 'r' + rowIndex, fields: Object.fromEntries(table.columns.map((column, index) => [column, values[index]])), source_refs: index === 0 && item.rowRefs ? item.rowRefs[rowIndex] : table.source_refs })) })),
    sources: item.sources.map(source => ({ ref: source.ref_index, title: source.title, source: source.source, as_of: source.updated_at,
      factual_assertions: source.data?.factual_assertions, counterfacts: source.data?.counterfacts, workflow: source.data?.workflow, followup_actions: source.data?.followup_actions })),
  });
  const initialPlayer=options.initialEvidence?.body.seller_move_analysis?.result?.player.player_name;
  const initial = options.initialEvidence ? register(initialPlayer&&getNflContractDossier(initialPlayer)?.source_status==='source_conflict'?contractDossiersEvidence([initialPlayer]):options.initialEvidence) : null;
  // Discovery is chosen by the analyst from the actual question, not names in a prepared example.
  stageMs.retrieval += Date.now()-retrievalStart;
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: JSON.stringify({
    question, today: new Date().toISOString().slice(0, 10), roster_as_of: seed.as_of_date, historical_usage_season: 2025, source_mode: loaded.source_mode,
    contract_dossier_coverage: getNflContractDossierCoverage(), previous_contract_scenario: contractArgsForModel(priorContractScenario),
    known_gaps: ['No verified current medical status, seller availability, asking prices or club-certified cap ledger.', 'Recorded age may be unavailable. Current team cap is not acquiring-team cap cost.'],
    capability_summary: 'Search the full recorded roster/usage population; enrich named receivers with available evaluations and dossiers; calculate literal contract scenarios and minimum single-conversion funding; inspect sourced rules and recorded historical packages. College, availability and coaching examples have the explicitly returned coverage.',
    team_ids: seed.teams.map(team => team.team_id), roster_status_codes: [...new Set(seed.roster_entries.map(row => row.roster_status))],
    conversation: history.slice(-8).map(turn => ({ question: turn.question, answer: turn.body?.answer, findings: turn.body?.key_findings, tables: turn.body?.tables, player_selection: turn.body?.factual_query, assumptions: turn.body?.ai_analysis?.assumptions, scenario:turn.body?.conversation_state?.active?{...turn.body.conversation_state.active,supplied_terms:turn.body.conversation_state.active.supplied_terms.map(currentTermsText).filter(Boolean)}:undefined, receiver_query:turn.body?.receiver_query, example_query:turn.body?.example_query, contract_scenario:contractArgsForModel(turn.body?.contract_scenario?.args as NflContractScenarioArgs|undefined),funding_observations:turn.body?.funding_observations })),
    previous_player_selection: previousQuery, scenario_state: conversationState?{...conversationState,active:{...conversationState.active,supplied_terms:conversationState.active.supplied_terms.map(currentTermsText).filter(Boolean)},saved:conversationState.saved.map(s=>({...s,supplied_terms:s.supplied_terms.map(currentTermsText).filter(Boolean)}))}:undefined, example_coverage: nflExampleCoverage, previous_example_query: history.at(-1)?.body?.example_query, previous_evaluation: lastEvaluation,
    initial_evidence: [...evidence.values()].map(forModel),
  }) }];
  const needsCalculation=!!priorContractScenario||/fund(?:ing)?|financ|calculat|convert|conversion|restructur|salary|guarantee|hypothetical|illustrative|saved (?:deal|contract)|cap (?:impact|relief|saving)|model.{0,30}(?:trade|release)/i.test(question);
  const needsEvaluation=!!lastEvaluation||/evaluat|grades?|weights?|threshold|scores?/i.test(question);
  const exposedTools=nflAnalystTools.filter(tool=>!['calculate_contract_scenario','nfl_contract_comparison','find_minimum_cap_funding'].includes(tool.name)||needsCalculation).filter(tool=>tool.name!=='evaluate_nfl_options'||needsEvaluation).map(tool=>{
    if(tool.name!=='finish_analysis')return tool;
    // Keep the submission grammar small. Older payload fields remain accepted by the handler.
    const properties=Object.fromEntries(Object.entries(tool.input_schema.properties??{}).filter(([key])=>['answer_paragraphs','tables','followups','evidence_id','continuation_query_id'].includes(key)));
    return {...tool,strict:false,input_examples:[{answer_paragraphs:[{text:'The supported recommendation and its evidence.',source_refs:[1]}],tables:[],followups:[],evidence_id:'lookup_1',continuation_query_id:'lookup_1'}],input_schema:jsonSchemaOutputFormat({type:'object',properties,required:['answer_paragraphs','tables','followups','evidence_id','continuation_query_id'],additionalProperties:false} as any).schema as Anthropic.Tool.InputSchema};
  });
  const call = options.callModel ?? createAnalystMessage;
  // Code validates exact cells and categorical facts. A separate bounded
  // evidence review checks the premises and completeness of AI interpretation.
  // Tests can replace that review explicitly; production never defaults to pass.
  const partial = (reason: string): FactualAnswer => {
    // Unreviewed set_scenario prose is not accepted merely because calculation
    // failed or the provider timed out. Derive this turn's state from execution.
    conversationState = structuredClone(stateBeforeTurn);
    const executed = [...evidence.values()].filter(e => e.executed);
    const decisionWeight = (item: Evidence) => {
      const scenario = item.body.contract_scenario?.result as NflContractScenarioResult & {comparison?:unknown} | undefined;
      return scenario?.comparison ? 6 : item.body.evaluation_query ? 5 : scenario?.moves.some(m => m.action !== 'hold') ? 4 : item.body.example_query ? 3 : item.body.receiver_query ? 2 : 1;
    };
    const selected = executed.slice().sort((a,b) => decisionWeight(b)-decisionWeight(a) || Number(b.id.split('_')[1])-Number(a.id.split('_')[1]))[0]
      ?? [...evidence.values()].find(e=>e.body.receiver_query) ?? [...evidence.values()].at(-1);
    if(selected)adoptExecutedState(selected);
    const body: DataAnalysisBriefBody = selected ? { ...selected.body,
      answer: 'The checked evidence is ready below. The written analysis did not finish, so this is an evidence view; it does not complete the requested comparison.',
    } : { kind:'data_analysis', answer:'The analyst could not retrieve enough evidence to answer this question. Your question is saved; retry it to continue.', key_findings:[], tables:[], calculations:[], caveats:[], followups:[] };
    if (selected) {
      const seen = new Set(body.tables.map(t => JSON.stringify([t.title,t.rows])));
      body.tables = [...body.tables];
      for (const item of executed.filter(e => e !== selected)) for (const table of item.body.tables) {
        const key = JSON.stringify([table.title,table.rows]);
        if (seen.has(key)) continue;
        seen.add(key); body.tables.push(table);
      }
      body.tables = body.tables.slice(0,6);
    }
    body.language_policy = 'facts_only_v1';
    body.caveats = [...body.caveats, 'Analysis incomplete: ' + reason];
    body.conversation_state = conversationState;
    body.ai_analysis = { model: servingModel, model_config:servingConfig, elapsed_ms: Date.now()-started, tool_names:toolNames, assumptions:conversationState?.active.assumptions ?? [], outcome:selected ? 'evidence_only':'unavailable', grounding_checked:false,pipeline_version:'analyst_v2',stage_ms:{...stageMs},repair_count:Math.min(finalFailures,1),validation_outcome:'incomplete' };
    body.followups = [question];
    return { body, sources };
  };
  let finalFailures = 0;
  const readCache=new Map<string,Promise<{answer?:FactualAnswer;error?:unknown}>>();
  const registeredReads=new Map<string,Evidence>();
  const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])):value;
  const independentRead=(tool:Anthropic.ToolUseBlock):(()=>Promise<FactualAnswer>)|undefined=>{
    if(tool.name==='compare_receivers')return ()=>buildNflReceiverComparison(tool.input,seed,[...history.map(t=>t.question),question].join('\n'));
    if(tool.name==='read_giants_cap')return ()=>buildNflCurrentAnswer('cap_space');
    if(tool.name==='read_contract_dossiers')return async()=>contractDossiersEvidence(object(tool.input).player_names?stringList(object(tool.input).player_names,'player names'):undefined);
    if(tool.name==='read_trade_history')return ()=>analystTradeEvidence(tool.input,options.loadTradeSnapshot);
    if(tool.name==='read_nfl_rules')return ()=>{const args=object(tool.input);if(args.domain&&!['cba','playing_rules','league_dates'].includes(String(args.domain)))throw new Error('Unknown rule domain.');return searchNflAuthority({question:text(args.question,'rules question',1500),domain:args.domain as 'cba'|'playing_rules'|'league_dates'|undefined,limit:4});};
    return undefined;
  };
  for (let round = 0; round < 6; round++) {
    if (Date.now() - started > deadlineMs) return partial('Response deadline reached.');
    let response: Anthropic.Message;
    const generationStart=Date.now();
    const mustFinish=evidence.size>0&&(finalFailures>0||Date.now()-started>deadlineMs-150_000);
    if(mustFinish&&!finalFailures)messages.push({role:'user',content:'Finish from the available evidence now. Identify any material unfinished input; do not start another research round.'});
    try { response = await call({ model: ANALYST_MODEL, max_tokens: 4500, output_config:{effort:ANALYST_EFFORT}, system: NFL_ANALYST_SYSTEM, tools: evidence.size?exposedTools:exposedTools.filter(tool=>tool.name!=='finish_analysis'),
      tool_choice: mustFinish?{type:'tool',name:'finish_analysis',disable_parallel_tool_use:true}:{type:'auto'}, messages,
    }, { timeout: Math.max(1, deadlineMs - (Date.now() - started)), maxRetries: 0 });
    } catch (error) {
      options.onTrace?.({stage:'provider_error',code:error instanceof AnalystProviderError?error.code:'request_failed',message:error instanceof Error?error.message:'Unknown provider error'});
      return partial(error instanceof Error && /timeout|timed out|abort/i.test(error.message) ? 'Response deadline reached.' : error instanceof AnalystProviderError&&error.code==='missing_api_key'?'The OpenAI analyst connection is not configured.':'The analysis provider is unavailable.');
    }
    console.info('[nfl analyst] round',round+1,'elapsed_ms',Date.now()-started,'output_tokens',response.usage.output_tokens,'stop',response.stop_reason,'tools',response.content.filter(b=>b.type==='tool_use').map(b=>(b as Anthropic.ToolUseBlock).name).join(','));
    stageMs[finalFailures?'repair':'generation']+=Date.now()-generationStart;
    options.onTrace?.({stage:finalFailures?'repair':'generation',round,model:response.model,model_config:analystModelMetadata(response),usage:response.usage,content:response.content});
    servingModel = response.model;
    servingConfig = analystModelMetadata(response);
    if (response.stop_reason === 'max_tokens') return partial('The analysis exceeded its output allowance.');
    const calls = response.content.filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use');
    if (!calls.length) {
      messages.push({ role: 'assistant', content: response.content }, { role: 'user', content: 'Use the data tools to investigate, then submit with finish_analysis. Do not answer outside that tool.' });
      continue;
    }
    messages.push({ role: 'assistant', content: response.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    const batchStart=Date.now();
    const readKeys=new Map<string,string>();
    // Reads use an immutable turn context. State-changing/dependent tools remain ordered below.
    for(const tool of calls){const run=independentRead(tool);if(!run||finalFailures)continue;const key=tool.name+JSON.stringify(canonical(tool.input));readKeys.set(tool.id,key);if(!readCache.has(key))readCache.set(key,Promise.resolve().then(run).then(answer=>({answer}),error=>({error})));}

    let finishFailedThisRound=false;
    for (const tool of calls) {
      toolNames.push(tool.name);
      try {
        if(finalFailures&&tool.name!=='finish_analysis')throw new Error('Repair the identified claim using the evidence already retrieved, then resubmit finish_analysis.');
        if(readKeys.has(tool.id)){const key=readKeys.get(tool.id)!;const result=await readCache.get(key)!;if(result.error)throw result.error;let item=registeredReads.get(key);if(!item){item=register(result.answer!,false,true);registeredReads.set(key,item);}results.push({type:'tool_result',tool_use_id:tool.id,content:JSON.stringify(forModel(item))});continue;}
        if (tool.name === 'finish_analysis') {
          if (calls.length !== 1) throw new Error('Submit finish_analysis on its own after reading the tool results.');
          if (!evidence.size) throw new Error('No current-turn evidence exists. Retrieve the relevant evidence with a read tool before finishing; previous lookup IDs are not reusable.');
          const args = object(tool.input);
          for(const key of ['key_findings','tables','caveats','assumptions','followups']) if(args[key]==null)args[key]=[];
          if (args.scenario) applyScenario(args.scenario);
          const primaryId = text(args.evidence_id, 'evidence_id');
          let primary = primaryId ? evidence.get(primaryId) : null;
          if (primaryId && !primary) throw new Error('Unknown evidence_id.');
          const selectedLookupIds = new Set([
            ...((args.tables as unknown[]) ?? []).map(value => String(object(value).table_id ?? '').split(':')[0]),
            ...stringList(args.answer_statements ?? [], 'answer statements').map(id => id.split(':')[0]),
          ]);
          const selectedContracts = [...evidence.values()].filter(item => item.body.contract_scenario && selectedLookupIds.has(item.id));
          if (selectedContracts.length > 1) throw new Error('Use one contract comparison result for the selected alternatives, so the saved scenario and its follow-ups match the displayed calculation.');
          const contractEvidence = selectedContracts[0] ?? (primary?.body.contract_scenario ? primary : undefined);
          const selectedEvaluations = [...evidence.values()].filter(item => item.body.evaluation_query && (selectedLookupIds.has(item.id) || item.id === primaryId || item.id === args.continuation_query_id));
          if (selectedEvaluations.length > 1) throw new Error('Select one executed evaluation rule as the decision to preserve for follow-ups.');
          const evaluationEvidence = selectedEvaluations[0];
          if (evaluationEvidence) primary = evaluationEvidence;
          else if (contractEvidence) primary = contractEvidence;
          if(contractEvidence?.body.contract_scenario&&conversationState){
            const executed=contractEvidence.body.contract_scenario.args as NflContractScenarioArgs;
            const expected=explicitPlayerProtections(question,conversationState.active.protected_player_names).names;
            for(const move of (contractEvidence.body.contract_scenario.result as NflContractScenarioResult).moves){if(move.action!=='hold'&&expected.includes(move.player_name)&&!move.issues.some(i=>i.code==='PROTECTED_PLAYER'))throw new Error('Protection changed after calculation. Recalculate with the current scenario before finishing.');}
            const executedBudget=executed.budget??null;
            if(JSON.stringify(conversationState.active.budget)!==JSON.stringify(executedBudget)&&conversationState.active.budget)throw new Error('Budget changed after calculation. Recalculate with the current budget before finishing.');
            conversationState.active.budget=executedBudget;
            conversationState.active.protected_player_names=executed.protected_player_ids?.map(id=>getNflContractDossier(id)?.player_name??id)??[];
          }

          const queryId = text(args.continuation_query_id, 'continuation_query_id');
          let queryEvidence = queryId ? evidence.get(queryId) : undefined;
          if (queryId && !queryEvidence) throw new Error('continuation_query_id must identify retrieved evidence.');
          if (primary?.body.contract_scenario || primary?.body.evaluation_query) queryEvidence = primary;
          const query = queryEvidence?.body.factual_query;
          const sourceIssues:string[]=[];
          const refs = (value: unknown): number[] => {
            if (!Array.isArray(value) || value.some(ref => !Number.isInteger(ref) || ref < 1 || ref > sources.length))sourceIssues.push('Use only retrieved source refs: integers from 1 through '+sources.length+'.');
            return Array.isArray(value)?[...new Set(value.filter(Number.isInteger))]:[];
          };
          args.key_findings??=[];args.tables??=[];
          if (!Array.isArray(args.key_findings) || !Array.isArray(args.tables)) throw new Error('Invalid findings or table selection.');
          const withheldSentences=0;
          const prose = (value: unknown, label: string, max = 9000) => cleanNflAnalystProse(text(value,label,max));
          const findings = args.key_findings.slice(0,5).map(value => { const row = object(value); return { label: prose(row.label, 'finding label', 120), body: prose(row.body, 'finding body', 2500), source_refs: refs(row.source_refs) }; }).filter(row=>row.body.length>0).map(row=>({...row,label:row.label||'Evidence'}));
          const tables = args.tables.slice(0,4).map((value): DataAnalysisTable => {
            const selected = object(value);
            const tableId = text(selected.table_id, 'table ID');
            const [lookupId, index] = tableId.split(':');
            const item = evidence.get(lookupId);
            const table = /^\d+$/.test(index ?? '') ? item?.body.tables[Number(index)] : undefined;
            if (!table || !item) throw new Error('Unknown table ID.');
            const rowIds = stringList(selected.row_ids ?? [], 'table rows');
            if (rowIds.some(id => !/^r\d+$/.test(id))) throw new Error('Unknown table row ID. Copy exact row_ids from the table.');
            const indices = integerList(rowIds.map(id => Number(id.slice(1))), table.rows.length, 'table row');
            const rows = indices.length ? indices : table.rows.map((_, index) => index);
            const chosenColumns = integerList(stringList(selected.column_names ?? [], 'table columns').map(column => table.columns.indexOf(column)), table.columns.length, 'table column');
            const columns = chosenColumns.length ? chosenColumns : table.columns.map((_, index) => index);
            return { title: table.title, columns: columns.map(index => table.columns[index]), rows: rows.map(index => columns.map(column => table.rows[index][column])),
              source_refs: Number(index) === 0 && item.rowRefs ? [...new Set(rows.flatMap(index => item.rowRefs![index]))] : table.source_refs };
          });
          const statements=stringList(args.answer_statements??[],'answer statements').slice(0,4).flatMap(id=>{
            const [lookup,kind,index]=id.split(':');const item=evidence.get(lookup);if(!item)return [];
            if(kind==='answer'&&!index)return [{text:item.body.answer,refs:item.sources.map(s=>s.ref_index)}];
            const finding=kind==='finding'&&/^\d+$/.test(index??'')?item.body.key_findings[Number(index)]:undefined;
            if(!finding)return [];
            return [{text:finding.body,refs:finding.source_refs}];
          });
          const catalog=collectEvidenceFacts(evidence.values());
          const rawParagraphs:SourcedParagraph[]=Array.isArray(args.answer_paragraphs)&&args.answer_paragraphs.length
            ? args.answer_paragraphs.map(value=>{const p=object(value);return {text:prose(p.text,'paragraph'),source_refs:refs(p.source_refs),fact_ids:stringList(p.fact_ids??[],'fact IDs')};})
            : prose(args.answer??'', 'answer').split(/\n\s*\n/).filter(Boolean).map(value=>({text:value,source_refs:refs(args.answer_source_refs??[])}));
          if(rawParagraphs.length>8)throw new Error('Use at most eight connected answer paragraphs.');
          let paragraphs=rawParagraphs.length?rawParagraphs:statements.map(s=>({text:s.text,source_refs:s.refs}));
          const quantitativeIssues:string[]=[...sourceIssues];
          try{paragraphs=validateSourcedParagraphs(paragraphs,catalog,new Set(sources.map(s=>s.ref_index)));}catch(error){quantitativeIssues.push(error instanceof Error?error.message:'Invalid paragraph claims.');}
          try{validateSourcedParagraphs(findings.map(f=>({text:f.body,source_refs:f.source_refs})),catalog,new Set(sources.map(s=>s.ref_index)));}catch(error){quantitativeIssues.push(error instanceof Error?error.message:'Invalid finding claims.');}
          const interpretation=paragraphs.map(p=>p.text).join('\n\n');
          const receiverEvidence = queryEvidence?.body.receiver_query ? queryEvidence : primary?.body.receiver_query ? primary : undefined;
          const supportingDetails = [
            ...statements.filter(s=>rawParagraphs.length).map(s=>({label:'Supporting evidence',body:s.text,source_refs:s.refs})),
            ...(primary?.body.supporting_details ?? []),
            ...(evaluationEvidence?.body.key_findings.filter(f=>f.label!=='Decision basis') ?? []),
            ...(receiverEvidence && receiverEvidence !== primary ? receiverEvidence.body.supporting_details ?? [] : []),
          ];
          const answer=interpretation;
          if (!answer) throw new Error('Write the useful answer in sourced paragraphs; do not submit an empty interpretation.');
          if(!tables.length&&primary)tables.push(...primary.body.tables.slice(0,2));
          const suppliedGrades = evaluationEvidence?.body.tables.find(t=>t.title==='User-supplied judgments · unverified attribution');
          if(suppliedGrades&&!tables.some(t=>t.title===suppliedGrades.title))tables.push(suppliedGrades);
          if(contractEvidence?.body.cap_strategy)for(const table of contractEvidence.body.tables.slice(0,2)){if(!tables.some(t=>t.title===table.title))tables.push(table);}
          const caveats = [...new Set([...(primary?.body.caveats??[]),...stringList(args.caveats,'caveats')])];
          if (loaded.source_mode !== 'supabase_current_views') caveats.push('Player records are from the saved public snapshot dated ' + seed.as_of_date + '; the database was unavailable.');
          if(contractEvidence??primary)adoptExecutedState((contractEvidence??primary)!);
          const draft: FactualAnswer = { body: {
            kind: 'data_analysis', language_policy: 'grounded_ai_v1', ...(primary?.body.population?{population:primary.body.population}:{}), answer, answer_paragraphs:paragraphs, answer_source_refs:[...new Set(paragraphs.flatMap(p=>p.source_refs))], ...(supportingDetails.length ? { supporting_details: supportingDetails } : {}), key_findings: findings, tables,
            calculations: primary?.body.calculations ?? [], caveats,
            followups: (stringList(args.followups, 'followups').length?stringList(args.followups,'followups'):primary?.body.followups??[]).slice(0,3),
            ...(query ? { factual_query: query } : {}),
            ...((queryEvidence?.body.receiver_query??primary?.body.receiver_query)?{receiver_query:queryEvidence?.body.receiver_query??primary?.body.receiver_query}:{}),
            ...(primary?.body.market_analysis ? { market_analysis: primary.body.market_analysis, answer_layout: primary.body.answer_layout, historical_selection: primary.body.historical_selection } : {}),
            ...(primary?.body.seller_move_analysis ? { seller_move_analysis: primary.body.seller_move_analysis, answer_layout: primary.body.answer_layout } : {}),
            conversation_state: conversationState,
            ...(contractEvidence?.body.contract_scenario ? {contract_scenario:contractEvidence.body.contract_scenario}: {}),
            ...(contractEvidence?.body.cap_strategy ? {cap_strategy:contractEvidence.body.cap_strategy}: {}),
            ...(contractEvidence?.body.funding_observations ? {funding_observations:contractEvidence.body.funding_observations}: {}),
            ...((contractEvidence?.body.saved_contract_reference??primary?.body.saved_contract_reference) ? {saved_contract_reference:contractEvidence?.body.saved_contract_reference??primary?.body.saved_contract_reference}: {}),
            ...(primary?.body.saved_contract_lookup ? {saved_contract_lookup:primary.body.saved_contract_lookup}: {}),
            ...(primary?.body.example_query ? {example_query:primary.body.example_query}: {}),
            ...(evaluationEvidence ? {evaluation_query:evaluationEvidence.body.evaluation_query,evaluation_result:evaluationEvidence.body.evaluation_result} : {}),
            ai_analysis: { outcome:primary?.body.saved_contract_lookup?.status==='not_found'&&!contractEvidence?'needs_input':'complete', withheld_numeric_sentences:withheldSentences, model: servingModel, model_config:analystModelMetadata(response), elapsed_ms: Date.now() - started, tool_names: toolNames, assumptions: stringList(args.assumptions, 'assumptions'),pipeline_version:'analyst_v2',stage_ms:{...stageMs},repair_count:Math.min(finalFailures,1),validation_outcome:'passed',evidence_hash:evidenceFingerprint(catalog) },
          }, sources };
          const authored: AnalystAuthoredProse = { answer: interpretation, findings,
            caveats: stringList(args.caveats, 'caveats'), assumptions: stringList(args.assumptions, 'assumptions'), followups: draft.body.followups,
            scenario_state: conversationState };
          const categoricalIssues = categoricalGroundingIssues(authored, [...evidence.values()]);
          let issues: string[];
          const reviewStart=Date.now();
          options.onEvidence?.([...evidence.values()].map(forModel));
          try {
            issues = options.reviewDraft ? await options.reviewDraft(draft, [...evidence.values()].map(forModel)) : await reviewNflAnalystSemantics({
              question, user_context: history.slice(-8).map(turn => turn.question), authored, selected_answer: answer, selected_tables: tables, evidence: [...evidence.values()].map(item=>{
                // Exact quantities have already been bound by code. Preserve the
                // source tables, calculations and caveats without repeating every
                // cell again as a fact catalog and an answer-statement catalog.
                const {facts,fact_fields,answer_statements,...reviewEvidence}=forModel(item);
                return reviewEvidence;
              }),
              tool_coverage: { examples: nflExampleCoverage, contract_dossiers:getNflContractDossierCoverage(), tools: nflAnalystTools.filter(t => t.name !== 'finish_analysis').map(t => ({name: t.name, description: t.description?.split('. ').slice(0,2).join('. ')})) },
            }, { callModel:options.callModel, onTrace:options.onTrace, timeoutMs: Math.min(120_000, Math.max(1, deadlineMs - (Date.now() - started))) });
          } catch(error) { stageMs.review+=Date.now()-reviewStart; options.onTrace?.({stage:'review_error',error:String(error)}); return partial('The factual interpretation review could not finish.'); }
          stageMs.review+=Date.now()-reviewStart;
          options.onTrace?.({stage:'review',issues,elapsed_ms:Date.now()-reviewStart});
          issues=[...quantitativeIssues,...categoricalIssues,...issues];
          if (issues.length) throw new Error('Revise these material issues together and resubmit finish_analysis once: ' + issues.join(' | '));
          draft.body.ai_analysis!.elapsed_ms = Date.now() - started;
          draft.body.ai_analysis!.grounding_checked = true;
          draft.body.ai_analysis!.stage_ms={...stageMs};
          return draft;
        }
        if (tool.name === 'set_scenario') {
          const priorObjective = conversationState?.active.objective;
          applyScenario(tool.input);
          if (conversationState!.active.objective !== priorObjective) lastPlayerQuery = null;
          results.push({type:'tool_result',tool_use_id:tool.id,content:JSON.stringify(conversationState)});
          continue;
        }
        let prepared: FactualAnswer;
        if (tool.name === 'search_player_records') {
          const searchArgs = object(tool.input);
          if (Array.isArray(searchArgs.numeric_filters)) for (const value of searchArgs.numeric_filters) {
            const predicate = object(value);
            const n = Number(predicate.value);
            const literals = [...question.matchAll(/\$?([\d,.]+)\s*(million|[mk])?\b/gi)].map(m=>Number(m[1].replaceAll(',',''))*(/million|m/i.test(m[2]??'')?1e6:/k/i.test(m[2]??'')?1e3:1));
            if (!literals.includes(n) && !lastPlayerQuery?.numeric_filters?.some(p=>p.value===n&&p.field===predicate.field&&p.operator===predicate.operator)) throw new Error('A new numeric filter must come from an explicit user amount. Do not invent a price or usage cutoff; compare supported records first.');
          }
          lastPlayerQuery = analystPlayerQuery(tool.input, seed, lastPlayerQuery);
          prepared = analystPlayerEvidence(lastPlayerQuery, seed);
        }
        else if (tool.name === 'get_nfl_example_evidence') {
          const {inherit_previous, ...args} = object(tool.input);
          const prior = lastExampleQuery;
          if (inherit_previous && !prior) throw new Error('No previous football example to inherit.');
          const executed = { ...(inherit_previous ? prior : {}), ...args, question };
          prepared = await buildNflExampleEvidence(executed as unknown as NflExampleArgs,{previousQuery:inherit_previous ? prior as unknown as NflExampleArgs : undefined});
          prepared.body.example_query ??= executed;
          lastExampleQuery=prepared.body.example_query;
        }
        else if (tool.name === 'evaluate_nfl_options') {
          const {inherit_previous, ...args} = object(tool.input);
          if (inherit_previous && !lastEvaluation) throw new Error('There is no previous executed evaluation. Supply the role and domain.');
          const previous = inherit_previous || history.at(-1)?.body?.evaluation_result ? lastEvaluation : undefined;
          const evaluationArgs = { ...(inherit_previous ? {domain:previous!.query.domain,role:previous!.query.role} : {}), ...args } as unknown as NflOptionEvaluationArgs;
          const contractArtifacts = [
            ...history.flatMap((turn,index) => turn.body?.contract_scenario ? [{id:'prior-turn-'+index,...turn.body.contract_scenario}] : []),
            ...[...evidence.values()].flatMap(item => item.body.contract_scenario ? [{id:item.id,...item.body.contract_scenario}] : []),
          ];
          const evaluated = await buildNflOptionEvaluation(evaluationArgs,{seed,userText:question,previous,trustedCosts:evaluationCostsFromContracts(contractArtifacts)});
          lastEvaluation = evaluated.evaluation.state;
          prepared = evaluated;
        }
        else if (tool.name === 'compare_receivers') prepared = await buildNflReceiverComparison(tool.input, seed, [...history.map(t=>t.question),question].join('\n'));
        else if (tool.name === 'read_giants_cap') prepared = await buildNflCurrentAnswer('cap_space');
        else if (tool.name === 'read_nfl_rules') {
          const args=object(tool.input); const domain=args.domain;
          if(domain&&!['cba','playing_rules','league_dates'].includes(String(domain)))throw new Error('Unknown rule domain.');
          prepared = await searchNflAuthority({question:text(args.question,'rules question',1500),domain:domain as 'cba'|'playing_rules'|'league_dates'|undefined,limit:4});
        }
        else if (tool.name === 'read_saved_contract') {
          const args=object(tool.input);
          const playerName=text(args.player_name,'player name',100);
          const pinned=options.pinnedSavedContract;
          const pinnedId=pinned&&(getNflContractDossier(playerName)?.player_name??playerName)===pinned.player_name?pinned.brief_id:undefined;
          const briefId=pinnedId??(args.brief_id?text(args.brief_id,'saved brief ID',36):undefined);
          const loaded=await (options.readSavedContract??readSavedNflContract)({player_name:playerName,...(briefId?{brief_id:briefId}:{})},{session_id:options.sessionId??'',...options.savedContractScope});
          prepared=loaded;
          if(loaded.scenario_args){
            priorContractScenario=loaded.scenario_args;
            priorContractBody=undefined;
            savedContractReference=loaded.body.saved_contract_reference;
          }
        }
        else if (tool.name === 'read_contract_dossiers') prepared=contractDossiersEvidence(object(tool.input).player_names ? stringList(object(tool.input).player_names,'player names'):undefined);
        else if (tool.name === 'calculate_contract_scenario') prepared=await executeContractScenario(tool.input,[...history.map(t=>t.question),question].join('\n'),priorContractScenario as NflContractScenarioArgs|undefined,conversationState?.active,question,fundingObservationHistory,budgetBeforeTurn);
        else if (tool.name === 'nfl_contract_comparison') prepared=await executeContractComparison(tool.input,[...history.map(t=>t.question),question].join('\n'),priorContractScenario as NflContractScenarioArgs|undefined,conversationState?.active,question,fundingObservationHistory,budgetBeforeTurn);
        else if (tool.name === 'find_minimum_cap_funding') prepared=await executeCapStrategy(tool.input,priorContractScenario,priorContractBody?.cap_strategy,conversationState?.active,question,fundingObservationHistory,budgetBeforeTurn);
        else if (tool.name === 'read_trade_history') prepared=await analystTradeEvidence(tool.input,options.loadTradeSnapshot);
        else throw new Error('Unknown data tool.');
        if(prepared.body.contract_scenario&&savedContractReference){
          const reference=savedContractReference;
          const moves=(prepared.body.contract_scenario.args as NflContractScenarioArgs).moves;
          if(moves.some(move=>move.action==='acquire'&&(getNflContractDossier(move.player_id)?.player_name??move.player_id)===reference.player_name)){
            prepared.body.saved_contract_reference=structuredClone(reference);
            const source=savedContractSource(reference);source.ref_index=prepared.sources.length+1;prepared.sources.push(source);
            prepared.body.supporting_details=[...(prepared.body.supporting_details??[]),{label:'Saved contract used',body:`${reference.player_name} · saved ${reference.saved_at}; ${reference.selection_basis.replaceAll('_',' ')}. Current scenario constraints apply separately.`,source_refs:[source.ref_index]}];
          }
        }
        const executed=register(prepared,tool.name==='search_player_records',true);
        // The calculator independently binds current user inputs. Adopt those
        // checked values even when the model did not call set_scenario first.
        // A later state change still triggers the finish-time mismatch guard.
        if(executed.body.contract_scenario)adoptExecutedState(executed);
        results.push({ type: 'tool_result', tool_use_id: tool.id, content: JSON.stringify(forModel(executed)) });
      } catch (error) {
        console.info('[nfl analyst] validation',tool.name,error instanceof Error?error.message:'lookup failed');
        options.onTrace?.({stage:'validation',tool:tool.name,error:error instanceof Error?error.message:'Lookup unavailable'});
        if (tool.name === 'finish_analysis'&&!finishFailedThisRound){finishFailedThisRound=true;if(++finalFailures>1)return partial('The written answer failed evidence validation.');}
        results.push({ type: 'tool_result', tool_use_id: tool.id, is_error: true, content: error instanceof Error ? error.message : 'Lookup unavailable.' });
      }
    }
    if(!calls.some(t=>t.name==='finish_analysis'))stageMs.retrieval+=Date.now()-batchStart;
    messages.push({ role: 'user', content: results });
  }
  return partial('The written analysis did not finish.');
}
