import type { DataAnalysisBriefBody, NflPositionMarketGroup } from './types';

export interface NflFactualQuery {
  kind: 'roster';
  team_ids: string[];
  player_names: string[];
  position_groups: NflPositionMarketGroup[];
  exclude_nyg: boolean;
  veterans_only: boolean;
  limit: number;
  sort: 'name' | 'cap_asc' | 'cap_desc' | 'snaps_desc' | 'starts_desc';
  transaction: 'none' | 'release' | 'trade' | 'restructure';
  post_june: boolean;
  hypothetical_unavailable: boolean;
  hypothetical_player_names?: string[];
  max_cap: number | null;
  min_starts: number | null;
}

export function factualBody(body: Omit<DataAnalysisBriefBody, 'kind' | 'language_policy'>): DataAnalysisBriefBody {
  return { ...body, kind: 'data_analysis', language_policy: 'facts_only_v1' };
}

export function isFactualBody(body: unknown): body is DataAnalysisBriefBody {
  return Boolean(body && typeof body === 'object' && 'kind' in body && body.kind === 'data_analysis'
    && 'language_policy' in body && body.language_policy === 'facts_only_v1');
}
