import { Hono } from 'hono';
import { db } from '../db/client.js';
import type {
  AcknowledgeMonitorAlertsResponse,
  CreateMonitorRequest,
  CreateMonitorResponse,
  ListMonitorsResponse,
  Monitor,
  MonitorFrequency,
  MonitorKind,
  UpdateMonitorResponse,
} from '@shared/types';

export const monitorRoutes = new Hono();

const VALID_KINDS: ReadonlySet<MonitorKind> = new Set(['rerun', 'watch']);
const VALID_SCHEDULES: ReadonlySet<MonitorFrequency> = new Set(['hourly', 'daily', 'weekly']);

const FREQ_MS: Record<MonitorFrequency, number> = {
  hourly: 3_600_000,
  daily: 86_400_000,
  weekly: 604_800_000,
};

monitorRoutes.get('/', async (c) => {
  const briefId = c.req.query('brief_id');

  let query = db
    .from('monitors')
    .select('*')
    .order('created_at', { ascending: false });

  if (briefId) query = query.eq('brief_id', briefId);

  const res = await query;
  if (res.error) return c.json({ error: 'list_monitors_failed', detail: res.error.message }, 500);

  const response: ListMonitorsResponse = { monitors: (res.data ?? []) as Monitor[] };
  return c.json(response);
});

monitorRoutes.post('/', async (c) => {
  let body: CreateMonitorRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const { brief_id, kind, config = {} } = body;
  if (!brief_id || typeof brief_id !== 'string') {
    return c.json({ error: 'brief_id required' }, 400);
  }
  if (!kind || !VALID_KINDS.has(kind)) {
    return c.json({ error: 'kind must be one of rerun|watch' }, 400);
  }

  const schedule = VALID_SCHEDULES.has(config.schedule ?? 'weekly')
    ? (config.schedule ?? 'weekly')
    : null;
  if (!schedule) {
    return c.json({ error: 'config.schedule must be one of hourly|daily|weekly' }, 400);
  }

  const briefRes = await db.from('briefs').select('id').eq('id', brief_id).maybeSingle();
  if (briefRes.error) {
    return c.json({ error: 'brief_lookup_failed', detail: briefRes.error.message }, 500);
  }
  if (!briefRes.data) {
    return c.json({ error: 'brief_not_found' }, 404);
  }

  const next_fire_at = new Date(Date.now() + FREQ_MS[schedule]).toISOString();
  const insert = await db
    .from('monitors')
    .insert({
      brief_id,
      kind,
      config: { ...config, schedule },
      paused: false,
      next_fire_at,
      alerts_count: 0,
    })
    .select()
    .single();

  if (insert.error || !insert.data) {
    return c.json({ error: 'create_monitor_failed', detail: insert.error?.message }, 500);
  }

  const response: CreateMonitorResponse = { monitor: insert.data as Monitor };
  return c.json(response, 201);
});

monitorRoutes.patch('/:id', async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'id required' }, 400);

  let body: { paused?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  if (typeof body.paused !== 'boolean') {
    return c.json({ error: 'paused boolean required' }, 400);
  }

  const update = await db
    .from('monitors')
    .update({ paused: body.paused })
    .eq('id', id)
    .select()
    .maybeSingle();

  if (update.error) return c.json({ error: 'update_monitor_failed', detail: update.error.message }, 500);
  if (!update.data) return c.json({ error: 'monitor_not_found' }, 404);

  const response: UpdateMonitorResponse = { monitor: update.data as Monitor };
  return c.json(response);
});

monitorRoutes.post('/acknowledge', async (c) => {
  let body: { brief_id?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  if (!body.brief_id || typeof body.brief_id !== 'string') {
    return c.json({ error: 'brief_id required' }, 400);
  }

  const update = await db
    .from('monitors')
    .update({ alerts_count: 0 })
    .eq('brief_id', body.brief_id)
    .select();

  if (update.error) {
    return c.json({ error: 'acknowledge_alerts_failed', detail: update.error.message }, 500);
  }

  const response: AcknowledgeMonitorAlertsResponse = { monitors: (update.data ?? []) as Monitor[] };
  return c.json(response);
});
