import type {
  NflCapRosterDecisionRequest,
  NflCapRosterDecisionResponse,
  NflDataHealthResponse,
} from '@shared/types';
import { postJson, SERVER_URL } from './client';

export async function getNflDataHealth(teamId = 'NYG'): Promise<NflDataHealthResponse> {
  const res = await fetch(`${SERVER_URL}/nfl/data-health?team_id=${encodeURIComponent(teamId)}`);
  if (!res.ok) throw new Error(`GET /nfl/data-health failed: ${res.status} ${await res.text().catch(() => '')}`);
  return res.json() as Promise<NflDataHealthResponse>;
}

export async function modelNflCapRoster(request: NflCapRosterDecisionRequest): Promise<NflCapRosterDecisionResponse> {
  return postJson('/nfl/decision-models/cap-roster', request);
}
