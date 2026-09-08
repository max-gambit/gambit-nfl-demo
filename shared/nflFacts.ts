import type { DataAnalysisBriefBody, NflPositionMarketGroup } from './types';

export type NflRosterNumericField = 'age' | 'cap_2026' | 'starts_2025' | 'snaps_2025' | 'games_2025';
export interface NflRosterNumericFilter {
  field: NflRosterNumericField;
  operator: 'lt' | 'lte' | 'gt' | 'gte' | 'eq';
  value: number;
}

export interface NflFactualQuery {
  kind: 'roster';
  team_ids: string[];
  player_names: string[];
  position_groups: NflPositionMarketGroup[];
  exclude_nyg: boolean;
  veterans_only: boolean;
  limit: number;
  sort: 'name' | 'cap_asc' | 'cap_desc' | 'snaps_desc' | 'snaps_asc' | 'starts_desc' | 'starts_asc' | 'games_desc' | 'games_asc' | 'age_asc' | 'age_desc';
  transaction: 'none' | 'release' | 'trade' | 'restructure';
  post_june: boolean;
  hypothetical_unavailable: boolean;
  hypothetical_player_names?: string[];
  max_cap: number | null;
  min_starts: number | null;
  numeric_filters?: NflRosterNumericFilter[];
  excluded_team_ids?: string[];
  excluded_player_names?: string[];
  roster_statuses?: string[];
  unresolved_constraints?: string[];
}

export function factualBody(body: Omit<DataAnalysisBriefBody, 'kind' | 'language_policy'>): DataAnalysisBriefBody {
  return { ...body, kind: 'data_analysis', language_policy: 'facts_only_v1' };
}

export function isFactualBody(body: unknown): body is DataAnalysisBriefBody {
  return Boolean(body && typeof body === 'object' && 'kind' in body && body.kind === 'data_analysis'
    && 'language_policy' in body && ['facts_only_v1', 'grounded_ai_v1'].includes(String(body.language_policy)));
}
