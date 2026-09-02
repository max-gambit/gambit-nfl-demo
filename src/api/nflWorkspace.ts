import type { CreateNflWorkspaceRequest, CreateNflWorkspaceResponse, ListNflWorkspacesResponse } from '@shared/types';
import { SERVER_URL } from './client';

export async function listNflWorkspaces(): Promise<ListNflWorkspacesResponse['workspaces']> {
  const response = await fetch(`${SERVER_URL}/nfl/workspaces?team_id=NYG`);
  if (!response.ok) throw new Error(`NFL workspaces failed (${response.status})`);
  return (await response.json() as ListNflWorkspacesResponse).workspaces;
}

export async function createNflWorkspace(request: CreateNflWorkspaceRequest): Promise<CreateNflWorkspaceResponse> {
  const response = await fetch(`${SERVER_URL}/nfl/workspaces`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  });
  const body = await response.json() as CreateNflWorkspaceResponse & { detail?: string };
  if (!response.ok) throw new Error(body.detail ?? `Create NFL workspace failed (${response.status})`);
  return body;
}
