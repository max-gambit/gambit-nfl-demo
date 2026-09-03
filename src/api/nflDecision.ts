import type {
  NflCapRosterDecisionRequest,
  NflCapRosterDecisionResponse,
  NflCapRosterExplanationRequest,
  NflCapRosterExplanationResponse,
  NflDataHealthResponse,
  NflReadinessPreflightResponse,
} from '@shared/types';
import { postJson, SERVER_URL } from './client';

export async function getNflDataHealth(teamId = 'NYG'): Promise<NflDataHealthResponse> {
  const res = await fetch(`${SERVER_URL}/nfl/data-health?team_id=${encodeURIComponent(teamId)}`);
  if (!res.ok) throw new Error(`GET /nfl/data-health failed: ${res.status} ${await res.text().catch(() => '')}`);
  return res.json() as Promise<NflDataHealthResponse>;
}

export async function getNflReadinessPreflight(teamId = 'NYG'): Promise<NflReadinessPreflightResponse> {
  const res = await fetch(`${SERVER_URL}/nfl/readiness-preflight?team_id=${encodeURIComponent(teamId)}`);
  if (!res.ok) throw new Error(`GET /nfl/readiness-preflight failed: ${res.status} ${await res.text().catch(() => '')}`);
  return res.json() as Promise<NflReadinessPreflightResponse>;
}

export async function modelNflCapRoster(request: NflCapRosterDecisionRequest): Promise<NflCapRosterDecisionResponse> {
  return postJson('/nfl/decision-models/cap-roster', request);
}

export async function explainNflCapRoster(request: NflCapRosterExplanationRequest): Promise<NflCapRosterExplanationResponse> {
  return postJson('/nfl/decision-models/cap-roster/explain', request);
}
