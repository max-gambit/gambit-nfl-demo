import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { AgentKind } from '@shared/types';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('agent registry routes staff protocol to a real handler', async () => {
  process.env.ANTHROPIC_API_KEY ??= 'test-key';
  const { AGENT_TITLES, handlerFor } = await import('../../src/claude/agents/index.js');

  assert.equal(typeof handlerFor('staff_protocol' as AgentKind), 'function');
  assert.equal(AGENT_TITLES.staff_protocol, 'Creating staff protocol');
});

test('agent kind migrations include change_my_mind and staff_protocol enum values', async () => {
  const migration = await readFile(
    path.join(repoRoot, 'supabase/migrations/20260518000100_agent_kind_change_my_mind_staff_protocol.sql'),
    'utf8',
  );

  assert.match(migration, /add value if not exists 'change_my_mind'/);
  assert.match(migration, /add value if not exists 'staff_protocol'/);
});
