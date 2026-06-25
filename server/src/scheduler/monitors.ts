import { db } from '../db/client.js';
import { regenerateBriefById } from '../routes/briefs.js';
import { handlerFor, AGENT_TITLES } from '../claude/agents/index.js';
import type { AgentKind, AgentRun, Monitor, MonitorConfig, MonitorFrequency } from '@shared/types';

const TICK_MS = 60_000;        // wake once a minute
const MAX_RUN_MS = 120_000;    // matches the agent route's per-run ceiling
const JUST_FINISHED_MS = 1500;
// Anything stuck in `generating` longer than this gets marked as failed so
// the UI doesn't spin forever after a server crash / process restart mid-call.
// We compare against `updated_at` (bumped on every status transition) rather
// than `created_at`, so a regenerate of an old brief gets a fresh sweep window
// — surfaced by the QA harness, where a slow regen got falsely-failed at
// ~150s while still in flight. Bumped from 150s → 240s to absorb the upper
// end of Opus 4.7 generation latency (typical 30–60s, observed ~120s+).
const STALE_BRIEF_MS = 240_000;

const FREQ_MS: Record<MonitorFrequency, number> = {
  hourly: 3_600_000,
  daily:  86_400_000,
  weekly: 604_800_000,
};

let started = false;
let timer: NodeJS.Timeout | null = null;

/**
 * Starts the monitor scheduler. Idempotent — calling twice is a no-op.
 * Runs once on tick, then every TICK_MS. Each tick:
 *   1. Pull every monitor whose next_fire_at < now and isn't paused.
 *   2. For each: dispatch the appropriate action (rerun → regenerate brief,
 *      watch → kick off the configured agent kind), persist alerts_count + 1,
 *      advance last_fired and next_fire_at.
 *
 * Errors per monitor are logged and isolated — one failure doesn't block
 * the other monitors on the tick.
 */
export function startMonitorScheduler(): void {
  if (started) return;
  started = true;
  // Run once on boot so testing doesn't have to wait a full minute.
  setTimeout(() => { void tick(); }, 1000);
  timer = setInterval(() => { void tick(); }, TICK_MS);
}

export function stopMonitorScheduler(): void {
  started = false;
  if (timer) clearInterval(timer);
  timer = null;
}

async function tick(): Promise<void> {
  await Promise.all([fireDueMonitors(), sweepStaleBriefs()]);
}

/**
 * Marks any brief stuck in `status='generating'` longer than STALE_BRIEF_MS
 * as 'failed' with a recoverable error so the client UI flips out of the
 * placeholder state. Triggered by:
 *   - server crashed mid-Anthropic call
 *   - process restarted before the async generateBrief finished
 *   - request landed on a process that was being SIGKILL'd
 *
 * Lightweight — single query, idempotent (re-running is a no-op).
 */
async function sweepStaleBriefs(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_BRIEF_MS).toISOString();
  const res = await db
    .from('briefs')
    .update({
      status: 'failed',
      error: 'Generation timed out — the server didn’t complete this brief in time. Click Regenerate to try again.',
      updated_at: new Date().toISOString(),
    })
    .eq('status', 'generating')
    .lt('updated_at', cutoff)
    .select('id');

  if (res.error) {
    console.warn('[scheduler] stale-brief sweep failed', res.error);
    return;
  }
  const flipped = (res.data ?? []) as { id: string }[];
  if (flipped.length > 0) {
    console.log(`[scheduler] flipped ${flipped.length} stale brief(s) to failed: ${flipped.map((r) => r.id).join(', ')}`);
  }
}

async function fireDueMonitors(): Promise<void> {
  const nowIso = new Date().toISOString();
  const due = await db
    .from('monitors')
    .select('*')
    .eq('paused', false)
    .lte('next_fire_at', nowIso)
    .limit(20);

  if (due.error) {
    console.warn('[scheduler] tick query failed', due.error);
    return;
  }

  const monitors = (due.data ?? []) as Monitor[];
  if (monitors.length === 0) return;

  console.log(`[scheduler] firing ${monitors.length} monitor(s)`);
  await Promise.all(monitors.map((m) => fireMonitor(m).catch((err) => {
    console.error(`[scheduler] monitor ${m.id} failed`, err);
  })));
}

async function fireMonitor(m: Monitor): Promise<void> {
  const config: MonitorConfig = m.config ?? {};
  const cadence = config.schedule ?? 'weekly';
  const nextFire = new Date(Date.now() + FREQ_MS[cadence]).toISOString();

  if (m.kind === 'rerun') {
    if (!m.brief_id) throw new Error('rerun monitor missing brief_id');
    await regenerateBriefById(m.brief_id);
  } else {
    // watch — kick off an agent run (default: research) bound to the brief.
    if (!m.brief_id) throw new Error('watch monitor missing brief_id');
    const kind: AgentKind = (config.agent_kind ?? 'research') as AgentKind;
    await dispatchAgentForMonitor(m.brief_id, kind, config);
  }

  // Advance schedule state. alerts_count += 1 so the brief tab shows a badge
  // until the user opens the brief (App.tsx clears it via acknowledgeBriefAlerts).
  await db
    .from('monitors')
    .update({
      last_fired: new Date().toISOString(),
      next_fire_at: nextFire,
      alerts_count: m.alerts_count + 1,
    })
    .eq('id', m.id);
}

/**
 * Inline mini-version of /agent/run, scoped to monitor-driven dispatch. We
 * avoid making an HTTP call back to ourselves so this works even before the
 * server has finished binding, and so the run shows the originating monitor's
 * sub-line instead of palette text.
 */
async function dispatchAgentForMonitor(
  briefId: string,
  kind: AgentKind,
  config: MonitorConfig,
): Promise<void> {
  const briefRes = await db
    .from('briefs')
    .select('id, thesis, question, session_id')
    .eq('id', briefId)
    .maybeSingle();
  if (briefRes.error || !briefRes.data) {
    throw new Error(`monitor scheduler: brief ${briefId} not found`);
  }
  const brief = briefRes.data as { thesis: string | null; question: string; session_id: string | null };
  const subjectLine = brief.thesis ?? brief.question;
  const sub = `Monitor · "${subjectLine.slice(0, 36)}${subjectLine.length > 36 ? '…' : ''}"`;

  const insert = await db
    .from('agent_runs')
    .insert({
      brief_id: briefId,
      session_id: brief.session_id,
      kind,
      status: 'running',
      progress: 5,
      title: AGENT_TITLES[kind],
      sub,
      config: { query: config.query ?? '', source: 'monitor' },
    })
    .select()
    .single();
  if (insert.error || !insert.data) {
    throw new Error(`monitor scheduler: agent_runs insert failed: ${insert.error?.message}`);
  }
  const run = insert.data as AgentRun;

  // Run the handler in-process. Same fire-and-forget shape as the agent route.
  void executeMonitorRun(run, kind, config).catch(async (err) => {
    console.error('[scheduler] agent run failed', run.id, err);
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
}

async function executeMonitorRun(
  run: AgentRun,
  kind: AgentKind,
  config: MonitorConfig,
): Promise<void> {
  const handler = handlerFor(kind);
  if (!run.brief_id) throw new Error('agent run missing brief_id');

  const halfwayTimer = setTimeout(() => {
    db.from('agent_runs').update({ progress: 50 }).eq('id', run.id).then(
      () => undefined,
      (err) => console.warn('[scheduler] halfway progress update failed', err),
    );
  }, 4_000);

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`agent timed out after ${MAX_RUN_MS / 1000}s`)), MAX_RUN_MS),
  );

  let result;
  try {
    result = await Promise.race([
      handler(run.brief_id, { query: config.query }, run.id),
      timeoutPromise,
    ]);
  } finally {
    clearTimeout(halfwayTimer);
  }

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
      (err) => console.warn('[scheduler] just_finished clear failed', err),
    );
  }, JUST_FINISHED_MS);
}
