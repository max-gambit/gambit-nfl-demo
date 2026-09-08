import type { NflContractScenarioArgs, NflIllustrativeContractYear } from './types.js';
import { validateNflContractScenarioArgs } from './validation.js';

export interface NflScenarioInputProvenanceContext {
  current_question: string;
  /** Previously executed, server-retained arguments; never model-supplied state. */
  prior_args?: NflContractScenarioArgs;
}
export interface NflScenarioInputProvenanceGap { path: string; code: string; message: string }
export interface NflScenarioInputProvenanceResult { ok: boolean; gaps: NflScenarioInputProvenanceGap[] }

const normalize = (s: string) => s.toLowerCase().replace(/(20\d{2})\s*[–—−-]\s*(20\d{2})/g, '$1 through $2').replace(/[–—−-]/g, ' ').replace(/[’']/g, '').replace(/\s+/g, ' ').trim();
const name = (s: string) => normalize(s.split(':').at(-1)!);
const samePlayer = (a: string, b: string) => name(a) === name(b);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
// Bare integers are deliberately excluded: a contract year is not a dollar amount.
const MONEY = String.raw`(?:\$\s*\d[\d,]*(?:\.\d+)?(?:\s*(?:million|thousand|billion|dollars?|usd|mm|m|k)\b)?|\d[\d,]*(?:\.\d+)?\s*(?:million|thousand|billion|dollars?|usd|mm|m|k)\b|zero\b)`;
const YEAR = String.raw`(20\d{2})`;
const moneyValue = (raw: string) => {
  if (raw.trim() === 'zero') return 0;
  const n = Number(raw.replace(/[$,\s]/g, '').match(/^\d+(?:\.\d+)?/)?.[0]);
  const unit = raw.match(/(?:million|thousand|billion|mm|m|k)\b/)?.[0];
  const value = n * (unit === 'billion' ? 1e9 : unit === 'million' || unit === 'm' || unit === 'mm' ? 1e6 : unit === 'thousand' || unit === 'k' ? 1e3 : 1);
  return Number.isSafeInteger(value) ? value : NaN;
};

type Field = Exclude<keyof NflIllustrativeContractYear, 'year' | 'kind'> | 'signing_bonus' | 'conversion_amount' | 'unpaid_salary_available' | 'credited_seasons' | 'prior_cap' | 'prior_cash';
interface Marker { field: Field; expression: RegExp; annual: boolean }
const markers: Marker[] = [
  { field: 'guaranteed_other_cash', expression: /\boutstanding (?:other guaranteed cash|guaranteed other cash|other cash guarantees)\b/g, annual: true },
  { field: 'guaranteed_salary', expression: /\boutstanding guaranteed (?:base )?salary\b/g, annual: true },
  { field: 'salary_paid_by_prior_team', expression: /\b(?:base )?salary paid by (?:the )?prior team\b/g, annual: true },
  { field: 'other_cash_paid_by_prior_team', expression: /\bother cash paid by (?:the )?prior team\b/g, annual: true },
  { field: 'incentives_cap_charge', expression: /\bincentives? cap (?:charge|amount)\b/g, annual: true },
  { field: 'incentives_cash', expression: /\bincentives? cash(?: amount)?\b/g, annual: true },
  { field: 'prior_cap', expression: /\bprior team cap obligations?\b/g, annual: true },
  { field: 'prior_cash', expression: /\bprior team cash obligations?\b/g, annual: true },
  { field: 'base_salary', expression: /\bbase salary\b/g, annual: true },
  { field: 'other_cash', expression: /\bother (?:compensation|cash)\b/g, annual: true },
  { field: 'signing_bonus', expression: /\b(?:new )?signing bonus\b/g, annual: false },
  { field: 'unpaid_salary_available', expression: /\bunpaid (?:base )?salary(?: available)?\b/g, annual: false },
  { field: 'credited_seasons', expression: /\bcredited seasons?\b/g, annual: false },
  { field: 'conversion_amount', expression: /\b(?:salary conversion|conversion|convert|restructure)\b/g, annual: false },
];
const annualFields: Exclude<keyof NflIllustrativeContractYear, 'year' | 'kind'>[] = ['base_salary', 'other_cash', 'incentives_cap_charge', 'incentives_cash', 'guaranteed_salary', 'guaranteed_other_cash', 'salary_paid_by_prior_team', 'other_cash_paid_by_prior_team'];
interface ZeroClause { fields: Set<Field | 'prior_obligations'>; other: boolean }
interface Evidence {
  amounts: Map<string, number[]>;
  zeroClauses: ZeroClause[];
  activeYears: number[][];
  voidYears: number[][];
  text: string[];
}
const blankEvidence = (): Evidence => ({ amounts: new Map(), zeroClauses: [], activeYears: [], voidYears: [], text: [] });
const key = (field: Field, year?: number) => `${field}:${year ?? ''}`;
function record(e: Evidence, field: Field, value: number, year?: number) {
  if (!Number.isSafeInteger(value)) return;
  const k = key(field, year); e.amounts.set(k, [...(e.amounts.get(k) ?? []), value]);
}

function extractAmounts(sentence: string, player: string, evidence: Evidence) {
  const found = markers.flatMap(m => [...sentence.matchAll(m.expression)].map(match => ({ ...m, start: match.index!, end: match.index! + match[0].length })))
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const nonoverlapping = found.filter((m, i) => !found.slice(0, i).some(other => other.start <= m.start && other.end > m.start));
  for (const [i, marker] of nonoverlapping.entries()) {
    const after = sentence.slice(marker.end, nonoverlapping[i + 1]?.start ?? sentence.length);
    const before = sentence.slice(nonoverlapping[i - 1]?.end ?? 0, marker.start);
    if (marker.annual) {
      // "base salary $2m in 2026 and $3m in 2027".
      for (const m of after.matchAll(new RegExp(`(${MONEY})\\s+(?:in|for|during)\\s+${YEAR}\\b`, 'g'))) record(evidence, marker.field, moneyValue(m[1]), Number(m[2]));
      // "base salary in 2026 is $2m" or "base salary 2026: $2m".
      for (const m of after.matchAll(new RegExp(`\\b${YEAR}\\s*(?:is|of|to|at|:|=)?\\s*(${MONEY})`, 'g'))) record(evidence, marker.field, moneyValue(m[2]), Number(m[1]));
      // "change the 2027 base salary to $4m".
      const yearBefore = before.match(/\b(20\d{2})\s*$/)?.[1];
      const leading = after.match(new RegExp(`^\\s*(?:is|of|to|at|:|=)?\\s*(${MONEY})`));
      if (yearBefore && leading) record(evidence, marker.field, moneyValue(leading[1]), Number(yearBefore));
    } else if (marker.field === 'credited_seasons') {
      const numeric = after.match(/^\s*(?:is|are|of|:|=)?\s*(\d{1,2})\b/)?.[1] ?? before.match(/\b(\d{1,2})\s*$/)?.[1];
      if (numeric != null) record(evidence, marker.field, Number(numeric));
    } else {
      let leading = after.match(new RegExp(`^\\s*(?:is|of|to|by|at|:|=)?\\s*(${MONEY})`));
      if (!leading && marker.field === 'conversion_amount') leading = after.match(new RegExp(`^\\s+${escape(player)}(?:s)?\\s+(?:by|to|of|for)\\s*(${MONEY})`));
      const trailing = before.match(new RegExp(`(${MONEY})\\s*$`));
      if (leading) record(evidence, marker.field, moneyValue(leading[1]));
      if (trailing) record(evidence, marker.field, moneyValue(trailing[1]));
    }
  }
}

function extractZeroClauses(sentence: string, evidence: Evidence) {
  // All-zero declarations name categories; silence is never a zero declaration.
  const clauses = [...sentence.matchAll(/\b(all (?:other )?[^.;]{1,220}?)\s+(?:are|is)\s+(?:zero|\$0)\b/g)].map(m => ({ text: m[1], other: /^all other\b/.test(m[1]) }));
  for (const clause of clauses) {
    const fields = new Set<Field | 'prior_obligations'>();
    if (/\b(?:other compensation|other cash)\b/.test(clause.text)) fields.add('other_cash');
    if (/\bguarantees\b/.test(clause.text)) { fields.add('guaranteed_salary'); fields.add('guaranteed_other_cash'); }
    if (/\bincentives\b/.test(clause.text)) { fields.add('incentives_cap_charge'); fields.add('incentives_cash'); }
    if (/\bprior team payments\b/.test(clause.text)) { fields.add('salary_paid_by_prior_team'); fields.add('other_cash_paid_by_prior_team'); }
    if (/\bprior team obligations\b/.test(clause.text)) fields.add('prior_obligations');
    evidence.zeroClauses.push({ fields, other: clause.other });
  }
}

function yearList(text: string): number[] {
  const range = text.match(/^(20\d{2})\s*(?:through|to|-)\s*(20\d{2})$/);
  if (range && Number(range[2]) >= Number(range[1]) && Number(range[2]) - Number(range[1]) <= 5) return Array.from({ length: Number(range[2]) - Number(range[1]) + 1 }, (_, i) => Number(range[1]) + i);
  return [...new Set((text.match(/\b20\d{2}\b/g) ?? []).map(Number))].sort();
}

function explicitActors(text: string): string[] {
  return [...text.matchAll(/\b(?:for|acquire|restructure|trade|release|hold)\s+([a-z][a-z ]{0,65})/g)].flatMap(m => {
    const candidate = m[1].split(/\s+(?:for|to|in|on|by|with|after|before|at|from|and|or|salary|base|contract|cap|cash)\b/)[0].trim();
    if (/^(?:the|a|an|this|that|these|those|each|every|all|any|of|with)\b/.test(candidate) || /^[a-z]{2,3}$/.test(candidate)) return [];
    return [candidate];
  });
}

function buildEvidence(question: string, args: NflContractScenarioArgs, prior?: NflContractScenarioArgs) {
  const normalizedQuestion = normalize(question);
  const players = [...new Set([...args.moves, ...(prior?.moves ?? [])].map(m => name(m.player_id)))];
  const mentioned = (text: string) => players.filter(p => new RegExp(`(?:^|\\b)${escape(p)}(?:\\b|$)`).test(text));
  const allMentions = mentioned(normalizedQuestion);
  const priorConversions = prior?.moves.filter(m => m.action === 'restructure') ?? [];
  const priorIllustrations = prior?.moves.filter(m => m.illustrative_terms) ?? [];
  const explicitlyNamesUnknownPlayer = explicitActors(normalizedQuestion).some(p => !players.includes(p));
  let fallback: string | null = allMentions.length === 1 ? allMentions[0] : null;
  if (!allMentions.length && !explicitlyNamesUnknownPlayer) {
    if (priorConversions.length === 1 && /\b(?:increase|decrease|change|keep|recalculate)\b.*\bconversion\b/.test(normalizedQuestion)) fallback = name(priorConversions[0].player_id);
    if (priorIllustrations.length === 1 && (/\b(?:those|same|exact|previous)\b.*\b(?:terms|contract)\b/.test(normalizedQuestion) || /\bchange (?:the )?20\d{2} base salary\b/.test(normalizedQuestion))) fallback = name(priorIllustrations[0].player_id);
  }
  const output = new Map(players.map(p => [p, blankEvidence()]));
  const scopingErrors: string[] = [];
  let current = fallback;
  // A decimal point is preserved; a sentence-ending period after a year is split.
  const sentences = question.split(/[.!?](?!\d)|(?<!\d)[.!?]|[\n;]/).map(normalize).filter(Boolean);
  for (const sentence of sentences) {
    const local = mentioned(sentence);
    const financial = markers.some(m => new RegExp(m.expression.source).test(sentence));
    const unknownActor = explicitActors(sentence).some(p => !players.includes(p));
    if (unknownActor) {
      current = null;
      if (financial) scopingErrors.push('Financial wording names a player who is absent from the proposed or prior scenario; it cannot supply another player’s values.');
      continue;
    }
    if (local.length) current = local.length === 1 ? local[0] : null;
    if (local.length > 1 && financial) scopingErrors.push('Financial wording names multiple players in one sentence. State each player’s field and amount in a separate sentence.');
    if (!current) continue;
    if (financial && /\b(?:not|dont|never)\b/.test(sentence)) { scopingErrors.push('Negated financial wording is outside this bounded parser. Restate the desired field and amount positively.'); continue; }
    const e = output.get(current)!;
    e.text.push(sentence);
    extractAmounts(sentence, current, e);
    extractZeroClauses(sentence, e);
    for (const m of sentence.matchAll(/\b(active|void) years?\s*(?:are|:|=)?\s*((?:20\d{2})(?:\s*(?:,|and|through|to|-)\s*20\d{2})*)/g)) e[m[1] === 'active' ? 'activeYears' : 'voidYears'].push(yearList(m[2]));
    if (/\b(?:no|without) void years?\b/.test(sentence)) e.voidYears.push([]);
  }
  return { output, scopingErrors };
}

export function extractBudget(question: string, kind: 'cap' | 'cash' | 'reserve'): number[] {
  const text = normalize(question);
  const label = kind === 'reserve' ? 'reserve' : `${kind} budget`;
  const values: number[] = [];
  for (const m of text.matchAll(new RegExp(`\\b${label}\\s*(?:is|of|to|:|=)?\\s*(${MONEY})`, 'g'))) values.push(moneyValue(m[1]));
  for (const m of text.matchAll(new RegExp(`(${MONEY})\\s+${label}\\b`, 'g'))) values.push(moneyValue(m[1]));
  return values;
}

/**
 * A deliberately bounded parser for user-authored scenario inputs. Values bind to
 * an actor, a named field, and (for annual terms) a year. Exact prior values may be
 * retained; all changes require fresh field-specific evidence. No LLM or network.
 */
export function validateNflScenarioInputProvenance(input: NflContractScenarioArgs, context: NflScenarioInputProvenanceContext): NflScenarioInputProvenanceResult {
  const gaps: NflScenarioInputProvenanceGap[] = [];
  const gap = (path: string, code: string, message: string) => gaps.push({ path, code, message });
  let args: NflContractScenarioArgs;
  try { args = validateNflContractScenarioArgs(input); } catch (error) { return { ok: false, gaps: [{ path: 'args', code: 'INVALID_ARGUMENTS', message: error instanceof Error ? error.message : 'Invalid scenario arguments.' }] }; }
  if (typeof context.current_question !== 'string' || !context.current_question.trim()) return { ok: false, gaps: [{ path: 'current_question', code: 'MISSING_USER_TEXT', message: 'The actual current user question is required.' }] };
  const prior = context.prior_args;
  const { output: evidence, scopingErrors } = buildEvidence(context.current_question, args, prior);
  for (const message of [...new Set(scopingErrors)]) gap('current_question', 'AMBIGUOUS_PLAYER_FIELD_TEXT', message);
  const bind = (path: string, value: number, previous: number | undefined, candidates: number[]) => {
    const unique = [...new Set(candidates)];
    if (unique.length > 1) gap(path, 'AMBIGUOUS_FIELD_VALUE', 'The user text supplies conflicting amounts for this specific field; restate one amount.');
    else if (unique.length === 1 && unique[0] !== value) gap(path, 'FIELD_VALUE_MISMATCH', `The user explicitly supplied ${unique[0]} for this field, but the proposed value is ${value}.`);
    else if (!unique.length && value !== previous) gap(path, 'MISSING_FIELD_EVIDENCE', 'No explicit amount is bound to this player, year and field in the current user text, and this is not an unchanged prior value.');
  };
  const bindYears = (path: string, years: number[], previous: number[] | undefined, candidates: number[][]) => {
    if (candidates.length && candidates.some(c => !equal(c, years))) gap(path, 'YEAR_SET_MISMATCH', 'The proposed active/void years do not exactly match the explicit year list.');
    else if (!candidates.length && !equal(years, previous)) gap(path, 'MISSING_YEAR_KINDS', 'Explicit active years and void years (or no void years) are required for new illustrative terms.');
  };
  for (const [i, move] of args.moves.entries()) {
    const path = `moves[${i}]`;
    const previous = prior?.moves.find(m => samePlayer(m.player_id, move.player_id) && m.action === move.action);
    const e = evidence.get(name(move.player_id)) ?? blankEvidence();
    const scalar = (field: 'conversion_amount' | 'unpaid_salary_available' | 'credited_seasons') => {
      if (move[field] != null) bind(`${path}.${field}`, move[field]!, previous?.[field], e.amounts.get(key(field)) ?? []);
      else if (previous?.[field] != null) gap(`${path}.${field}`, 'PRIOR_INPUT_REMOVED', 'An executed prior input was removed; retain it or explicitly restate the complete revised scenario.');
    };
    scalar('conversion_amount'); scalar('unpaid_salary_available'); scalar('credited_seasons');
    if (!move.illustrative_terms) continue;
    const t = move.illustrative_terms;
    const old = previous?.illustrative_terms;
    const p = `${path}.illustrative_terms`;
    const currentText = context.current_question.trim();
    const retained = t.user_input.trim();
    if (!old && retained !== currentText) gap(`${p}.user_input`, 'USER_INPUT_NOT_LITERAL', 'For new terms, retain the complete actual user question verbatim in user_input.');
    if (old && retained !== old.user_input.trim() && retained !== `${old.user_input.trim()}\n\n${currentText}`) gap(`${p}.user_input`, 'PRIOR_USER_INPUT_NOT_RETAINED', 'Retain the complete prior user_input unchanged, or append the complete current question separated by a blank line.');
    const scoped = e.text.join('. ');
    if (!old && !new RegExp(`\\b${escape(name(move.player_id))}\\b`).test(normalize(context.current_question))) gap(`${path}.player_id`, 'PLAYER_NOT_EXPLICIT', 'New illustrative terms must name this exact player; another player or an unbound receiver cannot supply their terms.');
    if (!old && !/\b(?:hypothetical|illustrative|assume|assumed)\b/.test(scoped)) gap(`${p}.basis`, 'ILLUSTRATION_NOT_REQUESTED', 'The user must explicitly request hypothetical or illustrative terms.');
    if (!old && !/\bcomplete (?:compensation schedule|contract terms|compensation terms)\b/.test(scoped)) gap(`${p}.terms_complete`, 'COMPLETENESS_NOT_EXPLICIT', 'The user must identify the supplied compensation schedule as complete.');
    if (!old && !/\bno\b[^.;]{0,60}\boptions\b/.test(scoped)) gap(`${p}.terms_complete`, 'OPTIONS_NOT_EXCLUDED', 'Explicitly exclude options for this bounded illustrative model.');
    bind(`${p}.signing_bonus`, t.signing_bonus, old?.signing_bonus, e.amounts.get(key('signing_bonus')) ?? []);
    bindYears(`${p}.active_years`, t.years.filter(y => y.kind === 'active').map(y => y.year), old?.years.filter(y => y.kind === 'active').map(y => y.year), e.activeYears);
    bindYears(`${p}.void_years`, t.years.filter(y => y.kind === 'void').map(y => y.year), old?.years.filter(y => y.kind === 'void').map(y => y.year), e.voidYears);
    for (const [j, y] of t.years.entries()) for (const field of annualFields) {
      const priorYear = old?.years.find(oldYear => oldYear.year === y.year);
      const explicit = e.amounts.get(key(field, y.year)) ?? [];
      const zeros = e.zeroClauses.filter(z => z.fields.has(field) && (!z.other || !explicit.length)).map(() => 0);
      // An explicitly named void year supplies no base salary; its guarantees and
      // payments still require a named zero category or unchanged prior input.
      if (field === 'base_salary' && y.kind === 'void' && e.voidYears.some(list => list.includes(y.year))) zeros.push(0);
      bind(`${p}.years[${j}].${field}`, y[field], priorYear?.[field], [...explicit, ...zeros]);
    }
    const zeroObligations = e.zeroClauses.some(z => z.fields.has('prior_obligations'));
    if (!t.prior_team_obligations.length) {
      if (!zeroObligations && !equal(t.prior_team_obligations, old?.prior_team_obligations)) gap(`${p}.prior_team_obligations`, 'PRIOR_OBLIGATIONS_NOT_EXPLICIT', 'State that prior-team obligations are zero, or supply their cap and cash by year.');
    } else if (zeroObligations) gap(`${p}.prior_team_obligations`, 'PRIOR_OBLIGATION_MISMATCH', 'The user explicitly set prior-team obligations to zero.');
    for (const [j, obligation] of t.prior_team_obligations.entries()) for (const field of ['cap', 'cash'] as const) bind(`${p}.prior_team_obligations[${j}].${field}`, obligation[field], old?.prior_team_obligations.find(y => y.year === obligation.year)?.[field], e.amounts.get(key(field === 'cap' ? 'prior_cap' : 'prior_cash', obligation.year)) ?? []);
  }
  if (args.budget) {
    const old = prior?.budget;
    bind('budget.amount', args.budget.amount, old?.type === args.budget.type ? old.amount : undefined, extractBudget(context.current_question, args.budget.type));
    bind('budget.reserve', args.budget.reserve, old?.reserve, extractBudget(context.current_question, 'reserve'));
    const otherType = args.budget.type === 'cap' ? 'cash' : 'cap';
    if (extractBudget(context.current_question, otherType).length) gap('budget.type', 'BUDGET_TYPE_MISMATCH', `The user supplied a ${otherType} budget; it cannot silently become a ${args.budget.type} budget.`);
  } else if (prior?.budget) gap('budget', 'PRIOR_BUDGET_REMOVED', 'The executed budget and reserve were removed; retain them or explicitly restate the revised scenario.');
  return { ok: gaps.length === 0, gaps };
}
