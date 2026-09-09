import type { NflEvaluationContext, NflEvaluationRule, NflOptionEvaluationArgs, NflSuppliedJudgment, NflValidatedJudgment } from './types.js';

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const normalize = (value: string) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const word = (value: string) => new RegExp(`(?<![A-Za-z0-9])${escape(value)}(?![A-Za-z0-9])`, 'ig');
const pairPattern = /(?<![\d.])([0-9]+(?:\.[0-9]+)?)\s*(?:\/|out\s+of)\s*([0-9]+(?:\.[0-9]+)?)(?!\d|\.\d)/gi;
const moneyPattern = /\$\s*(\d[\d,]*(?:\.\d+)?)\s*(million|m|thousand|k)?\b|\b(\d[\d,]*(?:\.\d+)?)\s*(million|thousand)\s*(?:dollars)?/gi;
const prohibitedCriterion = /\b(?:probabilit\w*|injur\w*|medical|recovery|prognos\w*|forecast\w*|predict\w*|odds|chance|return.to.play|missed.time)\b/i;
const label = (value: unknown, field: string, max = 100) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Provide a short ${field}.`);
  return value.trim();
};
function number(value: unknown, field: string, min = 0, max = 1e9): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid ${field}.`);
  return value;
}
function checkKeys(value: unknown, keys: string[], label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) throw new Error(`Invalid ${label} fields.`);
}
function quote(value: unknown, context: NflEvaluationContext): string {
  const text = label(value, 'exact user quote', 2400);
  if (!context.userText.includes(text) && !context.previous?.bound_quotes.includes(text)) throw new Error('The supporting quote is not present in user-authored input or previously validated user evidence.');
  return text;
}
function canonical(name: string, names: string[]): string {
  const exact = names.filter(n => normalize(n) === normalize(name));
  if (exact.length === 1) return exact[0];
  const short = names.filter(n => normalize(n.split(' ').at(-1)!) === normalize(name));
  if (short.length === 1) return short[0];
  throw new Error('The supplied player is outside this bounded comparison or its name is ambiguous.');
}
function mentions(text: string, names: string[]) {
  const result: Array<{ name: string; index: number; end: number }> = [];
  for (const name of names) {
    const aliases = [name, name.split(' ').at(-1)!];
    for (const alias of aliases) for (const match of text.matchAll(word(alias))) {
      if (!result.some(r => r.name === name && match.index! >= r.index && match.index! < r.end)) result.push({ name, index: match.index!, end: match.index! + match[0].length });
    }
  }
  return result.sort((a, b) => a.index - b.index || b.end - a.end);
}
interface BoundScore { value: number; out_of: number; scoreIndex: number; quoteStart: number; quoteEnd: number }
/** Every match binds one score locally or to its preceding shared criterion heading. */
function boundPairs(text: string, player: string, criterion: string, names: string[]): BoundScore[] {
  const hits = mentions(text, names);
  const result: BoundScore[] = [];
  for (let i = 0; i < hits.length; i++) {
    if (hits[i].name !== player) continue;
    const end = hits.slice(i + 1).find(h => h.index >= hits[i].end)?.index ?? text.length;
    const playerText = text.slice(hits[i].end, end);
    const prefix = text.slice(0, hits[i].index);
    const headings = [...prefix.matchAll(/([A-Za-z][A-Za-z -]{0,70})\s*[:,]/g)];
    const heading = headings.at(-1);
    const sharedCriterion = heading ? word(criterion).test(heading[1]) : new RegExp(escape(criterion) + '\\s*$', 'i').test(prefix.trim());
    const pairs = [...playerText.matchAll(pairPattern)];
    for (const [pairIndex, pair] of pairs.entries()) {
      const ownCriterion = [...playerText.slice(0, pair.index).matchAll(word(criterion))].at(-1);
      const between = ownCriterion ? playerText.slice(ownCriterion.index! + ownCriterion[0].length, pair.index) : playerText.slice(0, pair.index);
      if ((!ownCriterion && !(sharedCriterion && pairIndex === 0)) || !/^(?:(?:role|grade|score|is|of|at|rated)\b|[\s:=,()-])*$/i.test(between.trim())) continue;
      result.push({ value: Number(pair[1]), out_of: Number(pair[2]), scoreIndex: hits[i].end + pair.index!, quoteStart: ownCriterion ? hits[i].index : heading?.index ?? Math.max(0, hits[i].index - criterion.length), quoteEnd: hits[i].end + pair.index! + pair[0].length });
    }
  }
  return result;
}
function uniqueScore(pairs: BoundScore[]): BoundScore | null {
  if (new Set(pairs.map(p => `${p.value}/${p.out_of}`)).size > 1) throw new Error('Conflicting grades for the same player and criterion appear in the supplied text. Supply one current value; a shorter quote cannot hide the conflict.');
  return pairs[0] ?? null;
}
/** The model's quotation is a locator hint; only literal user evidence grants authority. */
function resolveGradeQuote(rawQuote: unknown, player: string, c: string, value: number, outOf: number, names: string[], context: NflEvaluationContext): { sourceQuote: string; pair: BoundScore } {
  label(rawQuote, 'grade quote hint', 2400);
  const current = uniqueScore(boundPairs(context.userText, player, c, names));
  if (current) {
    if (current.value !== value || current.out_of !== outOf) throw new Error('The player, criterion and grade must bind to the same literal user score; the current message supplies a different value or scale.');
    const sourceQuote = context.userText.length <= 2400 ? context.userText : context.userText.slice(current.quoteStart, current.quoteEnd);
    const pair = uniqueScore(boundPairs(sourceQuote, player, c, names))!;
    return { sourceQuote, pair };
  }
  const sourceQuote = quote(rawQuote, context);
  const pair = uniqueScore(boundPairs(sourceQuote, player, c, names));
  if (!pair || pair.value !== value || pair.out_of !== outOf) throw new Error('The player, criterion and grade must bind to the same literal user score, such as “receiving: Warren 8/10”. Do not borrow another player’s value.');
  return { sourceQuote, pair };
}
/** Metadata is local to the scored player's block/segment, unless explicitly shared. */
function metadataScopes(text: string, player: string, names: string[], scoreIndex?: number): string[] {
  const blocks = [...text.matchAll(/\[Evaluation\]([\s\S]*?)\[\/Evaluation\]/gi)];
  const matchingBlocks = blocks.filter(b => {
    const players = [...new Set(mentions(b[1], names).map(h => h.name))];
    return players.length === 1 && players[0] === player && (scoreIndex == null || scoreIndex >= b.index! && scoreIndex < b.index! + b[0].length);
  });
  const scopes: string[] = matchingBlocks.length === 1 ? [matchingBlocks[0][1]] : [];
  if (!blocks.length) {
    const hits = mentions(text, names);
    const segments = hits.map((hit, i) => ({ name: hit.name, start: hit.index, end: hits[i + 1]?.index ?? text.length })).filter(s => s.name === player && (scoreIndex == null || scoreIndex >= s.start && scoreIndex < s.end));
    if (segments.length === 1) scopes.push(text.slice(segments[0].start, segments[0].end));
  }
  // A shared declaration ends before the next player/block, so later metadata
  // cannot be borrowed just because a shared header appeared earlier.
  const shared = /Shared (?:evaluation )?metadata for all compared players\s*:/i.exec(text);
  if (shared) {
    const start = shared.index + shared[0].length;
    const tail = text.slice(start);
    const firstPlayer = mentions(tail, names)[0]?.index ?? tail.length;
    const boundary = tail.search(/\[Evaluation\]|\n\s*\n|\bPlayer\s*:/i);
    const body = tail.slice(0, Math.min(firstPlayer, boundary < 0 ? tail.length : boundary));
    if (body.trim()) scopes.push(body);
  }
  return scopes;
}
/** An ordinary, unique metadata header before multiple graded entries is global. */
function globalMetadataHeader(text: string, names: string[]): string | null {
  if (text.length > 2400 || /\[\/?Evaluation\]/i.test(text)) return null;
  const fields = [...text.matchAll(/\b(author|evaluator|source|model|report|date)\s*[:=]\s*/gi)];
  if (!fields.length) return null;
  const fieldKind = (value: string) => /author|evaluator/i.test(value) ? 'author' : /date/i.test(value) ? 'date' : 'source';
  if (new Set(fields.map(f => fieldKind(f[1]))).size !== fields.length) return null;
  const hits = mentions(text, names);
  const graded = hits.filter((hit, i) => [...text.slice(hit.end, hits[i + 1]?.index ?? text.length).matchAll(pairPattern)].length > 0);
  if (new Set(graded.map(hit => hit.name)).size < 2 || fields.some(f => f.index! >= graded[0].index)) return null;
  const headerStart = fields[0].index!;
  if ([...text.slice(0, headerStart).matchAll(pairPattern)].length) return null;
  // "Warren: Author: Alice" belongs to Warren, even if his grade is later.
  const preamble = text.slice(0, headerStart);
  const lastClause = preamble.slice(Math.max(preamble.lastIndexOf('.'), preamble.lastIndexOf('!'), preamble.lastIndexOf('?'), preamble.lastIndexOf('\n')) + 1);
  if (/\bPlayer\s*:/i.test(lastClause) || mentions(lastClause, names).length && !/\b(?:compare|both|all|versus|vs|and)\b/i.test(lastClause)) return null;
  const header = text.slice(headerStart, graded[0].index);
  return mentions(header, names).length ? null : header;
}
function criterion(value: unknown) {
  const result = label(value, 'criterion label', 60);
  if (prohibitedCriterion.test(result)) throw new Error('Medical risk, availability forecasts and outcome probabilities are not supported decision grades.');
  return result;
}
function bindJudgment(raw: NflSuppliedJudgment, names: string[], context: NflEvaluationContext): NflValidatedJudgment {
  checkKeys(raw, ['player_name', 'criterion', 'value', 'out_of', 'quote', 'author', 'date', 'source', 'metadata_quote'], 'judgment');
  const player_name = canonical(label(raw.player_name, 'player name'), names);
  const c = criterion(raw.criterion);
  const value = number(raw.value, 'grade'), out_of = number(raw.out_of, 'grade scale', Number.EPSILON, 1000);
  if (value > out_of) throw new Error('A supplied grade cannot exceed its stated scale.');
  const { sourceQuote, pair } = resolveGradeQuote(raw.quote, player_name, c, value, out_of, names, context);
  if (prohibitedCriterion.test(sourceQuote.slice(pair.quoteStart, pair.quoteEnd))) throw new Error('A forecast or medical-risk statement cannot be converted into a role grade.');
  let author: string | undefined, date: string | undefined, source: string | undefined;
  const metaQuote = raw.metadata_quote ? quote(raw.metadata_quote, context) : sourceQuote;
  const scopes = metadataScopes(metaQuote, player_name, names, metaQuote === sourceQuote ? pair.scoreIndex : undefined);
  // An excerpt alone cannot prove global scope. Resolve it within the current
  // user message or an already approved full quotation containing this grade.
  const globalContext = [context.userText, ...(context.previous?.bound_quotes ?? [])].find(text => text.includes(sourceQuote) && text.includes(metaQuote) && globalMetadataHeader(text, names) != null);
  if (globalContext) scopes.push(globalMetadataHeader(globalContext, names)!);
  if (raw.author != null) {
    author = label(raw.author, 'evaluation author', 160);
    if (!scopes.some(scope => new RegExp(`(?:author|evaluator|by)\\s*[:=]?\\s*${escape(author!)}(?=$|[\\s,;.])`, 'i').test(scope))) throw new Error('The evaluation author must be explicitly supplied in this player’s block/segment or clearly shared metadata; otherwise leave it absent.');
  }
  if (raw.date != null) {
    date = label(raw.date, 'evaluation date');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date || !scopes.some(scope => new RegExp(`(?:date|dated|on)\\s*[:=]?\\s*${escape(date!)}(?![0-9-])`, 'i').test(scope))) throw new Error('Use an explicitly supplied valid evaluation date in this player’s block/segment or clearly shared metadata, or leave it absent.');
  }
  if (raw.source != null) {
    source = label(raw.source, 'evaluation source', 240);
    if (!scopes.some(scope => new RegExp(`(?:source|model|report)\\s*[:=]?\\s*${escape(source!)}(?=$|[\\s,;.])`, 'i').test(scope))) throw new Error('The evaluation source must be explicitly supplied in this player’s block/segment or clearly shared metadata; otherwise leave it absent.');
  }
  const received = context.receivedAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(received))) throw new Error('Invalid server receipt date.');
  return { ...raw, player_name, criterion: c, value, out_of, quote: sourceQuote, ...(author ? { author } : {}), ...(date ? { date } : {}), ...(source ? { source } : {}), ...(globalContext && (author || date || source) ? { metadata_quote: globalContext } : {}), author_label: author ?? 'Conversation supplied', date_label: date ?? `${received.slice(0,10)} received; evaluation date not supplied`, source_label: source ?? 'User message', attribution_status: 'user_supplied_unverified', metadata_defaults: [...(author ? [] : ['Author not supplied']), ...(date ? [] : ['Receipt date is not the evaluation date']), ...(source ? [] : ['No external model or source connected'])] };
}
function ruleEvidence(text: string, c: string): { minimums: Array<{ value: number; out_of: number }>; weights: number[] } {
  const minimums: Array<{ value: number; out_of: number }> = [], weights: number[] = [];
  for (const match of text.matchAll(word(c))) {
    const after = text.slice(match.index! + match[0].length, match.index! + match[0].length + 110);
    const before = text.slice(Math.max(0, match.index! - 60), match.index);
    const pair = [...after.matchAll(pairPattern)][0];
    const between = pair ? after.slice(0, pair.index).trim() : '';
    const minimumMarker = /(?:minimum|threshold|floor|at least|must (?:reach|be|score))\s*[:=]?\s*$/i.test(before) || /minimum|threshold|floor|at least|must (?:reach|be|score)/i.test(between);
    if (pair && minimumMarker && /^(?:(?:minimum|threshold|floor|at|least|must|reach|be|score|grade|is|of|to|a)\b|[\s:=,()-])*$/i.test(between)) minimums.push({ value: Number(pair[1]), out_of: Number(pair[2]) });
    const following = after.match(/^\s*(?:(?:role|grade|weight|weighted|at|to|is|of|should|be|gets)\s+|[:=]\s*)*(\d+(?:\.\d+)?)\s*(%|percent)(?![A-Za-z])/i);
    const preceding = before.match(/(\d+(?:\.\d+)?)\s*(%|percent)\s*(?:weight\s*(?:on|for)?\s*)?$/i);
    const decimal = after.match(/^\s*(?:weight|weighting)\s*[:=]?\s*(0(?:\.\d+)?|1(?:\.0+)?)(?![\d.])/i);
    const fraction = following ? Number(following[1]) / 100 : preceding ? Number(preceding[1]) / 100 : decimal ? Number(decimal[1]) : null;
    if (fraction != null) weights.push(fraction);
  }
  if (new Set(minimums.map(m => `${m.value}/${m.out_of}`)).size > 1 || new Set(weights).size > 1) throw new Error('Conflicting rules for the same criterion appear in the supplied text. Supply one current weight and minimum; a shorter quote cannot hide the conflict.');
  return { minimums, weights };
}
function bindRule(raw: NflEvaluationRule, context: NflEvaluationContext): NflEvaluationRule {
  checkKeys(raw, ['criterion', 'minimum', 'weight', 'quote'], 'rule');
  const c = criterion(raw.criterion);
  label(raw.quote, 'rule quote hint', 2400);
  if (raw.minimum != null) {
    checkKeys(raw.minimum, ['value', 'out_of'], 'threshold');
    number(raw.minimum.value, 'threshold'); number(raw.minimum.out_of, 'threshold scale', Number.EPSILON, 1000);
    if (raw.minimum.value > raw.minimum.out_of) throw new Error('A threshold cannot exceed its stated scale.');
  }
  if (raw.weight != null) number(raw.weight, 'weight', 0, 1);
  const current = ruleEvidence(context.userText, c);
  if (raw.weight != null && current.weights.length && Math.abs(current.weights[0] - raw.weight) > 1e-9) throw new Error('The criterion weight must match the explicit current user percentage or decimal weight.');
  if (raw.minimum && current.minimums.length && (current.minimums[0].value !== raw.minimum.value || current.minimums[0].out_of !== raw.minimum.out_of)) throw new Error('The threshold must match the literal criterion minimum in the current user quote.');
  const currentComplete = (raw.minimum == null || current.minimums.length > 0) && (raw.weight == null || current.weights.length > 0);
  const sourceQuote = currentComplete && context.userText.length <= 2400 ? context.userText : quote(raw.quote, context);
  const evidence = sourceQuote === context.userText ? current : ruleEvidence(sourceQuote, c);
  if (raw.minimum && (!evidence.minimums.length || evidence.minimums[0].value !== raw.minimum.value || evidence.minimums[0].out_of !== raw.minimum.out_of)) throw new Error('An explicit minimum must match the literal criterion minimum in the user quote.');
  if (raw.weight != null && (!evidence.weights.length || Math.abs(evidence.weights[0] - raw.weight) > 1e-9)) {
    throw new Error('The criterion weight must match an explicit user percentage or decimal weight.');
  }
  if (raw.weight == null && raw.minimum == null) throw new Error('Each supplied rule needs a weight or minimum.');
  return { ...raw, criterion: c, quote: sourceQuote };
}
export function validateNflEvaluationInput(input: unknown, names: string[], context: NflEvaluationContext): { query: NflOptionEvaluationArgs; judgments: NflValidatedJudgment[]; boundQuotes: string[] } {
  checkKeys(input, ['domain', 'role', 'player_names', 'method', 'judgments', 'rules', 'constraints'], 'evaluation');
  if (!['receiver', 'college'].includes(String(input.domain))) throw new Error('Choose receiver or college evaluation.');
  const domain = input.domain as NflOptionEvaluationArgs['domain'];
  const role = label(input.role, 'role or objective', 180);
  if (prohibitedCriterion.test(role)) throw new Error('This evaluator does not predict injury, medical recovery or player outcomes.');
  const sameObjective = context.previous?.query.domain === domain && normalize(context.previous.query.role) === normalize(role);
  const bindingContext = sameObjective ? context : { ...context, previous: undefined };
  const method = (input.method ?? (sameObjective ? context.previous?.query.method : null) ?? 'public_tradeoffs') as NflOptionEvaluationArgs['method'];
  if (!['public_tradeoffs', 'threshold', 'weighted'].includes(String(method))) throw new Error('Choose public_tradeoffs, threshold or weighted.');
  const rawNames = input.player_names ?? (sameObjective ? context.previous?.query.player_names : null) ?? names;
  if (!Array.isArray(rawNames) || rawNames.length < 1 || rawNames.length > 8) throw new Error('Choose one to eight captured options.');
  const player_names = rawNames.map(n => canonical(label(n, 'player name'), names));
  if (new Set(player_names).size !== player_names.length) throw new Error('Do not include a candidate twice.');
  const rawJudgments = input.judgments ?? (sameObjective ? context.previous?.query.judgments?.filter(j => player_names.includes(j.player_name)) : null) ?? [];
  const rawRules = input.rules ?? (sameObjective ? context.previous?.query.rules : null) ?? [];
  if (!Array.isArray(rawJudgments) || rawJudgments.length > 40 || !Array.isArray(rawRules) || rawRules.length > 5) throw new Error('This bounded model supports at most five criteria and forty supplied judgments.');
  const revisions = rawJudgments.map(j => bindJudgment(j, names, bindingContext));
  const priorJudgments = sameObjective && input.judgments != null && rawJudgments.length
    ? (context.previous?.query.judgments ?? []).filter(j => player_names.includes(j.player_name) && !revisions.some(r => r.player_name === j.player_name && normalize(r.criterion) === normalize(j.criterion))).map(j => bindJudgment(j, names, bindingContext)) : [];
  const judgments = [...priorJudgments, ...revisions];
  if (judgments.some(j => !player_names.includes(j.player_name))) throw new Error('A supplied grade refers to a player outside the selected comparison.');
  if (new Set(judgments.map(j => `${j.player_name}:${normalize(j.criterion)}`)).size !== judgments.length) throw new Error('Provide only the current grade for each player and criterion; do not combine conflicting revisions.');
  const rules = rawRules.map(r => bindRule(r, bindingContext));
  if (new Set(rules.map(r => normalize(r.criterion))).size !== rules.length) throw new Error('Provide one rule per criterion.');
  if (method === 'weighted' && rules.length && Math.abs(rules.reduce((sum, r) => sum + (r.weight ?? 0), 0) - 1) > 1e-9) throw new Error('Explicit weights must total one hundred percent. Missing weights are not redistributed.');
  let constraints: NflOptionEvaluationArgs['constraints'];
  const rawConstraints = input.constraints ?? (sameObjective ? context.previous?.query.constraints : null);
  if (rawConstraints != null) {
    checkKeys(rawConstraints, ['internal_only', 'max_incoming_cap', 'max_incoming_cap_operator', 'quote'], 'constraints');
    const sourceQuote = quote(rawConstraints.quote, bindingContext);
    let capOperator: 'lt' | 'lte' | undefined;
    if (rawConstraints.internal_only != null && typeof rawConstraints.internal_only !== 'boolean') throw new Error('Invalid internal-only constraint.');
    if (rawConstraints.internal_only === true && !/internal only|only (?:our|existing|current|internal)|use (?:our|existing|current) (?:players|roster)|already on (?:our|the) roster/i.test(sourceQuote)) throw new Error('Internal-only scope needs an explicit user instruction.');
    if (rawConstraints.max_incoming_cap != null) {
      number(rawConstraints.max_incoming_cap, 'incoming cap limit');
      const amounts = [...sourceQuote.matchAll(moneyPattern)];
      const operators = amounts.flatMap((m, i) => {
        const amount = Number((m[1] ?? m[3]).replaceAll(',', '')) * (/^(million|m)$/i.test(m[2] ?? m[4] ?? '') ? 1e6 : /^(thousand|k)$/i.test(m[2] ?? m[4] ?? '') ? 1e3 : 1);
        if (amount !== rawConstraints.max_incoming_cap) return [];
        const prefix = sourceQuote.slice(i ? amounts[i - 1].index! + amounts[i - 1][0].length : 0, m.index);
        const operator = /\b(under|below|less than|at most|no more than|up to|maximum|max|limit|ceiling)\s*(?:(?:of|is)\s*|[:=]\s*)?$/i.exec(prefix);
        if (!operator || /\bnot\s*$/i.test(prefix.slice(0, operator.index))) return [];
        return [/^(?:under|below|less than)$/i.test(operator[1]) ? 'lt' as const : 'lte' as const];
      });
      if (!/cap/i.test(sourceQuote) || operators.length !== 1) throw new Error('The incoming cap ceiling must match an explicitly supplied money amount and an unambiguous cap-limit instruction.');
      capOperator = operators[0];
      if (rawConstraints.max_incoming_cap_operator != null && rawConstraints.max_incoming_cap_operator !== capOperator) throw new Error('The cap comparison operator must match the literal limit: under/below is strict; at most/ceiling is inclusive.');
    }
    if (rawConstraints.max_incoming_cap == null && rawConstraints.max_incoming_cap_operator != null) throw new Error('A cap comparison operator requires an explicit cap limit.');
    constraints = { ...rawConstraints, ...(capOperator ? { max_incoming_cap_operator: capOperator } : {}), quote: sourceQuote } as NflOptionEvaluationArgs['constraints'];
  }
  const query: NflOptionEvaluationArgs = { domain, role, player_names, method, judgments: judgments.map(({author_label, date_label, source_label, attribution_status, metadata_defaults, ...j}) => j), rules, ...(constraints ? { constraints } : {}) };
  const boundQuotes = [...new Set([...judgments.flatMap(j => [j.quote, ...(j.metadata_quote ? [j.metadata_quote] : [])]), ...rules.map(r => r.quote), ...(constraints ? [constraints.quote] : [])])];
  return { query, judgments, boundQuotes };
}
