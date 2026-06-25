import Anthropic from '@anthropic-ai/sdk';
import type {
  BetaFallbackParam,
  BetaMessage,
  BetaMessageStreamParams,
  MessageCreateParamsNonStreaming as BetaMessageCreateParamsNonStreaming,
} from '@anthropic-ai/sdk/resources/beta/messages';

// Reads ANTHROPIC_API_KEY from env; SDK retries 429/5xx with exponential backoff.
export const anthropic = new Anthropic();

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-4-8';
export const DEFAULT_ANTHROPIC_FALLBACK_MODEL = 'claude-opus-4-8';
export const SERVER_SIDE_FALLBACK_BETA = 'server-side-fallback-2026-06-01';
const FABLE_MODEL = 'claude-fable-5';

export interface AnthropicModelConfig {
  chatModel: string;
  briefModel: string;
  fallbackModel: string;
}

export type ClaudeMessageCreateParamsWithFallback =
  Anthropic.MessageCreateParamsNonStreaming & {
    betas?: string[];
    fallbacks?: BetaFallbackParam[] | null;
  };

export interface ClaudeMessageStream extends AsyncIterable<Anthropic.MessageStreamEvent> {
  finalMessage(): Promise<Anthropic.Message>;
}

type EnvLike = Record<string, string | undefined>;

export function resolveAnthropicModelConfig(env: EnvLike = process.env): AnthropicModelConfig {
  const sharedModel = envModel(env, 'ANTHROPIC_MODEL') ?? DEFAULT_ANTHROPIC_MODEL;
  return {
    chatModel: envModel(env, 'ANTHROPIC_CHAT_MODEL') ?? sharedModel,
    briefModel: envModel(env, 'ANTHROPIC_BRIEF_MODEL') ?? sharedModel,
    fallbackModel: envModel(env, 'ANTHROPIC_FALLBACK_MODEL') ?? DEFAULT_ANTHROPIC_FALLBACK_MODEL,
  };
}

const modelConfig = resolveAnthropicModelConfig();

export const CHAT_MODEL = modelConfig.chatModel;
export const BRIEF_MODEL = modelConfig.briefModel;
export const ANTHROPIC_FALLBACK_MODEL = modelConfig.fallbackModel;

export function withClaudeServerSideFallback(
  params: Anthropic.MessageCreateParamsNonStreaming,
  fallbackModel = ANTHROPIC_FALLBACK_MODEL,
): ClaudeMessageCreateParamsWithFallback {
  const request = params as ClaudeMessageCreateParamsWithFallback;
  if (!shouldAttachFableFallback(params.model, fallbackModel)) return request;

  return {
    ...request,
    betas: uniqueStrings([...(request.betas ?? []), SERVER_SIDE_FALLBACK_BETA]),
    fallbacks: request.fallbacks ?? [{ model: fallbackModel }],
  };
}

export async function createClaudeMessage(
  params: Anthropic.MessageCreateParamsNonStreaming,
): Promise<Anthropic.Message> {
  const request = withClaudeServerSideFallback(params);
  if (request.fallbacks?.length) {
    try {
      const response = await anthropic.beta.messages.create(
        request as unknown as BetaMessageCreateParamsNonStreaming,
      );
      logFallbackServingModel(params.model, response);
      return response as unknown as Anthropic.Message;
    } catch (error) {
      if (!isForcedToolIncompatibleError(error)) throw error;
      const fallbackModel = firstFallbackModel(request);
      if (!fallbackModel) throw error;
      console.info(`[claude] ${params.model} rejected forced tool use; retrying with ${fallbackModel}`);
      const response = await anthropic.messages.create({
        ...params,
        model: fallbackModel,
      });
      logFallbackServingModel(params.model, response);
      return response;
    }
  }

  return anthropic.messages.create(params);
}

export function streamClaudeMessage(
  params: Anthropic.MessageCreateParamsNonStreaming,
): ClaudeMessageStream {
  const request = withClaudeServerSideFallback(params);
  if (request.fallbacks?.length) {
    const stream = anthropic.beta.messages.stream(
      request as unknown as BetaMessageStreamParams,
    ) as unknown as ClaudeMessageStream;
    return withLoggedFinalMessage(stream, params.model);
  }

  return anthropic.messages.stream(params) as unknown as ClaudeMessageStream;
}

export function servingModelFromMessage(message: Anthropic.Message | BetaMessage): string | null {
  const fallbackModel = fallbackServingModelFromContent(message.content);
  return fallbackModel ?? message.model ?? null;
}

function shouldAttachFableFallback(model: string, fallbackModel: string): boolean {
  return model === FABLE_MODEL && fallbackModel.trim().length > 0 && fallbackModel !== model;
}

export function isForcedToolIncompatibleError(error: unknown): boolean {
  return /tool_choice forces tool use is not compatible/i.test(errorMessage(error));
}

function envModel(env: EnvLike, key: string): string | null {
  const value = env[key]?.trim();
  return value ? value : null;
}

function firstFallbackModel(request: ClaudeMessageCreateParamsWithFallback): string | null {
  const model = request.fallbacks?.[0]?.model;
  return typeof model === 'string' && model.trim() ? model : null;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (isRecord(error)) {
    const nested = error.error;
    if (isRecord(nested)) {
      const nestedError = nested.error;
      if (isRecord(nestedError) && typeof nestedError.message === 'string') return nestedError.message;
      if (typeof nested.message === 'string') return nested.message;
    }
    if (typeof error.message === 'string') return error.message;
  }
  return String(error);
}

function fallbackServingModelFromContent(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (!isRecord(block) || block.type !== 'fallback') continue;
    const to = block.to;
    if (isRecord(to) && typeof to.model === 'string' && to.model.trim()) {
      return to.model;
    }
  }
  return null;
}

function withLoggedFinalMessage(
  stream: ClaudeMessageStream,
  requestedModel: string,
): ClaudeMessageStream {
  const finalMessage = stream.finalMessage.bind(stream);
  return Object.assign(stream, {
    async finalMessage(): Promise<Anthropic.Message> {
      const message = await finalMessage();
      logFallbackServingModel(requestedModel, message);
      return message;
    },
  });
}

function logFallbackServingModel(requestedModel: string, response: Anthropic.Message | BetaMessage): void {
  const servingModel = servingModelFromMessage(response);
  if (servingModel && servingModel !== requestedModel) {
    console.info(`[claude] server-side fallback served ${requestedModel} with ${servingModel}`);
  }
  if (response.stop_reason === 'refusal') {
    console.info(`[claude] model refusal surfaced as response from ${servingModel ?? requestedModel}`);
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
