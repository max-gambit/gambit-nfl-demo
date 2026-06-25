import type {
  GetCurrentNbaCapSheetResponse,
  GetCurrentNbaPlayerStatsTeamResponse,
  ListCurrentNbaCapSheetsResponse,
  ListCurrentNbaPlayerStatsResponse,
  ListCurrentNbaRostersResponse,
} from '@shared/types';
import { SERVER_URL } from './client';

let currentRosterPromise: Promise<ListCurrentNbaRostersResponse> | null = null;
let currentCapSheetsPromise: Promise<ListCurrentNbaCapSheetsResponse> | null = null;
let currentPlayerStatsPromise: Promise<ListCurrentNbaPlayerStatsResponse> | null = null;
const capSheetDetailPromises = new Map<string, Promise<GetCurrentNbaCapSheetResponse>>();
const playerStatsTeamPromises = new Map<string, Promise<GetCurrentNbaPlayerStatsTeamResponse>>();

export async function getCurrentNbaRosters(opts: { force?: boolean } = {}): Promise<ListCurrentNbaRostersResponse> {
  if (!currentRosterPromise || opts.force) {
    currentRosterPromise = fetch(`${SERVER_URL}/nba/rosters/current`).then(async (res) => {
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`GET /nba/rosters/current failed: ${res.status} ${text}`);
      }
      return res.json() as Promise<ListCurrentNbaRostersResponse>;
    });
  }
  return currentRosterPromise;
}

export async function getCurrentNbaCapSheets(opts: { force?: boolean } = {}): Promise<ListCurrentNbaCapSheetsResponse> {
  if (!currentCapSheetsPromise || opts.force) {
    currentCapSheetsPromise = fetch(`${SERVER_URL}/nba/cap-sheets/current`).then(async (res) => {
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`GET /nba/cap-sheets/current failed: ${res.status} ${text}`);
      }
      return res.json() as Promise<ListCurrentNbaCapSheetsResponse>;
    });
  }
  return currentCapSheetsPromise;
}

export async function getCurrentNbaCapSheet(
  teamId: string,
  opts: { force?: boolean } = {},
): Promise<GetCurrentNbaCapSheetResponse> {
  const key = teamId.toUpperCase();
  if (!capSheetDetailPromises.has(key) || opts.force) {
    const promise = fetch(`${SERVER_URL}/nba/cap-sheets/current/${encodeURIComponent(key)}`).then(async (res) => {
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`GET /nba/cap-sheets/current/${key} failed: ${res.status} ${text}`);
      }
      return res.json() as Promise<GetCurrentNbaCapSheetResponse>;
    }).catch((err) => {
      if (capSheetDetailPromises.get(key) === promise) {
        capSheetDetailPromises.delete(key);
      }
      throw err;
    });
    capSheetDetailPromises.set(key, promise);
  }
  return capSheetDetailPromises.get(key)!;
}

export async function getCurrentNbaPlayerStats(opts: { force?: boolean } = {}): Promise<ListCurrentNbaPlayerStatsResponse> {
  if (!currentPlayerStatsPromise || opts.force) {
    currentPlayerStatsPromise = fetch(`${SERVER_URL}/nba/player-stats/current`).then(async (res) => {
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`GET /nba/player-stats/current failed: ${res.status} ${text}`);
      }
      return res.json() as Promise<ListCurrentNbaPlayerStatsResponse>;
    });
  }
  return currentPlayerStatsPromise;
}

export async function getCurrentNbaPlayerStatsTeam(
  teamId: string,
  opts: { force?: boolean } = {},
): Promise<GetCurrentNbaPlayerStatsTeamResponse> {
  const key = teamId.toUpperCase();
  if (!playerStatsTeamPromises.has(key) || opts.force) {
    playerStatsTeamPromises.set(key, fetch(`${SERVER_URL}/nba/player-stats/current/${encodeURIComponent(key)}`).then(async (res) => {
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`GET /nba/player-stats/current/${key} failed: ${res.status} ${text}`);
      }
      return res.json() as Promise<GetCurrentNbaPlayerStatsTeamResponse>;
    }));
  }
  return playerStatsTeamPromises.get(key)!;
}
