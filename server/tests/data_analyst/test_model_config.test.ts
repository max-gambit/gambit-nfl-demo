import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ANTHROPIC_FALLBACK_MODEL,
  DEFAULT_ANTHROPIC_MODEL,
  resolveAnthropicModelConfig,
  withClaudeServerSideFallback,
} from '../../src/claude/client.js';

test('forced tool submissions keep default Opus without attaching fallback', () => {
  const request = withClaudeServerSideFallback({
    model: DEFAULT_ANTHROPIC_MODEL,
    max_tokens: 16,
    messages: [{ role: 'user', content: 'hello' }],
    tools: [{
      name: 'submit_test',
      input_schema: { type: 'object', properties: {} },
    }],
    tool_choice: { type: 'tool', name: 'submit_test' },
  });

  assert.equal(request.model, DEFAULT_ANTHROPIC_MODEL);
  assert.equal(request.fallbacks, undefined);
});

test('forced tool submissions on explicit Fable attach Opus fallback', () => {
  const request = withClaudeServerSideFallback({
    model: 'claude-fable-5',
    max_tokens: 16,
    messages: [{ role: 'user', content: 'hello' }],
    tools: [{
      name: 'submit_test',
      input_schema: { type: 'object', properties: {} },
    }],
    tool_choice: { type: 'tool', name: 'submit_test' },
  });

  assert.equal(request.model, 'claude-fable-5');
  assert.equal(request.fallbacks?.[0]?.model, DEFAULT_ANTHROPIC_FALLBACK_MODEL);
});

test('brief model still resolves independently from fallback model', () => {
  const config = resolveAnthropicModelConfig({
    ANTHROPIC_MODEL: 'claude-fable-5',
    ANTHROPIC_BRIEF_MODEL: undefined,
    ANTHROPIC_CHAT_MODEL: undefined,
    ANTHROPIC_FALLBACK_MODEL: 'claude-opus-4-8',
  });

  assert.equal(config.briefModel, 'claude-fable-5');
  assert.equal(config.fallbackModel, 'claude-opus-4-8');
});
