export type NflObjective = 'acquisition' | 'internal_roster' | 'contract' | 'college' | 'availability' | 'coaching' | 'rules' | 'history';
export interface NflScenarioState {
  id: string;
  objective: NflObjective;
  team_id: string;
  horizon: string;
  budget: { type: 'cap' | 'cash'; amount: number; reserve: number } | null;
  protected_player_names: string[];
  candidate_scope: 'external' | 'internal' | 'both' | 'unspecified';
  transaction: 'none' | 'trade' | 'release' | 'restructure' | 'acquire' | 'hold';
  scenario_date: string | null;
  supplied_terms: string[];
  unresolved_inputs: string[];
  assumptions: string[];
}
export interface NflConversationState {
  schema_version: 1;
  active: NflScenarioState;
  saved: NflScenarioState[];
}
