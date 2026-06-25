import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('brief share tokens are prefixed and URL safe', async () => {
  process.env.SUPABASE_URL ??= 'http://localhost:54321';
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-key';
  const { createBriefShareToken } = await import('../../src/routes/briefs.js');

  const token = createBriefShareToken((size) => Buffer.alloc(size, 0xab));

  assert.match(token, /^gbs_[A-Za-z0-9_-]{24}$/);
  assert.equal(token.includes('='), false);
});

test('brief share migration creates persistence tables and Warriors recipients', async () => {
  const migration = await readFile(
    path.join(repoRoot, 'supabase/migrations/20260612000100_brief_share_flow.sql'),
    'utf8',
  );

  assert.match(migration, /create table if not exists team_members/);
  assert.match(migration, /create table if not exists brief_shares/);
  assert.match(migration, /create table if not exists brief_share_links/);
  assert.match(migration, /'GSW', 'Jon Phelps'/);
  assert.match(migration, /'GSW', 'Michael Scheinert'/);
  assert.match(migration, /idx_brief_share_links_one_active_per_brief/);
});
