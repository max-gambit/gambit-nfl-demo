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

export const NFL_CONTRACT_COMPARISON_TOOL_SCHEMA = NFL_CONTRACT_SCENARIO_TOOL_SCHEMA;
export const NFL_CONTRACT_COMPARISON_TOOL_DESCRIPTION =
  'Calculate hold versus the requested contract alternative in ONE call, including this year, next year, every later contract/void year, cash changes, future obligations, budget/reserve and controlling CBA mechanisms with sources. Supply only the requested moves, once per player: for hold versus a $6m conversion, submit one restructure move with conversion_amount 6000000, never separate hold and restructure moves for that player. The tool automatically computes hold on the same selected cohort. When an acquisition and funding moves are supplied, it also computes acquisition without funding. Preserve the requested moves for follow-ups. Conversion amounts and all illustrative terms must come from the user; never invent credited seasons, unpaid amounts, terms or availability. Omit optional credited_seasons and unpaid_salary_available unless explicitly supplied. For an acquisition, supply complete literal illustrative terms when the user provides them; otherwise the tool shows the incoming-terms gap and original-team obligations. Do not call a separate CBA search for the controlling mechanisms already returned here.';
export const nflContractComparisonTool = {
  name: 'nfl_contract_comparison',
  description: NFL_CONTRACT_COMPARISON_TOOL_DESCRIPTION,
  input_schema: NFL_CONTRACT_COMPARISON_TOOL_SCHEMA,
} as const;

export const nflCapStrategyTool = {
  name:'find_minimum_cap_funding',
  description:'Work backward from an acquisition to minimum necessary funding, then calculate budget, reserve and bonus-price sensitivities and exact no-funding thresholds in ONE call. Omit scenario to reuse the last validated acquisition terms and constraints; current literal budget/reserve changes are bound by the server. For new or changed incoming terms, supply the complete scenario from explicit user inputs. The server discovers eligible single salary conversions in reviewed team dossiers and derives amounts in $1,000 increments; never guess a conversion amount. Protected players are excluded. Ranks sufficient minimum conversions by least next-year added cap and retains all later allocations. No cash savings from conversion; missing incoming terms, source conflicts and infeasible funding remain explicit. Automatically generated sensitivity cases never overwrite user terms. Prior specified conversion amounts are observations, not a funding target. The output includes hold, acquisition alone, minimum funding where needed, all later years, CBA mechanisms and auditable derivation. This is conditional scenario analysis, not a current cap ledger or a real transaction.',
  input_schema:{type:'object',properties:{...NFL_CONTRACT_SCENARIO_TOOL_SCHEMA.properties,
    funding_observations:{type:'array',description:'Independent user-supplied limits for candidates, retained across follow-ups. No conversion amount is required or allowed here. Omitted candidates/fields retain prior observations.',items:{type:'object',properties:{player_id:{type:'string'},unpaid_salary_available:{type:'integer',minimum:0,description:'Literal user observation of remaining unpaid base salary, bound to this player.'},credited_seasons:{type:'integer',minimum:0,maximum:25,description:'Only a literal supplied credited-season count, not accrued seasons.'}},required:['player_id'],additionalProperties:false}},
    scenario:{...NFL_CONTRACT_SCENARIO_TOOL_SCHEMA,description:'Optional complete scenario. Prefer flat fields for changes, or {} to reuse prior terms. Equivalent or complementary nested and flat fields are accepted; conflicting duplicate values are rejected.'}},additionalProperties:false},
} as const;
