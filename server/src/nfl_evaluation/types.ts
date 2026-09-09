import type { FactualAnswer } from '../nfl_facts/answer.js';
import type { NflDemoSeed } from '../nfl_data/seed.js';

export type NflEvaluationDomain = 'receiver' | 'college';
export type NflEvaluationMethod = 'public_tradeoffs' | 'threshold' | 'weighted';
export interface NflSuppliedJudgment {
  player_name: string;
  /** A literal user label, e.g. receiving, blocking or value; not a system grade. */
  criterion: string;
  value: number;
  out_of: number;
  quote: string;
  author?: string;
  date?: string;
  source?: string;
  metadata_quote?: string;
}
export interface NflEvaluationRule {
  criterion: string;
  minimum?: { value: number; out_of: number };
  /** Fraction of total weight, e.g. 0.7 for the user's explicit 70%. */
  weight?: number;
  quote: string;
}
export interface NflOptionEvaluationArgs {
  domain: NflEvaluationDomain;
  role: string;
  player_names?: string[];
  method?: NflEvaluationMethod;
  judgments?: NflSuppliedJudgment[];
  rules?: NflEvaluationRule[];
  constraints?: { internal_only?: boolean; max_incoming_cap?: number; /** Code derives this from the validated cap-limit quote. */ max_incoming_cap_operator?: 'lt' | 'lte'; quote: string };
}
/** Root supplies these from an executed contract tool; never expose this in tool arguments. */
export interface TrustedNflEvaluationCost {
  origin: 'contract_scenario';
  player_name: string;
  team_id: string;
  season: number;
  incoming_cap: number | null;
  status: 'reported' | 'conditional' | 'illustrative' | 'blocked';
  acquisition_path: 'internal' | 'trade' | 'free_agent' | 'draft' | 'unresolved';
  source_id: string;
  as_of: string;
  source_url?: string;
  conditions: string[];
}
export interface NflEvaluationContext {
  seed: NflDemoSeed;
  /** User-authored text only. Do not include assistant prose or retrieved documents. */
  userText: string;
  receivedAt?: string;
  /** Previously code-validated state, provided by the server, never the model. */
  previous?: NflEvaluationState;
  trustedCosts?: TrustedNflEvaluationCost[];
}
export interface NflEvaluationState {
  schema_version: 1;
  query: NflOptionEvaluationArgs;
  /** Literal user quotations approved during an earlier turn. */
  bound_quotes: string[];
}
export interface NflValidatedJudgment extends NflSuppliedJudgment {
  author_label: string;
  date_label: string;
  source_label: string;
  attribution_status: 'user_supplied_unverified';
  metadata_defaults: string[];
}
export interface NflEvaluatedOption {
  player_name: string;
  path: string;
  receiving_yards_per_game: number | null;
  receptions_per_game: number | null;
  last_active_contract_year: number | null;
  incoming_cap: number | null;
  threshold_status: 'passes' | 'fails' | 'unknown';
  weighted_score: number | null;
  judgments: Array<{ criterion: string; value: number | null; out_of: number | null; passes: boolean | null }>;
  reasons: string[];
}
export interface NflEvaluationFlip {
  kind: 'threshold' | 'grade' | 'weight' | 'price' | 'missing_input';
  player_name: string | null;
  criterion: string;
  condition: string;
  value: number | null;
  unit: string;
}
export interface NflEvaluationDecision {
  schema_version: 1;
  domain: NflEvaluationDomain;
  role: string;
  method: NflEvaluationMethod;
  status: 'public_shortlist' | 'conditional_preference' | 'tie' | 'no_eligible_option' | 'needs_input';
  preferred_player_names: string[];
  public_shortlist: string[];
  options: NflEvaluatedOption[];
  flips: NflEvaluationFlip[];
  unresolved_inputs: string[];
  executable: false;
  state: NflEvaluationState;
}
export interface NflOptionEvaluationAnswer extends FactualAnswer {
  evaluation: NflEvaluationDecision;
  body: FactualAnswer['body'] & { evaluation_query: NflOptionEvaluationArgs & Record<string, unknown>; evaluation_result: NflEvaluationDecision & Record<string, unknown> };
}
