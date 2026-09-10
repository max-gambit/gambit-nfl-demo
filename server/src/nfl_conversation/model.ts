import type Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ANALYST_MODEL = 'gpt-6-astra';
export const ANALYST_EFFORT = 'max';
export const ANALYST_SERVICE_TIER = 'fast';
export const ANALYST_MAX_OUTPUT_TOKENS = 32768;
const localEnvironment = fileURLToPath(new URL('../../.env.local', import.meta.url));

export interface AnalystModelMetadata {
  provider: 'openai';
  requested_model: string;
  model: string;
  reasoning_effort: 'max';
  requested_service_tier: 'fast';
  service_tier: string | null;
  response_id: string;
  reasoning_tokens: number;
  cached_input_tokens: number;
}

type Json = Record<string, any>;
export class AnalystProviderError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

// The application keeps its existing tool protocol. These weak maps preserve
// complete Responses output items (including encrypted reasoning and phase)
// for the next tool round without persisting them in briefs or QA traces.
const responseItems = new WeakMap<object, Json[]>();
const responseMetadata = new WeakMap<object, AnalystModelMetadata>();
export const analystModelMetadata = (message: Anthropic.Message) => responseMetadata.get(message);

function inputItems(messages: Anthropic.MessageParam[]): Json[] {
  const input: Json[] = [];
  for (const message of messages) {
    const preserved = typeof message.content === 'object' && responseItems.get(message.content);
    if (message.role === 'assistant' && preserved) { input.push(...preserved); continue; }
    if (typeof message.content === 'string') { input.push({ role: message.role, content: message.content }); continue; }
    for (const block of message.content) {
      if (block.type === 'text') input.push({ role: message.role, content: block.text });
      else if (block.type === 'tool_use') input.push({ type: 'function_call', call_id: block.id, name: block.name, arguments: JSON.stringify(block.input) });
      else if (block.type === 'tool_result') {
        const output = typeof block.content === 'string' ? block.content : (block.content ?? []).map(part => {
          if (part.type !== 'text') throw new Error('The Giants analyst supports text tool results only.');
          return part.text;
        }).join('\n');
        input.push({ type: 'function_call_output', call_id: block.tool_use_id, output: block.is_error ? JSON.stringify({ error: output }) : output });
      } else throw new Error('Unsupported content in the Giants analyst tool conversation.');
    }
  }
  return input;
}

export function analystResponseRequest(params: Anthropic.MessageCreateParamsNonStreaming): Json {
  if (params.model !== ANALYST_MODEL) throw new Error('The Giants analyst must explicitly request ' + ANALYST_MODEL + '.');
  const choice = params.tool_choice;
  const toolChoice = choice?.type === 'tool' ? { type: 'function', name: choice.name }
    : choice?.type === 'any' ? 'required' : choice?.type === 'none' ? 'none' : 'auto';
  const tools = (params.tools ?? []).map(tool => {
    if (!('input_schema' in tool)) throw new Error('Only application function tools are supported by the Giants analyst.');
    return { type: 'function', name: tool.name, description: tool.description ?? '', parameters: tool.input_schema, strict: tool.strict === true };
  });
  return {
    model: ANALYST_MODEL, reasoning: { effort: ANALYST_EFFORT }, service_tier: ANALYST_SERVICE_TIER,
    store: false, max_output_tokens: Math.max(ANALYST_MAX_OUTPUT_TOKENS, params.max_tokens),
    instructions: typeof params.system === 'string' ? params.system : params.system?.map(block => block.text).join('\n'),
    input: inputItems(params.messages),
    ...(tools.length ? { tools, tool_choice: toolChoice, parallel_tool_calls: !(choice && 'disable_parallel_tool_use' in choice && choice.disable_parallel_tool_use) } : {}),
  };
}

function apiKey(): string | undefined {
  // Each candidate worktree can configure its own ignored file. Never change
  // the shared .env symlink or silently substitute another model/provider.
  if (!process.env.OPENAI_API_KEY?.trim()) {
    try {
      const localKey = dotenv.parse(readFileSync(localEnvironment)).OPENAI_API_KEY;
      if (localKey?.trim()) process.env.OPENAI_API_KEY = localKey.trim();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return process.env.OPENAI_API_KEY?.trim();
}

export function createAnalystClient(deps: { fetch?: typeof fetch; getApiKey?: () => string | undefined } = {}) {
  return async function createMessage(params: Anthropic.MessageCreateParamsNonStreaming, options?: Anthropic.RequestOptions): Promise<Anthropic.Message> {
    const key = (deps.getApiKey ?? apiKey)();
    if (!key) throw new AnalystProviderError('missing_api_key', 'The Giants analyst needs OPENAI_API_KEY configured in server/.env.local.');
    const timeout = AbortSignal.timeout(Math.max(1, options?.timeout ?? 180000));
    const signal = options?.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
    const response = await (deps.fetch ?? fetch)('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify(analystResponseRequest(params)), signal,
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({})) as Json;
      const code = typeof detail.error?.code === 'string' ? detail.error.code : 'http_' + response.status;
      throw new AnalystProviderError(code, 'The OpenAI analyst request failed (HTTP ' + response.status + '; ' + code + ').');
    }
    const result = await response.json() as Json;
    if (!Array.isArray(result.output) || typeof result.id !== 'string' || typeof result.model !== 'string') throw new AnalystProviderError('invalid_response', 'The OpenAI analyst returned an invalid response.');
    if (result.status !== 'completed' && result.status !== 'incomplete') throw new AnalystProviderError('response_' + result.status, 'The OpenAI analyst did not complete the response.');
    const content: Anthropic.ContentBlock[] = [];
    let refused = false;
    for (const item of result.output) {
      if (item.type === 'function_call') {
        if (typeof item.call_id !== 'string' || typeof item.name !== 'string' || typeof item.arguments !== 'string') throw new AnalystProviderError('invalid_tool_call', 'The OpenAI analyst returned an invalid tool call.');
        let args: unknown;
        try { args = JSON.parse(item.arguments); } catch { throw new AnalystProviderError('invalid_tool_arguments', 'The OpenAI analyst returned incomplete tool arguments.'); }
        if (!args || typeof args !== 'object' || Array.isArray(args)) throw new AnalystProviderError('invalid_tool_arguments', 'The OpenAI analyst returned non-object tool arguments.');
        content.push({ type: 'tool_use', id: item.call_id, name: item.name, input: args, caller: { type: 'direct' } });
      } else if (item.type === 'message') {
        for (const part of item.content ?? []) {
          if (part.type === 'output_text') content.push({ type: 'text', text: part.text, citations: [] });
          if (part.type === 'refusal') refused = true;
        }
      } else if (item.type !== 'reasoning') throw new AnalystProviderError('unsupported_output', 'The OpenAI analyst returned an unsupported output item.');
    }
    const message = {
      id: result.id, type: 'message', role: 'assistant', model: result.model, content,
      stop_reason: result.status === 'incomplete' ? 'max_tokens' : refused ? 'refusal' : content.some(block => block.type === 'tool_use') ? 'tool_use' : 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: result.usage?.input_tokens ?? 0, output_tokens: result.usage?.output_tokens ?? 0 },
    } as Anthropic.Message;
    responseItems.set(content, result.output);
    responseMetadata.set(message, { provider: 'openai', requested_model: ANALYST_MODEL, model: result.model, reasoning_effort: ANALYST_EFFORT, requested_service_tier: ANALYST_SERVICE_TIER, service_tier: typeof result.service_tier === 'string' ? result.service_tier : null, response_id: result.id, reasoning_tokens: result.usage?.output_tokens_details?.reasoning_tokens ?? 0, cached_input_tokens: result.usage?.input_tokens_details?.cached_tokens ?? 0 });
    return message;
  };
}

export const createAnalystMessage = createAnalystClient();
