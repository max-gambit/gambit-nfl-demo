import { createClient } from '@supabase/supabase-js';

/**
 * Wipes all user-scoped Supabase tables before a run so the harness exercises
 * the cold-start UX every time. Reference data (cba_articles) is preserved.
 *
 * Cascade chain (see schema.sql):
 *   sessions → briefs (cascade) → {chat_turns, brief_options, brief_sources,
 *                                  bookmarks, monitors, artifacts} (all cascade)
 *   agent_runs → artifacts (cascade)
 *   agent_runs.session_id / brief_id → ON DELETE SET NULL (so deleting sessions
 *     doesn't remove agent_runs — it orphans them)
 *
 * So the minimum delete set is `agent_runs` + `sessions`. Both have a
 * `created_at` column, which Supabase JS requires us to filter on (no `where
 * true` affordance on `delete()`). Storage objects from prior agent runs are
 * intentionally left in place — they're orphaned but harmless.
 */
export async function resetDatabase(opts: { supabaseUrl: string; serviceRoleKey: string }): Promise<void> {
  const db = createClient(opts.supabaseUrl, opts.serviceRoleKey, {
    auth: { persistSession: false },
  });

  const ALL = '1900-01-01';

  const agentRunsRes = await db.from('agent_runs').delete().gt('created_at', ALL);
  if (agentRunsRes.error) {
    console.warn('[reset] agent_runs:', agentRunsRes.error.message);
  }

  const sessionsRes = await db.from('sessions').delete().gt('created_at', ALL);
  if (sessionsRes.error) {
    console.warn('[reset] sessions:', sessionsRes.error.message);
  }
}
