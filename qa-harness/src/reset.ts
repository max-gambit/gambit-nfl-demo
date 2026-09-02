import { createClient } from '@supabase/supabase-js';

/** Remove only rows explicitly owned by prior automated QA runs. */
export async function resetQaWorkspaceRows(opts: { supabaseUrl: string; serviceRoleKey: string }): Promise<void> {
  const db = createClient(opts.supabaseUrl, opts.serviceRoleKey, { auth: { persistSession: false } });
  const projects = await db.from('projects').delete().eq('workspace_key', 'nyg-demo').like('seed_key', 'qa:%');
  if (projects.error) throw new Error(`QA project reset failed: ${projects.error.message}`);
  const sessions = await db.from('sessions').delete().eq('workspace_key', 'nyg-demo').like('seed_key', 'qa:%');
  if (sessions.error) throw new Error(`QA session reset failed: ${sessions.error.message}`);
}
