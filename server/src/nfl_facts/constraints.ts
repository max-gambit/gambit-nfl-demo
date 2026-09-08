import type { NflFactualQuery, NflRosterNumericField, NflRosterNumericFilter } from '@shared/nflFacts';
import type { NflDemoSeed } from '../nfl_data/seed.js';
import { TEAM_ALIASES } from '../context_graph/schema.js';
import { positionGroupsFromQuestion, teamIdsFromQuestion } from '../nfl_transactions/question.js';

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const words: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50 };
const valuePattern = String.raw`\$?\s*\d[\d,]*(?:\.\d+)?\s*(?:(?:million|thousand|m|k)\b)?`;
const fieldPattern = String.raw`(?:age|years? old|(?:20\d{2}\s+)?(?:cap(?:\s+(?:hit|number))?|starts?|snaps?|games?)(?:\s+(?:(?:in|during|from|for)\s+)?20\d{2})?)`;
const operatorPattern = String.raw`(?:no more than|no fewer than|at least|at most|less than|fewer than|more than|younger than|older than|minimum(?:\s+of)?|maximum(?:\s+of)?|up to|under(?:\s+age)?|over(?:\s+age)?|below|above|exactly|>=|<=|>|<|=)`;

function fieldFrom(value: string): NflRosterNumericField | null {
  if (/\bage\b|years? old|younger|older/i.test(value)) return 'age';
  if (/\bcap\b/i.test(value)) return 'cap_2026';
  if (/\bstarts?\b/i.test(value)) return 'starts_2025';
  if (/\bsnaps?\b/i.test(value)) return 'snaps_2025';
  if (/\bgames?\b/i.test(value)) return 'games_2025';
  return null;
}

function operatorFrom(value: string): NflRosterNumericFilter['operator'] {
  if (/^(?:at least|no fewer than|minimum|>=)/i.test(value)) return 'gte';
  if (/^(?:at most|no more than|maximum|up to|<=)/i.test(value)) return 'lte';
  if (/^(?:under|below|less|fewer|younger|<)/i.test(value)) return 'lt';
  if (/^(?:over|above|more|older|>)/i.test(value)) return 'gt';
  return 'eq';
}

function numericValue(value: string): number {
  const amount = Number(value.replace(/[^\d.]/g, ''));
  return amount * (/million|m\b/i.test(value) ? 1e6 : /thousand|k\b/i.test(value) ? 1e3 : 1);
}

/** Every material word must belong to a supported selection. Unknown conditions
 * stop the selection; listing applied filters is not permission to drop others.
 */
export function applyRosterConstraints(question: string, query: NflFactualQuery, seed: NflDemoSeed): NflFactualQuery {
  let remaining = question.replace(/[’‘]/g, "'").replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/\blast (?:season|year)\b/gi, '2025').replace(/\b[a-z]+\b/gi, value => value.toLowerCase() in words ? String(words[value.toLowerCase()]) : value);
  const unresolved = [...(query.unresolved_constraints ?? [])];
  const snapshotYear = seed.season.match(/\b20\d{2}\b/)?.[0];
  const filters: NflRosterNumericFilter[] = [];
  const previousFilters = query.numeric_filters ?? [
    ...(query.max_cap == null ? [] : [{ field: 'cap_2026', operator: 'lte', value: query.max_cap } as const]),
    ...(query.min_starts == null ? [] : [{ field: 'starts_2025', operator: 'gte', value: query.min_starts } as const]),
  ];
  query.numeric_filters = [...previousFilters];
  const consume = (pattern: RegExp, fn?: (match: RegExpExecArray) => void) => {
    remaining = remaining.replace(pattern, (...args: unknown[]) => {
      const match = args.slice(0, -2) as unknown as RegExpExecArray;
      fn?.(match);
      return ' ';
    });
  };
  consume(/^\s*what about\b/gi);
  // These totals cover the whole historical season. A team attached to that
  // usage clause cannot be implemented as a current-roster team predicate.
  const historicalTeamClause = remaining.match(/\b(?:starts?|snaps?|games?|played)\b[^.!?;]*?\b(?:for|with|on)\s+(.+?)(?=[.!?;]|$)/i);
  if (historicalTeamClause && teamIdsFromQuestion(historicalTeamClause[1]).length) unresolved.push(`historical team usage: ${historicalTeamClause[0].trim()}`);

  // Count attached to an ordering phrase: "the 10 highest cap hits".
  consume(/\b(?:the\s+)?(\d+)\s+(?=(?:highest|lowest|most|fewest|largest|smallest|youngest|oldest)\b)/gi, match => {
    const limit = Number(match[1]);
    if (limit < 1 || limit > 50) unresolved.push(`show ${limit} players (maximum 50 per answer)`);
    else query.limit = limit;
  });
  // Explicit removal is the only way a blocked follow-up loses its condition.
  consume(/\b(?:remove|drop|ignore|clear)\s+(?:the\s+)?(age|cap|starts?|snaps?|games?|health|healthy|injury|availability|all)\s+(?:filters?|limits?|conditions?|constraints?)\b/gi, match => {
    const field = fieldFrom(match[1]);
    if (match[1].toLowerCase() === 'all') {
      query.numeric_filters = []; query.excluded_team_ids = []; query.excluded_player_names = []; query.roster_statuses = []; unresolved.length = 0;
    } else {
      query.numeric_filters = query.numeric_filters!.filter(filter => filter.field !== field);
      for (let index = unresolved.length - 1; index >= 0; index--) {
        if (new RegExp(escape(match[1].replace(/s$/, '')), 'i').test(unresolved[index])) unresolved.splice(index, 1);
      }
    }
  });
  consume(/\b(?:remove|drop|ignore|clear)\s+(?:the\s+)?(.+?)\s+(?:filters?|conditions?|constraints?)(?=[.!?;]|$)/gi, match => {
    const terms = match[1].toLowerCase().match(/[a-z0-9]+/g) ?? [];
    const indexes = unresolved.flatMap((value, index) => terms.length && terms.every(term => value.toLowerCase().includes(term)) ? [index] : []);
    if (!indexes.length) unresolved.push(`remove ${match[1]}`);
    for (const index of indexes.reverse()) unresolved.splice(index, 1);
  });
  // OR and negated comparisons need a predicate tree, not a conjunction or a
  // flipped comparison guessed from nearby words.
  if (/\bor\b|\b(?:not|don't|do not|never)\s+(?:under|over|above|below|more|less|at least|at most)\b/i.test(remaining)) unresolved.push('alternative or negated conditions');

  const add = (fieldText: string, operator: string, value: string) => {
    let field = fieldFrom(fieldText);
    if (!field && /\$|\b(?:million|thousand|m|k)\b/i.test(value)) field = 'cap_2026';
    const year = fieldText.match(/\b20\d{2}\b/)?.[0];
    if (!field || (year && year !== (field === 'cap_2026' ? '2026' : '2025'))) {
      unresolved.push(`${fieldText} ${operator} ${value}`.trim()); return;
    }
    const number = numericValue(value);
    if (!Number.isFinite(number) || number < 0 || (field !== 'cap_2026' && (!Number.isInteger(number) || /\$|million|thousand|\b[mk]\b/i.test(value)))) {
      unresolved.push(`${fieldText} ${operator} ${value}`.trim()); return;
    }
    filters.push({ field, operator: operatorFrom(operator), value: number });
  };
  const addRange = (field: string, lower: string, upper: string) => {
    if (numericValue(lower) > numericValue(upper)) unresolved.push(`${field} between ${lower} and ${upper}`);
    else { add(field, 'at least', lower); add(field, 'at most', upper); }
  };
  consume(new RegExp(`\\b(${fieldPattern})\\s+between\\s+(${valuePattern})\\s+and\\s+(${valuePattern})`, 'gi'), match => addRange(match[1], match[2], match[3]));
  consume(new RegExp(`\\bbetween\\s+(${valuePattern})\\s+and\\s+(${valuePattern})\\s+(${fieldPattern})`, 'gi'), match => addRange(match[3], match[1], match[2]));
  // Both orders are supported: "cap under $5m" and "under $5m in 2026 cap".
  consume(new RegExp(`\\b(${fieldPattern})\\s*(?:of\\s+)?(${operatorPattern})\\s*(${valuePattern})`, 'gi'), match => add(match[1], match[2], match[3]));
  consume(new RegExp(`(${operatorPattern})\\s*(${valuePattern})(?:\\s+(?:in|of)\\s+|\\s*)(${fieldPattern})`, 'gi'), match => add(match[3], match[1], match[2]));
  consume(new RegExp(`\\b(younger than|older than|under age|over age)\\s*(${valuePattern})`, 'gi'), match => add('age', match[1], match[2]));
  consume(new RegExp(`(${operatorPattern})\\s*(\\$\\s*\\d[\\d,]*(?:\\.\\d+)?\\s*(?:(?:million|thousand|m|k)\\b)?)`, 'gi'), match => add('cap', match[1], match[2]));
  // Bare "under 30" is only unambiguous after an age-only numeric selection.
  consume(new RegExp(`(${operatorPattern})\\s*(${valuePattern})`, 'gi'), match => {
    const fields = [...new Set(query.numeric_filters!.map(filter => filter.field))];
    if (/\$|\b(?:million|thousand|m|k)\b/i.test(match[2])) add('cap', match[1], match[2]);
    else if (fields.length === 1) add(fields[0] === 'cap_2026' ? 'cap' : fields[0].split('_')[0], match[1], match[2]);
    else unresolved.push(`${match[1]} ${match[2]}`.trim());
  });
  if (filters.length) {
    const bound = (operator: NflRosterNumericFilter['operator']) => ['lt','lte'].includes(operator) ? 'upper' : ['gt','gte'].includes(operator) ? 'lower' : 'exact';
    query.numeric_filters = [...query.numeric_filters.filter(previous => !filters.some(next => next.field === previous.field && (next.operator === 'eq' || bound(next.operator) === bound(previous.operator)))), ...filters];
  }
  // Legacy fields are retained for old saved answers, but the typed predicates
  // now own execution, including strict versus inclusive boundaries.
  query.max_cap = query.numeric_filters.find(filter => filter.field === 'cap_2026' && ['lt','lte'].includes(filter.operator))?.value ?? null;
  query.min_starts = query.numeric_filters.find(filter => filter.field === 'starts_2025' && ['gt','gte'].includes(filter.operator))?.value ?? null;

  const names = [...new Set(seed.roster_entries.map(row => row.player_name))];
  consume(/\b(?:exclude|excluding|except(?: for)?|without)\s+(.+?)(?=\s+(?:with|under|over|at least|at most|sorted|sort|ordered|order)\b|[;.!?]|$)/gi, match => {
    const subject = match[1].trim();
    const teams = teamIdsFromQuestion(subject);
    const players = names.filter(name => new RegExp(`\\b${escape(name)}\\b`, 'i').test(subject));
    let rest = subject;
    for (const [alias] of Object.entries(TEAM_ALIASES).sort(([a],[b]) => b.length-a.length)) rest = rest.replace(new RegExp(`\\b${escape(alias)}\\b`, alias.length <= 3 ? 'g' : 'gi'), ' ');
    for (const name of players) rest = rest.replace(new RegExp(escape(name), 'gi'), ' ');
    rest = rest.replace(/\b(?:the|and|players|teams)\b|[,\s]/gi, '');
    if ((!teams.length && !players.length) || rest) { unresolved.push(`exclude ${subject}`); return; }
    query.excluded_team_ids = [...new Set([...(query.excluded_team_ids ?? []), ...teams])];
    query.excluded_player_names = [...new Set([...(query.excluded_player_names ?? []), ...players])];
    // Keep the positive cohort even when the exclusion empties it. Positive
    // entities are resolved from the question with exclusion clauses removed.
  });
  consume(/\b(?:only\s+)?active(?:[- ]roster)?(?:\s+players)?\b/gi, () => { query.roster_statuses = ['active']; });
  consume(/\b(?:all|any)\s+roster\s+statuses\b/gi, () => { query.roster_statuses = []; });
  consume(/\boutside (?:the )?(?:giants|nyg)\b/gi);
  consume(/\bother (?:nfl )?teams\b/gi);
  consume(/\b(?:youngest|oldest)\b/gi, match => { query.sort = match[0].toLowerCase() === 'youngest' ? 'age_asc' : 'age_desc'; });
  consume(/\b(?:sort|order)(?:ed)?\s+by\s+age(?:\s*[,;]?\s*(ascending|descending|lowest first|highest first))?/gi, match => { query.sort = /descending|highest/i.test(match[1] ?? '') ? 'age_desc' : 'age_asc'; });
  consume(/\b(?:after|post[- ]?)\s*june\s*1\b|\b(?:before|pre[- ]?)\s*june\s*1\b/gi);
  consume(/\b(most|highest|largest|biggest|lowest|smallest|least|fewest)\s+(?:recorded\s+)?(?:(20\d{2})\s+)?(cap(?:\s+(?:hits?|numbers?))?|starts?|snaps?|games?)\b/gi, match => {
    const field = fieldFrom(match[3])!;
    if (match[2] && match[2] !== (field === 'cap_2026' ? '2026' : '2025')) unresolved.push(`${match[2]} ${match[3]}`);
    const suffix = /lowest|smallest|least|fewest/i.test(match[1]) ? 'asc' : 'desc';
    query.sort = `${field.split('_')[0]}_${suffix}` as NflFactualQuery['sort'];
  });
  consume(/\b(cap(?:\s+(?:hits?|numbers?))?|starts?|snaps?|games?)\s*[,;]?\s*(lowest first|highest first|ascending|descending)\b/gi, match => {
    query.sort = `${fieldFrom(match[1])!.split('_')[0]}_${/lowest|ascending/i.test(match[2]) ? 'asc' : 'desc'}` as NflFactualQuery['sort'];
  });
  consume(/\b(?:sort|order)(?:ed)?\s+(?:them\s+)?by\s+(?:recorded\s+)?(?:(20\d{2})\s+)?(cap(?:\s+(?:hits?|numbers?))?|starts?|snaps?|games?)\b/gi, match => {
    const field = fieldFrom(match[2])!;
    if (match[1] && match[1] !== (field === 'cap_2026' ? '2026' : '2025')) unresolved.push(`${match[1]} ${match[2]}`);
    query.sort = `${field.split('_')[0]}_${field === 'cap_2026' ? 'asc' : 'desc'}` as NflFactualQuery['sort'];
  });
  // The snapshot can answer only these seasons; a year qualifier must remain
  // attached to the requested field rather than being ignored as a number.
  consume(/\b(20\d{2})\s+(cap(?:\s+(?:hits?|numbers?))?|starts?|snaps?|games?|usage|season|roster)\b/gi, match => {
    const valid = /cap|roster/i.test(match[2]) ? snapshotYear : '2025';
    if (match[1] !== valid) unresolved.push(`${match[1]} ${match[2]}`);
  });
  consume(/\b(starts?|snaps?|games?|usage|cap(?:\s+(?:hits?|numbers?))?)\s+(?:in|from|during|for)\s+(20\d{2})\b/gi, match => {
    if (match[2] !== (/cap/i.test(match[1]) ? snapshotYear : '2025')) unresolved.push(`${match[1]} in ${match[2]}`);
  });
  // Entity removal uses the same roster and team identities as selection.
  const surnameCounts = new Map<string, number>();
  for (const name of names) { const last = name.split(' ').at(-1)!.toLowerCase(); surnameCounts.set(last, (surnameCounts.get(last) ?? 0) + 1); }
  for (const name of names.sort((a,b) => b.length-a.length)) {
    if (remaining.toLowerCase().includes(name.toLowerCase())) remaining = remaining.replace(new RegExp(`\\b${escape(name)}\\b`, 'gi'), ' ');
    const last = name.split(' ').at(-1)!;
    if (last.length >= 4 && surnameCounts.get(last.toLowerCase()) === 1 && remaining.toLowerCase().includes(last.toLowerCase())) remaining = remaining.replace(new RegExp(`\\b${escape(last)}\\b`, 'gi'), ' ');
  }
  for (const [alias] of Object.entries(TEAM_ALIASES).sort(([a],[b]) => b.length-a.length)) remaining = remaining.replace(new RegExp(`\\b${escape(alias)}\\b`, alias.length <= 3 ? 'g' : 'gi'), ' ');
  // A group is consumed only if the shared position resolver recognized it.
  const positionPhrases = /\b(?:interior offensive line(?:m[ae]n)?|interior o-?line(?:m[ae]n)?|interior defensive line(?:m[ae]n)?|defensive tackles?|nose tackles?|offensive tackles?|edge rushers?|edge defenders?|wide receivers?|running[- ]backs?|tight ends?|long snappers?|special teams?|quarterbacks?|linebackers?|cornerbacks?|corners?|defensive backs?|safet(?:y|ies)|tailbacks?|receivers?|guards?|centers?|kickers?|punters?|edges?|qbs?|rbs?|wrs?|tes?|ots?|iols?|idls?|lbs?|cbs?|dbs?|sts?)\b/gi;
  consume(positionPhrases, match => { if (!positionGroupsFromQuestion(match[0]).length) unresolved.push(match[0]); });
  consume(/\b(?:show|list|first|top|include|which)\s+(?:me\s+)?(\d+)\b/gi, match => {
    const limit = Number(match[1]);
    if (limit < 1 || limit > 50) unresolved.push(`show ${limit} players (maximum 50 per answer)`);
    else query.limit = limit;
  });
  consume(/\b(?:alphabetical(?:ly)?|player name|a\s*[-–]\s*z)\b/gi, () => { query.sort = 'name'; });
  // Role coverage is explicitly hypothetical and reports missing assignments.
  if (query.hypothetical_unavailable) consume(/\b(?:unavailable|injured|injury|missing time|limited|knee|roles?|cover|coverage|replacements?|receiving|this week|would need)\b/gi);
  // Non-conditional prose contains no additional selection semantics. Unknown
  // adjectives, fields, numbers or names survive this list and require clarity.
  remaining = remaining.replace(/\b(?:please|can|could|would|if|we|i|us|me|the|a|an|and|of|in|on|to|for|from|by|with|that|those|these|their|them|it|this|be|are|is|were|have|has|had|played|made|wanted|want|need|should|which|what|how|who|show|list|give|display|compare|comparison|between|include|only|filter|keep|now|instead|also|first|all|matching|records?|players?|roster|current|currently|loaded|nfl|league|leaguewide|league-wide|across|teams?|excluding nyg|veterans?|investigate|add|acquire|acquisition|targets?|trade for|cap|hit|hits|number|numbers|contracts?|starts?|snaps?|games?|usage|recorded|sort|order|ordered|sorted|release|releasing|cut|restructure|restructuring|trade|trading|savings|save|money|dead|effect)\b/gi, ' ');
  remaining = remaining.replace(/[\s,.!?;:()–—-]+/g, ' ').trim();
  if (remaining) unresolved.push(remaining);
  query.unresolved_constraints = [...new Set(unresolved)];
  return query;
}

export function numericMatches(value: number | null | undefined, filter: NflRosterNumericFilter): boolean {
  if (value == null || !Number.isFinite(value)) return false;
  switch (filter.operator) {
    case 'lt': return value < filter.value;
    case 'lte': return value <= filter.value;
    case 'gt': return value > filter.value;
    case 'gte': return value >= filter.value;
    case 'eq': return value === filter.value;
  }
}

export function numericFilterLabel(filter: NflRosterNumericFilter): string {
  const fields: Record<NflRosterNumericField, string> = { age: 'recorded age', cap_2026: '2026 cap', starts_2025: '2025 starts', snaps_2025: '2025 snaps', games_2025: '2025 games' };
  const operators = { lt: '<', lte: '≤', gt: '>', gte: '≥', eq: '=' };
  const value = filter.field === 'cap_2026' ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(filter.value) : filter.value.toLocaleString();
  return `${fields[filter.field]} ${operators[filter.operator]} ${value}`;
}
