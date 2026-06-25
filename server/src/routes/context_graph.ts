import { Hono } from 'hono';
import type {
  PatchContextGraphOnboardingRequest,
  TeamMemoryIntakeRequest,
  TeamMemoryOptionsRequest,
  TeamMemoryProfile,
  ResetTeamContextPreferencesResponse,
  TeamContextPreferencePatch,
  UpdateTeamContextPreferencesRequest,
  UpdateTeamContextPreferencesResponse,
} from '@shared/types';
import {
  getTeamContextPreferences,
  listTeamContextPreferences,
  patchTeamContextPreferences,
  resetTeamContextPreferences,
  type TeamPreferenceStoreOptions,
} from '../context_graph/preferences.js';
import {
  completeContextGraphOnboarding,
  getContextGraphOnboardingResponse,
  patchContextGraphOnboarding,
  resetContextGraphOnboarding,
} from '../context_graph/onboarding.js';
import {
  buildTeamMemoryIntake,
  buildTeamMemoryOptions,
  deleteTeamMemoryProfile,
  getTeamMemoryResponse,
  saveTeamMemoryProfile,
  type TeamMemoryExtractionRunner,
  type TeamMemoryOptionsRunner,
  type TeamMemoryStoreOptions,
} from '../context_graph/team_memory.js';
import { getContextGraphWarRoom } from '../context_graph/war_room.js';

export type ContextGraphRouteOptions = TeamPreferenceStoreOptions & TeamMemoryStoreOptions & {
  teamMemoryExtractor?: TeamMemoryExtractionRunner;
  teamMemoryOptionsGenerator?: TeamMemoryOptionsRunner;
};

export function createContextGraphRoutes(options: ContextGraphRouteOptions = {}): Hono {
  const routes = new Hono();

  routes.get('/preferences', async (c) => {
    try {
      return c.json(await listTeamContextPreferences(options));
    } catch (error) {
      return c.json(errorResponse('context_graph_preferences_failed', error), 500);
    }
  });

  routes.get('/war-room/:teamId', async (c) => {
    const teamId = c.req.param('teamId')?.toUpperCase();
    if (!teamId) return c.json({ error: 'team_id_required' }, 400);

    try {
      return c.json(await getContextGraphWarRoom(teamId, options));
    } catch (error) {
      return c.json(errorResponse('context_graph_war_room_failed', error), isUserError(error) ? 400 : 500);
    }
  });

  routes.get('/onboarding/:teamId', async (c) => {
    const teamId = c.req.param('teamId')?.toUpperCase();
    if (!teamId) return c.json({ error: 'team_id_required' }, 400);

    try {
      return c.json(await getContextGraphOnboardingResponse(teamId, options));
    } catch (error) {
      return c.json(errorResponse('context_graph_onboarding_failed', error), isUserError(error) ? 400 : 500);
    }
  });

  routes.patch('/onboarding/:teamId', async (c) => {
    const teamId = c.req.param('teamId')?.toUpperCase();
    if (!teamId) return c.json({ error: 'team_id_required' }, 400);

    let body: PatchContextGraphOnboardingRequest;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }

    if (!isRecord(body) || !isRecord(body.profile)) {
      return c.json({ error: 'profile patch object required' }, 400);
    }
    for (const key of Object.keys(body)) {
      if (key !== 'profile') return c.json({ error: `Unexpected request field ${key}` }, 400);
    }

    try {
      return c.json(await patchContextGraphOnboarding(teamId, body.profile, options));
    } catch (error) {
      return c.json(errorResponse('patch_context_graph_onboarding_failed', error), isUserError(error) ? 400 : 500);
    }
  });

  routes.post('/onboarding/:teamId/complete', async (c) => {
    const teamId = c.req.param('teamId')?.toUpperCase();
    if (!teamId) return c.json({ error: 'team_id_required' }, 400);

    try {
      return c.json(await completeContextGraphOnboarding(teamId, options));
    } catch (error) {
      return c.json(errorResponse('complete_context_graph_onboarding_failed', error), isUserError(error) ? 400 : 500);
    }
  });

  routes.post('/onboarding/:teamId/reset', async (c) => {
    const teamId = c.req.param('teamId')?.toUpperCase();
    if (!teamId) return c.json({ error: 'team_id_required' }, 400);

    try {
      return c.json(await resetContextGraphOnboarding(teamId, options));
    } catch (error) {
      return c.json(errorResponse('reset_context_graph_onboarding_failed', error), isUserError(error) ? 400 : 500);
    }
  });

  routes.get('/team-memory/:teamId', async (c) => {
    const teamId = c.req.param('teamId')?.toUpperCase();
    if (!teamId) return c.json({ error: 'team_id_required' }, 400);

    try {
      return c.json(await getTeamMemoryResponse(teamId, options));
    } catch (error) {
      return c.json(errorResponse('context_graph_team_memory_failed', error), isUserError(error) ? 400 : 500);
    }
  });

  routes.post('/team-memory/:teamId/intake', async (c) => {
    const teamId = c.req.param('teamId')?.toUpperCase();
    if (!teamId) return c.json({ error: 'team_id_required' }, 400);

    let body: TeamMemoryIntakeRequest;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }

    if (!isRecord(body) || typeof body.input !== 'string') {
      return c.json({ error: 'input string required' }, 400);
    }
    for (const key of Object.keys(body)) {
      if (key !== 'input') return c.json({ error: `Unexpected request field ${key}` }, 400);
    }

    try {
      const team = await getTeamContextPreferences(teamId, options);
      return c.json(await buildTeamMemoryIntake(teamId, team.name, body.input, {
        ...options,
        extractor: options.teamMemoryExtractor,
      }));
    } catch (error) {
      return c.json(errorResponse('context_graph_team_memory_intake_failed', error), isUserError(error) ? 400 : 500);
    }
  });

  routes.post('/team-memory/:teamId/options', async (c) => {
    const teamId = c.req.param('teamId')?.toUpperCase();
    if (!teamId) return c.json({ error: 'team_id_required' }, 400);

    let body: TeamMemoryOptionsRequest;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }

    if (!isRecord(body) || typeof body.stage !== 'string') {
      return c.json({ error: 'stage string required' }, 400);
    }
    const allowedFields = new Set(['stage', 'selections', 'traits', 'accepted_options', 'note']);
    for (const key of Object.keys(body)) {
      if (!allowedFields.has(key)) return c.json({ error: `Unexpected request field ${key}` }, 400);
    }
    if ('selections' in body && !Array.isArray(body.selections)) return c.json({ error: 'selections array required' }, 400);
    if ('traits' in body && !Array.isArray(body.traits)) return c.json({ error: 'traits array required' }, 400);
    if ('accepted_options' in body && !Array.isArray(body.accepted_options)) return c.json({ error: 'accepted_options array required' }, 400);
    if ('note' in body && typeof body.note !== 'string') return c.json({ error: 'note string required' }, 400);

    try {
      const warRoom = await getContextGraphWarRoom(teamId, options);
      return c.json(await buildTeamMemoryOptions(teamId, warRoom, body, {
        ...options,
        generator: options.teamMemoryOptionsGenerator,
      }));
    } catch (error) {
      return c.json(errorResponse('context_graph_team_memory_options_failed', error), isUserError(error) ? 400 : 500);
    }
  });

  routes.patch('/team-memory/:teamId', async (c) => {
    const teamId = c.req.param('teamId')?.toUpperCase();
    if (!teamId) return c.json({ error: 'team_id_required' }, 400);

    let body: { profile?: TeamMemoryProfile };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }

    if (!isRecord(body) || !isRecord(body.profile)) {
      return c.json({ error: 'profile object required' }, 400);
    }
    for (const key of Object.keys(body)) {
      if (key !== 'profile') return c.json({ error: `Unexpected request field ${key}` }, 400);
    }

    try {
      return c.json(await saveTeamMemoryProfile(teamId, body.profile as TeamMemoryProfile, options));
    } catch (error) {
      return c.json(errorResponse('update_context_graph_team_memory_failed', error), isUserError(error) ? 400 : 500);
    }
  });

  routes.delete('/team-memory/:teamId', async (c) => {
    const teamId = c.req.param('teamId')?.toUpperCase();
    if (!teamId) return c.json({ error: 'team_id_required' }, 400);

    try {
      return c.json(await deleteTeamMemoryProfile(teamId, options));
    } catch (error) {
      return c.json(errorResponse('delete_context_graph_team_memory_failed', error), isUserError(error) ? 400 : 500);
    }
  });

  routes.patch('/preferences/:teamId', async (c) => {
    const teamId = c.req.param('teamId')?.toUpperCase();
    if (!teamId) return c.json({ error: 'team_id_required' }, 400);

    let body: UpdateTeamContextPreferencesRequest;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }

    if (!isRecord(body) || !isRecord(body.preferences)) {
      return c.json({ error: 'preferences object required' }, 400);
    }
    for (const key of Object.keys(body)) {
      if (key !== 'preferences') return c.json({ error: `Unexpected request field ${key}` }, 400);
    }

    try {
      const team = await patchTeamContextPreferences(teamId, body.preferences as TeamContextPreferencePatch, options);
      const metadata = (await listTeamContextPreferences(options)).metadata;
      const response: UpdateTeamContextPreferencesResponse = { team, metadata };
      return c.json(response);
    } catch (error) {
      return c.json(errorResponse('update_context_graph_preferences_failed', error), isUserError(error) ? 400 : 500);
    }
  });

  routes.post('/preferences/:teamId/reset', async (c) => {
    const teamId = c.req.param('teamId')?.toUpperCase();
    if (!teamId) return c.json({ error: 'team_id_required' }, 400);

    try {
      const team = await resetTeamContextPreferences(teamId, options);
      const metadata = (await listTeamContextPreferences(options)).metadata;
      const response: ResetTeamContextPreferencesResponse = { team, metadata };
      return c.json(response);
    } catch (error) {
      return c.json(errorResponse('reset_context_graph_preferences_failed', error), isUserError(error) ? 400 : 500);
    }
  });

  return routes;
}

export const contextGraphRoutes = createContextGraphRoutes();

function errorResponse(error: string, cause: unknown): { error: string; detail: string } {
  return {
    error,
    detail: cause instanceof Error ? cause.message : String(cause),
  };
}

function isUserError(error: unknown): boolean {
  return error instanceof Error
    && (
      error.message.includes('must be')
      || error.message.includes('not an editable')
      || error.message.includes('Unknown Intel team_id')
      || error.message.includes('team memory')
      || error.message.includes('onboarding')
      || error.message.includes('input string required')
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
