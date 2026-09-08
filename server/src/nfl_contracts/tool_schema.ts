/** Descriptive schema for the orchestrator. No amount has a default. */
export const NFL_CONTRACT_SCENARIO_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    schema_version: { type: 'integer', enum: [1] },
    season: { type: 'integer', minimum: 2026, maximum: 2029 },
    team_id: { type: 'string', description: 'Team whose selected-move before/after totals are requested.' },
    timing: { type: 'string', enum: ['pre_june_1', 'post_june_1'], description: 'Hypothetical accounting timing; does not establish earned or paid compensation.' },
    moves: { type: 'array', minItems: 1, maxItems: 12, items: {
      type: 'object', properties: {
        player_id: { type: 'string', description: 'Use a dossier player_id or full player name.' },
        action: { type: 'string', enum: ['hold', 'trade', 'release', 'restructure', 'acquire'] },
        conversion_amount: { type: 'integer', minimum: 1, description: 'Explicit requested whole-dollar salary conversion. Required for restructure.' },
        unpaid_salary_available: { type: 'integer', minimum: 0, description: 'Only if the user supplied this amount; never infer from calendar date.' },
        credited_seasons: { type: 'integer', minimum: 0, description: 'Only if supplied or independently verified; accrued seasons are a different measure.' },
        illustrative_terms: {
          type: 'object', description: 'Use only for complete literal user-supplied terms, preserving user_input. Never invent compensation or split APY. If absent, acquire reports the incoming-terms gap and original-team charges.',
          properties: {
            basis: { type: 'string', enum: ['user_supplied_illustrative'] },
            label: { type: 'string' }, user_input: { type: 'string' }, terms_complete: { type: 'boolean', enum: [true] },
            signing_bonus: { type: 'integer', minimum: 0 }, guarantee_note: { type: 'string' },
            years: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'object', properties: {
              year: { type: 'integer' }, kind: { type: 'string', enum: ['active', 'void'] },
              base_salary: { type: 'integer', minimum: 0 }, other_cash: { type: 'integer', minimum: 0 },
              incentives_cap_charge: { type: 'integer', minimum: 0 }, incentives_cash: { type: 'integer', minimum: 0 },
              guaranteed_salary: { type: 'integer', minimum: 0, description: 'Outstanding guaranteed salary AFTER prior-team payments; must be explicitly supplied.' }, guaranteed_other_cash: { type: 'integer', minimum: 0, description: 'Outstanding other guaranteed cash AFTER prior-team payments, excluding the new signing bonus.' },
              salary_paid_by_prior_team: { type: 'integer', minimum: 0 }, other_cash_paid_by_prior_team: { type: 'integer', minimum: 0 },
            }, required: ['year', 'kind', 'base_salary', 'other_cash', 'incentives_cap_charge', 'incentives_cash', 'guaranteed_salary', 'guaranteed_other_cash', 'salary_paid_by_prior_team', 'other_cash_paid_by_prior_team'], additionalProperties: false } },
            prior_team_obligations: { type: 'array', items: { type: 'object', properties: { year: { type: 'integer' }, cap: { type: 'integer', minimum: 0 }, cash: { type: 'integer', minimum: 0 } }, required: ['year', 'cap', 'cash'], additionalProperties: false } },
          }, required: ['basis', 'label', 'user_input', 'terms_complete', 'signing_bonus', 'years', 'prior_team_obligations', 'guarantee_note'], additionalProperties: false,
        },
      }, required: ['player_id', 'action'], additionalProperties: false,
    } },
    protected_player_ids: { type: 'array', items: { type: 'string' } },
    budget: { type: 'object', properties: { type: { type: 'string', enum: ['cap', 'cash'] }, amount: { type: 'integer', minimum: 0 }, reserve: { type: 'integer', minimum: 0 } }, required: ['type', 'amount', 'reserve'], additionalProperties: false },
  },
  required: ['schema_version', 'season', 'team_id', 'timing', 'moves'],
  additionalProperties: false,
} as const;
