import { Hono } from 'hono';
import { db } from '../db/client.js';
import { handlerFor, AGENT_TITLES } from '../claude/agents/index.js';
import type { AgentKind, AgentRun, RunAgentRequest, RunAgentResponse } from '@shared/types';

export const agentRoutes = new Hono();

// Hard ceiling per the plan (Cost guardrails). If a handler exceeds this,
// we abort, mark failed, and surface the timeout to the client.
const MAX_RUN_MS = 120_000;
// How long the "just_finished" flag stays true after completion. Drives the
// 600ms puck pulse client-side; we keep it slightly longer than the animation
// so a slow client still catches the rising edge.
const JUST_FINISHED_MS = 1500;

const VALID_KINDS: ReadonlySet<AgentKind> = new Set([
  'deck', 'memo', 'research', 'comp_set', 'synthesize', 'change_my_mind', 'staff_protocol',
] as const);

interface SuppliedRunRequest extends RunAgentRequest {
  query?: string;
}

agentRoutes.post('/run', async (c) => {
  let body: SuppliedRunRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const { brief_id, kind, config = {}, query } = body;
  if (!brief_id || typeof brief_id !== 'string') {
    return c.json({ error: 'brief_id required' }, 400);
  }
  if (!kind || !VALID_KINDS.has(kind)) {
    return c.json({ error: 'kind must be one of deck|memo|research|comp_set|synthesize|change_my_mind|staff_protocol' }, 400);
  }

  // Look up the brief so we can use its thesis/question to label the puck.
  const briefRes = await db.from('briefs').select('id, thesis, question, session_id').eq('id', brief_id).maybeSingle();
  if (briefRes.error || !briefRes.data) {
    return c.json({ error: 'brief_not_found', detail: briefRes.error?.message }, 404);
  }
  const brief = briefRes.data as Pick<AgentRun, 'session_id'> & { thesis: string | null; question: string };

  // The query passed from the palette is part of config so the handler sees it.
  const mergedConfig = { ...config, ...(query ? { query } : {}) };
  const subjectLine = brief.thesis ?? brief.question;
  const sub = `From "${subjectLine.slice(0, 40)}${subjectLine.length > 40 ? '…' : ''}"`;

  const insert = await db
    .from('agent_runs')
    .insert({
      brief_id,
      session_id: brief.session_id,
      kind,
      status: 'running',
      progress: 5,
      title: AGENT_TITLES[kind],
      sub,
      config: mergedConfig,
    })
    .select()
    .single();

  if (insert.error || !insert.data) {
    return c.json({ error: 'persist_run_failed', detail: insert.error?.message }, 500);
  }

  const run = insert.data as AgentRun;

  // Fire-and-forget. Errors are caught and persisted as status='failed'.
  void executeRun(run, mergedConfig).catch(async (err) => {
    console.error('[agent] run failed', run.id, err);
    await db
      .from('agent_runs')
      .update({
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
        completed_at: new Date().toISOString(),
        progress: 0,
      })
      .eq('id', run.id);
  });

  const response: RunAgentResponse = { run_id: run.id };
  return c.json(response, 201);
});

agentRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'id required' }, 400);

  const res = await db.from('agent_runs').select('*').eq('id', id).maybeSingle();
  if (res.error) return c.json({ error: 'lookup_failed', detail: res.error.message }, 500);
  if (!res.data) return c.json({ error: 'not_found' }, 404);

  return c.json({ run: res.data });
});

/**
 * Mints a short-lived signed URL for an artifact's storage path. Clients call
 * this when the user clicks Open — keeps URLs out of the artifact row so
 * stale links don't sit around.
 */
agentRoutes.get('/artifacts/:id/url', async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'id required' }, 400);

  const res = await db.from('artifacts').select('storage_url, name').eq('id', id).maybeSingle();
  if (res.error) return c.json({ error: 'lookup_failed', detail: res.error.message }, 500);
  if (!res.data || !res.data.storage_url) return c.json({ error: 'not_found' }, 404);

  const signed = await db.storage
    .from('artifacts')
    .createSignedUrl(res.data.storage_url, 60 * 60);
  if (signed.error || !signed.data) {
    return c.json({ error: 'signed_url_failed', detail: signed.error?.message }, 500);
  }

  return c.json({ url: signed.data.signedUrl, name: res.data.name });
});

async function executeRun(run: AgentRun, config: { query?: string }) {
  const handler = handlerFor(run.kind);
  if (!run.brief_id) throw new Error('agent run missing brief_id');

  // Halfway progress tick after a short delay — purely cosmetic so the
  // puck shows movement while Claude generates the artifact. Note: the
  // Supabase query builder is thenable but lazy — we have to call `.then`
  // (or await) to actually issue the request.
  const halfwayTimer = setTimeout(() => {
    db.from('agent_runs').update({ progress: 50 }).eq('id', run.id).then(
      () => undefined,
      (err) => console.warn('[agent] halfway progress update failed', err),
    );
  }, 4_000);

  // Bounded execution. Race the handler against a hard timeout — whichever
  // resolves first wins. If timeout wins, status flips to failed below.
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`agent timed out after ${MAX_RUN_MS / 1000}s`)), MAX_RUN_MS),
  );

  let result;
  try {
    result = await Promise.race([
      handler(run.brief_id, config, run.id),
      timeoutPromise,
    ]);
  } finally {
    clearTimeout(halfwayTimer);
  }

  // Persist artifact row.
  const artifactInsert = await db
    .from('artifacts')
    .insert({
      agent_run_id: run.id,
      brief_id: run.brief_id,
      name: result.artifact.name,
      kind: result.artifact.kind,
      storage_url: result.artifact.storage_path,
      meta: result.artifact.meta,
    })
    .select()
    .single();
  if (artifactInsert.error) {
    throw new Error(`artifact insert failed: ${artifactInsert.error.message}`);
  }

  // Flip the run to completed with just_finished=true so the client puck
  // can pulse, then clear the flag a moment later.
  await db
    .from('agent_runs')
    .update({
      status: 'completed',
      progress: 100,
      result: { summary: result.summary, artifact_id: artifactInsert.data?.id },
      completed_at: new Date().toISOString(),
      just_finished: true,
    })
    .eq('id', run.id);

  setTimeout(() => {
    db.from('agent_runs').update({ just_finished: false }).eq('id', run.id).then(
      () => undefined,
      (err) => console.warn('[agent] just_finished clear failed', err),
    );
  }, JUST_FINISHED_MS);
}
