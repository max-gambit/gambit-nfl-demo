import type { FactualAnswer } from '../nfl_facts/answer.js';

export interface NflContractDossier {
  player_id: string;
  player_name: string;
  team_id: string;
  roster_status_as_of_snapshot: string;
  source_status: 'reported' | 'source_conflict';
  source_url: string;
  inspected_at: string;
  source_sha256: string;
  snapshot_as_of: string;
  reported_2026_cash_payout: number | null;
  snapshot_ledger: Array<Record<string, unknown>>;
  reported_years: Array<{
    year: number; year_annotation: string; is_void: boolean;
    fields: Record<string, number | null>;
    reported_dead: Record<string, number | null>;
    reported_savings: Record<string, number | null>;
  }>;
  conflicts: string[];
  source_tables: Array<{ section: string; table_attributes: string; rows: string[][] }>;
  unknown_fields: string[];
  availability: string;
}

/** Every compensation field is explicit; no automatic annual-value split. */
export interface NflIllustrativeContractYear {
  year: number;
  kind: 'active' | 'void';
  base_salary: number;
  other_cash: number;
  incentives_cap_charge: number;
  incentives_cash: number;
  /** Outstanding guarantees AFTER the separately supplied prior-team payments. */
  guaranteed_salary: number;
  guaranteed_other_cash: number;
  salary_paid_by_prior_team: number;
  other_cash_paid_by_prior_team: number;
}

export interface NflIllustrativeContractTerms {
  basis: 'user_supplied_illustrative';
  label: string;
  /** Literal user terms must be retained by the orchestrator; never model defaults. */
  user_input: string;
  terms_complete: true;
  signing_bonus: number;
  years: NflIllustrativeContractYear[];
  /** Existing-team obligations are context only, never added to the new team. */
  prior_team_obligations: Array<{ year: number; cap: number; cash: number }>;
  guarantee_note: string;
}

export interface NflContractScenarioMove {
  player_id: string;
  action: 'hold' | 'trade' | 'release' | 'restructure' | 'acquire';
  conversion_amount?: number;
  /** Optional explicit user observation; absence leaves the model conditional. */
  unpaid_salary_available?: number;
  /** Optional verified/user-supplied credited seasons, not accrued seasons. */
  credited_seasons?: number;
  illustrative_terms?: NflIllustrativeContractTerms;
}

export interface NflContractScenarioArgs {
  schema_version: 1;
  season: number;
  team_id: string;
  timing: 'pre_june_1' | 'post_june_1';
  moves: NflContractScenarioMove[];
  protected_player_ids?: string[];
  /** User's available amount before these moves; not a refreshed team balance. */
  budget?: { type: 'cap' | 'cash'; amount: number; reserve: number };
}

export interface NflContractScenarioIssue {
  code: string;
  severity: 'blocked' | 'conditional' | 'note';
  player_id?: string;
  message: string;
}

export interface NflContractScenarioYear {
  year: number;
  cap_before: number | null;
  cap_after: number | null;
  cap_relief: number | null;
  cash_before: number | null;
  cash_after: number | null;
  cash_relief: number | null;
  dead_money_after: number | null;
  /** Newly added proration; does not include existing bonus allocations. */
  added_proration: number;
}

export interface NflContractMoveResult {
  player_id: string;
  player_name: string;
  original_team_id: string | null;
  action: NflContractScenarioMove['action'];
  status: 'reported' | 'conditional' | 'illustrative' | 'blocked';
  years: NflContractScenarioYear[];
  /** These amounts belong to the original club and are outside scenario totals. */
  original_team_obligations: Array<{ year: number; cap: number | null; cash: number | null }>;
  reported_contract_years: NflContractDossier['reported_years'];
  guarantees: Array<{ year: number; salary: number | null; other_cash: number | null }>;
  issues: NflContractScenarioIssue[];
  assumptions: string[];
  source_url: string | null;
  source_as_of: string | null;
}

export interface NflContractScenarioResult {
  schema_version: 1;
  summary: string;
  status: 'reported' | 'conditional' | 'illustrative' | 'blocked';
  team_id: string;
  season: number;
  moves: NflContractMoveResult[];
  years: NflContractScenarioYear[];
  budget: null | { type: 'cap' | 'cash'; before: number; reserve: number; after_reserve: number | null; fits: boolean | null; basis: 'user_supplied_available_amount' };
  issues: NflContractScenarioIssue[];
  assumptions: string[];
  source_as_of: string[];
}

export interface NflContractScenarioAnswer extends FactualAnswer {
  scenario_args: NflContractScenarioArgs;
  scenario_result: NflContractScenarioResult;
}
