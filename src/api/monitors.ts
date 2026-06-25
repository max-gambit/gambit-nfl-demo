import type {
  AcknowledgeMonitorAlertsResponse,
  CreateMonitorRequest,
  CreateMonitorResponse,
  ListMonitorsResponse,
  Monitor,
  UpdateMonitorResponse,
} from '@shared/types';
import { postJson, SERVER_URL } from './client';

export async function createMonitor(req: CreateMonitorRequest): Promise<Monitor> {
  const res = await postJson<CreateMonitorResponse>('/monitors', req);
  return res.monitor;
}

export async function listMonitors(): Promise<Monitor[]> {
  const res = await fetch(`${SERVER_URL}/monitors`);
  if (!res.ok) throw new Error(`GET /monitors failed: ${res.status}`);
  const body = await res.json() as ListMonitorsResponse;
  return body.monitors;
}

export async function pauseMonitor(id: string, paused: boolean): Promise<Monitor> {
  const res = await fetch(`${SERVER_URL}/monitors/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paused }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PATCH /monitors/${id} failed: ${res.status} ${text}`);
  }
  const body = await res.json() as UpdateMonitorResponse;
  return body.monitor;
}

export async function acknowledgeMonitorAlerts(brief_id: string): Promise<Monitor[]> {
  const res = await postJson<AcknowledgeMonitorAlertsResponse>('/monitors/acknowledge', { brief_id });
  return res.monitors;
}
