import test from 'node:test';
import assert from 'node:assert/strict';
import type Anthropic from '@anthropic-ai/sdk';
import {
  DEFAULT_ANTHROPIC_FALLBACK_MODEL,
  DEFAULT_ANTHROPIC_MODEL,
  SERVER_SIDE_FALLBACK_BETA,
  isForcedToolIncompatibleError,
  resolveAnthropicModelConfig,
  servingModelFromMessage,
  withClaudeServerSideFallback,
} from '../../src/claude/client.js';

test('Anthropic model config defaults chat and brief calls to Claude Opus 4.8', () => {
  const config = resolveAnthropicModelConfig({});

  assert.equal(config.chatModel, DEFAULT_ANTHROPIC_MODEL);
  assert.equal(config.briefModel, DEFAULT_ANTHROPIC_MODEL);
  assert.equal(config.fallbackModel, DEFAULT_ANTHROPIC_FALLBACK_MODEL);
});

test('Anthropic model config honors shared and per-use env overrides', () => {
  assert.deepEqual(resolveAnthropicModelConfig({
    ANTHROPIC_MODEL: 'shared-model',
    ANTHROPIC_CHAT_MODEL: 'chat-model',
    ANTHROPIC_BRIEF_MODEL: 'brief-model',
    ANTHROPIC_FALLBACK_MODEL: 'fallback-model',
  }), {
    chatModel: 'chat-model',
    briefModel: 'brief-model',
    fallbackModel: 'fallback-model',
  });

  assert.deepEqual(resolveAnthropicModelConfig({ ANTHROPIC_MODEL: 'shared-model' }), {
    chatModel: 'shared-model',
    briefModel: 'shared-model',
    fallbackModel: DEFAULT_ANTHROPIC_FALLBACK_MODEL,
  });
});

test('default Opus requests do not attach server-side fallback params', () => {
  const request = withClaudeServerSideFallback(messageParams(DEFAULT_ANTHROPIC_MODEL));

  assert.equal(request.betas, undefined);
  assert.equal(request.fallbacks, undefined);
});

test('explicit Fable requests attach server-side fallback beta and Opus fallback model', () => {
  const request = withClaudeServerSideFallback(messageParams('claude-fable-5'));

  assert.deepEqual(request.betas, [SERVER_SIDE_FALLBACK_BETA]);
  assert.equal(request.fallbacks?.[0]?.model, DEFAULT_ANTHROPIC_FALLBACK_MODEL);
});

test('non-Fable model overrides do not attach Fable fallback request params', () => {
  const request = withClaudeServerSideFallback(messageParams('custom-model'));

  assert.equal(request.betas, undefined);
  assert.equal(request.fallbacks, undefined);
});

test('serving model helper reads fallback seam blocks without treating refusal as an exception', () => {
  const message = {
    model: DEFAULT_ANTHROPIC_MODEL,
    stop_reason: 'refusal',
    content: [
      { type: 'fallback', from: { model: DEFAULT_ANTHROPIC_MODEL }, to: { model: DEFAULT_ANTHROPIC_FALLBACK_MODEL } },
      { type: 'text', text: 'Refusal surfaced as a model response.' },
    ],
  } as unknown as Anthropic.Message;

  assert.equal(servingModelFromMessage(message), DEFAULT_ANTHROPIC_FALLBACK_MODEL);
});

test('forced tool compatibility errors are recognized for local fallback retry', () => {
  assert.equal(isForcedToolIncompatibleError({
    error: {
      error: {
        message: 'tool_choice forces tool use is not compatible with this model.',
      },
    },
  }), true);
  assert.equal(isForcedToolIncompatibleError(new Error('unrelated provider error')), false);
});

function messageParams(model: string): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model,
    max_tokens: 16,
    messages: [{ role: 'user', content: 'hello' }],
  };
}
