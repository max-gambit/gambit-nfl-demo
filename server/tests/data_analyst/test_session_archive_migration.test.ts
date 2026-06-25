import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('sessions support archived channels without deleting their briefs', async () => {
  const migration = await readFile(
    path.join(repoRoot, 'supabase/migrations/20260612000200_archive_sessions.sql'),
    'utf8',
  );
  const initialSchema = await readFile(
    path.join(repoRoot, 'supabase/migrations/20260427000000_initial.sql'),
    'utf8',
  );

  assert.match(initialSchema, /archived_at\s+timestamptz/);
  assert.match(migration, /alter table sessions\s+add column if not exists archived_at timestamptz/);
  assert.match(migration, /create index if not exists idx_sessions_active_created_at/);
  assert.doesNotMatch(migration, /delete from briefs/i);
});
