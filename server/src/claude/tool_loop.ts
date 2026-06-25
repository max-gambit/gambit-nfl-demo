import type Anthropic from '@anthropic-ai/sdk';
import { createClaudeMessage, streamClaudeMessage } from './client.js';
import {
  contextGraphTraceFromToolResult,
  contextGraphToolResultBlock,
  contextGraphTools,
  isContextGraphToolUse,
} from './context_graph.js';
import {
  dataAnalystToolResultBlock,
  isDataAnalystToolUse,
  queryNbaDataTool,
} from './data_analyst.js';
import type { TeamPreferenceStoreOptions } from '../context_graph/preferences.js';
import type { ContextGraphTrace, DataAnalystTrace } from '@shared/types';

const MAX_TOOL_ROUNDS = 6;

export interface ContextGraphToolLoopOptions {
  contextGraphOptions?: TeamPreferenceStoreOptions;
  terminalToolNames?: string[];
}

export interface StreamCallbacks {
  onText?: (text: string) => Promise<void> | void;
  onContextGraphToolUse?: (toolUse: Anthropic.ToolUseBlock) => Promise<void> | void;
  onContextGraphToolResult?: (
    toolUse: Anthropic.ToolUseBlock,
    result: Anthropic.ToolResultBlockParam,
  ) => Promise<void> | void;
  onContextGraphTrace?: (trace: ContextGraphTrace) => Promise<void> | void;
  onDataAnalystToolUse?: (toolUse: Anthropic.ToolUseBlock) => Promise<void> | void;
  onDataAnalystTrace?: (trace: DataAnalystTrace) => Promise<void> | void;
}

export interface MessageWithContextGraphTraces {
  message: Anthropic.Message;
  traces: ContextGraphTrace[];
}

export interface MessagesWithContextGraphTraces {
  messages: Anthropic.MessageParam[];
  traces: ContextGraphTrace[];
}

export interface GambitToolStreamResult {
  text: string;
  finalMessage: Anthropic.Message;
  contextGraphTraces: ContextGraphTrace[];
  dataAnalystTraces: DataAnalystTrace[];
}

export async function createMessageWithContextGraphTools(
  params: Anthropic.MessageCreateParamsNonStreaming,
  options: ContextGraphToolLoopOptions = {},
): Promise<MessageWithContextGraphTraces> {
  let messages = [...params.messages];
  const traces: ContextGraphTrace[] = [];
  const tools = mergeContextGraphTools(params.tools);
  const terminalToolNames = new Set(options.terminalToolNames ?? []);

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const response = await createClaudeMessage({
      ...params,
      messages,
      tools,
      stream: false,
    });

    if (hasTerminalToolUse(response, terminalToolNames)) return { message: response, traces };

    const contextToolUses = response.content.filter(isContextGraphToolUse);
    if (contextToolUses.length === 0) return { message: response, traces };

    const toolResult = await appendContextGraphToolResults(
      messages,
      response.content,
      contextToolUses,
      options.contextGraphOptions,
    );
    messages = toolResult.messages;
    traces.push(...toolResult.traces);
  }

  throw new Error(`Intel tool loop exceeded ${MAX_TOOL_ROUNDS} rounds.`);
}

export async function buildMessagesWithContextGraphLookups(
  params: Anthropic.MessageCreateParamsNonStreaming,
  options: ContextGraphToolLoopOptions = {},
): Promise<MessagesWithContextGraphTraces> {
  let messages = [...params.messages];
  const traces: ContextGraphTrace[] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const response = await createClaudeMessage({
      ...params,
      messages,
      tools: contextGraphTools,
      tool_choice: { type: 'auto' },
      stream: false,
    });

    const contextToolUses = response.content.filter(isContextGraphToolUse);
    if (contextToolUses.length === 0) return { messages, traces };

    const toolResult = await appendContextGraphToolResults(
      messages,
      response.content,
      contextToolUses,
      options.contextGraphOptions,
    );
    messages = toolResult.messages;
    traces.push(...toolResult.traces);
  }

  throw new Error(`Intel lookup loop exceeded ${MAX_TOOL_ROUNDS} rounds.`);
}

export async function streamMessageWithContextGraphTools(
  params: Anthropic.MessageCreateParamsNonStreaming,
  callbacks: StreamCallbacks = {},
  options: ContextGraphToolLoopOptions = {},
): Promise<{ text: string; finalMessage: Anthropic.Message; traces: ContextGraphTrace[] }> {
  let messages = [...params.messages];
  const tools = mergeContextGraphTools(params.tools);
  let accumulatedText = '';
  const traces: ContextGraphTrace[] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const claudeStream = streamClaudeMessage({
      ...params,
      messages,
      tools,
    });

    for await (const event of claudeStream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        accumulatedText += event.delta.text;
        await callbacks.onText?.(event.delta.text);
      }
    }

    const finalMessage = await claudeStream.finalMessage();
    const contextToolUses = finalMessage.content.filter(isContextGraphToolUse);
    if (contextToolUses.length === 0) {
      return { text: accumulatedText, finalMessage, traces };
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const toolUse of contextToolUses) {
      await callbacks.onContextGraphToolUse?.(toolUse);
      const result = await contextGraphToolResultBlock(toolUse, options.contextGraphOptions);
      toolResults.push(result);
      await callbacks.onContextGraphToolResult?.(toolUse, result);
      const trace = contextGraphTraceFromToolResult(toolUse.id, result);
      if (trace) {
        traces.push(trace);
        await callbacks.onContextGraphTrace?.(trace);
      }
    }

    messages = appendToolResultMessages(messages, finalMessage.content, toolResults);
  }

  throw new Error(`Intel tool loop exceeded ${MAX_TOOL_ROUNDS} rounds.`);
}

export async function streamMessageWithGambitTools(
  params: Anthropic.MessageCreateParamsNonStreaming,
  callbacks: StreamCallbacks = {},
  options: ContextGraphToolLoopOptions = {},
): Promise<GambitToolStreamResult> {
  let messages = [...params.messages];
  const tools = mergeGambitTools(params.tools);
  let accumulatedText = '';
  const contextGraphTraces: ContextGraphTrace[] = [];
  const dataAnalystTraces: DataAnalystTrace[] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const claudeStream = streamClaudeMessage({
      ...params,
      messages,
      tools,
    });

    for await (const event of claudeStream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        accumulatedText += event.delta.text;
        await callbacks.onText?.(event.delta.text);
      }
    }

    const finalMessage = await claudeStream.finalMessage();
    const toolUses = finalMessage.content.filter(isGambitToolUse);
    if (toolUses.length === 0) {
      return { text: accumulatedText, finalMessage, contextGraphTraces, dataAnalystTraces };
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const toolUse of toolUses) {
      if (isContextGraphToolUse(toolUse)) {
        await callbacks.onContextGraphToolUse?.(toolUse);
        const result = await contextGraphToolResultBlock(toolUse, options.contextGraphOptions);
        toolResults.push(result);
        await callbacks.onContextGraphToolResult?.(toolUse, result);
        const trace = contextGraphTraceFromToolResult(toolUse.id, result);
        if (trace) {
          contextGraphTraces.push(trace);
          await callbacks.onContextGraphTrace?.(trace);
        }
      } else {
        await callbacks.onDataAnalystToolUse?.(toolUse);
        const { block, trace } = await dataAnalystToolResultBlock(toolUse);
        toolResults.push(block);
        dataAnalystTraces.push(trace);
        await callbacks.onDataAnalystTrace?.(trace);
      }
    }

    messages = appendToolResultMessages(messages, finalMessage.content, toolResults);
  }

  throw new Error(`Gambit tool loop exceeded ${MAX_TOOL_ROUNDS} rounds.`);
}

async function appendContextGraphToolResults(
  messages: Anthropic.MessageParam[],
  assistantContent: Anthropic.ContentBlock[],
  toolUses: Anthropic.ToolUseBlock[],
  options?: TeamPreferenceStoreOptions,
): Promise<MessagesWithContextGraphTraces> {
  const toolResults = await Promise.all(
    toolUses.map((toolUse) => contextGraphToolResultBlock(toolUse, options)),
  );
  return {
    messages: appendToolResultMessages(messages, assistantContent, toolResults),
    traces: toolResults.flatMap((result, index) => {
      const trace = contextGraphTraceFromToolResult(toolUses[index].id, result);
      return trace ? [trace] : [];
    }),
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

function mergeContextGraphTools(
  tools: Anthropic.ToolUnion[] | undefined,
): Anthropic.ToolUnion[] {
  return mergeTools(tools, contextGraphTools);
}

function mergeGambitTools(
  tools: Anthropic.ToolUnion[] | undefined,
): Anthropic.ToolUnion[] {
  return mergeTools(tools, [...contextGraphTools, queryNbaDataTool]);
}

function mergeTools(
  tools: Anthropic.ToolUnion[] | undefined,
  requiredTools: Anthropic.ToolUnion[],
): Anthropic.ToolUnion[] {
  const merged = [...requiredTools];
  for (const tool of tools ?? []) {
    if (!merged.some((existing) => existing.name === tool.name)) merged.push(tool);
  }
  return merged;
}

function isGambitToolUse(block: Anthropic.ContentBlock): block is Anthropic.ToolUseBlock {
  return isContextGraphToolUse(block) || isDataAnalystToolUse(block);
}

function hasTerminalToolUse(
  response: Anthropic.Message,
  terminalToolNames: Set<string>,
): boolean {
  if (terminalToolNames.size === 0) return false;
  return response.content.some(
    (block) => block.type === 'tool_use' && terminalToolNames.has(block.name),
  );
}
