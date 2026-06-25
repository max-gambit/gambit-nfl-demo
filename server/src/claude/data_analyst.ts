import type Anthropic from '@anthropic-ai/sdk';
import { createClaudeMessage, streamClaudeMessage } from './client.js';
import { db } from '../db/client.js';
import { getEffectiveTeamContextForAI, listContextGraphTeams } from './context_graph.js';
import { isNbaTeamId } from '../context_graph/schema.js';
import type {
  BriefSource,
  CbaArticle,
  DataAnalystTrace,
  DataAnalystTraceDataset,
  SubmitBriefInput,
  SubmitDataAnalysisInput,
  ToolCall,
} from '@shared/types';
import type { CurrentCapSheetViewRow } from '../nba_cap_sheets/seed.js';
import type { CurrentPlayerStatViewRow } from '../nba_player_stats/seed.js';
import type { CurrentRosterViewRow } from '../nba_rosters/seed.js';
import { defaultNbaEvidenceTeamId } from './nba_evidence.js';
import { loadNflDemoSeed, nflTeamDetail, type NflDemoSeed } from '../nfl_data/seed.js';
import { loadNflRulesCorpus } from '../nfl_rules/seed.js';

const MAX_TOOL_ROUNDS = 6;
const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 100;
const CBA_SOURCE_NAME = 'CBA REFERENCE';
const CBA_SOURCE_FRESHNESS = '2024 CBA';

export const DATA_ANALYST_SYSTEM = `You are the Gambit Data Analyst - an evidence-first analyst for NFL front-office data in the New York Giants demo.

The user asked a data-backed question. You must answer using only app-available data retrieved through tools. Before submitting the final answer, call at least one data tool. Do not invent numbers, rows, sources, freshness, or calculations.

This local setup is now the New York Giants NFL demo POV. Treat first-person phrases like "we", "our", and "us" as the NYG front office for NFL questions unless the user explicitly names a different subject team. If you call query_nfl_data without team_ids, the server scopes the lookup to NYG. Legacy NBA app data remains available only through query_nba_data for old NBA tests and demos.

Output requirements:
- Lead with the direct answer.
- Show the core calculation or comparison when it matters.
- Use tables when the answer compares players, teams, salaries, or stats.
- Cite source refs in findings, tables, and calculations.
- State missing/stale data plainly. Current app datasets are snapshots, not live feeds.
- When the question or answer involves NFL rules mechanics, name the specific rule family. Prefer the loaded NFL rule rows returned by query_nfl_data and caveat missing full-corpus coverage.
- Keep the tone tight, expert, and data-driven.
- Submit the final analysis by calling submit_data_analysis exactly once.`;

export const DATA_ANALYST_CHAT_SYSTEM = `You are the Gambit Data Analyst answering follow-up questions inside an existing analyst thread.

Use read-only app data tools whenever the user asks for fresh numbers, rankings, comparisons, tables, or source-backed checks. This local setup is the New York Giants NFL demo POV for NFL questions; omitted NFL team scope defaults to NYG. Do not write SQL. Do not invent data. Lead with the answer, then show the relevant evidence and caveats in concise prose.`;

type NbaDatasetKey = 'rosters' | 'cap_sheets' | 'player_stats' | 'context_graph' | 'cba_articles';
type NflDatasetKey = 'rosters' | 'cap_sheets' | 'player_metrics' | 'context_graph' | 'rules';
type DataAnalystToolName = 'list_available_datasets' | 'query_nba_data' | 'query_nfl_data' | 'query_brief_workspace';

interface DataAnalystToolResult {
  ok: boolean;
  tool_name: DataAnalystToolName;
  datasets: DataAnalystTraceDataset[];
  data: Record<string, unknown>;
  errors: { scope: string; error: string }[];
}

export const listAvailableDatasetsTool: Anthropic.Tool = {
  name: 'list_available_datasets',
  description: 'List app-available datasets and freshness/source metadata. Use this before choosing which dataset to query.',
  input_schema: {
    type: 'object',
    properties: {},
  },
};

export const queryNbaDataTool: Anthropic.Tool = {
  name: 'query_nba_data',
  description:
    'Read bounded NBA app datasets for team/player analysis. Supports current rosters, cap sheets, player advanced stats, and Intel summaries. Use standard NBA three-letter team_ids such as WAS, GSW, BOS. If team_ids are omitted, this local setup defaults to GSW.',
  input_schema: {
    type: 'object',
    properties: {
      team_ids: {
        type: 'array',
        description: 'Optional standard NBA team ids. If omitted, this local setup returns GSW rows as the Warriors POV default.',
        items: { type: 'string' },
        maxItems: 30,
      },
      player_names: {
        type: 'array',
        description: 'Optional case-insensitive player-name filters.',
        items: { type: 'string' },
        maxItems: 20,
      },
      datasets: {
        type: 'array',
        description: 'Datasets to query. Defaults to roster/cap/stat/context data. Include cba_articles for CBA rule-reference checks.',
        items: { type: 'string', enum: ['rosters', 'cap_sheets', 'player_stats', 'context_graph', 'cba_articles'] },
        maxItems: 5,
      },
      sort_by: {
        type: 'string',
        enum: ['source_order', 'usage_pct_desc', 'net_rating_asc', 'net_rating_desc', 'payroll_desc'],
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_LIMIT,
        description: 'Maximum rows per dataset returned to the model.',
      },
    },
  },
};

export const queryNflDataTool: Anthropic.Tool = {
  name: 'query_nfl_data',
  description:
    'Read bounded NFL demo app datasets for team/player cap, roster, metrics, Intel, and rules analysis. Use standard NFL team_ids such as NYG, DAL, PHI. If team_ids are omitted, this local setup defaults to NYG.',
  input_schema: {
    type: 'object',
    properties: {
      team_ids: {
        type: 'array',
        description: 'Optional standard NFL team ids. If omitted, this local setup returns NYG rows as the Giants POV default.',
        items: { type: 'string' },
        maxItems: 32,
      },
      player_names: {
        type: 'array',
        description: 'Optional case-insensitive player-name filters.',
        items: { type: 'string' },
        maxItems: 20,
      },
      datasets: {
        type: 'array',
        description: 'Datasets to query. Defaults to roster/cap/metric/context/rules data.',
        items: { type: 'string', enum: ['rosters', 'cap_sheets', 'player_metrics', 'context_graph', 'rules'] },
        maxItems: 5,
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_LIMIT,
        description: 'Maximum rows per dataset returned to the model.',
      },
    },
  },
};

export const queryBriefWorkspaceTool: Anthropic.Tool = {
  name: 'query_brief_workspace',
  description:
    'Read bounded data from existing Gambit workspace artifacts: brief sources, options, and chat turns. Use when the question references prior briefs or thread history.',
  input_schema: {
    type: 'object',
    properties: {
      brief_id: { type: 'string' },
      session_id: { type: 'string' },
      include: {
        type: 'array',
        items: { type: 'string', enum: ['sources', 'options', 'chat_turns'] },
        maxItems: 3,
      },
      limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT },
    },
  },
};

export const dataAnalystTools: Anthropic.Tool[] = [
  listAvailableDatasetsTool,
  queryNflDataTool,
  queryNbaDataTool,
  queryBriefWorkspaceTool,
];

export const submitDataAnalysisTool: Anthropic.Tool = {
  name: 'submit_data_analysis',
  description: 'Submit the final structured data-analysis answer. Call this exactly once after using data tools.',
  input_schema: {
    type: 'object',
    properties: {
      answer: {
        type: 'string',
        description: 'Direct answer first. One concise paragraph.',
      },
      key_findings: {
        type: 'array',
        minItems: 1,
        maxItems: 6,
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            body: { type: 'string' },
            source_refs: { type: 'array', items: { type: 'integer' }, minItems: 1, maxItems: 8 },
          },
          required: ['label', 'body', 'source_refs'],
        },
      },
      tables: {
        type: 'array',
        maxItems: 3,
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            columns: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 10 },
            rows: {
              type: 'array',
              maxItems: 12,
              items: {
                type: 'array',
                items: { type: ['string', 'number', 'null'] },
              },
            },
            source_refs: { type: 'array', items: { type: 'integer' }, minItems: 1, maxItems: 8 },
          },
          required: ['title', 'columns', 'rows', 'source_refs'],
        },
      },
      calculations: {
        type: 'array',
        maxItems: 6,
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            formula: { type: 'string' },
            value: { type: 'string' },
            source_refs: { type: 'array', items: { type: 'integer' }, minItems: 1, maxItems: 8 },
          },
          required: ['label', 'value', 'source_refs'],
        },
      },
      sources: {
        type: 'array',
        minItems: 1,
        maxItems: 12,
        items: {
          type: 'object',
          properties: {
            ref_index: { type: 'integer' },
            kind: { type: 'string', enum: ['ANALYST_DATA', 'CONTEXT_GRAPH', 'CAP', 'PROJECTION', 'NEWS', 'CBA'] },
            source: { type: 'string' },
            title: { type: 'string' },
            updated_at: { type: 'string' },
            data: {
              type: 'object',
              properties: {
                rows: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { k: { type: 'string' }, v: { type: 'string' } },
                    required: ['k', 'v'],
                  },
                },
              },
            },
          },
          required: ['ref_index', 'kind', 'title'],
        },
      },
      caveats: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 6 },
      followups: { type: 'array', items: { type: 'string' }, maxItems: 4 },
    },
    required: ['answer', 'key_findings', 'tables', 'calculations', 'sources', 'caveats', 'followups'],
  },
};

export interface MessagesWithDataAnalystTraces {
  messages: Anthropic.MessageParam[];
  traces: DataAnalystTrace[];
}

export interface DataAnalystStreamCallbacks {
  onText?: (text: string) => Promise<void> | void;
  onDataAnalystToolUse?: (toolUse: Anthropic.ToolUseBlock) => Promise<void> | void;
  onDataAnalystTrace?: (trace: DataAnalystTrace) => Promise<void> | void;
}

export async function buildMessagesWithDataAnalystLookups(
  params: Anthropic.MessageCreateParamsNonStreaming,
): Promise<MessagesWithDataAnalystTraces> {
  let messages = [...params.messages];
  const traces: DataAnalystTrace[] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const response = await createClaudeMessage({
      ...params,
      messages,
      tools: dataAnalystTools,
      tool_choice: { type: 'auto' },
      stream: false,
    });

    const toolUses = response.content.filter(isDataAnalystToolUse);
    if (toolUses.length === 0) return { messages, traces };

    const toolResult = await appendDataAnalystToolResults(messages, response.content, toolUses);
    messages = toolResult.messages;
    traces.push(...toolResult.traces);
  }

  throw new Error(`Data analyst tool loop exceeded ${MAX_TOOL_ROUNDS} rounds.`);
}

export async function streamMessageWithDataAnalystTools(
  params: Anthropic.MessageCreateParamsNonStreaming,
  callbacks: DataAnalystStreamCallbacks = {},
): Promise<{ text: string; finalMessage: Anthropic.Message; traces: DataAnalystTrace[] }> {
  let messages = [...params.messages];
  let accumulatedText = '';
  const traces: DataAnalystTrace[] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const claudeStream = streamClaudeMessage({
      ...params,
      messages,
      tools: dataAnalystTools,
    });

    for await (const event of claudeStream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        accumulatedText += event.delta.text;
        await callbacks.onText?.(event.delta.text);
      }
    }

    const finalMessage = await claudeStream.finalMessage();
    const toolUses = finalMessage.content.filter(isDataAnalystToolUse);
    if (toolUses.length === 0) return { text: accumulatedText, finalMessage, traces };

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const toolUse of toolUses) {
      await callbacks.onDataAnalystToolUse?.(toolUse);
      const { block, trace } = await dataAnalystToolResultBlock(toolUse);
      toolResults.push(block);
      traces.push(trace);
      await callbacks.onDataAnalystTrace?.(trace);
    }

    messages = appendToolResultMessages(messages, finalMessage.content, toolResults);
  }

  throw new Error(`Data analyst tool loop exceeded ${MAX_TOOL_ROUNDS} rounds.`);
}

export async function dataAnalystToolResultBlock(
  toolUse: Anthropic.ToolUseBlock,
): Promise<{ block: Anthropic.ToolResultBlockParam; trace: DataAnalystTrace }> {
  const result = await handleDataAnalystToolUse(toolUse.name as DataAnalystToolName, toolUse.input);
  const trace = dataAnalystTraceFromResult(toolUse.id, result);
  return {
    trace,
    block: {
      type: 'tool_result',
      tool_use_id: toolUse.id,
      content: JSON.stringify(result),
      is_error: !result.ok,
    },
  };
}

export async function handleDataAnalystToolUse(
  toolName: DataAnalystToolName,
  input: unknown,
): Promise<DataAnalystToolResult> {
  switch (toolName) {
    case 'list_available_datasets':
      return listAvailableDatasetsResult();
    case 'query_nba_data':
      return queryNbaDataResult(input);
    case 'query_nfl_data':
      return queryNflDataResult(input);
    case 'query_brief_workspace':
      return queryBriefWorkspaceResult(input);
    default:
      return {
        ok: false,
        tool_name: toolName,
        datasets: [],
        data: {},
        errors: [{ scope: toolName, error: 'unknown_data_analyst_tool' }],
      };
  }
}

export function dataAnalystTracesToToolCalls(traces: DataAnalystTrace[]): ToolCall[] {
  return traces.map((trace) => ({
    id: trace.tool_use_id,
    name: trace.tool_name,
    input: {
      datasets: trace.datasets.map((dataset) => dataset.dataset_id),
      team_ids: [...new Set(trace.datasets.flatMap((dataset) => dataset.team_ids))],
    },
    data_analyst_trace: trace,
  }));
}

export function dataAnalystTracesToBriefSources(
  traces: DataAnalystTrace[],
  startRefIndex: number,
): Omit<BriefSource, 'id' | 'brief_id'>[] {
  const datasets = dedupeTraceDatasets(traces);
  const errors = traces.flatMap((trace) => trace.errors);
  const sources = datasets.map((dataset, index) => ({
    ref_index: startRefIndex + index,
    kind: 'ANALYST_DATA',
    source: 'GAMBIT_APP_DATA',
    title: `App data · ${dataset.label}`,
    updated_at: dataset.as_of_date,
    data: {
      rows: [
        { k: 'Dataset', v: dataset.dataset_id },
        { k: 'Source', v: dataset.source_name ?? 'unknown' },
        { k: 'As of', v: dataset.as_of_date ?? 'unknown' },
        { k: 'Teams', v: dataset.team_ids.length ? dataset.team_ids.join(', ') : 'all/bounded' },
        { k: 'Rows returned', v: String(dataset.row_count) },
      ],
      data_analyst_trace: {
        tool_use_id: 'brief_data_analyst_sources',
        tool_name: dataset.dataset_id.startsWith('nfl_') ? 'query_nfl_data' : 'query_nba_data',
        datasets: [dataset],
        errors,
      } satisfies DataAnalystTrace,
    },
  }));

  if (errors.length === 0) return sources;
  return [
    ...sources,
    {
      ref_index: startRefIndex + sources.length,
      kind: 'ANALYST_DATA',
      source: 'GAMBIT_APP_DATA',
      title: 'App data · query caveats',
      updated_at: null,
      data: {
        rows: errors.map((error) => ({ k: error.scope, v: error.error })),
      },
    },
  ];
}

export function dataAnalysisCbaCitationSources(
  question: string,
  input: SubmitDataAnalysisInput,
  articles: CbaArticle[],
  startRefIndex: number,
  existingSources: Omit<BriefSource, 'id' | 'brief_id'>[] = [],
): Omit<BriefSource, 'id' | 'brief_id'>[] {
  if (hasNflDataAnalystEvidence([...input.sources, ...existingSources])) return [];

  const text = dataAnalysisCbaMatchText(question, input);
  const selected = selectCbaArticlesForText(articles, text);
  if (selected.length === 0) return [];

  const existingKeys = new Set(existingSources.flatMap(cbaSourceKeys));
  return selected
    .filter((article) => {
      const keys = cbaArticleKeys(article);
      return keys.every((key) => !existingKeys.has(key));
    })
    .map((article, index) => cbaArticleToBriefSource(article, startRefIndex + index));
}

function hasNflDataAnalystEvidence(sources: Omit<BriefSource, 'id' | 'brief_id'>[]): boolean {
  return sources.some((source) => {
    if (source.kind === 'NFL_RULE' || source.source === 'NFL_RULES') return true;
    const data = source.data;
    if (!data) return false;
    const trace = data.data_analyst_trace as DataAnalystTrace | undefined;
    if (trace?.tool_name === 'query_nfl_data') return true;
    if (trace?.datasets.some((dataset) => dataset.dataset_id.startsWith('nfl_'))) return true;
    const rows = data.rows;
    if (!Array.isArray(rows)) return false;
    return rows.some((row) => {
      if (!row || typeof row !== 'object') return false;
      const value = 'v' in row ? String((row as { v?: unknown }).v ?? '') : '';
      return value.startsWith('nfl_');
    });
  });
}

export function recommendationBriefCbaCitationSources(
  question: string,
  input: SubmitBriefInput,
  articles: CbaArticle[],
  startRefIndex: number,
  existingSources: Omit<BriefSource, 'id' | 'brief_id'>[] = [],
): Omit<BriefSource, 'id' | 'brief_id'>[] {
  const text = recommendationBriefCbaMatchText(question, input);
  const selected = selectCbaArticlesForText(articles, text);
  if (selected.length === 0) return [];

  const existingKeys = new Set(existingSources.flatMap(cbaSourceKeys));
  return selected
    .filter((article) => {
      const keys = cbaArticleKeys(article);
      return keys.every((key) => !existingKeys.has(key));
    })
    .map((article, index) => cbaArticleToBriefSource(article, startRefIndex + index));
}

export function selectCbaArticlesForText(articles: CbaArticle[], text: string, limit = 3): CbaArticle[] {
  const normalizedText = text.toLowerCase();
  if (!hasCbaCitationSignal(normalizedText)) return [];

  const scored = articles
    .map((article) => ({ article, score: cbaArticleScore(article, normalizedText) }))
    .filter((item) => item.score >= 3)
    .sort((a, b) => b.score - a.score || a.article.id.localeCompare(b.article.id));

  if (scored.length > 0) {
    return mergeCbaArticleRankings(
      [
        priorityCbaArticlesForText(articles, normalizedText),
        scored.map((item) => item.article),
      ],
      limit,
    );
  }
  if (/\b(cba|collective bargaining)\b/i.test(text)) return articles.slice(0, limit);
  return [];
}

export function summarizePlayerStatsForAnalyst(rows: CurrentPlayerStatViewRow[], limit = 5) {
  const bounded = clampLimit(limit);
  return {
    top_usage: rows
      .slice()
      .sort((a, b) => b.usage_pct - a.usage_pct || a.player_name.localeCompare(b.player_name))
      .slice(0, bounded)
      .map(compactPlayerStatRow),
    weakest_net_rating: rows
      .slice()
      .sort((a, b) => a.net_rating - b.net_rating || a.player_name.localeCompare(b.player_name))
      .slice(0, bounded)
      .map(compactPlayerStatRow),
    high_usage_weak_net: rows
      .slice()
      .sort((a, b) => analystRiskScore(b) - analystRiskScore(a) || a.player_name.localeCompare(b.player_name))
      .slice(0, bounded)
      .map((row) => ({ ...compactPlayerStatRow(row), analyst_score: round2(analystRiskScore(row)) })),
  };
}

function dataAnalystTraceFromResult(toolUseId: string, result: DataAnalystToolResult): DataAnalystTrace {
  return {
    tool_use_id: toolUseId,
    tool_name: result.tool_name,
    datasets: result.datasets,
    errors: result.errors,
  };
}

async function appendDataAnalystToolResults(
  messages: Anthropic.MessageParam[],
  assistantContent: Anthropic.ContentBlock[],
  toolUses: Anthropic.ToolUseBlock[],
): Promise<MessagesWithDataAnalystTraces> {
  const pairs = await Promise.all(toolUses.map((toolUse) => dataAnalystToolResultBlock(toolUse)));
  return {
    messages: appendToolResultMessages(messages, assistantContent, pairs.map((pair) => pair.block)),
    traces: pairs.map((pair) => pair.trace),
  };
}

function appendToolResultMessages(
  messages: Anthropic.MessageParam[],
  assistantContent: Anthropic.ContentBlock[],
  toolResults: Anthropic.ToolResultBlockParam[],
): Anthropic.MessageParam[] {
  return [
    ...messages,
    { role: 'assistant', content: assistantContent as unknown as Anthropic.ContentBlockParam[] },
    { role: 'user', content: toolResults },
  ];
}

export function isDataAnalystToolUse(block: Anthropic.ContentBlock): block is Anthropic.ToolUseBlock {
  return block.type === 'tool_use' && (
    block.name === 'list_available_datasets' ||
    block.name === 'query_nfl_data' ||
    block.name === 'query_nba_data' ||
    block.name === 'query_brief_workspace'
  );
}

async function listAvailableDatasetsResult(): Promise<DataAnalystToolResult> {
  const result = emptyResult('list_available_datasets');
  const [nflDemo, nflStaticDatasets, contextGraph, nflRules] = await Promise.all([
    nflDemoCatalogEntry(),
    nflStaticCatalogEntries(),
    contextGraphCatalogEntry(),
    nflRulesCatalogEntry(),
  ]);
  for (const item of [nflDemo, ...nflStaticDatasets, contextGraph, nflRules]) {
    if ('error' in item) {
      addError(result, item.scope, item.error);
    } else {
      result.datasets.push(item);
    }
  }
  result.data.datasets = result.datasets;
  return result;
}

async function nflStaticCatalogEntries(): Promise<Array<DataAnalystTraceDataset | { scope: string; error: string }>> {
  try {
    const seed = await loadNflDemoSeed();
    const teamIds = seed.teams.map((team) => team.team_id);
    return [
      nflDatasetTrace('nfl_rosters_current', 'NFL offseason rosters', seed, teamIds, seed.roster_entries.length),
      nflDatasetTrace('nfl_cap_sheets_current', 'NFL cap and contract rows', seed, teamIds, seed.cap_rows.length),
      nflDatasetTrace('nfl_player_metrics_current', 'NFL player metrics', seed, teamIds, seed.player_metrics.length),
    ];
  } catch (error) {
    return [{ scope: 'nfl_static_catalog', error: error instanceof Error ? error.message : String(error) }];
  }
}

async function queryNflDataResult(input: unknown): Promise<DataAnalystToolResult> {
  const result = emptyResult('query_nfl_data');
  const body = objectInput(input);
  const seed = await loadNflDemoSeed();
  const requestedDatasets = parseNflDatasets(body.datasets);
  const limit = clampLimit(numberInput(body.limit) ?? DEFAULT_LIMIT);
  const teamIds = resolveNflTeamIds(body.team_ids, seed, result);
  const playerNames = stringArrayInput(body.player_names).map((name) => name.toLowerCase());

  if (requestedDatasets.includes('rosters')) {
    const rows = filterNflPlayers(seed.roster_entries.filter((row) => teamIds.includes(row.team_id)), playerNames).slice(0, limit);
    result.data.rosters = { rows };
    result.datasets.push(nflDatasetTrace('nfl_rosters_current', 'NFL offseason rosters', seed, teamIds, rows.length));
  }
  if (requestedDatasets.includes('cap_sheets')) {
    const rows = filterNflPlayers(seed.cap_rows.filter((row) => teamIds.includes(row.team_id)), playerNames).slice(0, limit);
    result.data.cap_sheets = { rows };
    result.datasets.push(nflDatasetTrace('nfl_cap_sheets_current', 'NFL cap and contract rows', seed, teamIds, rows.length));
  }
  if (requestedDatasets.includes('player_metrics')) {
    const rows = filterNflPlayers(seed.player_metrics.filter((row) => teamIds.includes(row.team_id)), playerNames).slice(0, limit);
    result.data.player_metrics = { rows };
    result.datasets.push(nflDatasetTrace('nfl_player_metrics_current', 'NFL player metrics', seed, teamIds, rows.length));
  }
  if (requestedDatasets.includes('context_graph')) {
    const teams = [];
    for (const teamId of teamIds) {
      const team = await getEffectiveTeamContextForAI(teamId);
      teams.push(team);
    }
    result.data.context_graph = { teams };
    result.datasets.push({
      dataset_id: 'nfl_context_graph',
      label: 'NFL Intel',
      source_name: 'Gambit Intel',
      as_of_date: firstString(teams.map((team) => team.metadata.source_as_of_date)),
      team_ids: teams.map((team) => team.team_id),
      row_count: teams.length,
    });
  }
  if (requestedDatasets.includes('rules')) {
    const rulesCorpus = await loadNflRulesCorpus();
    const rules = rulesCorpus.rules;
    result.data.rules = { rows: rules };
    result.datasets.push({
      dataset_id: 'nfl_rules_static',
      label: 'NFL rules static snippets',
      source_name: rulesCorpus.source_name,
      as_of_date: rulesCorpus.as_of_date,
      team_ids: teamIds,
      row_count: rules.length,
    });
  }

  return result;
}

async function queryNbaDataResult(input: unknown): Promise<DataAnalystToolResult> {
  const result = emptyResult('query_nba_data');
  const body = objectInput(input);
  const requestedDatasets = parseNbaDatasets(body.datasets);
  const limit = clampLimit(numberInput(body.limit) ?? DEFAULT_LIMIT);
  const teamIds = resolveDataAnalystTeamIds(body.team_ids, result);
  const playerNames = stringArrayInput(body.player_names).map((name) => name.toLowerCase());
  const sortBy = typeof body.sort_by === 'string' ? body.sort_by : 'source_order';

  if (requestedDatasets.includes('player_stats')) {
    const rows = await queryPlayerStats(teamIds, playerNames, sortBy, limit, result);
    result.data.player_stats = {
      rows: rows.slice(0, limit).map(compactPlayerStatRow),
      computed: summarizePlayerStatsForAnalyst(rows, Math.min(5, limit)),
    };
    result.datasets.push(datasetTraceFromRows('nba_player_stats_current', 'NBA player advanced stats', rows));
  }

  if (requestedDatasets.includes('rosters')) {
    const rows = await queryRosterRows(teamIds, playerNames, limit, result);
    result.data.rosters = { rows: rows.slice(0, limit).map(compactRosterRow) };
    result.datasets.push(datasetTraceFromRows('nba_rosters_current', 'NBA official rosters', rows));
  }

  if (requestedDatasets.includes('cap_sheets')) {
    const rows = await queryCapSheetRows(teamIds, sortBy, limit, result);
    result.data.cap_sheets = { rows: rows.slice(0, limit).map(compactCapSheetRow) };
    result.datasets.push(datasetTraceFromRows('nba_cap_sheets_current', 'NBA cap sheets', rows));
  }

  if (requestedDatasets.includes('context_graph')) {
    const contextRows = await queryContextGraphRows(teamIds, limit, result);
    result.data.context_graph = { teams: contextRows };
    result.datasets.push({
      dataset_id: 'nfl_context_graph',
      label: 'NFL Intel',
      source_name: 'Gambit Intel',
      as_of_date: firstString(contextRows.map((row) => row.metadata.source_as_of_date)),
      team_ids: contextRows.map((row) => row.team_id),
      row_count: contextRows.length,
    });
  }

  if (requestedDatasets.includes('cba_articles')) {
    const articles = await queryCbaArticles(limit, result);
    result.data.cba_articles = { articles: articles.map(compactCbaArticle) };
    result.datasets.push(cbaDatasetTrace(articles.length));
  }

  return result;
}

async function queryBriefWorkspaceResult(input: unknown): Promise<DataAnalystToolResult> {
  const result = emptyResult('query_brief_workspace');
  const body = objectInput(input);
  const briefId = typeof body.brief_id === 'string' ? body.brief_id : null;
  const sessionId = typeof body.session_id === 'string' ? body.session_id : null;
  const include = parseWorkspaceIncludes(body.include);
  const limit = clampLimit(numberInput(body.limit) ?? 30);

  if (!briefId && !sessionId) {
    addError(result, 'brief_workspace', 'brief_id or session_id is required');
    return result;
  }

  if (include.includes('sources')) {
    let query = db.from('brief_sources').select('*').order('ref_index', { ascending: true }).limit(limit);
    if (briefId) query = query.eq('brief_id', briefId);
    const { data, error } = sessionId && !briefId
      ? await query.in('brief_id', await briefIdsForSession(sessionId, limit))
      : await query;
    if (error) addError(result, 'brief_sources', error.message);
    result.data.sources = data ?? [];
    result.datasets.push({
      dataset_id: 'brief_sources',
      label: 'Brief sources',
      source_name: 'Gambit workspace',
      as_of_date: null,
      team_ids: [],
      row_count: (data ?? []).length,
    });
  }

  if (include.includes('options')) {
    let query = db.from('brief_options').select('*').order('ref_index', { ascending: true }).limit(limit);
    if (briefId) query = query.eq('brief_id', briefId);
    const { data, error } = sessionId && !briefId
      ? await query.in('brief_id', await briefIdsForSession(sessionId, limit))
      : await query;
    if (error) addError(result, 'brief_options', error.message);
    result.data.options = data ?? [];
    result.datasets.push({
      dataset_id: 'brief_options',
      label: 'Brief options',
      source_name: 'Gambit workspace',
      as_of_date: null,
      team_ids: [],
      row_count: (data ?? []).length,
    });
  }

  if (include.includes('chat_turns')) {
    let query = db.from('chat_turns').select('*').order('created_at', { ascending: true }).limit(limit);
    if (briefId) query = query.eq('brief_id', briefId);
    const { data, error } = sessionId && !briefId
      ? await query.in('brief_id', await briefIdsForSession(sessionId, limit))
      : await query;
    if (error) addError(result, 'chat_turns', error.message);
    result.data.chat_turns = data ?? [];
    result.datasets.push({
      dataset_id: 'chat_turns',
      label: 'Chat turns',
      source_name: 'Gambit workspace',
      as_of_date: null,
      team_ids: [],
      row_count: (data ?? []).length,
    });
  }

  return result;
}

async function latestSnapshot(
  table: string,
  label: string,
  rowCountColumn: 'team_count' | 'player_count' | 'row_count',
): Promise<DataAnalystTraceDataset | { scope: string; error: string }> {
  const { data, error } = await db
    .from(table)
    .select(`season, as_of_date, source_name, source_url, retrieved_at, ${rowCountColumn}`)
    .order('as_of_date', { ascending: false })
    .order('retrieved_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return { scope: table, error: error.message };
  if (!data) return { scope: table, error: 'no snapshot rows found' };
  const row = data as unknown as { as_of_date?: string; source_name?: string } & Record<string, unknown>;
  return {
    dataset_id: table.replace(/_snapshots$/, '_current'),
    label,
    source_name: row.source_name ?? null,
    as_of_date: row.as_of_date ?? null,
    team_ids: [],
    row_count: typeof row[rowCountColumn] === 'number' ? row[rowCountColumn] : 0,
  };
}

async function contextGraphCatalogEntry(): Promise<DataAnalystTraceDataset | { scope: string; error: string }> {
  try {
    const teams = await listContextGraphTeams();
    return {
      dataset_id: 'nfl_context_graph',
      label: 'NFL Intel',
      source_name: 'Gambit Intel',
      as_of_date: firstString(teams.map((team) => team.source_as_of_date)),
      team_ids: teams.map((team) => team.team_id),
      row_count: teams.length,
    };
  } catch (error) {
    return { scope: 'nfl_context_graph', error: error instanceof Error ? error.message : String(error) };
  }
}

async function nflDemoCatalogEntry(): Promise<DataAnalystTraceDataset | { scope: string; error: string }> {
  try {
    const seed = await loadNflDemoSeed();
    return {
      dataset_id: 'nfl_demo_static',
      label: 'NFL static demo data',
      source_name: seed.source_name,
      as_of_date: seed.as_of_date,
      team_ids: seed.teams.map((team) => team.team_id),
      row_count: seed.roster_entries.length + seed.cap_rows.length + seed.player_metrics.length,
    };
  } catch (error) {
    return { scope: 'nfl_demo_static', error: error instanceof Error ? error.message : String(error) };
  }
}

async function nflRulesCatalogEntry(): Promise<DataAnalystTraceDataset | { scope: string; error: string }> {
  try {
    const corpus = await loadNflRulesCorpus();
    return {
      dataset_id: 'nfl_rules_static',
      label: 'NFL rules static snippets',
      source_name: corpus.source_name,
      as_of_date: corpus.as_of_date,
      team_ids: [],
      row_count: corpus.rules.length,
    };
  } catch (error) {
    return { scope: 'nfl_rules_static', error: error instanceof Error ? error.message : String(error) };
  }
}

async function cbaCorpusCatalogEntry(): Promise<DataAnalystTraceDataset | { scope: string; error: string }> {
  const { data, error } = await db
    .from('cba_articles')
    .select('id')
    .order('id', { ascending: true });
  if (error) return { scope: 'cba_articles', error: error.message };
  return cbaDatasetTrace((data ?? []).length);
}

async function queryPlayerStats(
  teamIds: string[],
  playerNames: string[],
  sortBy: string,
  limit: number,
  result: DataAnalystToolResult,
): Promise<CurrentPlayerStatViewRow[]> {
  let query = db.from('nba_current_player_stats').select('*');
  if (teamIds.length) query = query.in('team_id', teamIds);
  const { data, error } = await query.order('team_id', { ascending: true }).order('source_order', { ascending: true }).limit(MAX_LIMIT);
  if (error) {
    addError(result, 'nba_current_player_stats', error.message);
    return [];
  }
  return sortPlayerRows(filterByPlayerNames((data ?? []) as CurrentPlayerStatViewRow[], playerNames), sortBy).slice(0, limit);
}

async function queryRosterRows(
  teamIds: string[],
  playerNames: string[],
  limit: number,
  result: DataAnalystToolResult,
): Promise<CurrentRosterViewRow[]> {
  let query = db.from('nba_current_roster_entries').select('*');
  if (teamIds.length) query = query.in('team_id', teamIds);
  const { data, error } = await query.order('team_id', { ascending: true }).order('source_order', { ascending: true }).limit(MAX_LIMIT);
  if (error) {
    addError(result, 'nba_current_roster_entries', error.message);
    return [];
  }
  return filterRosterByPlayerNames((data ?? []) as CurrentRosterViewRow[], playerNames).slice(0, limit);
}

async function queryCapSheetRows(
  teamIds: string[],
  sortBy: string,
  limit: number,
  result: DataAnalystToolResult,
): Promise<CurrentCapSheetViewRow[]> {
  let query = db.from('nba_current_cap_sheets').select('*');
  if (teamIds.length) query = query.in('team_id', teamIds);
  const { data, error } = await query.order('team_id', { ascending: true }).limit(MAX_LIMIT);
  if (error) {
    addError(result, 'nba_current_cap_sheets', error.message);
    return [];
  }
  const rows = (data ?? []) as CurrentCapSheetViewRow[];
  if (sortBy === 'payroll_desc') return rows.sort((a, b) => (b.payroll_amount ?? -1) - (a.payroll_amount ?? -1)).slice(0, limit);
  return rows.slice(0, limit);
}

async function queryContextGraphRows(
  teamIds: string[],
  limit: number,
  result: DataAnalystToolResult,
) {
  const ids = teamIds.length ? teamIds : (await listContextGraphTeams()).map((team) => team.team_id).slice(0, limit);
  const rows = [];
  for (const teamId of ids.slice(0, limit)) {
    try {
      rows.push(await getEffectiveTeamContextForAI(teamId));
    } catch (error) {
      addError(result, `context_graph:${teamId}`, error instanceof Error ? error.message : String(error));
    }
  }
  return rows;
}

async function queryCbaArticles(limit: number, result: DataAnalystToolResult): Promise<CbaArticle[]> {
  const { data, error } = await db
    .from('cba_articles')
    .select('*')
    .order('id', { ascending: true })
    .limit(limit);
  if (error) {
    addError(result, 'cba_articles', error.message);
    return [];
  }
  return (data ?? []) as CbaArticle[];
}

async function briefIdsForSession(sessionId: string, limit: number): Promise<string[]> {
  const { data, error } = await db.from('briefs').select('id').eq('session_id', sessionId).order('created_at', { ascending: false }).limit(limit);
  if (error) return [];
  return (data ?? []).map((row) => (row as { id: string }).id);
}

function emptyResult(toolName: DataAnalystToolName): DataAnalystToolResult {
  return { ok: true, tool_name: toolName, datasets: [], data: {}, errors: [] };
}

function addError(result: DataAnalystToolResult, scope: string, error: string) {
  result.ok = false;
  result.errors.push({ scope, error });
}

function objectInput(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null ? input as Record<string, unknown> : {};
}

function parseNbaDatasets(value: unknown): NbaDatasetKey[] {
  const allowed = new Set<NbaDatasetKey>(['rosters', 'cap_sheets', 'player_stats', 'context_graph', 'cba_articles']);
  const parsed = Array.isArray(value)
    ? value.filter((item): item is NbaDatasetKey => typeof item === 'string' && allowed.has(item as NbaDatasetKey))
    : [];
  return parsed.length ? parsed : ['rosters', 'cap_sheets', 'player_stats'];
}

function parseNflDatasets(value: unknown): NflDatasetKey[] {
  const allowed = new Set<NflDatasetKey>(['rosters', 'cap_sheets', 'player_metrics', 'context_graph', 'rules']);
  const parsed = Array.isArray(value)
    ? value.filter((item): item is NflDatasetKey => typeof item === 'string' && allowed.has(item as NflDatasetKey))
    : [];
  return parsed.length ? parsed : ['rosters', 'cap_sheets', 'player_metrics', 'context_graph', 'rules'];
}

function parseWorkspaceIncludes(value: unknown): ('sources' | 'options' | 'chat_turns')[] {
  const allowed = new Set(['sources', 'options', 'chat_turns']);
  const parsed = Array.isArray(value)
    ? value.filter((item): item is 'sources' | 'options' | 'chat_turns' => typeof item === 'string' && allowed.has(item))
    : [];
  return parsed.length ? parsed : ['sources', 'options', 'chat_turns'];
}

export function dataAnalystDefaultTeamId(): string | null {
  return defaultNbaEvidenceTeamId();
}

export function resolveDataAnalystTeamIds(value: unknown, result?: DataAnalystToolResult): string[] {
  const ids = stringArrayInput(value).map((id) => id.toUpperCase());
  if (ids.length === 0) {
    const defaultTeamId = dataAnalystDefaultTeamId();
    return defaultTeamId ? [defaultTeamId] : [];
  }

  const valid: string[] = [];
  for (const id of ids) {
    if (!isNbaTeamId(id)) {
      if (result) addError(result, `team_id:${id}`, 'unknown_team_id');
    } else {
      valid.push(id);
    }
  }
  return [...new Set(valid)];
}

function stringArrayInput(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function numberInput(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function clampLimit(limit: number): number {
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(limit)));
}

function filterByPlayerNames(rows: CurrentPlayerStatViewRow[], playerNames: string[]) {
  if (playerNames.length === 0) return rows;
  return rows.filter((row) => playerNames.some((name) => row.player_name.toLowerCase().includes(name)));
}

function filterRosterByPlayerNames(rows: CurrentRosterViewRow[], playerNames: string[]) {
  if (playerNames.length === 0) return rows;
  return rows.filter((row) => playerNames.some((name) => row.player_full_name.toLowerCase().includes(name)));
}

function filterNflPlayers<T extends { player_name: string }>(rows: T[], playerNames: string[]): T[] {
  if (playerNames.length === 0) return rows;
  return rows.filter((row) => playerNames.some((name) => row.player_name.toLowerCase().includes(name)));
}

function resolveNflTeamIds(value: unknown, seed: NflDemoSeed, result?: DataAnalystToolResult): string[] {
  const allowed = new Set(seed.teams.map((team) => team.team_id));
  const ids = stringArrayInput(value).map((id) => id.toUpperCase());
  if (ids.length === 0) return ['NYG'];
  const valid: string[] = [];
  for (const id of ids) {
    if (!allowed.has(id)) {
      if (result) addError(result, `team_id:${id}`, 'unknown_nfl_team_id');
    } else {
      valid.push(id);
    }
  }
  return [...new Set(valid)];
}

function sortPlayerRows(rows: CurrentPlayerStatViewRow[], sortBy: string) {
  const sorted = rows.slice();
  if (sortBy === 'usage_pct_desc') return sorted.sort((a, b) => b.usage_pct - a.usage_pct);
  if (sortBy === 'net_rating_asc') return sorted.sort((a, b) => a.net_rating - b.net_rating);
  if (sortBy === 'net_rating_desc') return sorted.sort((a, b) => b.net_rating - a.net_rating);
  return sorted.sort((a, b) => a.team_id.localeCompare(b.team_id) || a.source_order - b.source_order);
}

function compactPlayerStatRow(row: CurrentPlayerStatViewRow) {
  return {
    team_id: row.team_id,
    player_name: row.player_name,
    position: row.position,
    games_played: row.games_played,
    minutes: row.minutes,
    usage_pct: row.usage_pct,
    net_rating: row.net_rating,
    true_shooting_pct: row.true_shooting_pct,
    effective_fg_pct: row.effective_fg_pct,
    assist_pct: row.assist_pct,
    turnover_pct: row.turnover_pct,
    match_status: row.match_status,
  };
}

function compactRosterRow(row: CurrentRosterViewRow) {
  return {
    team_id: row.team_id,
    player_name: row.player_full_name,
    position: row.position,
    jersey_number: row.jersey_number,
    height: row.height,
    weight_lbs: row.weight_lbs,
    roster_count: row.official_roster_count,
    source_url: row.entry_source_url ?? row.player_source_url,
  };
}

function compactCapSheetRow(row: CurrentCapSheetViewRow) {
  return {
    team_id: row.team_id,
    team_name: row.full_name,
    official_roster_count: row.official_roster_count,
    cap_status: row.cap_status,
    tax_status: row.tax_status,
    apron_status: row.apron_status,
    payroll_amount: row.payroll_amount,
    source_status: row.source_status,
    missing_sections: row.missing_sections ?? [],
  };
}

function compactCbaArticle(article: CbaArticle) {
  return {
    id: article.id,
    label: article.label,
    body: article.body,
  };
}

function analystRiskScore(row: CurrentPlayerStatViewRow): number {
  return (row.usage_pct * 100) - row.net_rating;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function datasetTraceFromRows(
  datasetId: string,
  label: string,
  rows: Array<CurrentPlayerStatViewRow | CurrentRosterViewRow | CurrentCapSheetViewRow>,
): DataAnalystTraceDataset {
  return {
    dataset_id: datasetId,
    label,
    source_name: firstString(rows.map((row) => row.source_name)),
    as_of_date: firstString(rows.map((row) => row.as_of_date)),
    team_ids: [...new Set(rows.map((row) => row.team_id))].sort(),
    row_count: rows.length,
  };
}

function cbaDatasetTrace(rowCount: number): DataAnalystTraceDataset {
  return {
    dataset_id: 'cba_articles',
    label: 'CBA reference corpus',
    source_name: CBA_SOURCE_NAME,
    as_of_date: CBA_SOURCE_FRESHNESS,
    team_ids: [],
    row_count: rowCount,
  };
}

function nflDatasetTrace(
  datasetId: string,
  label: string,
  seed: NflDemoSeed,
  teamIds: string[],
  rowCount: number,
): DataAnalystTraceDataset {
  return {
    dataset_id: datasetId,
    label,
    source_name: seed.source_name,
    as_of_date: seed.as_of_date,
    team_ids: teamIds,
    row_count: rowCount,
  };
}

function dataAnalysisCbaMatchText(question: string, input: SubmitDataAnalysisInput): string {
  return [
    question,
    input.answer,
    ...input.key_findings.flatMap((finding) => [finding.label, finding.body]),
    ...input.tables.flatMap((table) => [
      table.title,
      ...table.columns,
      ...table.rows.flatMap((row) => row.map((cell) => cell == null ? '' : String(cell))),
    ]),
    ...input.calculations.flatMap((calculation) => [
      calculation.label,
      calculation.formula ?? '',
      calculation.value,
    ]),
    ...input.caveats,
    ...input.followups,
    ...input.sources.flatMap(sourceTextParts),
  ].join('\n');
}

function recommendationBriefCbaMatchText(question: string, input: SubmitBriefInput): string {
  return [
    question,
    input.thesis,
    input.reasoning,
    input.blockquote?.text ?? '',
    input.blockquote?.source ?? '',
    ...input.watching.flatMap((item) => [item.tag, item.body]),
    ...(input.next_questions ?? []).flatMap((group) => [
      group.audience,
      ...group.questions,
    ]),
    ...input.options.flatMap((option) => [
      option.title,
      option.subtitle ?? '',
      option.cba_section ?? '',
      option.net_cap_label,
      option.timing ?? '',
      option.details.decision_question,
      option.details.why_this,
      option.details.upside,
      option.details.downside,
      ...(option.details.move_candidates ?? []).flatMap((candidate) => [
        candidate.label,
        candidate.subject_team_id ?? '',
        ...(candidate.target_player_names ?? []),
        candidate.target_team_id ?? '',
        candidate.target_team_name ?? '',
        ...(candidate.outgoing_player_names ?? []),
        candidate.outgoing_package ?? '',
        candidate.salary_match ?? '',
        candidate.basketball_fit ?? '',
        candidate.mechanism ?? '',
        candidate.why ?? '',
        candidate.cost ?? '',
        candidate.constraints ?? '',
        ...(candidate.evidence_refs ?? []).map((ref) => String(ref)),
      ]),
      ...option.details.required_moves,
      ...option.details.blockers,
      ...option.details.watch_triggers,
      option.details.next_step,
    ]),
    ...presentationTextParts(input.presentation),
    ...input.sources.flatMap(sourceTextParts),
  ].join('\n');
}

function presentationTextParts(presentation: SubmitBriefInput['presentation']): string[] {
  if (!presentation) return [];
  const parts = [presentation.title ?? '', presentation.template_id];
  for (const section of presentation.sections) {
    parts.push(section.title, section.kind);
    if (section.kind === 'prose') {
      parts.push(section.body);
    } else if (section.kind === 'bullets') {
      for (const item of section.items) parts.push(item.label ?? '', item.body);
    } else if (section.kind === 'table') {
      parts.push(...section.columns);
      for (const row of section.rows) {
        for (const cell of row) parts.push(cell == null ? '' : String(cell));
      }
    } else if (section.kind === 'question_groups') {
      for (const group of section.groups) {
        parts.push(group.audience, ...group.questions);
      }
    }
  }
  return parts;
}

function sourceTextParts(source: Omit<BriefSource, 'id' | 'brief_id'>): string[] {
  const parts = [
    source.kind,
    source.source ?? '',
    source.title,
    source.updated_at ?? '',
  ];
  const data = source.data;
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    if (typeof record.excerpt === 'string') parts.push(record.excerpt);
    if (typeof record.article === 'string') parts.push(record.article);
    if (typeof record.section === 'string') parts.push(record.section);
    if (Array.isArray(record.rows)) {
      for (const row of record.rows) {
        if (row && typeof row === 'object') {
          const item = row as Record<string, unknown>;
          if (typeof item.k === 'string') parts.push(item.k);
          if (typeof item.v === 'string') parts.push(item.v);
        }
      }
    }
  }
  return parts;
}

function hasCbaCitationSignal(text: string): boolean {
  return /(?:\b(?:cba|collective bargaining|apron|hard[- ]?cap(?:s|ped)?|mid[- ]level|\bmle\b|bird rights?|qualifying offers?|\bqo\b|\brfa\b|restricted free agenc(?:y|ies)|aggregate salaries|salary aggregation|sign[- ]and[- ]trade|non[- ]taxpayer|taxpayer mle|bi[- ]annual|\bbae\b|above the cap|over the cap|article\s+[ivxlcdm]+)\b|§[ivxlcdm\d])/i.test(text);
}

function priorityCbaArticlesForText(articles: CbaArticle[], text: string): CbaArticle[] {
  const prioritized: CbaArticle[] = [];
  const addWhere = (predicate: (article: CbaArticle) => boolean) => {
    for (const article of articles) {
      if (predicate(article)) prioritized.push(article);
    }
  };

  addWhere((article) => cbaArticleSectionRefMatches(article, text));

  if (/\bbird[- ]rights?\b|\bbird\s*§|\bre-?sign(?:ing)?(?:\s+\w+){0,4}\s+above the cap\b/i.test(text)) {
    addWhere((article) => (
      cbaArticleIdIs(article, 'Article VII §6') ||
      cbaArticleHasAlias(article, ['bird rights', 'veteran free agent exception'])
    ));
  }
  if (/\bmle\b|\bmid[- ]level\b|§vii\.6/i.test(text)) {
    addWhere((article) => cbaArticleIdIs(article, 'Article VII §6'));
  }
  if (/\b(second|2nd) apron\b|\bsalary aggregation\b|\baggregate salaries\b/i.test(text)) {
    addWhere((article) => cbaArticleHasAlias(article, ['second apron', 'apron restrictions']));
  }
  if (/\bsalary aggregation\b|\baggregate salaries\b|\btrade rules?\b|\btraded player exception\b|\btpe\b/i.test(text)) {
    addWhere((article) => cbaArticleIdIs(article, 'Article VII §8'));
  }

  return dedupeCbaArticles(prioritized);
}

function cbaArticleScore(article: CbaArticle, text: string): number {
  const id = article.id.toLowerCase();
  const label = article.label.toLowerCase();
  const comparableText = text.replace(/[-‐‑‒–—]+/g, ' ');
  let score = 0;

  if (text.includes(id)) score += 12;
  for (const alias of article.aliases ?? []) {
    const normalizedAlias = alias.toLowerCase();
    const comparableAlias = normalizedAlias.replace(/[-‐‑‒–—]+/g, ' ');
    if (normalizedAlias && (text.includes(normalizedAlias) || comparableText.includes(comparableAlias))) score += 10;
  }

  const parsed = parseCbaArticleId(article.id);
  if (parsed.article && text.includes(`article ${parsed.article.toLowerCase()}`)) score += 3;
  if (parsed.section && text.includes(parsed.section.toLowerCase())) score += 6;
  if (parsed.article && parsed.section) {
    const sectionNumber = parsed.section.replace(/^§/, '').toLowerCase();
    if (sectionNumber && text.includes(`§${parsed.article.toLowerCase()}.${sectionNumber}`)) score += 8;
  }
  if (text.includes(label)) score += 8;

  for (const token of label.split(/[^a-z0-9]+/).filter((part) => part.length >= 4)) {
    if (text.includes(token)) score += 1;
  }

  const corpusText = cbaArticleSearchText(article);
  if (/mid-level|non-taxpayer|\bmle\b/.test(corpusText)) {
    if (/\bmid[- ]level\b/i.test(text)) score += 6;
    if (/\bmle\b/i.test(text)) score += 6;
    if (/\bnon[- ]taxpayer\b/i.test(text)) score += 4;
    if (/\b(first apron|hard[- ]?cap(?:s|ped)?)\b/i.test(text)) score += 4;
    if (/\b(above the cap|over the cap)\b/i.test(text)) score += 1;
  }
  if (/second apron|aggregate salaries|picks frozen|first-round picks/.test(corpusText)) {
    if (/\b(second|2nd) apron\b/i.test(text)) score += 8;
    if (/\baggregate salaries\b|\bsalary aggregation\b/i.test(text)) score += 6;
    if (/\bfrozen\b|\bfirst[- ]round picks?\b/i.test(text)) score += 3;
  }
  if (/bird rights|qualifying offers?/.test(corpusText)) {
    if (/\bbird rights?\b/i.test(text)) score += 8;
    if (/\bbird\b/i.test(text)) score += 3;
    if (/\bqualifying[- ]offers?\b|\bqo\b/i.test(text)) score += 6;
    if (/\brfa\b|restricted free agenc(?:y|ies)/i.test(text)) score += 4;
    if (/\bre-?sign(?:ing)?(?:\s+\w+){0,4}\s+above the cap\b/i.test(text)) score += 5;
  }
  if (/bird rights|veteran free agent exception/.test(corpusText)) {
    if (/\bbird[- ]rights?\b|\bbird\s*§|\bre-?sign/i.test(text)) score += 30;
  }
  if (/trade rules|traded player exception|aggregation/.test(corpusText)) {
    if (/\baggregate salaries\b|\bsalary aggregation\b|\baggregation\b/i.test(text)) score += 5;
    if (/\btrade rules?\b|\btraded player exception\b|\btpe\b/i.test(text)) score += 5;
  }
  if (/^article i §1$/i.test(article.id) && !/\b(defin(?:e|ition)|means|meaning|what is)\b/i.test(text)) {
    score -= 8;
  }

  return score;
}

function cbaArticleSectionRefMatches(article: CbaArticle, text: string): boolean {
  const parsed = parseCbaArticleId(article.id);
  if (!parsed.article || !parsed.section) return false;
  const sectionNumber = parsed.section.replace(/^§/, '').toLowerCase();
  return sectionNumber.length > 0 && text.includes(`§${parsed.article.toLowerCase()}.${sectionNumber}`);
}

function cbaArticleHasAlias(article: CbaArticle, aliases: string[]): boolean {
  const articleAliases = new Set((article.aliases ?? []).map((alias) => alias.toLowerCase()));
  return aliases.some((alias) => articleAliases.has(alias));
}

function cbaArticleIdIs(article: CbaArticle, id: string): boolean {
  return cbaKey(article.id) === cbaKey(id);
}

function cbaArticleToBriefSource(
  article: CbaArticle,
  refIndex: number,
): Omit<BriefSource, 'id' | 'brief_id'> {
  const parsed = parseCbaArticleId(article.id);
  return {
    ref_index: refIndex,
    kind: 'CBA',
    source: CBA_SOURCE_NAME,
    title: cbaArticleTitle(article),
    updated_at: CBA_SOURCE_FRESHNESS,
    data: {
      article: parsed.article ?? article.id,
      section: parsed.section ?? null,
      excerpt: article.body,
      rows: [
        { k: 'Citation', v: article.id },
        { k: 'Rule', v: article.label },
      ],
    },
  };
}

function cbaArticleSearchText(article: CbaArticle): string {
  return [
    article.id,
    article.label,
    article.article ?? '',
    article.section ?? '',
    article.section_number ?? '',
    ...(article.aliases ?? []),
    article.body,
  ].join(' ').toLowerCase();
}

function cbaArticleTitle(article: CbaArticle): string {
  return article.label.toLowerCase().startsWith(article.id.toLowerCase())
    ? article.label
    : `${article.id} - ${article.label}`;
}

function parseCbaArticleId(id: string): { article: string | null; section: string | null } {
  const match = id.match(/^ARTICLE\s+([IVXLCDM]+)\s+(§\S+)/i);
  if (!match) return { article: null, section: null };
  return { article: match[1].toUpperCase(), section: match[2] };
}

function cbaArticleKeys(article: CbaArticle): string[] {
  return [article.id, `${article.id} - ${article.label}`, article.label].map(cbaKey);
}

function cbaSourceKeys(source: Omit<BriefSource, 'id' | 'brief_id'>): string[] {
  if (source.kind !== 'CBA') return [];
  const keys = [source.title, source.source ?? ''];
  const data = source.data;
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    if (typeof record.article === 'string') keys.push(record.article);
    if (typeof record.section === 'string') keys.push(record.section);
    if (Array.isArray(record.rows)) {
      for (const row of record.rows) {
        if (row && typeof row === 'object') {
          const value = (row as Record<string, unknown>).v;
          if (typeof value === 'string') keys.push(value);
        }
      }
    }
  }
  return keys.map(cbaKey);
}

function cbaKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9§.]+/g, '');
}

function mergeCbaArticleRankings(groups: CbaArticle[][], limit: number): CbaArticle[] {
  const merged: CbaArticle[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const article of group) {
      const key = cbaKey(article.id);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(article);
      if (merged.length >= limit) return merged;
    }
  }
  return merged;
}

function dedupeCbaArticles(articles: CbaArticle[]): CbaArticle[] {
  return mergeCbaArticleRankings([articles], articles.length);
}

function dedupeTraceDatasets(traces: DataAnalystTrace[]): DataAnalystTraceDataset[] {
  const byKey = new Map<string, DataAnalystTraceDataset>();
  for (const trace of traces) {
    for (const dataset of trace.datasets) {
      const key = `${dataset.dataset_id}:${dataset.team_ids.join(',')}:${dataset.as_of_date ?? ''}`;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, { ...dataset });
      } else {
        byKey.set(key, {
          ...existing,
          row_count: Math.max(existing.row_count, dataset.row_count),
          team_ids: [...new Set([...existing.team_ids, ...dataset.team_ids])].sort(),
        });
      }
    }
  }
  return [...byKey.values()];
}

function firstString(values: Array<string | null | undefined>): string | null {
  return values.find((value): value is string => typeof value === 'string' && value.length > 0) ?? null;
}

export function isSubmitDataAnalysisInput(input: unknown): input is SubmitDataAnalysisInput {
  return (
    typeof input === 'object' &&
    input !== null &&
    typeof (input as SubmitDataAnalysisInput).answer === 'string' &&
    Array.isArray((input as SubmitDataAnalysisInput).key_findings) &&
    Array.isArray((input as SubmitDataAnalysisInput).tables) &&
    Array.isArray((input as SubmitDataAnalysisInput).calculations) &&
    Array.isArray((input as SubmitDataAnalysisInput).sources) &&
    Array.isArray((input as SubmitDataAnalysisInput).caveats) &&
    Array.isArray((input as SubmitDataAnalysisInput).followups)
  );
}
