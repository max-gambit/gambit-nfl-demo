import { loadNflAuthorityCorpus } from './corpus.js';
import { NFL_AUTHORITY_TOPICS, topicAppliesToPassage } from './topics.js';
import type { NflAuthorityCorpus, NflAuthorityDomain, NflAuthorityQuery, NflAuthoritySearchResult } from './types.js';

const stopwords = new Set('a an and are as at be been by can could did do does for from has have how i if in into is it its may me my nfl of on or our player players rule rules say says should team teams that the their them these this to us was we were what when which who why will with would you your year years season seasons explain about under many difference between only same now go work after before'.split(' '));
const normalize = (text: string) => text.toLowerCase().normalize('NFKD').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
function stem(term: string): string {
  const aliases: Record<string, string> = { prorated: 'prorat', proration: 'prorat', prorate: 'prorat', prorating: 'prorat', amortization: 'prorat', amortized: 'prorat', guaranteed: 'guarantee', guarantees: 'guarantee', guaranteeing: 'guarantee', waived: 'waiver', waivers: 'waiver', traded: 'trade', trading: 'trade', trades: 'trade', released: 'release', releasing: 'release', catches: 'catch', caught: 'catch', tenders: 'tender', tendered: 'tender', fifth: 'fifth', '5th': 'fifth', cut: 'release', cuts: 'release', touchdowns: 'touchdown', salaries: 'salary' };
  if (aliases[term]) return aliases[term];
  return term.length > 4 && term.endsWith('s') && !term.endsWith('ss') ? term.slice(0, -1) : term;
}
function tokens(text: string): string[] { return normalize(text).split(' ').filter(t => t.length > 1 && !stopwords.has(t) && !/^20\d\d$/.test(t)).map(stem); }
const hasPhrase = (text: string, phrase: string) => ` ${normalize(text)} `.includes(` ${normalize(phrase)} `);

interface PreparedIndex {
  corpus: NflAuthorityCorpus;
  terms: Array<Map<string, number>>;
  lengths: number[];
  frequencies: Map<string, number>;
  meanLength: number;
}
let prepared: PreparedIndex | undefined;
function prepare(corpus: NflAuthorityCorpus): PreparedIndex {
  if (prepared?.corpus === corpus) return prepared;
  const frequencies = new Map<string, number>();
  const lengths: number[] = [];
  const terms = corpus.passages.map(p => {
    const words = tokens(p.text); // Search the source passage, not just its title.
    lengths.push(words.length);
    const counts = new Map<string, number>();
    for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
    for (const word of counts.keys()) frequencies.set(word, (frequencies.get(word) ?? 0) + 1);
    return counts;
  });
  return prepared = { corpus, terms, lengths, frequencies, meanLength: lengths.reduce((a, b) => a + b, 0) / lengths.length };
}

/** Deterministic BM25 passage retrieval with explicit topic, year and league boundaries. */
export async function searchNflAuthorityPassages(query: NflAuthorityQuery): Promise<NflAuthoritySearchResult> {
  const corpus = await loadNflAuthorityCorpus();
  const base = { captured_at: corpus.captured_at, topic_ids: [] as string[], matches: [], caveats: [] as string[] };
  const unsupported = (reason: string): NflAuthoritySearchResult => ({ ...base, status: 'unsupported', reason });
  const question = query.question?.trim().slice(0, 5000) ?? '';
  if (!question) return unsupported('Specify an NFL contract, roster, playing-rule or league-date question.');
  if (/\b(?:nba|wnba|nbpa|basketball|mlb|nhl|ncaa|second apron|first apron|bird rights|mid[- ]level exception)\b/i.test(question)) return unsupported('This index contains NFL authority only; it cannot establish another league’s rules or a cross-league comparison.');
  if (/\b(?:best|worst|better player|asking price|trade targets?|medical prognosis|player rankings?)\b/i.test(question)) return unsupported('NFL authority sources cannot establish player evaluations, medical findings, availability or current asking prices.');
  if (query.domain && !['cba', 'playing_rules', 'league_dates'].includes(query.domain)) return unsupported('The requested NFL authority domain is not supported.');
  const topics = NFL_AUTHORITY_TOPICS.filter(topic => topic.aliases.some(alias => hasPhrase(question, alias)));
  base.topic_ids = topics.map(t => t.id);
  const words = [...new Set(tokens(question))];
  if (!words.length) return unsupported('The question does not identify a searchable authority topic.');
  const years = [...new Set((question.match(/\b20\d\d\b/g) ?? []).map(Number))];
  const activeDomains = new Set<NflAuthorityDomain>(query.domain ? [query.domain] : topics.flatMap(topic => [...topic.domains]));
  if (!activeDomains.size) for (const domain of ['cba', 'playing_rules', 'league_dates'] as const) activeDomains.add(domain);
  const isDateQuestion = !query.domain && /^(?:when\b|what\b.*(?:deadline|date|league year|free agency)|(?:show|list)\b.*(?:date|calendar|deadline))/i.test(question) && topics.some(t => t.domains.includes('league_dates'));
  if (isDateQuestion) { activeDomains.clear(); activeDomains.add('league_dates'); }
  if (activeDomains.size === 1 && activeDomains.has('playing_rules') && years.some(y => y !== 2026)) return unsupported('Only the 2026 playing-rule edition is indexed. It cannot establish an earlier or later season’s rule.');
  if (years.some(y => y > 2030) && !activeDomains.has('playing_rules')) return unsupported('That year is outside the captured CBA/calendar coverage. No future rule or deadline is inferred.');
  const index = prepare(corpus);
  const sourceMap = new Map(corpus.sources.map(source => [source.id, source]));
  const expanded = new Set(topics.flatMap(t => t.terms.flatMap(tokens)).filter(t => !words.includes(t)));
  const defaultYear = Number(corpus.captured_at.slice(0, 4));
  const requestedLocators = question.match(/\b(?:article|section|rule)\s+\d+/gi) ?? [];
  const tradeDeadline = (isDateQuestion || query.domain === 'league_dates') && /\b(?:trade|trading)\b/i.test(question) && /\b(?:deadline|ends?)\b/i.test(question);
  const leagueYearStart = /\bleague year\b/i.test(question) && /\b(?:start|begins?)\b/i.test(question);
  const calendarRelevant = (text: string) => (!tradeDeadline || /All trading ends/i.test(text)) && (!leagueYearStart || /League Year.*?begins/i.test(text));
  const scores = corpus.passages.flatMap((passage, i) => {
    if (!activeDomains.has(passage.domain)) return [];
    if (passage.domain === 'playing_rules' && years.some(y => y !== 2026)) return [];
    if (passage.domain === 'league_dates' && !(years.length ? years : [defaultYear]).includes(passage.season_year ?? -1)) return [];
    if (passage.domain === 'league_dates' && !calendarRelevant(passage.text)) return [];
    if (topics.some(t => t.id === 'fifth_year_option') && years.some(y => y === 2016 || y === 2017) && !years.some(y => y >= 2018)
      && /2018 or any subsequent Draft/.test(passage.text) && !/2016 or 2017/.test(passage.text)) return [];
    if (passage.text.length < 90) return []; // Exclude headings; dated one-line rules are handled below.
    return [{ passage, i }];
  });
  // Short dated deadlines are substantive even when shorter than a PDF heading window.
  corpus.passages.forEach((passage, i) => {
    if (activeDomains.has('league_dates') && passage.domain === 'league_dates' && passage.text.length < 90 && calendarRelevant(passage.text) && (years.length ? years : [defaultYear]).includes(passage.season_year ?? -1)) scores.push({ passage, i });
  });
  const matches = scores.flatMap(({ passage, i }) => {
    const counts = index.terms[i];
    const matched = words.filter(word => counts.has(word));
    const boundTopics = topics.filter(topic => topicAppliesToPassage(topic, passage));
    const locatorMatch = requestedLocators.length > 0 && requestedLocators.every(locator => hasPhrase(passage.locator, locator));
    // A topic hint cannot make an unrelated passage pass the evidence gate.
    if (!locatorMatch && (matched.length === 0 || (!boundTopics.length && (matched.length < 2 || matched.length / words.length < 0.28)))) return [];
    const bm25 = (term: string) => {
      const tf = counts.get(term) ?? 0;
      if (!tf) return 0;
      const df = index.frequencies.get(term) ?? 0;
      const idf = Math.log(1 + (corpus.passages.length - df + 0.5) / (df + 0.5));
      return idf * (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * index.lengths[i] / index.meanLength));
    };
    let score = words.reduce((sum, word) => sum + bm25(word), 0);
    score += [...expanded].reduce((sum, word) => sum + 0.16 * bm25(word), 0);
    score += boundTopics.length ? 6 + Math.min(6, boundTopics.length * 2) : 0;
    score += locatorMatch ? 20 : 0;
    for (const topic of boundTopics) {
      score += topic.terms.filter(term => hasPhrase(passage.text, term)).length * 1.1;
      for (const alias of topic.aliases) if (hasPhrase(question, alias) && hasPhrase(passage.text, alias)) score += 2;
    }
    if (passage.source_id === 'nfl-contract-guarantees-guide' && topics.some(t => t.id === 'guarantees') && !topics.some(t => t.id === 'fifth_year_option')) score += 14;
    if (topics.some(t => t.id === 'bonus_proration') && /maximum proration of five years/.test(passage.text)) score += 12;
    if (topics.some(t => t.id === 'bonus_proration') && /when such payments are actually made/.test(passage.text) && /\bcash\b/i.test(question)) score += 30;
    if (topics.some(t => t.id === 'fifth_year_option') && /2018 or any subsequent Draft/.test(passage.text) && /effective upon the Club’s exercise/.test(passage.text)) score += 18;
    if (topics.some(t => t.id === 'fifth_year_option')) {
      const olderClass = years.some(year => year === 2016 || year === 2017);
      if (!olderClass && /2016 or 2017/.test(passage.text)) score -= 18;
      if (olderClass && /2018 or any subsequent Draft/.test(passage.text) && !/2016 or 2017/.test(passage.text)) score -= 25;
    }
    if (topics.some(t => t.id === 'rfa_erfa') && passage.locator.startsWith('Article 9, Section 2')) score += 10;
    if (topics.some(t => t.id === 'catch') && passage.locator === 'Rule 8, Section 1, Article 3' && /^ARTICLE 3\./.test(passage.text)) score += 10;
    if (topics.some(t => t.id === 'overtime') && /regular[- ]season/i.test(question) && passage.locator === 'Rule 16, Section 1, Article 3') score += 15;
    if (topics.some(t => t.id === 'practice_squad') && passage.domain === 'league_dates' && /Practice Squad of 17/.test(passage.text)) score += 18;
    if (topics.some(t => t.id === 'practice_squad') && passage.locator === 'Article 33, Section 1' && /shall not exceed fourteen/.test(passage.text)) score += 12;
    // Avoid letting generic cap terms crowd out the controlling June 1 subsection.
    if (topics.some(t => t.id === 'june_1') && /June 1|June 2/.test(passage.text) && passage.locator === 'Article 13, Section 6') score += 18;
    return [{ passage, source: sourceMap.get(passage.source_id)!, score: Math.round(score * 1000) / 1000, matched_terms: matched, topic_ids: boundTopics.map(t => t.id) }];
  }).sort((a, b) => b.score - a.score || a.passage.id.localeCompare(b.passage.id));
  if (!matches.length || matches[0].score < 7) return unsupported('No sufficiently relevant passage was found in the captured NFL sources. No rule, date or calculation is inferred.');
  const limit = Number.isFinite(query.limit) ? Math.max(1, Math.min(8, Math.floor(query.limit!))) : 5;
  const selected = matches.filter(match => match.score >= Math.max(7, matches[0].score * 0.42)).slice(0, limit);
  const caveats = [
    `Sources were captured ${corpus.captured_at.slice(0, 10)}. Search retrieves bounded passages; it does not verify current player-specific terms or consolidate every later amendment.`,
    ...topics.flatMap(t => t.caveat ? [t.caveat] : []),
    ...new Set(selected.map(m => m.source.authority_boundary)),
  ];
  if (selected.some(m => m.passage.continues_before || m.passage.continues_after)) caveats.push('Some passages continue across windows or pages. Open the cited section for surrounding clauses, exceptions and exhibit layout before treating an excerpt as a complete rule.');
  return { status: 'supported', reason: null, captured_at: corpus.captured_at, matches: selected, topic_ids: base.topic_ids, caveats };
}
