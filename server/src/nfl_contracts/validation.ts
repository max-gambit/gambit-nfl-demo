import type { NflContractScenarioArgs, NflIllustrativeContractTerms } from './types.js';

const object = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
function fail(message: string): never { throw new Error(`Invalid contract scenario: ${message}`); }
const dollars = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= 1_000_000_000;
function keys(v: Record<string, unknown>, allowed: string[], path: string) {
  for (const key of Object.keys(v)) if (!allowed.includes(key)) fail(`${path}.${key} is unsupported`);
}
function text(v: unknown): v is string { return typeof v === 'string' && v.trim().length > 0 && v.length <= 8000; }

export function validateIllustrativeTerms(value: unknown, season: number): NflIllustrativeContractTerms {
  if (!object(value)) fail('illustrative_terms must be an object');
  keys(value, ['basis', 'label', 'user_input', 'terms_complete', 'signing_bonus', 'years', 'prior_team_obligations', 'guarantee_note'], 'illustrative_terms');
  if (value.basis !== 'user_supplied_illustrative' || value.terms_complete !== true || !text(value.user_input) || !text(value.label) || !text(value.guarantee_note)) fail('illustrative terms need complete user-supplied terms, label, input, and guarantee note');
  if (!dollars(value.signing_bonus)) fail('signing_bonus must be nonnegative whole dollars');
  if (!Array.isArray(value.years) || !value.years.length || value.years.length > 5) fail('illustrative years must include 1–5 consecutive years');
  let voidSeen = false;
  const moneyFields = ['base_salary', 'other_cash', 'incentives_cap_charge', 'incentives_cash', 'guaranteed_salary', 'guaranteed_other_cash', 'salary_paid_by_prior_team', 'other_cash_paid_by_prior_team'];
  for (const [i, y] of value.years.entries()) {
    if (!object(y)) fail('each illustrative year must be an object');
    keys(y, ['year', 'kind', ...moneyFields], `years[${i}]`);
    if (y.year !== season + i || (y.year as number) > 2030) fail('years must be consecutive from the scenario season and end by 2030');
    if (!['active', 'void'].includes(String(y.kind))) fail('each year needs active or void kind');
    for (const field of moneyFields) if (!dollars(y[field])) fail(`years[${i}].${field} must be explicitly supplied in whole dollars`);
    if (y.kind === 'void') { voidSeen = true; if (moneyFields.some(f => y[f] !== 0)) fail('void years cannot include salary, cash, incentives, or guarantees'); }
    else if (voidSeen) fail('an active year cannot follow a void year');
    if (i === 0 && y.kind !== 'active') fail('the first illustrative year must be active');
    if (Number(y.salary_paid_by_prior_team) > Number(y.base_salary) || Number(y.other_cash_paid_by_prior_team) > Number(y.other_cash)) fail('paid amounts cannot exceed compensation');
    if (Number(y.guaranteed_salary) > Number(y.base_salary) - Number(y.salary_paid_by_prior_team) || Number(y.guaranteed_other_cash) > Number(y.other_cash) - Number(y.other_cash_paid_by_prior_team)) fail('outstanding guarantees cannot exceed unpaid compensation; specify guarantees after prior-team payments');
    if (i > 0 && (y.salary_paid_by_prior_team !== 0 || y.other_cash_paid_by_prior_team !== 0)) fail('future-year prior payments need a separately reviewed deferred-payment model');
  }
  if (!Array.isArray(value.prior_team_obligations) || value.prior_team_obligations.length > 8) fail('prior_team_obligations must be explicit, including [] if none');
  const seen = new Set<number>();
  for (const y of value.prior_team_obligations) {
    if (!object(y)) fail('prior obligation must be an object');
    keys(y, ['year', 'cap', 'cash'], 'prior_team_obligations');
    if (!Number.isInteger(y.year) || Number(y.year) < season || Number(y.year) > 2031 || seen.has(Number(y.year)) || !dollars(y.cap) || !dollars(y.cash)) fail('prior obligations need unique years and nonnegative whole-dollar cap/cash');
    seen.add(Number(y.year));
  }
  return structuredClone(value) as unknown as NflIllustrativeContractTerms;
}

/** Reject ambiguous/unknown action fields rather than silently dropping them. */
export function validateNflContractScenarioArgs(value: unknown): NflContractScenarioArgs {
  if (!object(value)) fail('arguments must be an object');
  keys(value, ['schema_version', 'season', 'team_id', 'timing', 'moves', 'protected_player_ids', 'budget'], 'args');
  if (value.schema_version !== 1 || !Number.isInteger(value.season) || Number(value.season) < 2026 || Number(value.season) > 2029) fail('supported scenario seasons are 2026–2029; final-CBA-year transactions need separate review');
  if (!text(value.team_id) || !/^[A-Z]{2,3}$/.test(value.team_id)) fail('team_id must be a team abbreviation');
  if (!['pre_june_1', 'post_june_1'].includes(String(value.timing))) fail('timing must be explicit pre_june_1 or post_june_1');
  if (!Array.isArray(value.moves) || !value.moves.length || value.moves.length > 12) fail('supply 1–12 moves');
  for (const move of value.moves) {
    if (!object(move)) fail('each move must be an object');
    keys(move, ['player_id', 'action', 'conversion_amount', 'unpaid_salary_available', 'credited_seasons', 'illustrative_terms'], 'move');
    if (!text(move.player_id) || !['hold', 'trade', 'release', 'restructure', 'acquire'].includes(String(move.action))) fail('each move needs player_id and a supported action');
    if (move.action === 'restructure') {
      if (!dollars(move.conversion_amount) || move.conversion_amount === 0) fail('restructure needs a positive conversion_amount');
      if (move.unpaid_salary_available !== undefined && !dollars(move.unpaid_salary_available)) fail('unpaid_salary_available must be whole dollars');
      if (move.credited_seasons !== undefined && (!Number.isInteger(move.credited_seasons) || Number(move.credited_seasons) < 0 || Number(move.credited_seasons) > 25)) fail('credited_seasons must be a nonnegative integer');
    } else if (move.conversion_amount !== undefined || move.unpaid_salary_available !== undefined || move.credited_seasons !== undefined) fail('conversion inputs apply only to restructure');
    if (move.illustrative_terms !== undefined) {
      if (move.action !== 'acquire') fail('illustrative acquisition terms apply only to acquire');
      validateIllustrativeTerms(move.illustrative_terms, Number(value.season));
    }
  }
  if (value.protected_player_ids !== undefined && (!Array.isArray(value.protected_player_ids) || value.protected_player_ids.some(v => !text(v)) || new Set(value.protected_player_ids).size !== value.protected_player_ids.length)) fail('protected_player_ids must contain unique nonempty identities');
  if (value.budget !== undefined) {
    if (!object(value.budget)) fail('budget must be an object');
    keys(value.budget, ['type', 'amount', 'reserve'], 'budget');
    if (!['cap', 'cash'].includes(String(value.budget.type)) || !dollars(value.budget.amount) || !dollars(value.budget.reserve)) fail('budget needs cap/cash type, available amount and reserve');
  }
  return structuredClone(value) as unknown as NflContractScenarioArgs;
}
