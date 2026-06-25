import type { AgentRun, RunAgentRequest, RunAgentResponse } from '@shared/types';
import { postJson, SERVER_URL } from './client';

export async function runAgent(req: RunAgentRequest & { query?: string }): Promise<RunAgentResponse> {
  return postJson<RunAgentResponse>('/agent/run', req);
}

export async function pollAgent(id: string): Promise<AgentRun> {
  const res = await fetch(`${SERVER_URL}/agent/${id}`);
  if (!res.ok) throw new Error(`GET /agent/${id} failed: ${res.status}`);
  const body = await res.json() as { run: AgentRun };
  return body.run;
}

/** Mints a short-lived signed URL for an artifact via the server. */
export async function getArtifactUrl(artifactId: string): Promise<{ url: string; name: string }> {
  const res = await fetch(`${SERVER_URL}/agent/artifacts/${artifactId}/url`);
  if (!res.ok) throw new Error(`GET artifact url failed: ${res.status}`);
  return res.json() as Promise<{ url: string; name: string }>;
}
