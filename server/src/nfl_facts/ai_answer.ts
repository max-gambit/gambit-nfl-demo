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
  editDraft?: (draft: FactualAnswer, evidence: unknown[]) => Promise<unknown>;
}
interface Evidence extends FactualAnswer { id: string; rowRefs?: number[][] }
const positions = ['QB', 'RB', 'WR', 'TE', 'OT', 'IOL', 'EDGE', 'IDL', 'LB', 'CB', 'S', 'ST'];
const numericFields = ['age', 'cap_2026', 'starts_2025', 'snaps_2025', 'games_2025'];
const sorts = ['name', 'cap_asc', 'cap_desc', 'starts_asc', 'starts_desc', 'snaps_asc', 'snaps_desc', 'games_asc', 'games_desc', 'age_asc', 'age_desc'];
const strings = (description: string) => ({ type: 'array', items: { type: 'string' }, description });
const integerRefs = { type: 'array', items: { type: 'integer' }, description: 'Positive source refs returned by the tools.' };

export const NFL_ANALYST_SYSTEM = `You are Gambit's AI analyst working with the New York Giants front office. Understand the user's football problem, investigate it with the available tools, and give a useful, evidence-backed answer. You can reason, synthesize, compare approaches and suggest next investigations. Do not make the user speak a query language.

INTERPRET THE REQUEST
- Treat we/our/us as NYG unless another club is specified. Separate the situation from the action requested: an injured Giants player can motivate an outside acquisition search without being the player to acquire or trade away.
- A user's injury statement is scenario context, not a verified diagnosis. Work with the scenario naturally (for example, "With Nabers' availability in doubt..."); do not turn every contextual adjective into a filter or demand that the user remove it.
- Understand ordinary language such as "without blowing up our cap", "someone who has actually played", "cheaper", "what about...", and "keep the same budget". Preserve concrete numeric constraints and exclusions through follow-ups. Never silently discard a condition, change a strict bound, or equate missing with zero.
- A vague budget is a preference, not an arbitrary numerical cutoff. You may investigate illustrative price bands if you identify them as your working screen, or ask one focused budget question while still providing useful analysis. Explicit user limits are mandatory.
- Use the conversation to resolve pronouns, motivations and changed assumptions. An earlier parser error is not the user's intended constraint. Ignore parser debris in old answers and interpret the original user words.

INVESTIGATE AND REASON
- Call data tools before making player-specific or numerical claims. Use several lookups in parallel when useful. Search outside NYG for acquisitions. Query enough records to make a meaningful comparison, then select a small set to show and explain why those records are relevant.
- For a cap-sensitive acquisition question, read the Giants cap position as well as player records. Use receiving yards and offensive usage when discussing receivers. A low cap charge by itself is not evidence of useful receiving production.
- Make an acquisition shortlist useful for actual calls. Lead with a few plausible investigation candidates and explain the contract/usage rationale for each. Cheap stars who are probably retained can explain a tradeoff in one sentence; they should not dominate the recommendation or table. Do not infer a rookie contract from a low cap charge, age or draft history: a player may have signed an extension. Use only the recorded contract terms.
- Current-team cap charges, scheduled annual cash, acquiring-team cap costs and trade compensation are different things. Never label a player's current-team cap hit as the Giants' cost to acquire him. Exact incoming cap cost needs remaining unpaid compensation, transferred guarantees, timing and contract terms; it is not established by these snapshot columns. Never certify affordability from these numbers.
- Negative dated public cap observations do not establish that the Giants are currently over the cap, have no room, or must offset every acquisition. Their accounting bases disagree and are not the club ledger. Explain that they suggest cost pressure, conditional on reconciliation. Keep this qualification with the claim and keep it brief; lead with the football recommendation, not an extended cap disclaimer. A stated budget narrows profiles; it does not let these snapshot fields establish exact affordability.
- Current roster status does not prove a player is available for trade, a free agent, healthy, on the block or willing to sign. Do not invent seller willingness, asking prices, medical prognoses, scouting traits or future performance. Specific contract-year claims require the returned contract-end field. Unknown means unknown, not zero or unavailable as a player.
- Discuss acquisition routes and tradeoffs as analysis, with any unverified seller/role assumptions explicit. Qualified judgments such as "may be attainable" are welcome when you explain sound reasoning from the contract, usage, roster context or a clearly stated scenario. Confirmed seller interest is NOT required for a conditional judgment. Make the reasoning useful and distinguish an inference from an established fact. You may identify which records deserve investigation and why. A cheap productive star is not automatically a practical target solely because his current cap charge is low. Claims about a team's current depth require a roster/usage lookup; hypothetical seller motivations can be framed as hypotheses to test.
- Dates on the tools are snapshot dates. Do not freshen sources, assume the public cap observations reconcile, or convert historical transactions into current asking prices. Consult the rules tool for technical transaction-rule claims.
- If one field is missing, explain that particular gap in normal English and continue the useful supported analysis. Do not refuse the entire football question because it contains contextual language or an unsupported statistic.
- Missing historical usage means this dataset cannot compare that player's workload; it does not imply inexperience or establish that someone else is the team's only proven/full-time player. Say "among the records available" when coverage is incomplete. Use the recorded NFL-experience field for career-stage claims. A workload comparison does not establish who will absorb targets, outside/slot assignments, pedigree or upside; frame role ideas as hypotheses that need coaching/scouting evidence.

WRITE THE ANSWER
- Lead with a concrete answer to the actual question, in natural, connected prose. Keep the lead to about 120-200 words, with 2-3 short supporting findings and 3-6 player rows when helpful. Avoid repetitive disclaimers, internal tool/schema labels and process narration. Do not repeat the entire answer in the findings.
- Use plain prose in string fields; the interface supplies headings and typography. Do not use Markdown headings, bold markers or raw source tokens in prose. Put exact numeric source refs in findings; tools own all source links and tables.
- Select tables/rows/columns from tool results. Do not invent table cells or calculate new figures in narrative. Copy figures from the retrieved evidence. Label current-team cap clearly. State essential qualifications next to the affected assertion rather than burying them.
- When your investigation is complete, return the final answer as JSON matching the response schema. Select the evidence that owns the main question and the player-query lookup that should carry into the next turn. Propose useful follow-ups as requests the user can click, such as "Compare the lower-cost players with the most receiving usage." Ask any needed budget question in the answer, not as a clickable button that repeats your question back to you. Do not submit a list of keyword filters as the answer.
- Use tools to investigate. Then return only the final JSON object; never emit tool-call markup or XML in an answer string. Before submitting, check every named player's contract year and statistic against that exact row's field names, and check every source reference.`;

export const nflAnalystTools: Anthropic.Tool[] = [
  {
    name: 'search_player_records', description: 'Search current roster/contract snapshots and recorded 2025 usage. This is read-only. Provide complete selection fields, or inherit the previous player selection and change only specified fields. Numeric filters, when supplied, replace the full numeric-filter list, so include retained bounds. Empty team_ids means all teams. cap_2026 is CURRENT TEAM cap, not acquiring-team cost.',
    input_schema: { type: 'object', properties: {
      inherit_previous: { type: 'boolean' },
      team_ids: strings('Standard team IDs. Omitted defaults to NYG; [] searches leaguewide.'),
      player_names: strings('Exact full player names, case insensitive. Use [] for a cohort; scenario subjects are not acquisition targets.'),
      position_groups: { type: 'array', items: { type: 'string', enum: positions } },
      exclude_nyg: { type: 'boolean' }, veterans_only: { type: 'boolean' },
      transaction: { type: 'string', enum: ['none', 'release', 'trade', 'restructure'], description: 'Include recorded savings/dead money for a hypothetical move. These are existing contract calculations, not certified club cap room.' },
      post_june: { type: 'boolean', description: 'Whether the modeled release/trade actually occurs after June 1. A trade cannot receive an advance post-June designation.' },
      excluded_team_ids: strings('Teams to exclude without changing positive scope.'),
      excluded_player_names: strings('Players to exclude.'),
      roster_statuses: strings('Recorded status codes, for example active or practice_squad. Omitted/empty includes all statuses.'),
      numeric_filters: { type: 'array', items: { type: 'object', properties: {
        field: { type: 'string', enum: numericFields }, operator: { type: 'string', enum: ['lt', 'lte', 'gt', 'gte', 'eq'] }, value: { type: 'number', minimum: 0 },
      }, required: ['field', 'operator', 'value'], additionalProperties: false } },
      sort: { type: 'string', enum: sorts }, limit: { type: 'integer', minimum: 1, maximum: 50 },
    }, additionalProperties: false },
  },
  { name: 'read_giants_cap', description: 'Read dated public Giants cap observations, their disagreement and verified arithmetic. Not a live certified ledger.', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'read_nfl_rules', description: 'Look up sourced NFL CBA/transaction rules. Ask a focused rules question, e.g. acquiring obligations in a trade, practice squad signing, waiver claim or June 1 accounting.', input_schema: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'], additionalProperties: false } },
  { name: 'read_trade_history', description: 'Execute a recorded historical trade comparison and optionally inspect named complete packages. The result is historical evidence, not a current price quote.', input_schema: { type: 'object', properties: {
    start_year: { type: 'integer', minimum: 1994, maximum: 2025 }, end_year: { type: 'integer', minimum: 1994, maximum: 2025 },
    position_groups: { type: 'array', items: { type: 'string', enum: positions } },
    package_question: { type: 'string', description: 'Optional request to inspect specific complete packages in this historical period.' },
  }, required: ['start_year', 'end_year', 'position_groups'], additionalProperties: false } },
  { name: 'finish_analysis', strict: true, description: 'Submit evidence-backed prose plus exact tool-owned tables. Copy row_names (exact first-column values, usually player names) and column_names from the selected table. Empty row_names selects all returned rows; keep visible tables compact. evidence_id preserves any underlying market/scenario artifact. continuation_query_id identifies the player search whose filters follow into the next turn.', input_schema: { type: 'object', properties: {
    answer: { type: 'string' },
    key_findings: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, body: { type: 'string' }, source_refs: integerRefs }, required: ['label', 'body', 'source_refs'], additionalProperties: false } },
    tables: { type: 'array', items: { type: 'object', properties: { table_id: { type: 'string' }, title: { type: 'string' }, row_names: strings('Exact first-column row names from this table, usually full player names. Never use indexes or source refs.'), column_names: strings('Exact column names from this table.') }, required: ['table_id', 'title', 'row_names', 'column_names'], additionalProperties: false } },
    evidence_id: { type: 'string' }, continuation_query_id: { type: 'string' },
    caveats: strings('Only material qualifications, expressed in plain English.'),
    assumptions: strings('User-supplied scenarios and clearly labeled working assumptions, never inferred medical facts.'),
    followups: { type: 'array', items: { type: 'string' } },
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
    ...(query.max_cap == null ? [] : [{ field: 'cap_2026', operator: 'lte', value: query.max_cap } as const]),
    ...(query.min_starts == null ? [] : [{ field: 'starts_2025', operator: 'gte', value: query.min_starts } as const]),
  ];
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
  for (const key of ['exclude_nyg', 'veterans_only', 'post_june'] as const) {
    if (!(key in args)) continue;
    if (typeof args[key] !== 'boolean') throw new Error('Invalid ' + key + '.');
    query[key] = args[key];
  }
  if ('transaction' in args) {
    if (!['none', 'release', 'trade', 'restructure'].includes(String(args.transaction))) throw new Error('Unsupported transaction calculation.');
    query.transaction = args.transaction as NflFactualQuery['transaction'];
  }
  if ('numeric_filters' in args) {
    if (!Array.isArray(args.numeric_filters) || args.numeric_filters.length > 20) throw new Error('Invalid numeric filters.');
    query.numeric_filters = args.numeric_filters.map(value => {
      const filter = object(value);
      if (Object.keys(filter).some(key => !['field', 'operator', 'value'].includes(key))) throw new Error('Unsupported numeric predicate field.');
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
  table.columns.push('2026 scheduled cash', 'Contract end', ...(receiving ? ['2025 receiving yards', '2025 offensive snaps'] : []), 'NFL experience (years)');
  for (const values of table.rows) {
    const cap = seed.cap_rows.find(row => row.player_name === values[0] && row.team_id === values[1]);
    const metric = seed.player_metrics.find(row => row.player_name === values[0] && row.team_id === values[1]);
    const capturedCap = cap?.source_status === 'captured' ? cap : null;
    values.push(money(capturedCap?.cash_due_2026), capturedCap?.contract_end_year == null ? 'Not recorded' : String(capturedCap.contract_end_year));
    if (receiving) values.push(metric?.source_status === 'captured' && metric.receiving_yards_2025 != null ? metric.receiving_yards_2025.toLocaleString('en-US') : 'Not recorded', metric?.source_status === 'captured' && metric.offense_snaps_2025 != null ? metric.offense_snaps_2025.toLocaleString('en-US') : 'Not recorded');
    const experience = seed.roster_entries.find(row => row.player_name === values[0] && row.team_id === values[1])?.experience;
    values.push(experience == null ? 'Not recorded' : String(experience));
    const source = result.sources.find(source => source.title === values[0] + ' · ' + values[1]);
    if (receiving && source && metric?.metric_families?.includes('nflverse_stats_player')) {
      const data = source.data as { rows: Array<{ k: string; v: string }> };
      data.rows.push({ k: '2025 receiving statistics source', v: 'https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_reg_2025.csv' });
    }
  }
  result.body.caveats.unshift('Cap figures are charges at each player’s current team, not the Giants’ cost to acquire him. Scheduled annual cash is not remaining unpaid salary. Trade availability and compensation are not established.');
  if (table.rows.some(row => row[table.columns.indexOf('2025 snaps')] === 'Not recorded')) result.body.caveats.push('Historical usage coverage is incomplete: an unrecorded workload cannot establish inexperience or absence of a prior role. Compare the available workloads without treating them as the whole room.');
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
  const seed = loaded.seed;
  const history = options.history ?? [];
  const previousQuery = [...history].reverse().find(turn => turn.body?.factual_query)?.body?.factual_query ?? null;
  let lastPlayerQuery = previousQuery;
  const evidence = new Map<string, Evidence>();
  const sources: FactualAnswer['sources'] = [];
  const toolNames: string[] = [];
  let servingModel = BRIEF_MODEL;

  const register = (answer: FactualAnswer, isPlayerSearch = false): Evidence => {
    const id = 'lookup_' + (evidence.size + 1);
    const sourceMap = new Map<number, number>();
    for (const source of answer.sources) {
      const ref = sources.length + 1;
      sourceMap.set(source.ref_index, ref);
      sources.push({ ...source, ref_index: ref });
    }
    const remap = (refs: number[]) => refs.map(ref => sourceMap.get(ref)).filter((ref): ref is number => ref != null);
    const body = { ...answer.body,
      key_findings: answer.body.key_findings.map(row => ({ ...row, source_refs: remap(row.source_refs) })),
      tables: answer.body.tables.map(row => ({ ...row, source_refs: remap(row.source_refs) })),
      calculations: answer.body.calculations.map(row => ({ ...row, source_refs: remap(row.source_refs) })),
    };
    const item: Evidence = { id, body, sources: answer.sources.map(source => ({ ...source, ref_index: sourceMap.get(source.ref_index)! })),
      ...(isPlayerSearch && body.tables[0] ? { rowRefs: body.tables[0].rows.map((_, index) => [sourceMap.get(answer.sources[index].ref_index)!]) } : {}),
    };
    evidence.set(id, item);
    return item;
  };
  const forModel = (item: Evidence) => ({
    lookup_id: item.id, answer: item.body.answer, selection: item.body.factual_query,
    findings: item.body.key_findings, calculations: item.body.calculations, caveats: item.body.caveats,
    tables: item.body.tables.map((table, index) => ({ table_id: item.id + ':' + index, title: table.title, columns: table.columns, rows: table.rows.map((values, rowIndex) => ({ row_name: String(values[0]), fields: Object.fromEntries(table.columns.map((column, index) => [column, values[index]])), source_refs: index === 0 && item.rowRefs ? item.rowRefs[rowIndex] : table.source_refs })) })),
    sources: item.sources.map(source => ({ ref: source.ref_index, title: source.title, source: source.source, as_of: source.updated_at })),
  });
  const initial = options.initialEvidence ? register(options.initialEvidence) : null;
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: JSON.stringify({
    question, today: new Date().toISOString().slice(0, 10), roster_as_of: seed.as_of_date, historical_usage_season: 2025, source_mode: loaded.source_mode,
    known_gaps: ['No verified current medical status, seller availability, asking prices or club-certified cap ledger.', 'Recorded age may be unavailable. Current team cap is not acquiring-team cap cost.'],
    team_ids: seed.teams.map(team => team.team_id), roster_status_codes: [...new Set(seed.roster_entries.map(row => row.roster_status))],
    conversation: history.slice(-8).map(turn => ({ question: turn.question, answer: turn.body?.answer, findings: turn.body?.key_findings, tables: turn.body?.tables, player_selection: turn.body?.factual_query, assumptions: turn.body?.ai_analysis?.assumptions })),
    previous_player_selection: previousQuery,
    initial_evidence: initial ? forModel(initial) : null,
  }) }];
  const call = options.callModel ?? createClaudeMessage;
  const edit = options.editDraft ?? (async (draft: FactualAnswer, records: unknown[]) => {
    toolNames.push('edit_analysis');
    const properties = nflAnalystTools.find(tool => tool.name === 'finish_analysis')!.input_schema.properties as Record<string, unknown>;
    const fields = ['answer', 'key_findings', 'caveats', 'assumptions', 'followups'];
    const edited = await call({ model: BRIEF_MODEL, max_tokens: 5000, thinking: { type: 'adaptive' },
      output_config: { effort: 'high', format: { type: 'json_schema', schema: { type: 'object', properties: Object.fromEntries(fields.map(field => [field, properties[field]])), required: fields, additionalProperties: false } } },
      system: `Edit this NFL analysis before publication. Preserve useful recommendations, comparisons and qualified judgments such as "may be attainable" when the reasoning is sound. Correct factual premises against the exact named record fields; the draft itself is not evidence. Do not demand confirmed seller interest for a conditional recommendation and do not refuse the football task. When a premise lacks support, remove or qualify that premise while retaining the useful investigation or recommendation.
Check comparative words such as "only", "every", "most", and "leads": partial records cannot establish an entire team's history, and leading in snaps does not mean leading in games. Missing usage is not zero or inexperience. Check contract years exactly: an end in the current year is not multiple future years of control. Do not infer contract type from cheap cap figures. Do not assert current depth, receiver alignment, speed, pedigree, medical status or future target share from generic workload; those require specific scouting/coaching evidence. Keep any role ideas explicitly hypothetical. Current-team cap and annual cash are not incoming Giants cost, and the dated, disagreeing public cap observations do not prove a current cap deficit or a mandatory offset. Preserve concrete user constraints and the chosen scope. Do not invent new numbers, comparisons, player facts or source refs.
Return the corrected prose as JSON, with a focused answer of roughly 150-200 words, 2-3 supporting findings, material caveats and useful clickable follow-up requests. Explain why the recommended next investigations matter. Use plain prose and short paragraphs. No XML, Markdown markup or internal process narration. The existing exact tables and calculations are preserved separately, so do not reproduce them in prose.`,
      messages: [{ role: 'user', content: JSON.stringify({ question, today: new Date().toISOString().slice(0, 10), draft: draft.body, evidence: records }) }],
    }, { timeout: 90_000, signal: AbortSignal.timeout(Math.max(1, 215_000 - (Date.now() - started))), maxRetries: 1 });
    if (edited.stop_reason === 'max_tokens') throw new Error('The factual edit was truncated.');
    return JSON.parse(edited.content.filter((block): block is Anthropic.TextBlock => block.type === 'text').map(block => block.text).join(''));
  });
  let finalFailures = 0;
  for (let round = 0; round < 6; round++) {
    if (Date.now() - started > 210_000) throw new Error('The AI analysis exceeded its response deadline.');
    const response = await call({ model: BRIEF_MODEL, max_tokens: 8192, thinking: { type: 'adaptive' },
      output_config: { effort: evidence.size ? 'high' : 'medium', format: { type: 'json_schema', schema: nflAnalystTools.find(tool => tool.name === 'finish_analysis')!.input_schema } },
      system: NFL_ANALYST_SYSTEM,
      tools: nflAnalystTools.filter(tool => tool.name !== 'finish_analysis'),
      tool_choice: { type: 'auto' }, messages,
    }, { timeout: Math.min(90_000, 215_000 - (Date.now() - started)), signal: AbortSignal.timeout(Math.max(1, 215_000 - (Date.now() - started))), maxRetries: 1 });
    servingModel = response.model;
    const calls = response.content.filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use');
    const submittedJson = calls.length === 0;
    if (submittedJson) {
      const json = response.content.filter((block): block is Anthropic.TextBlock => block.type === 'text').map(block => block.text).join('');
      if (response.stop_reason === 'max_tokens') throw new Error('The AI answer was truncated.');
      calls.push({ type: 'tool_use', id: 'final-answer', name: 'finish_analysis', input: JSON.parse(json) } as Anthropic.ToolUseBlock);
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
          const primaryId = text(args.evidence_id, 'evidence_id');
          const primary = primaryId ? evidence.get(primaryId) : null;
          if (primaryId && !primary) throw new Error('Unknown evidence_id.');
          const queryId = text(args.continuation_query_id, 'continuation_query_id');
          const query = queryId ? evidence.get(queryId)?.body.factual_query : undefined;
          if (queryId && !query) throw new Error('continuation_query_id must identify a player search.');
          const refs = (value: unknown): number[] => {
            if (!Array.isArray(value) || value.some(ref => !Number.isInteger(ref) || ref < 1 || ref > sources.length)) throw new Error('Use only retrieved source refs.');
            return [...new Set(value)];
          };
          if (!Array.isArray(args.key_findings) || args.key_findings.length > 5 || !Array.isArray(args.tables) || args.tables.length > 4) throw new Error('Invalid findings or table selection.');
          const findings = args.key_findings.map(value => { const row = object(value); return { label: text(row.label, 'finding label', 120), body: text(row.body, 'finding body', 2500), source_refs: refs(row.source_refs) }; });
          const tables = args.tables.map((value): DataAnalysisTable => {
            const selected = object(value);
            const tableId = text(selected.table_id, 'table ID');
            const [lookupId, index] = tableId.split(':');
            const item = evidence.get(lookupId);
            const table = /^\d+$/.test(index ?? '') ? item?.body.tables[Number(index)] : undefined;
            if (!table || !item) throw new Error('Unknown table ID.');
            const rowNames = stringList(selected.row_names, 'table row names');
            const indices = rowNames.flatMap(name => {
              const matches = table.rows.flatMap((row, index) => String(row[0]) === name ? [index] : []);
              if (!matches.length) throw new Error('Unknown table row name: ' + name + '. Copy names from the selected table.');
              return matches;
            });
            const rows = indices.length ? [...new Set(indices)] : table.rows.map((_, index) => index);
            const chosenColumns = integerList(stringList(selected.column_names, 'table columns').map(column => table.columns.indexOf(column)), table.columns.length, 'table column');
            const columns = chosenColumns.length ? chosenColumns : table.columns.map((_, index) => index);
            return { title: text(selected.title, 'table title', 180), columns: columns.map(index => table.columns[index]), rows: rows.map(index => columns.map(column => table.rows[index][column])),
              source_refs: Number(index) === 0 && item.rowRefs ? [...new Set(rows.flatMap(index => item.rowRefs![index]))] : table.source_refs };
          });
          const answer = text(args.answer, 'answer');
          if (!answer) throw new Error('The answer must address the user question.');
          if (/<\/?(?:parameter|tool_call|invoke)\b/.test(answer)) throw new Error('Put each field in its own JSON property; remove tool markup from the answer.');
          const caveats = stringList(args.caveats, 'caveats');
          if (loaded.source_mode !== 'supabase_current_views') caveats.push('Player records are from the saved public snapshot dated ' + seed.as_of_date + '; the database was unavailable.');
          const draft: FactualAnswer = { body: {
            kind: 'data_analysis', language_policy: 'grounded_ai_v1', answer, key_findings: findings, tables,
            calculations: primary?.body.calculations ?? [], caveats, followups: stringList(args.followups, 'followups').slice(0, 3),
            ...(query ? { factual_query: query } : {}),
            ...(primary?.body.market_analysis ? { market_analysis: primary.body.market_analysis, answer_layout: primary.body.answer_layout, historical_selection: primary.body.historical_selection } : {}),
            ...(primary?.body.seller_move_analysis ? { seller_move_analysis: primary.body.seller_move_analysis, answer_layout: primary.body.answer_layout } : {}),
            ai_analysis: { model: servingModel, elapsed_ms: Date.now() - started, tool_names: toolNames, assumptions: stringList(args.assumptions, 'assumptions') },
          }, sources };
          const edited = object(await edit(draft, [...evidence.values()].map(forModel)));
          draft.body.answer = text(edited.answer, 'edited answer');
          if (!draft.body.answer || !Array.isArray(edited.key_findings) || edited.key_findings.length > 5) throw new Error('Invalid edited answer.');
          draft.body.key_findings = edited.key_findings.map(value => {
            const finding = object(value);
            return { label: text(finding.label, 'finding label', 120), body: text(finding.body, 'finding body', 2500), source_refs: refs(finding.source_refs) };
          });
          draft.body.caveats = stringList(edited.caveats, 'edited caveats');
          if (loaded.source_mode !== 'supabase_current_views') draft.body.caveats.push('Player records are from the saved public snapshot dated ' + seed.as_of_date + '; the database was unavailable.');
          draft.body.followups = stringList(edited.followups, 'edited followups').slice(0, 3);
          draft.body.ai_analysis!.assumptions = stringList(edited.assumptions, 'edited assumptions');
          draft.body.ai_analysis!.elapsed_ms = Date.now() - started;
          draft.body.ai_analysis!.evidence_validated = true;
          return draft;
        }
        let prepared: FactualAnswer;
        if (tool.name === 'search_player_records') {
          lastPlayerQuery = analystPlayerQuery(tool.input, seed, lastPlayerQuery);
          prepared = analystPlayerEvidence(lastPlayerQuery, seed);
        }
        else if (tool.name === 'read_giants_cap') prepared = await buildNflCurrentAnswer('cap_space');
        else if (tool.name === 'read_nfl_rules') prepared = await buildNflRuleAnswer(text(object(tool.input).question, 'rules question', 1500));
        else if (tool.name === 'read_trade_history') prepared = await analystTradeEvidence(tool.input);
        else throw new Error('Unknown data tool.');
        results.push({ type: 'tool_result', tool_use_id: tool.id, content: JSON.stringify(forModel(register(prepared, tool.name === 'search_player_records'))) });
      } catch (error) {
        if (tool.name === 'finish_analysis' && ++finalFailures > 1) throw error;
        results.push({ type: 'tool_result', tool_use_id: tool.id, is_error: true, content: error instanceof Error ? error.message : 'Lookup unavailable.' });
      }
    }
    messages.push({ role: 'user', content: submittedJson ? 'Correct the response JSON and resubmit: ' + results.map(result => result.content).join(' | ') : results });
  }
  throw new Error('The AI analysis did not finish.');
}
