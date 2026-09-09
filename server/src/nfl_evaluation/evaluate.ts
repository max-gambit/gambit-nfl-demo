import { factualBody } from '@shared/nflFacts';
import { validateNflEvaluationInput } from './binding.js';
import { defaultEvaluationNames, loadEvaluationEvidence, supportedEvaluationNames, type EvaluationEvidenceOption } from './evidence.js';
import type { NflEvaluationContext, NflEvaluationDecision, NflEvaluationFlip, NflEvaluationRule, NflEvaluatedOption, NflOptionEvaluationAnswer, NflOptionEvaluationArgs } from './types.js';

const norm = (v: string) => v.toLowerCase().replace(/\s+/g, ' ').trim();
const show = (v: number | null, digits = 2) => v == null ? 'Unknown' : v.toFixed(digits).replace(/\.00$/, '');
const money = (v: number | null) => v == null ? 'Unknown' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);
const ratio = (o: NflEvaluatedOption, c: string) => { const j = o.judgments.find(j => norm(j.criterion) === norm(c)); return j?.value == null || !j.out_of ? null : j.value / j.out_of; };
const refsFor = (rows: EvaluationEvidenceOption[]) => [...new Set(rows.flatMap(o => o.refs))];
const pricePasses = (cost: number, query: NflOptionEvaluationArgs) => query.constraints?.max_incoming_cap_operator === 'lt' ? cost < query.constraints!.max_incoming_cap! : cost <= query.constraints!.max_incoming_cap!;
const priceLimitLabel = (query: NflOptionEvaluationArgs) => `${query.constraints?.max_incoming_cap_operator === 'lt' ? 'below' : 'at or below'} ${money(query.constraints!.max_incoming_cap!)}`;

/** Descriptive dimensions only. An unknown dimension never loses by imputation. */
function publicFrontier(rows: EvaluationEvidenceOption[], domain: NflOptionEvaluationArgs['domain']): string[] {
  const metrics = (o: EvaluationEvidenceOption) => domain === 'college'
    ? [o.yards_per_game, o.receptions_per_game]
    : [o.yards_per_game, o.last_active_year == null ? null : -o.last_active_year];
  return rows.filter(candidate => !rows.some(other => {
    if (other === candidate) return false;
    const a = metrics(candidate), b = metrics(other);
    return a.every((v, i) => v != null && b[i] != null && b[i]! >= v) && a.some((v, i) => b[i]! > v!);
  })).map(o => o.name);
}

function flipsFor(options: NflEvaluatedOption[], rules: NflEvaluationRule[], query: NflOptionEvaluationArgs, preferred: string[]): NflEvaluationFlip[] {
  const flips: NflEvaluationFlip[] = [];
  for (const o of options) {
    for (const r of rules) {
      const g = o.judgments.find(j => norm(j.criterion) === norm(r.criterion));
      if (g?.value == null || !g.out_of) {
        flips.push({ kind: 'missing_input', player_name: o.player_name, criterion: r.criterion, condition: `Supply ${o.player_name}'s ${r.criterion} grade with its scale; this option cannot be scored for that criterion.`, value: null, unit: 'user grade' });
      } else if (r.minimum && g.passes === false) {
        const target = r.minimum.value / r.minimum.out_of * g.out_of;
        flips.push({ kind: 'threshold', player_name: o.player_name, criterion: r.criterion, condition: `${o.player_name}'s ${r.criterion} must reach ${show(target, 3)}/${g.out_of} to pass this floor; other gates still apply.`, value: target, unit: `grade out of ${g.out_of}` });
      }
    }
    if (query.constraints?.max_incoming_cap != null && (o.incoming_cap == null || !pricePasses(o.incoming_cap, query))) flips.push({ kind: 'price', player_name: o.player_name, criterion: 'incoming cap', condition: `A compatible root-calculated incoming-cap scenario for ${o.player_name} ${priceLimitLabel(query)} is required to pass the price gate.`, value: query.constraints.max_incoming_cap, unit: query.constraints.max_incoming_cap_operator === 'lt' ? 'USD strict upper bound' : 'USD incoming cap ceiling' });
  }
  if (query.method !== 'weighted' || preferred.length !== 1) return flips;
  const leader = options.find(o => o.player_name === preferred[0])!;
  const weighted = rules.filter(r => r.weight != null && r.weight > 0);
  for (const challenger of options.filter(o => o.player_name !== leader.player_name && o.threshold_status === 'passes' && o.weighted_score != null)) {
    for (const r of weighted) {
      const grade = challenger.judgments.find(j => norm(j.criterion) === norm(r.criterion))!;
      const target = (grade.value! / grade.out_of! + (leader.weighted_score! - challenger.weighted_score!) / (100 * r.weight!)) * grade.out_of!;
      if (target <= grade.out_of! + 1e-9) flips.push({ kind: 'grade', player_name: challenger.player_name, criterion: r.criterion, condition: `Holding all other grades and weights fixed, ${challenger.player_name} ties ${leader.player_name} at ${show(target, 3)}/${grade.out_of} for ${r.criterion}; a higher grade makes this challenger lead if all gates pass.`, value: target, unit: `grade out of ${grade.out_of}` });
    }
    if (weighted.length === 2) {
      const [a, b] = weighted;
      const da = ratio(challenger, a.criterion)! - ratio(leader, a.criterion)!;
      const db = ratio(challenger, b.criterion)! - ratio(leader, b.criterion)!;
      const tie = -db / (da - db);
      if (Number.isFinite(tie) && tie >= 0 && tie <= 1) flips.push({ kind: 'weight', player_name: challenger.player_name, criterion: a.criterion, condition: `${challenger.player_name} and ${leader.player_name} tie when ${a.criterion} receives ${show(100 * tie, 3)}% and ${b.criterion} receives ${show(100 * (1 - tie), 3)}%. ${challenger.player_name} leads ${da - db > 0 ? 'above' : 'below'} that ${a.criterion} weight, with grades and gates fixed.`, value: tie, unit: 'fraction of total weight' });
    }
  }
  return flips;
}

export async function buildNflOptionEvaluation(input: NflOptionEvaluationArgs, context: NflEvaluationContext): Promise<NflOptionEvaluationAnswer> {
  const names = supportedEvaluationNames(input?.domain, context);
  const priorCompatible = context.previous?.query.domain === input?.domain && norm(context.previous.query.role) === norm(input?.role ?? '');
  const prepared = input && typeof input === 'object' && !input.player_names && !priorCompatible ? { ...input, player_names: defaultEvaluationNames(input.domain, context) } : input;
  const { query, judgments, boundQuotes } = validateNflEvaluationInput(prepared, names, context);
  const { options: evidence, sources } = await loadEvaluationEvidence(query.domain, query.player_names!, context);
  const rules = query.rules ?? [], method = query.method!;
  const missing = new Set<string>();
  const options: NflEvaluatedOption[] = evidence.map(e => {
    let failed = false, unknown = false;
    const reasons: string[] = [];
    if (query.constraints?.internal_only && !e.internal) { failed = true; reasons.push('Outside the requested internal-only roster scope.'); }
    const ceiling = query.constraints?.max_incoming_cap;
    if (ceiling != null) {
      if (e.incoming_cap == null) { unknown = true; missing.add(`${e.name}: compatible incoming-cap scenario ${priceLimitLabel(query)}`); reasons.push('Incoming cap unknown; does not pass the price gate.'); }
      else if (!pricePasses(e.incoming_cap, query)) { failed = true; reasons.push(`Incoming cap ${money(e.incoming_cap)} does not satisfy the required limit ${priceLimitLabel(query)}.`); }
      else reasons.push(`Conditional incoming-cap scenario ${money(e.incoming_cap)} passes the limit ${priceLimitLabel(query)}; ${e.cost?.status} assumptions still apply.`);
    }
    const criteria = [...new Set([...rules.map(r => norm(r.criterion)), ...judgments.filter(j => j.player_name === e.name).map(j => norm(j.criterion))])];
    const grades = criteria.map(c => {
      const r = rules.find(r => norm(r.criterion) === c), j = judgments.find(j => j.player_name === e.name && norm(j.criterion) === c);
      const passes = r?.minimum ? j ? j.value / j.out_of + 1e-12 >= r.minimum.value / r.minimum.out_of : null : null;
      if (r && !j) { unknown = true; missing.add(`${e.name}: ${r.criterion} grade and scale`); reasons.push(`${r.criterion} grade missing; no substitute or reweighting applied.`); }
      if (passes === false) { failed = true; reasons.push(`${r!.criterion} ${j!.value}/${j!.out_of} is below the supplied ${r!.minimum!.value}/${r!.minimum!.out_of} floor.`); }
      return { criterion: r?.criterion ?? j!.criterion, value: j?.value ?? null, out_of: j?.out_of ?? null, passes };
    });
    const weightedRules = rules.filter(r => r.weight != null);
    const complete = weightedRules.length > 0 && weightedRules.every(r => grades.some(g => norm(g.criterion) === norm(r.criterion) && g.value != null));
    const weighted_score = method === 'weighted' && complete ? 100 * weightedRules.reduce((sum, r) => { const g = grades.find(g => norm(g.criterion) === norm(r.criterion))!; return sum + r.weight! * g.value! / g.out_of!; }, 0) : null;
    return { player_name: e.name, path: e.path, receiving_yards_per_game: e.yards_per_game, receptions_per_game: e.receptions_per_game, last_active_contract_year: e.last_active_year, incoming_cap: e.incoming_cap, threshold_status: failed ? 'fails' : unknown ? 'unknown' : 'passes', weighted_score, judgments: grades, reasons };
  });
  const remaining = options.filter(o => o.threshold_status !== 'fails');
  const eligible = remaining.filter(o => o.threshold_status === 'passes');
  const shortlist = publicFrontier(evidence.filter(e => remaining.some(o => o.player_name === e.name)), query.domain);
  let status: NflEvaluationDecision['status'], preferred: string[] = [];
  if (!remaining.length) status = 'no_eligible_option';
  else if (method === 'public_tradeoffs') status = 'public_shortlist';
  else if (!rules.length || method === 'threshold' && !rules.some(r => r.minimum) || method === 'weighted' && !rules.some(r => r.weight != null)) {
    status = 'needs_input'; missing.add(method === 'weighted' ? 'Explicit criterion weights totaling 100% and corresponding grades' : 'An explicit role-grade floor and corresponding player grades');
  } else if (remaining.some(o => o.threshold_status === 'unknown') || method === 'weighted' && eligible.some(o => o.weighted_score == null)) status = 'needs_input';
  else if (method === 'threshold') { preferred = eligible.map(o => o.player_name); status = preferred.length === 1 ? 'conditional_preference' : 'tie'; }
  else {
    const high = Math.max(...eligible.map(o => o.weighted_score!));
    preferred = eligible.filter(o => Math.abs(o.weighted_score! - high) < 1e-9).map(o => o.player_name);
    status = preferred.length === 1 ? 'conditional_preference' : 'tie';
  }
  if (method === 'public_tradeoffs') missing.add('Your role criteria and either pass/fail floors or weights plus candidate grades');
  missing.add(query.domain === 'college' ? 'Current eligibility, acquisition path and cost: these are historical 2025 draft examples' : 'Current availability, role assignment and acquisition feasibility; public roster history does not establish them');
  if (query.domain === 'receiver' && query.constraints?.max_incoming_cap == null) missing.add('Compatible incoming-cost scenarios and a team cap ceiling before an executable acquisition decision');
  const flips = flipsFor(options, rules, query, preferred);
  const evaluation: NflEvaluationDecision = { schema_version: 1, domain: query.domain, role: query.role, method, status, preferred_player_names: preferred, public_shortlist: shortlist, options, flips, unresolved_inputs: [...missing], executable: false, state: { schema_version: 1, query, bound_quotes: boundQuotes } };
  const lead = status === 'conditional_preference' ? `${preferred[0]} is the conditional preference for “${query.role}” under your supplied ${method === 'weighted' ? 'grades and weights' : 'grade floors'}.`
    : status === 'tie' ? `${preferred.join(' and ')} ${method === 'threshold' ? 'pass the supplied floors; those floors do not rank the passing options' : 'tie under the supplied grades and weights'}.`
    : status === 'no_eligible_option' ? `No selected option passes the supplied constraints for “${query.role}”.`
    : status === 'needs_input' ? `The comparison for “${query.role}” is incomplete; the missing inputs prevent a complete conditional preference.`
    : `${shortlist.join(' and ') || 'No selected option'} ${shortlist.length === 1 ? 'is' : 'are'} on the descriptive public-record frontier for “${query.role}”.`;
  const publicDefinition = query.domain === 'college' ? 'The public frontier compares higher 2024 receiving yards/game and receptions/game. It does not value route skill, blocking, team context or prospect quality.' : 'The public frontier compares higher 2025 receiving yards/game and an earlier last reported active contract year. Contract horizon is a flexibility dimension, not incoming cost or player value; unknown dimensions remain on the frontier.';
  const allRefs = refsFor(evidence);
  const gradeRefs = judgments.map(j => { const ref_index = sources.length + 1; sources.push({ kind: 'SUPPLIED_EVALUATION', source: j.source_label, title: `${j.player_name}: conversation-supplied ${j.criterion}`, updated_at: j.date ?? context.receivedAt ?? new Date().toISOString(), ref_index, data: { quote: j.quote, metadata_quote: j.metadata_quote, attribution_status: j.attribution_status, rows: [{ k: 'Player / criterion', v: `${j.player_name} / ${j.criterion}` }, { k: 'Supplied grade', v: `${j.value}/${j.out_of}` }, { k: 'Author', v: j.author_label }, { k: 'Date', v: j.date_label }, { k: 'Source', v: j.source_label }, { k: 'Attribution boundary', v: 'Supplied by the user, not independently verified. No proprietary Giants model is connected.' }, { k: 'Defaults', v: j.metadata_defaults.join('; ') || 'All metadata explicitly supplied' }] } }); return ref_index; });
  const ruleRefs = rules.map(r => { const ref_index = sources.length + 1; sources.push({ kind: 'USER_RULE', source: 'User message', title: `Supplied decision rule: ${r.criterion}`, updated_at: context.receivedAt ?? new Date().toISOString(), ref_index, data: { quote: r.quote, numeric_provenance: { weight: r.weight, minimum: r.minimum }, rows: [{ k: 'Boundary', v: 'User-owned preference; not a system talent grade.' }] } }); return ref_index; });
  const result = factualBody({
    answer: `${lead} ${method === 'public_tradeoffs' ? publicDefinition : 'This is transparent arithmetic over user-supplied judgments, not an independent player evaluation.'} Current path, availability and deal conditions remain unresolved.`,
    answer_source_refs: [...allRefs, ...gradeRefs, ...ruleRefs],
    key_findings: [{ label: 'Decision basis', body: method === 'weighted' ? 'Score = 100 × sum(weight × grade / stated scale). Weights must total 100%; missing grades are never imputed or redistributed. Floors and explicit scope/cap gates apply before preference.' : method === 'threshold' ? 'Each supplied grade is compared on its stated scale with the explicit minimum. Passing establishes eligibility within this supplied model; it does not rank multiple passing options.' : publicDefinition, source_refs: [...ruleRefs, ...gradeRefs, ...(method === 'public_tradeoffs' ? allRefs : [])] }, ...evidence.filter(e => e.reports.length).map(e => ({ label: `${e.name}: attributed public assessment`, body: e.reports.join(' '), source_refs: e.refs }))],
    tables: [{ title: query.domain === 'college' ? 'Historical 2025 draft example · public record and decision status' : 'Receiver role comparison · dated public record and decision status', columns: ['Player', 'Public yards/game', 'Public receptions/game', 'Last active contract year', 'Incoming cap', 'Constraint status', 'Supplied weighted score / 100', 'Path'], rows: options.map(o => [o.player_name, show(o.receiving_yards_per_game), show(o.receptions_per_game), o.last_active_contract_year ?? 'Unknown', money(o.incoming_cap), o.threshold_status, show(o.weighted_score), o.path]), source_refs: [...allRefs, ...gradeRefs, ...ruleRefs] }, ...(judgments.length ? [{ title: 'User-supplied judgments · unverified attribution', columns: ['Player', 'Criterion', 'Grade', 'Author', 'Date', 'Source'], rows: judgments.map(j => [j.player_name, j.criterion, `${j.value}/${j.out_of}`, j.author_label, j.date_label, j.source_label]), source_refs: gradeRefs }] : []), ...(flips.length ? [{ title: 'What changes the decision', columns: ['Option', 'Input', 'Flip condition'], rows: flips.map(f => [f.player_name ?? 'Comparison', f.criterion, f.condition]), source_refs: [...allRefs, ...gradeRefs, ...ruleRefs] }] : [])],
    calculations: [...evidence.filter(e => e.games && e.yards != null).map(e => ({ label: `${e.name}: ${e.stats_season} receiving yards/game`, formula: `${e.yards} / ${e.games}`, value: show(e.yards_per_game), source_refs: e.refs })), ...options.filter(o => o.weighted_score != null).map(o => ({ label: `${o.player_name}: supplied weighted score`, formula: `100 × (${rules.filter(r => r.weight != null).map(r => { const j = o.judgments.find(j => norm(j.criterion) === norm(r.criterion))!; return `${r.weight} × ${j.value}/${j.out_of}`; }).join(' + ')})`, value: `${show(o.weighted_score)} / 100`, source_refs: [...gradeRefs, ...ruleRefs] }))],
    caveats: [...options.flatMap(o => o.reasons.map(reason => `${o.player_name}: ${reason}`)), ...missing, 'Public reports are attributed opinions; user grades and their author/source claims are unverified supplied inputs. No private Giants scouting, medical or proprietary evaluation model is connected.'],
    followups: method === 'public_tradeoffs' ? ['Choose the role criteria and supply the player grades with scales, then give pass/fail floors or weights totaling 100%.', 'Add an internal-only constraint or a cap ceiling, then calculate compatible incoming-cost scenarios.'] : ['Change a supplied grade, floor or weight and rerun the same comparison.', 'Change the role objective to start a fresh comparison; previous grades and rules will not silently carry over.'],
  });
  return { body: { ...result, evaluation_query: { ...query }, evaluation_result: { ...evaluation } }, sources, evaluation };
}
