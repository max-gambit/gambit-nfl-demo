export interface SafeVocabRepair {
  path: string;
  from: string;
  to: string;
  note: string;
}

export interface SchemaDriftCandidate {
  path: string;
  value: string;
  recommendation: 'resolved_schema' | 'resolved_source' | 'audit_only';
  note: string;
}

export const SAFE_VOCAB_REPAIRS: SafeVocabRepair[] = [
  {
    path: 'strategic_posture.constraints[].reason_code',
    from: 'tax_apron_pressure',
    to: 'tax_apron_constraints',
    note: 'Strategic posture constraints use the posture-level tax apron vocabulary.',
  },
  {
    path: 'team_team_relationships.rivalries[].type',
    from: 'recent_playoff_rematch',
    to: 'playoff_rematch',
    note: 'The schema already has the same rivalry concept without the recent_ prefix.',
  },
  {
    path: 'roster[].movement_constraints.reasons[].reason_code',
    from: 'recent_acquisition',
    to: 'recently_acquired',
    note: 'Movement constraint vocabulary uses recently_acquired for this concept.',
  },
  {
    path: 'roster[].movement_constraints.reasons[].reason_code',
    from: 'declined_role',
    to: 'declining_role',
    note: 'Typo repair for the existing declining_role vocabulary value.',
  },
  {
    path: 'roster[].contract.bird_rights',
    from: 'none',
    to: 'non',
    note: 'Schema uses NBA non-Bird shorthand.',
  },
];

export const SCHEMA_DRIFT_CANDIDATES: SchemaDriftCandidate[] = [
  {
    path: 'cap_situation.current_status',
    value: 'below_first_apron',
    recommendation: 'resolved_schema',
    note: 'v2.2.2 keeps this as a first-class CBA status instead of coercing it to below_apron.',
  },
  {
    path: 'known_target_history[].outcome',
    value: 'actively_traded / traded / let_walk',
    recommendation: 'resolved_schema',
    note: 'v2.2.2 allows live-market and final-disposition outcomes used by target history.',
  },
  {
    path: 'roster[].movement_constraints.status',
    value: 'unavailable',
    recommendation: 'resolved_schema',
    note: 'v2.2.2 represents unavailable roster rows explicitly.',
  },
  {
    path: 'roster[].archetype.*',
    value: 'unknown',
    recommendation: 'resolved_schema',
    note: 'v2.2.2 permits explicit unknown archetype values where the source snapshot does not support a researched label.',
  },
  {
    path: 'roster[].trajectory',
    value: 'unknown / uncertain / flat',
    recommendation: 'resolved_schema',
    note: 'v2.2.2 distinguishes sourced unknown, unstable/uncertain, and flat trajectory states.',
  },
  {
    path: 'roster[].movement_constraints.reasons[].reason_code',
    value: 'recent_acquisition_poison_pill',
    recommendation: 'resolved_schema',
    note: 'v2.2.2 keeps the combined roster/CBA concept when the source row uses it deliberately.',
  },
  {
    path: 'roster[].movement_constraints.signal_strength',
    value: 'null / missing',
    recommendation: 'resolved_source',
    note: 'Source-backed repair normalizes these to explicit unknown signal strength.',
  },
  {
    path: 'near_term_priorities[].type',
    value: 'missing',
    recommendation: 'resolved_source',
    note: 'Source-backed repair classifies type from priority/detail text.',
  },
  {
    path: 'roster[].contract.years_remaining',
    value: 'unknown',
    recommendation: 'resolved_schema',
    note: 'v2.2.2 permits explicit unknown contract years when reviewed cap data does not carry the duration.',
  },
  {
    path: 'cap_situation.current_payroll_estimate',
    value: 'unknown',
    recommendation: 'resolved_source',
    note: 'Source-backed repair fills reviewed cap-sheet payroll estimates where available; schema also permits unknown for unsourced rows.',
  },
  {
    path: 'roster[].contract.team_option',
    value: 'yes',
    recommendation: 'resolved_source',
    note: 'Source-backed repair normalizes option presence without a year to option_pending.',
  },
  {
    path: 'roster[].contract.contract_through',
    value: 'traded annotation',
    recommendation: 'resolved_source',
    note: 'Source-backed repair normalizes traded annotations to uncertain after roster reconciliation.',
  },
  {
    path: 'trade_dna.recent_significant_trades[].date',
    value: 'YYYY',
    recommendation: 'resolved_schema',
    note: 'v2.2.2 allows year-only dates when the reviewed source captures only the year.',
  },
  {
    path: 'key_assets.draft_picks_owed[].to_team',
    value: 'unknown / multiple teams',
    recommendation: 'resolved_source',
    note: 'Source-backed repair moves conditional or unknown destinations to to_team_options plus condition.',
  },
  {
    path: 'team_team_relationships / trade_dna / personnel links',
    value: 'one-way relationship completeness',
    recommendation: 'audit_only',
    note: 'v2.2.2 keeps validation blocking only for explicit requires_reciprocal rivalry rows and unconditional pick reciprocity.',
  },
];
