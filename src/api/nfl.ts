import type {
  GetCurrentNflCoverageTeamResponse,
  GetCurrentNflPlayerMetricsTeamResponse,
  GetCurrentNflTeamResponse,
  NflCoverageMatrixResponse,
  ListCurrentNflDemoResponse,
} from '@shared/types';
import { SERVER_URL } from './client';

let currentRosterPromise: Promise<ListCurrentNflDemoResponse> | null = null;
let currentCapSheetsPromise: Promise<ListCurrentNflDemoResponse> | null = null;
let currentPlayerMetricsPromise: Promise<ListCurrentNflDemoResponse> | null = null;
const teamDetailPromises = new Map<string, Promise<GetCurrentNflTeamResponse>>();
const playerMetricsTeamPromises = new Map<string, Promise<GetCurrentNflPlayerMetricsTeamResponse>>();
let currentCoveragePromise: Promise<NflCoverageMatrixResponse> | null = null;
const coverageTeamPromises = new Map<string, Promise<GetCurrentNflCoverageTeamResponse>>();

export async function getCurrentNflRosters(opts: { force?: boolean } = {}): Promise<ListCurrentNflDemoResponse> {
  if (!currentRosterPromise || opts.force) {
    currentRosterPromise = getJson('/nfl/rosters/current');
  }
  return currentRosterPromise;
}

export async function getCurrentNflCapSheets(opts: { force?: boolean } = {}): Promise<ListCurrentNflDemoResponse> {
  if (!currentCapSheetsPromise || opts.force) {
    currentCapSheetsPromise = getJson('/nfl/cap-sheets/current');
  }
  return currentCapSheetsPromise;
}

export async function getCurrentNflCapSheet(
  teamId: string,
  opts: { force?: boolean } = {},
): Promise<GetCurrentNflTeamResponse> {
  const key = teamId.toUpperCase();
  if (!teamDetailPromises.has(key) || opts.force) {
    const promise = getJson<GetCurrentNflTeamResponse>(`/nfl/cap-sheets/current/${encodeURIComponent(key)}`)
      .catch((err) => {
        if (teamDetailPromises.get(key) === promise) teamDetailPromises.delete(key);
        throw err;
      });
    teamDetailPromises.set(key, promise);
  }
  return teamDetailPromises.get(key)!;
}

export async function getCurrentNflPlayerMetrics(opts: { force?: boolean } = {}): Promise<ListCurrentNflDemoResponse> {
  if (!currentPlayerMetricsPromise || opts.force) {
    currentPlayerMetricsPromise = getJson('/nfl/player-stats/current');
  }
  return currentPlayerMetricsPromise;
}

export async function getCurrentNflPlayerMetricsTeam(
  teamId: string,
  opts: { force?: boolean } = {},
): Promise<GetCurrentNflPlayerMetricsTeamResponse> {
  const key = teamId.toUpperCase();
  if (!playerMetricsTeamPromises.has(key) || opts.force) {
    const promise = getJson<GetCurrentNflPlayerMetricsTeamResponse>(`/nfl/player-stats/current/${encodeURIComponent(key)}`)
      .catch((err) => {
        if (playerMetricsTeamPromises.get(key) === promise) playerMetricsTeamPromises.delete(key);
        throw err;
      });
    playerMetricsTeamPromises.set(key, promise);
  }
  return playerMetricsTeamPromises.get(key)!;
}

export async function getCurrentNflCoverage(opts: { force?: boolean } = {}): Promise<NflCoverageMatrixResponse> {
  if (!currentCoveragePromise || opts.force) {
    currentCoveragePromise = getJson('/nfl/coverage/current');
  }
  return currentCoveragePromise;
}

export async function getCurrentNflCoverageTeam(
  teamId: string,
  opts: { force?: boolean } = {},
): Promise<GetCurrentNflCoverageTeamResponse> {
  const key = teamId.toUpperCase();
  if (!coverageTeamPromises.has(key) || opts.force) {
    const promise = getJson<GetCurrentNflCoverageTeamResponse>(`/nfl/coverage/current/${encodeURIComponent(key)}`)
      .catch((err) => {
        if (coverageTeamPromises.get(key) === promise) coverageTeamPromises.delete(key);
        throw err;
      });
    coverageTeamPromises.set(key, promise);
  }
  return coverageTeamPromises.get(key)!;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${SERVER_URL}${path}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GET ${path} failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<T>;
}
