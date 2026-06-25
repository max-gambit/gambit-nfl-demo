import type {
  CompleteContextGraphOnboardingResponse,
  ContextGraphWarRoomResponse,
  DeleteTeamMemoryResponse,
  GetContextGraphOnboardingResponse,
  GetTeamMemoryResponse,
  ListContextGraphPreferencesResponse,
  PatchContextGraphOnboardingResponse,
  PatchContextGraphOnboardingRequest,
  ResetTeamContextPreferencesResponse,
  ResetContextGraphOnboardingResponse,
  ContextGraphOnboardingProfile,
  ContextGraphOnboardingViewModel,
  TeamMemoryIntakeResponse,
  TeamMemoryOptionsRequest,
  TeamMemoryOptionsResponse,
  TeamMemoryProfile,
  TeamContextPreferencePatch,
  TeamContextPreferences,
  UpdateTeamMemoryResponse,
  UpdateTeamContextPreferencesResponse,
} from '@shared/types';
import { SERVER_URL } from './client';

export async function listContextGraphPreferences(): Promise<ListContextGraphPreferencesResponse> {
  const res = await fetch(`${SERVER_URL}/context-graph/preferences`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GET /context-graph/preferences failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<ListContextGraphPreferencesResponse>;
}

export async function getContextGraphWarRoom(teamId: string): Promise<ContextGraphWarRoomResponse> {
  const res = await fetch(`${SERVER_URL}/context-graph/war-room/${teamId}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GET /context-graph/war-room/${teamId} failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<ContextGraphWarRoomResponse>;
}

export async function getContextGraphOnboarding(teamId: string): Promise<ContextGraphOnboardingViewModel> {
  const res = await fetch(`${SERVER_URL}/context-graph/onboarding/${teamId}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GET /context-graph/onboarding/${teamId} failed: ${res.status} ${text}`);
  }
  const body = await res.json() as GetContextGraphOnboardingResponse;
  return body.onboarding;
}

export async function patchContextGraphOnboarding(
  teamId: string,
  profile: PatchContextGraphOnboardingRequest['profile'],
): Promise<ContextGraphOnboardingViewModel> {
  const res = await fetch(`${SERVER_URL}/context-graph/onboarding/${teamId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PATCH /context-graph/onboarding/${teamId} failed: ${res.status} ${text}`);
  }
  const body = await res.json() as PatchContextGraphOnboardingResponse;
  return body.onboarding;
}

export async function completeContextGraphOnboarding(teamId: string): Promise<ContextGraphOnboardingViewModel> {
  const res = await fetch(`${SERVER_URL}/context-graph/onboarding/${teamId}/complete`, { method: 'POST' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`POST /context-graph/onboarding/${teamId}/complete failed: ${res.status} ${text}`);
  }
  const body = await res.json() as CompleteContextGraphOnboardingResponse;
  return body.onboarding;
}

export async function resetContextGraphOnboarding(teamId: string): Promise<ContextGraphOnboardingViewModel> {
  const res = await fetch(`${SERVER_URL}/context-graph/onboarding/${teamId}/reset`, { method: 'POST' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`POST /context-graph/onboarding/${teamId}/reset failed: ${res.status} ${text}`);
  }
  const body = await res.json() as ResetContextGraphOnboardingResponse;
  return body.onboarding;
}

export async function getTeamMemory(teamId: string): Promise<TeamMemoryProfile | null> {
  const res = await fetch(`${SERVER_URL}/context-graph/team-memory/${teamId}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GET /context-graph/team-memory/${teamId} failed: ${res.status} ${text}`);
  }
  const body = await res.json() as GetTeamMemoryResponse;
  return body.profile;
}

export async function intakeTeamMemory(teamId: string, input: string): Promise<TeamMemoryIntakeResponse> {
  const res = await fetch(`${SERVER_URL}/context-graph/team-memory/${teamId}/intake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`POST /context-graph/team-memory/${teamId}/intake failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<TeamMemoryIntakeResponse>;
}

export async function generateTeamMemoryOptions(
  teamId: string,
  request: TeamMemoryOptionsRequest,
): Promise<TeamMemoryOptionsResponse> {
  const res = await fetch(`${SERVER_URL}/context-graph/team-memory/${teamId}/options`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`POST /context-graph/team-memory/${teamId}/options failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<TeamMemoryOptionsResponse>;
}

export async function updateTeamMemory(teamId: string, profile: TeamMemoryProfile): Promise<TeamMemoryProfile> {
  const res = await fetch(`${SERVER_URL}/context-graph/team-memory/${teamId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PATCH /context-graph/team-memory/${teamId} failed: ${res.status} ${text}`);
  }
  const body = await res.json() as UpdateTeamMemoryResponse;
  return body.profile;
}

export async function deleteTeamMemory(teamId: string): Promise<null> {
  const res = await fetch(`${SERVER_URL}/context-graph/team-memory/${teamId}`, { method: 'DELETE' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`DELETE /context-graph/team-memory/${teamId} failed: ${res.status} ${text}`);
  }
  const body = await res.json() as DeleteTeamMemoryResponse;
  return body.profile;
}

export async function updateContextGraphPreferences(
  teamId: string,
  preferences: TeamContextPreferencePatch,
): Promise<TeamContextPreferences> {
  const res = await fetch(`${SERVER_URL}/context-graph/preferences/${teamId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preferences }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PATCH /context-graph/preferences/${teamId} failed: ${res.status} ${text}`);
  }
  const body = await res.json() as UpdateTeamContextPreferencesResponse;
  return body.team;
}

export async function resetContextGraphPreferences(teamId: string): Promise<TeamContextPreferences> {
  const res = await fetch(`${SERVER_URL}/context-graph/preferences/${teamId}/reset`, {
    method: 'POST',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`POST /context-graph/preferences/${teamId}/reset failed: ${res.status} ${text}`);
  }
  const body = await res.json() as ResetTeamContextPreferencesResponse;
  return body.team;
}
