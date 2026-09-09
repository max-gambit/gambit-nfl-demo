import { cleanNflAnalystProse } from '@shared/nflReceiverPresentation';
import { searchNflAuthority } from '../nfl_authority/index.js';
import { describeNflIllustrativeTerms, getNflContractDossier, getNflContractDossierCoverage, NFL_CONTRACT_SCENARIO_TOOL_SCHEMA, type NflContractScenarioArgs, type NflContractScenarioResult } from '../nfl_contracts/index.js';
import { contractDossiersEvidence, executeContractScenario, explicitPlayerProtections } from '../nfl_conversation/contract_tools.js';
import { buildNflExampleEvidence, nflExampleTool, nflExampleCoverage, type NflExampleArgs } from '../nfl_examples/evidence.js';
import { buildNflReceiverComparison, nflReceiverTool, officialReceivingTotals } from '../nfl_scouting/evidence.js';
import { nflScenarioTool, updateNflConversationState, userMoneyAmounts } from '../nfl_conversation/state.js';
import { resolveEvidenceProse } from '../nfl_conversation/grounding.js';
import type Anthropic from '@anthropic-ai/sdk';
import type { DataAnalysisBriefBody, DataAnalysisTable } from '@shared/types';
import type { NflFactualQuery, NflRosterNumericFilter } from '@shared/nflFacts';
import { BRIEF_MODEL, createClaudeMessage } from '../claude/client.js';
import { loadCurrentNflDataWithMode, type NflDemoSeed } from '../nfl_data/seed.js';
import { rosterFactsAnswer, historicalPackageAnswer, type FactualAnswer } from './answer.js';
import { buildNflCurrentAnswer } from '../nfl_current/analysis.js';
import { buildNflRuleAnswer } from '../nfl_rules/analysis.js';
import { analyzeNflTransactionMarket } from '../nfl_transactions/analyze.js';
import { loadCurrentNflTransactionMarketSnapshot } from '../nfl_transactions/seed.js';
import { factualMarketAnswer } from '@shared/nflAnswerDepth';
import { deterministicMarketSourceRows, deterministicMarketEventSourceRows } from '../claude/nfl_transaction_market_guardrails.js';

export interface AnalystTurn { question: string; body: DataAnalysisBriefBody | null }
interface AnalystOptions {
  history?: AnalystTurn[];
  initialEvidence?: FactualAnswer;
  loadData?: typeof loadCurrentNflDataWithMode;
  callModel?: typeof createClaudeMessage;
  deadlineMs?: number;
  prefetch?: boolean;
  reviewDraft?: (draft: FactualAnswer, evidence: unknown[]) => Promise<string[]>;
}
interface Evidence extends FactualAnswer { id: string; rowRefs?: number[][]; executed?: boolean }
const positions = ['QB', 'RB', 'WR', 'TE', 'OT', 'IOL', 'EDGE', 'IDL', 'LB', 'CB', 'S', 'ST'];
const numericFields = ['age', 'cap_2026', 'starts_2025', 'snaps_2025', 'games_2025'];
const sorts = ['name', 'cap_asc', 'cap_desc', 'starts_asc', 'starts_desc', 'snaps_asc', 'snaps_desc', 'games_asc', 'games_desc', 'age_asc', 'age_desc'];
const strings = (description: string) => ({ type: 'array', items: { type: 'string' }, description });
const integerRefs = { type: 'array', items: { type: 'integer', minimum: 1 } };

export const NFL_ANALYST_SYSTEM = `You are Gambit's AI analyst working with the New York Giants front office. Understand the user's football problem, investigate it with the available tools, and give a useful, evidence-backed answer. You can reason, synthesize, compare approaches and suggest next investigations. Do not make the user speak a query language.

INTERPRET THE REQUEST
- Treat we/our/us as NYG unless another club is specified. Separate the situation from the action requested: an injured Giants player can motivate an outside acquisition search without being the player to acquire or trade away.
- A user's injury statement is scenario context, not a verified diagnosis. Work with the scenario naturally (for example, "With Nabers' availability in doubt..."); do not turn every contextual adjective into a filter or demand that the user remove it.
- Understand ordinary language such as "without blowing up our cap", "someone who has actually played", "cheaper", "what about...", and "keep the same budget". Preserve concrete numeric constraints and exclusions through follow-ups. Never silently discard a condition, change a strict bound, or equate missing with zero.
- A vague budget is a preference, not an arbitrary numerical cutoff. You may investigate illustrative price bands if you identify them as your working screen, or ask one focused budget question while still providing useful analysis. Explicit user limits are mandatory.
- Use the conversation to resolve pronouns, motivations and changed assumptions. An earlier parser error is not the user's intended constraint. Ignore parser debris in old answers and interpret the original user words.

INVESTIGATE AND REASON
- Use supplied initial_evidence first. If it already supports the answer, finish immediately and do not repeat lookups. For receiver value questions, prefer compare_receivers for like-for-like production and attributed evaluations. Use search_player_records to broaden the cohort only when the user asks. Call data tools before making player-specific or numerical claims. Use several lookups in parallel when useful. Search outside NYG for acquisitions. Query enough records to make a meaningful comparison, then select a small set to show and explain why those records are relevant.
- For a cap-sensitive acquisition question, read the Giants cap position as well as player records. Use receiving yards and offensive usage when discussing receivers. A low cap charge by itself is not evidence of useful receiving production.
- Current-team cap charges, scheduled annual cash, acquiring-team cap costs and trade compensation are different things. Never label a player's current-team cap hit as the Giants' cost to acquire him. Exact incoming cap cost needs remaining unpaid compensation, transferred guarantees, timing and contract terms; it is not established by these snapshot columns. Never certify affordability from these numbers.
- A shorter active contract is a shorter recorded term, not proof of no future obligations, a clean exit, or a shorter guaranteed tail. Compare guaranteed liability only from complete year-by-year guarantee terms and transaction assumptions; otherwise describe the recorded term. Do not promise an exact incoming cost from a budget alone. For receiver comparisons, read each player's Team / scope field before calling him internal or external.
- Current roster status does not prove a player is available for trade, a free agent, healthy, on the block or willing to sign. Do not invent seller willingness, asking prices, medical prognoses, scouting traits or future performance. Specific contract-year claims require the returned contract-end field. Unknown means unknown, not zero or unavailable as a player.
- Discuss acquisition routes and tradeoffs as analysis, with any unverified seller/role assumptions explicit. Qualified judgments such as "may be attainable" are welcome when you explain sound reasoning from the contract, usage, roster context or a clearly stated scenario. Confirmed seller interest is NOT required for a conditional judgment. Make the reasoning useful and distinguish an inference from an established fact. You may identify which records deserve investigation and why. A cheap productive star is not automatically a practical target solely because his current cap charge is low. Claims about a team's current depth require a roster/usage lookup; hypothetical seller motivations can be framed as hypotheses to test.
- Dates on the tools are snapshot dates. Do not freshen sources, assume the public cap observations reconcile, or convert historical transactions into current asking prices. Consult the rules tool for technical transaction-rule claims.
- Do not claim that a player led the whole room in a metric if any relevant player's metric is unknown. Observed yards and games are not measures of talent, upside or current health. Do not label a player the highest-upside/best talent without an attributed evaluation. Keep rankings to the specified evidence and method.
- If a tool returns an explicit coverage gap, finish with that exact answer statement and explain the useful next input. Do not repeat a lookup or substitute another player to obtain a probability or current medical claim.
- If one field is missing, explain that particular gap in normal English and continue the useful supported analysis. Do not refuse the entire football question because it contains contextual language or an unsupported statistic.

- Make an acquisition shortlist useful for actual calls. Lead with a few plausible investigation candidates and explain the contract/usage rationale for each. Cheap stars who are probably retained can explain a tradeoff in one sentence; they should not dominate the recommendation or table. Do not infer a rookie contract from a low cap charge, age or draft history: a player may have signed an extension. Use only the recorded contract terms.

- Negative dated public cap observations do not establish that the Giants are currently over the cap, have no room, or must offset every acquisition. Their accounting bases disagree and are not the club ledger. Explain that they suggest cost pressure, conditional on reconciliation. Keep this qualification with the claim and keep it brief; lead with the football recommendation, not an extended cap disclaimer. A stated budget narrows profiles; it does not let these snapshot fields establish exact affordability.

- Missing historical usage means this dataset cannot compare that player's workload; it does not imply inexperience or establish that someone else is the team's only proven/full-time player. Say "among the records available" when coverage is incomplete. Use the recorded NFL-experience field for career-stage claims. A workload comparison does not establish who will absorb targets, outside/slot assignments, pedigree or upside; frame role ideas as hypotheses that need coaching/scouting evidence.

WRITE THE ANSWER
- Lead with the players, options or football tradeoff that answers the actual question, in natural, connected prose. Do not open with sorting rules, dossier/snapshot terminology, evidence-policy disclaimers or a roll call of statistics. Methodology and supporting records belong in the comparison details. Mention a missing input in the lead only when it prevents the requested conclusion; keep other material qualifications beside their affected claim. Keep the lead to about eighty words, with 2-3 short supporting findings and 3-6 player rows when helpful. Avoid repetitive disclaimers, internal tool/schema labels and process narration. Do not repeat the entire answer in the findings.
- For a receiver shortlist, focus the opening on whom to investigate, recorded production versus active contract length, and the internal alternative. Do not discuss or rank guarantees in this summary: the receiver comparison does not calculate transferred liability. Do not append the public-cap accounting warning when you have made no affordability claim, or end with a generic offer to model something. The interface already provides labeled tables, relevant limits and follow-ups.
- Use plain prose in string fields; the interface supplies headings and typography. Do not use Markdown headings, bold markers or raw source tokens in prose. Put exact numeric source refs in findings; tools own all source links and tables.
- Select tables/rows/columns from tool results. Do not invent table cells or calculate new figures in narrative. Copy figures from the retrieved evidence. Label current-team cap clearly. State essential qualifications next to the affected assertion rather than burying them.
- Keep ALL numerical facts in tool-owned tables/calculations. Prose and table titles must contain no numbers, spelled-out quantities, money, dates or cell tokens. Use qualitative prose: this year, last season, current deal, a shorter commitment. Never turn the model prose into a calculator.
- Before calculation, call set_scenario if changing a budget or protected player, or restoring an earlier scenario. Put it before calculation in the same tool batch. A new objective must use fresh search scope. Omit unchanged state fields. Include scenario in finish_analysis for other objective changes. Do not clear earlier constraints without a user request.
- Keep the final answer to a short paragraph and use at most two findings and two tables. Do not repeat evidence in prose. For exact quantitative results or a reviewed rule statement, select answer_statements by ID: code inserts the complete statement with its source refs. Copy result IDs, never rewrite figures. A final response must include answer and may omit empty arrays. Do not add prose containing a number that you intend code to remove.
- Use finish_analysis to submit the final answer. Select the evidence that owns the main question and the player-query lookup that should carry into the next turn. Propose useful follow-ups as requests the user can click, such as "Compare the lower-cost players with the most receiving usage." Ask any needed budget question in the answer, not as a clickable button that repeats your question back to you. Do not submit a list of keyword filters as the answer.
- Communicate only through tool calls. Do not write a draft as a text block before finish_analysis. Before submitting, check every named player's contract year and statistic against that exact row's field names, and check every source reference.`;

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
  nflScenarioTool as Anthropic.Tool,
  {name:'read_contract_dossiers',description:'Inspect all years, active versus void, guarantees and source conflicts in the eight deep public contract dossiers. Includes originals from other teams; never implies incoming cost.',input_schema:{type:'object',properties:{player_names:{type:'array',items:{type:'string'}}},additionalProperties:false}},
  {name:'calculate_contract_scenario',description:'Read-only simulation, never a real transaction. Call even for a protected-player conflict to show the explicit blocked result. Calculate hold, trade, release, salary-conversion restructure or an acquisition with complete literal user-supplied illustrative terms. Code owns all figures and future-year obligations. This replaces broad estimated lever columns for numerical scenarios. Every new amount must be supplied by the user; incomplete incoming terms remain blocked.',input_schema:NFL_CONTRACT_SCENARIO_TOOL_SCHEMA as unknown as Anthropic.Tool.InputSchema},
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
    answer_statements: {type:'array', maxItems:3, items:{type:'string'}, description:'Exact complete tool-authored statements to include before your qualitative interpretation. IDs are listed in answer_statements on evidence. Select only statements that answer the current question.'},
    answer: { type: 'string' },
    key_findings: { type: 'array', maxItems: 5, items: { type: 'object', properties: { label: { type: 'string' }, body: { type: 'string' }, source_refs: integerRefs }, required: ['label', 'body', 'source_refs'], additionalProperties: false } },
    tables: { type: 'array', maxItems: 4, items: { type: 'object', properties: { table_id: { type: 'string' }, title: { type: 'string',description:'Optional presentation label; code preserves the original evidence title.' }, row_ids: strings('Exact row IDs from this table, e.g. r0. Never use source refs as row IDs.'), column_names: strings('Exact column names from this table.') }, required: ['table_id', 'title', 'row_ids', 'column_names'], additionalProperties: false } },
    evidence_id: { type: 'string' }, continuation_query_id: { type: 'string' },
    caveats: strings('Only material qualifications, expressed in plain English.'),
    assumptions: strings('User-supplied scenarios and clearly labeled working assumptions, never inferred medical facts.'),
    followups: { type: 'array', maxItems: 3, items: { type: 'string' } },
  }, required: ['answer', 'key_findings', 'tables', 'evidence_id', 'continuation_query_id', 'caveats', 'assumptions', 'followups'], additionalProperties: false } },
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
  const result = rosterFactsAnswer(query, seed);
  const table = result.body.tables[0];
  if (!table) return result;
  table.columns[4] = '2026 cap at current team';
  const receiving = query.position_groups.some(position => ['WR', 'TE'].includes(position)) || table.rows.every(row => ['WR', 'TE'].includes(String(row[2])));
  const money = (value: number | null | undefined) => value == null ? 'Not recorded' : '$' + value.toLocaleString('en-US');
  table.columns.push('2026 snapshot scheduled cash', 'Last active contract year / basis', ...(receiving ? ['2025 receiving yards', '2025 offensive snaps'] : []), 'NFL experience (years)');
  for (const values of table.rows) {
    const cap = seed.cap_rows.find(row => row.player_name === values[0] && row.team_id === values[1]);
    const metric = seed.player_metrics.find(row => row.player_name === values[0] && row.team_id === values[1]);
    const officialReceiving=receiving?officialReceivingTotals(String(values[0])):null;
    if(officialReceiving)values[7]=String(officialReceiving.games);
    if(metric&&!metric.metric_families?.includes('nflverse_snap_counts'))values[6]='Not recorded';
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
    return start === end
      ? historicalPackageAnswer('Only ' + start + '.', market, { ...selected.body.historical_selection!, years: [start] })
      : selected;
  }
  return { body: factualMarketAnswer(market), sources: [...deterministicMarketSourceRows(market, 1), ...deterministicMarketEventSourceRows(market, market.source_refs.length + 1)] };
}

export async function buildNflAiAnswer(question: string, options: AnalystOptions = {}): Promise<FactualAnswer> {
  const started = Date.now();
  const loaded = await (options.loadData ?? loadCurrentNflDataWithMode)();
  const seed = structuredClone(loaded.seed);
  for(const cap of seed.cap_rows){if(getNflContractDossier(cap.player_name)?.source_status==='source_conflict'){cap.source_status='source-needed';for(const key of Object.keys(cap)){if(typeof (cap as unknown as Record<string,unknown>)[key]==='number'&&key!=='source_order')(cap as unknown as Record<string,unknown>)[key]=null;}}}
  const history = options.history ?? [];
  const previousQuery = [...history].reverse().find(turn => turn.body?.factual_query)?.body?.factual_query ?? null;
  let lastPlayerQuery = previousQuery;
  let lastExampleQuery=history.at(-1)?.body?.example_query;
  const priorContractScenario=[...history].reverse().find(t=>t.body?.contract_scenario)?.body?.contract_scenario?.args as NflContractScenarioArgs|undefined;
  let conversationState = structuredClone(history.at(-1)?.body?.conversation_state);
  if(conversationState)conversationState.active.protected_player_names=explicitPlayerProtections(question,conversationState.active.protected_player_names).names;
  const applyScenario=(input:unknown)=>{
    const next=updateNflConversationState(input,conversationState,question);
    const explicit=explicitPlayerProtections(question,conversationState?.active.protected_player_names??[]);
    // A refinement cannot silently remove a protection. New objectives are
    // isolated by updateNflConversationState; explicit changes apply now.
    if(next.active.objective===conversationState?.active.objective||['acquisition','contract'].includes(next.active.objective)&&['acquisition','contract'].includes(conversationState?.active.objective??''))next.active.protected_player_names=explicitPlayerProtections(question,[...next.active.protected_player_names,...explicit.names]).names;
    else next.active.protected_player_names=explicitPlayerProtections(question,next.active.protected_player_names).names;
    conversationState=next;
  };
  const deadlineMs = options.deadlineMs ?? 28_000;
  const evidence = new Map<string, Evidence>();
  const sources: FactualAnswer['sources'] = [];
  const toolNames: string[] = [];
  let servingModel = BRIEF_MODEL;

  const register = (answer: FactualAnswer, isPlayerSearch = false, executed = false): Evidence => {
    const id = 'lookup_' + (evidence.size + 1);
    const sourceMap = new Map<number, number>();
    for (const source of answer.sources) {
      const ref = sources.length + 1;
      sourceMap.set(source.ref_index, ref);
      sources.push({ ...source, ref_index: ref });
    }
    const remap = (refs: number[]) => refs.map(ref => sourceMap.get(ref)).filter((ref): ref is number => ref != null);
    const body = { ...answer.body,
      ...(answer.body.supporting_details ? { supporting_details: answer.body.supporting_details.map(row => ({ ...row, source_refs: remap(row.source_refs) })) } : {}),
      key_findings: answer.body.key_findings.map(row => ({ ...row, source_refs: remap(row.source_refs) })),
      tables: answer.body.tables.map(row => ({ ...row, source_refs: remap(row.source_refs) })),
      calculations: answer.body.calculations.map(row => ({ ...row, source_refs: remap(row.source_refs) })),
      ...(answer.body.contract_scenario?{contract_scenario:{...answer.body.contract_scenario,tables:answer.body.contract_scenario.tables?.map(t=>({...t,source_refs:remap(t.source_refs)})),calculations:answer.body.contract_scenario.calculations?.map(c=>({...c,source_refs:remap(c.source_refs)}))}}:{}),
    };
    const item: Evidence = { id, body, executed, sources: answer.sources.map(source => ({ ...source, ref_index: sourceMap.get(source.ref_index)! })),
      ...(isPlayerSearch && body.tables[0] ? { rowRefs: body.tables[0].rows.map((_, index) => [sourceMap.get(answer.sources[index]?.ref_index) ?? body.tables[0].source_refs[0]]) } : {}),
    };
    evidence.set(id, item);
    return item;
  };
  const adoptExecutedState=(item:Evidence)=>{
    const body=item.body;
    const contract=body.contract_scenario;
    const receiver=body.receiver_query;
    const example=body.example_query;
    const rules=item.sources.some(s=>['CBA','NFL_RULEBOOK','NFL_CALENDAR'].includes(s.kind??''))&&!contract&&!body.seller_move_analysis;
    const objective=contract||body.seller_move_analysis?'contract':receiver?receiver.candidate_scope==='internal'?'internal_roster':'acquisition':example?String(example.domain):body.market_analysis?'history':body.factual_query?body.factual_query.team_ids.length===1&&body.factual_query.team_ids[0]==='NYG'&&!body.factual_query.exclude_nyg?'internal_roster':'acquisition':rules?'rules':undefined;
    if(!objective)return;
    const next=updateNflConversationState({objective},conversationState,question);
    if(receiver){next.active.candidate_scope=receiver.candidate_scope as 'external'|'internal'|'both';next.active.horizon=receiver.priority==='contract_horizon'?'Remaining reported active contract years':'2025 receiving evidence';next.active.transaction=receiver.candidate_scope==='internal'?'hold':'none';}
    if(example){next.active.horizon=String(example.domain==='college'?'Historical 2025 draft class':'Historical 2025 season');next.active.candidate_scope='unspecified';next.active.transaction='none';}
    if(body.factual_query){const q=body.factual_query;next.active.candidate_scope=q.exclude_nyg?'external':q.team_ids.length===1&&q.team_ids[0]==='NYG'?'internal':'both';next.active.objective=next.active.candidate_scope==='internal'?'internal_roster':'acquisition';}
    if(contract){
      const a=contract.args as NflContractScenarioArgs;const r=contract.result as NflContractScenarioResult;
      next.active.team_id=a.team_id;next.active.budget=a.budget??null;next.active.transaction=a.moves.length===1?a.moves[0].action:'none';next.active.horizon=a.season+' and all modeled later contract years';
      next.active.candidate_scope=a.moves.some(m=>m.action==='acquire')?'external':'internal';
      next.active.protected_player_names=(a.protected_player_ids??[]).map(id=>getNflContractDossier(id)?.player_name??id);
      next.active.supplied_terms=a.moves.flatMap(m=>m.illustrative_terms?describeNflIllustrativeTerms(m):m.conversion_amount!=null?['Requested conversion for '+m.player_id+': $'+m.conversion_amount.toLocaleString('en-US')]:[]);
      next.active.unresolved_inputs=r.issues.map(i=>i.message).slice(0,20);
    }
    next.active.protected_player_names=explicitPlayerProtections(question,next.active.protected_player_names).names;
    conversationState=next;
  };
  const forModel = (item: Evidence) => ({
    lookup_id: item.id, answer: item.body.answer, selection: item.body.factual_query,receiver_selection:item.body.receiver_query,example_selection:item.body.example_query,
    answer_statements: [{id:item.id+':answer',text:item.body.answer}, ...item.body.key_findings.flatMap((f,i)=>f.label==='Rule summary'?[{id:item.id+':finding:'+i,text:f.body}]:[])], findings: item.body.key_findings, supporting_details: item.body.supporting_details, calculations: item.body.calculations, caveats: item.body.caveats,
    tables: item.body.tables.map((table, index) => ({ table_id: item.id + ':' + index, title: table.title, columns: table.columns, rows: table.rows.map((values, rowIndex) => ({ row_id: 'r' + rowIndex, fields: Object.fromEntries(table.columns.map((column, index) => [column, values[index]])), source_refs: index === 0 && item.rowRefs ? item.rowRefs[rowIndex] : table.source_refs })) })),
    sources: item.sources.map(source => ({ ref: source.ref_index, title: source.title, source: source.source, as_of: source.updated_at })),
  });
  const initialPlayer=options.initialEvidence?.body.seller_move_analysis?.result?.player.player_name;
  const initial = options.initialEvidence ? register(initialPlayer&&getNflContractDossier(initialPlayer)?.source_status==='source_conflict'?contractDossiersEvidence([initialPlayer]):options.initialEvidence) : null;
  const relevantToReceivers = /receiver|\bWR\b/i.test(question) || ['acquisition','internal_roster'].includes(conversationState?.active.objective ?? '') || /receiver|\bWR\b/i.test(history.at(-1)?.question ?? '');
  if (options.prefetch !== false && relevantToReceivers && !/college|draft|prospect|tight end|hypothetical|signing.bonus|conversion|restructure|recalculate/i.test(question)) {
    try {
      const scope = /(?:already|existing|only).*roster|our roster instead|internal only/i.test(question) ? 'internal' : 'both';
      const priority = /flexibility|next.year|overcommitt/i.test(question) && !/production over|prioritize (?:receiving )?production/i.test(question) ? 'contract_horizon' : 'receiving_production';
      register(await buildNflReceiverComparison({candidate_scope:scope,priority}, seed, [...history.map(t=>t.question),question].join('\n')));
      register(await buildNflCurrentAnswer('cap_space'));
      if(scope!=='internal')register(contractDossiersEvidence(['Courtland Sutton','Jakobi Meyers','Christian Kirk']));
    } catch { /* Prefetch failure does not substitute a different player cohort. */ }
  }

  if(options.prefetch!==false){
    const domain=/Warren/i.test(question)&&/Loveland/i.test(question)||/same college comparison|historical draft prospects/i.test(question)?'college':/availability timeline|practice.label changes|historical.*(?:practice|availability)|Andrew Thomas.*participation/i.test(question)?'availability':/captured.*(?:sample|regular.season).*|same weeks/i.test(question)&&/offense|Giants|Dallas|Kansas City|third down|red zone/i.test(question)?'coaching':undefined;
    if(domain){
      const args:Record<string,unknown>={...(lastExampleQuery?.domain===domain?lastExampleQuery:{}),domain,question};
      // A changed role or situation is interpreted from the actual new text.
      if(domain==='college')delete args.collegePriority;
      if(domain==='availability'&&/all|changes|report/i.test(question))args.playerName='all';
      if(domain==='coaching'){delete args.situation;delete args.teamId;delete args.comparisonTeamId;}
      const prepared=await buildNflExampleEvidence(args as unknown as NflExampleArgs);prepared.body.example_query??=args;lastExampleQuery=prepared.body.example_query;register(prepared,false,false);
    }
  }

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: JSON.stringify({
    question, today: new Date().toISOString().slice(0, 10), roster_as_of: seed.as_of_date, historical_usage_season: 2025, source_mode: loaded.source_mode,
    contract_dossier_coverage: getNflContractDossierCoverage(), previous_contract_scenario: priorContractScenario,
    known_gaps: ['No verified current medical status, seller availability, asking prices or club-certified cap ledger.', 'Recorded age may be unavailable. Current team cap is not acquiring-team cap cost.'],
    team_ids: seed.teams.map(team => team.team_id), roster_status_codes: [...new Set(seed.roster_entries.map(row => row.roster_status))],
    conversation: history.slice(-8).map(turn => ({ question: turn.question, answer: turn.body?.answer, findings: turn.body?.key_findings, tables: turn.body?.tables, player_selection: turn.body?.factual_query, assumptions: turn.body?.ai_analysis?.assumptions, scenario:turn.body?.conversation_state?.active, receiver_query:turn.body?.receiver_query, example_query:turn.body?.example_query, contract_scenario:turn.body?.contract_scenario?.args })),
    previous_player_selection: previousQuery, scenario_state: conversationState, example_coverage: nflExampleCoverage, previous_example_query: history.at(-1)?.body?.example_query,
    initial_evidence: [...evidence.values()].map(forModel),
  }) }];
  const call = options.callModel ?? createClaudeMessage;
  // Exact cells, calculations and source IDs are validated in code. An optional
  // external reviewer is a test/audit hook, never another model latency gate.
  const review = options.reviewDraft ?? (async () => []);
  const partial = (reason: string): FactualAnswer => {
    const selected = [...evidence.values()].filter(e=>e.executed).at(-1) ?? [...evidence.values()].find(e=>e.body.receiver_query) ?? [...evidence.values()].at(-1);
    if(selected)adoptExecutedState(selected);
    const body: DataAnalysisBriefBody = selected ? { ...selected.body,
      answer: 'The checked evidence is ready below. The written analysis did not finish, so this is an evidence view; it does not complete the requested comparison.',
    } : { kind:'data_analysis', answer:'The analyst could not retrieve enough evidence to answer this question. Your question is saved; retry it to continue.', key_findings:[], tables:[], calculations:[], caveats:[], followups:[] };
    body.language_policy = 'facts_only_v1';
    body.caveats = [...body.caveats, 'Analysis incomplete: ' + reason];
    body.conversation_state = conversationState;
    body.ai_analysis = { model: servingModel, elapsed_ms: Date.now()-started, tool_names:toolNames, assumptions:conversationState?.active.assumptions ?? [], outcome:selected ? 'evidence_only':'unavailable', grounding_checked:false };
    body.followups = [question];
    return { body, sources };
  };
  let finalFailures = 0;
  for (let round = 0; round < 6; round++) {
    if (Date.now() - started > deadlineMs) return partial('Response deadline reached.');
    let response: Anthropic.Message;
    try { response = await call({ model: BRIEF_MODEL, max_tokens: 2500, output_config:{effort:'low'}, system: NFL_ANALYST_SYSTEM, tools: nflAnalystTools,
      tool_choice: { type: 'auto' }, messages,
    }, { timeout: Math.max(1, deadlineMs - (Date.now() - started)), maxRetries: 0 });
    } catch (error) { return partial(error instanceof Error && /timeout|timed out|abort/i.test(error.message) ? 'Response deadline reached.' : 'The analysis provider is unavailable.'); }
    console.info('[nfl analyst] round',round+1,'elapsed_ms',Date.now()-started,'output_tokens',response.usage.output_tokens,'stop',response.stop_reason,'tools',response.content.filter(b=>b.type==='tool_use').map(b=>(b as Anthropic.ToolUseBlock).name).join(','));
    servingModel = response.model;
    const calls = response.content.filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use');
    if (!calls.length) {
      messages.push({ role: 'assistant', content: response.content }, { role: 'user', content: 'Use the data tools to investigate, then submit with finish_analysis. Do not answer outside that tool.' });
      continue;
    }
    messages.push({ role: 'assistant', content: response.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tool of calls) {
      toolNames.push(tool.name);
      try {
        if (tool.name === 'finish_analysis') {
          if (calls.length !== 1) throw new Error('Submit finish_analysis on its own after reading the tool results.');
          if (!evidence.size) throw new Error('Retrieve relevant evidence before submitting.');
          const args = object(tool.input);
          for(const key of ['key_findings','tables','caveats','assumptions','followups']) if(args[key]==null)args[key]=[];
          if (args.scenario) applyScenario(args.scenario);
          const primaryId = text(args.evidence_id, 'evidence_id');
          const primary = primaryId ? evidence.get(primaryId) : null;
          if (primaryId && !primary) throw new Error('Unknown evidence_id.');
          if(primary?.body.contract_scenario&&conversationState){
            const executed=primary.body.contract_scenario.args as NflContractScenarioArgs;
            const expected=explicitPlayerProtections(question,conversationState.active.protected_player_names).names;
            for(const move of (primary.body.contract_scenario.result as NflContractScenarioResult).moves){if(move.action!=='hold'&&expected.includes(move.player_name)&&!move.issues.some(i=>i.code==='PROTECTED_PLAYER'))throw new Error('Protection changed after calculation. Recalculate with the current scenario before finishing.');}
            const executedBudget=executed.budget??null;
            if(JSON.stringify(conversationState.active.budget)!==JSON.stringify(executedBudget)&&conversationState.active.budget)throw new Error('Budget changed after calculation. Recalculate with the current budget before finishing.');
            conversationState.active.budget=executedBudget;
            conversationState.active.protected_player_names=executed.protected_player_ids?.map(id=>getNflContractDossier(id)?.player_name??id)??[];
          }

          const queryId = text(args.continuation_query_id, 'continuation_query_id');
          const queryEvidence = queryId ? evidence.get(queryId) : undefined;
          const query = queryEvidence?.body.factual_query;
          if (queryId && !queryEvidence) throw new Error('continuation_query_id must identify retrieved evidence.');
          const refs = (value: unknown): number[] => {
            if (!Array.isArray(value) || value.some(ref => !Number.isInteger(ref) || ref < 1 || ref > sources.length)) throw new Error('Use only retrieved source refs.');
            return [...new Set(value)];
          };
          if (!Array.isArray(args.key_findings) || !Array.isArray(args.tables)) throw new Error('Invalid findings or table selection.');
          let withheldSentences=0;
          const prose = (value: unknown, label: string, max = 6000) => cleanNflAnalystProse(text(value,label,max)).split(/(?<=[.!?])\s+/).filter(sentence=>{try{resolveEvidenceProse(sentence,evidence);return true;}catch{withheldSentences++;return false;}}).join(' ');
          const findings = args.key_findings.slice(0,5).map(value => { const row = object(value); return { label: prose(row.label, 'finding label', 120), body: prose(row.body, 'finding body', 2500), source_refs: refs(row.source_refs) }; }).filter(row=>row.body.length>0).map(row=>({...row,label:row.label||'Evidence'}));
          const tables = args.tables.slice(0,4).map((value): DataAnalysisTable => {
            const selected = object(value);
            const tableId = text(selected.table_id, 'table ID');
            const [lookupId, index] = tableId.split(':');
            const item = evidence.get(lookupId);
            const table = /^\d+$/.test(index ?? '') ? item?.body.tables[Number(index)] : undefined;
            if (!table || !item) throw new Error('Unknown table ID.');
            const rowIds = stringList(selected.row_ids, 'table rows');
            if (rowIds.some(id => !/^r\d+$/.test(id))) throw new Error('Unknown table row ID. Copy exact row_ids from the table.');
            const indices = integerList(rowIds.map(id => Number(id.slice(1))), table.rows.length, 'table row');
            const rows = indices.length ? indices : table.rows.map((_, index) => index);
            const chosenColumns = integerList(stringList(selected.column_names, 'table columns').map(column => table.columns.indexOf(column)), table.columns.length, 'table column');
            const columns = chosenColumns.length ? chosenColumns : table.columns.map((_, index) => index);
            return { title: table.title, columns: columns.map(index => table.columns[index]), rows: rows.map(index => columns.map(column => table.rows[index][column])),
              source_refs: Number(index) === 0 && item.rowRefs ? [...new Set(rows.flatMap(index => item.rowRefs![index]))] : table.source_refs };
          });
          const statements=stringList(args.answer_statements??[],'answer statements').slice(0,3).flatMap(id=>{
            const [lookup,kind,index]=id.split(':');const item=evidence.get(lookup);if(!item)return [];
            if(kind==='answer'&&!index)return [{text:item.body.answer,refs:item.sources.map(s=>s.ref_index)}];
            const finding=kind==='finding'&&/^\d+$/.test(index??'')?item.body.key_findings[Number(index)]:undefined;
            if(!finding||finding.label!=='Rule summary')return [];
            return [{text:finding.body,refs:finding.source_refs}];
          });
          let interpretation=prose(args.answer??'', 'answer');
          const reviewedRules=primary?.body.key_findings.filter(f=>f.label==='Rule summary')??[];
          if(reviewedRules.length){statements.splice(0,statements.length,...reviewedRules.slice(0,2).map(f=>({text:f.body,refs:f.source_refs})));interpretation='';findings.splice(0,findings.length);}
          // If all quantitative narrative was withheld, retain the full executed
          // result statement. Never leave an orphan such as "New York time."
          if(!statements.length&&primary&&(withheldSentences||!interpretation||Array.isArray(args.answer_statements)&&args.answer_statements.length)){const summaries=primary.body.key_findings.filter(f=>f.label==='Rule summary');statements.push(...(summaries.length?summaries.slice(0,2).map(f=>({text:f.body,refs:f.source_refs})):[{text:primary.body.answer,refs:primary.sources.map(s=>s.ref_index)}]));}
          const receiverEvidence = queryEvidence?.body.receiver_query ? queryEvidence : primary?.body.receiver_query ? primary : undefined;
          const receiverLead = Boolean(receiverEvidence && interpretation.length >= 35);
          const supportingDetails = [
            ...(primary?.body.supporting_details ?? []),
            ...(receiverEvidence && receiverEvidence !== primary ? receiverEvidence.body.supporting_details ?? [] : []),
            ...(receiverLead ? statements.map(s => ({label:'Recorded comparison',body:s.text,source_refs:s.refs})) : []),
          ];
          const answer=receiverLead ? interpretation : [...statements.map(s=>s.text),interpretation.length>=35?interpretation:''].filter(Boolean).join('\n\n');
          if (!answer) return partial('The written answer contained only unverified quantitative prose. The labelled evidence is preserved.');
          if(!tables.length&&primary)tables.push(...primary.body.tables.slice(0,2));
          const caveats = [...new Set([...(primary?.body.caveats??[]),...stringList(args.caveats,'caveats').filter(value=>{try{resolveEvidenceProse(value,evidence);return true;}catch{return false;}})])];
          if (loaded.source_mode !== 'supabase_current_views') caveats.push('Player records are from the saved public snapshot dated ' + seed.as_of_date + '; the database was unavailable.');
          if(primary)adoptExecutedState(primary);
          const draft: FactualAnswer = { body: {
            kind: 'data_analysis', language_policy: 'grounded_ai_v1', answer, answer_source_refs:[...new Set(statements.flatMap(s=>s.refs))], ...(supportingDetails.length ? { supporting_details: supportingDetails } : {}), key_findings: findings, tables,
            calculations: primary?.body.calculations ?? [], caveats, followups: stringList(args.followups, 'followups').slice(0, 3),
            ...(query ? { factual_query: query } : {}),
            ...((queryEvidence?.body.receiver_query??primary?.body.receiver_query)?{receiver_query:queryEvidence?.body.receiver_query??primary?.body.receiver_query}:{}),
            ...(primary?.body.market_analysis ? { market_analysis: primary.body.market_analysis, answer_layout: primary.body.answer_layout, historical_selection: primary.body.historical_selection } : {}),
            ...(primary?.body.seller_move_analysis ? { seller_move_analysis: primary.body.seller_move_analysis, answer_layout: primary.body.answer_layout } : {}),
            conversation_state: conversationState,
            ...(primary?.body.contract_scenario ? {contract_scenario:primary.body.contract_scenario}: {}),
            ...(primary?.body.example_query ? {example_query:primary.body.example_query}: {}),
            ai_analysis: { outcome:'complete', withheld_numeric_sentences:withheldSentences, model: servingModel, elapsed_ms: Date.now() - started, tool_names: toolNames, assumptions: stringList(args.assumptions, 'assumptions') },
          }, sources };
          const issues = await review(draft, [...evidence.values()].map(forModel));
          if (issues.length) throw new Error('Revise these material issues and resubmit finish_analysis: ' + issues.join(' | '));
          draft.body.ai_analysis!.elapsed_ms = Date.now() - started;
          draft.body.ai_analysis!.grounding_checked = true;
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
          prepared = await buildNflExampleEvidence(executed as unknown as NflExampleArgs);
          prepared.body.example_query ??= executed;
          lastExampleQuery=prepared.body.example_query;
        }
        else if (tool.name === 'compare_receivers') prepared = await buildNflReceiverComparison(tool.input, seed, [...history.map(t=>t.question),question].join('\n'));
        else if (tool.name === 'read_giants_cap') prepared = await buildNflCurrentAnswer('cap_space');
        else if (tool.name === 'read_nfl_rules') {
          const args=object(tool.input); const domain=args.domain;
          if(domain&&!['cba','playing_rules','league_dates'].includes(String(domain)))throw new Error('Unknown rule domain.');
          prepared = await searchNflAuthority({question:text(args.question,'rules question',1500),domain:domain as 'cba'|'playing_rules'|'league_dates'|undefined,limit:4});
        }
        else if (tool.name === 'read_contract_dossiers') prepared=contractDossiersEvidence(object(tool.input).player_names ? stringList(object(tool.input).player_names,'player names'):undefined);
        else if (tool.name === 'calculate_contract_scenario') prepared=await executeContractScenario(tool.input,[...history.map(t=>t.question),question].join('\n'),priorContractScenario as NflContractScenarioArgs|undefined,conversationState?.active,question);
        else if (tool.name === 'read_trade_history') prepared=await analystTradeEvidence(tool.input);
        else throw new Error('Unknown data tool.');
        results.push({ type: 'tool_result', tool_use_id: tool.id, content: JSON.stringify(forModel(register(prepared, tool.name === 'search_player_records', true))) });
      } catch (error) {
        console.info('[nfl analyst] validation',tool.name,error instanceof Error?error.message:'lookup failed');
        if (tool.name === 'finish_analysis' && ++finalFailures > 1) return partial('The written answer failed evidence validation.');
        results.push({ type: 'tool_result', tool_use_id: tool.id, is_error: true, content: error instanceof Error ? error.message : 'Lookup unavailable.' });
      }
    }
    messages.push({ role: 'user', content: results });
  }
  return partial('The written analysis did not finish.');
}
