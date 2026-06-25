import type {
  CbaChunk,
  CbaCitation,
  CbaDocument,
  CbaSearchContextPayload,
  CbaSearchMatchKind,
  CbaSection,
  CbaSupportLevel,
} from '@shared/types';
import cbaAliasConfig from '../../../data/cba/aliases.json';

export interface CbaSeedSection extends CbaSection {
  chunks?: CbaChunk[];
}

export interface CbaSeedCorpus {
  document: CbaDocument;
  sections: CbaSeedSection[];
}

export interface CbaSearchContext {
  section: CbaSection;
  chunk: CbaChunk;
  score: number;
  match_kind: CbaSearchMatchKind;
  support_level: CbaSupportLevel;
}

export interface CbaAliasGroup {
  terms: string[];
  aliases: string[];
}

export interface CbaAliasConfig {
  query_groups?: CbaAliasGroup[];
  section_aliases?: Record<string, string[]>;
}

export interface CbaSectionSearchMatch {
  section: CbaSection;
  score: number;
  snippet: string;
  match_terms: string[];
}

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has',
  'have', 'how', 'in', 'is', 'it', 'of', 'on', 'or', 'that', 'the', 'this',
  'to', 'under', 'what', 'when', 'where', 'which', 'who', 'why', 'with',
  'tell', 'show', 'find',
]);

const DEFAULT_CBA_ALIAS_CONFIG = normalizeAliasConfig(cbaAliasConfig as CbaAliasConfig);
const DEFAULT_MIN_CHUNK_SCORE = 24;
const MEDIUM_SUPPORT_SCORE = 70;
const STRONG_SUPPORT_SCORE = 180;

const TEAM_OR_LIVE_CONTEXT_RE =
  /\b(we|our|us|warriors|celtics|lakers|bucks|hawks|hornets|wizards|knicks|current roster|cap sheet|payroll|tax line|which apron are|available exception|can we trade|should we trade|trade for|trade away|sign him|re-sign him)\b/i;

const PURE_RULE_NAV_RE =
  /\b(where|defined|definition|section|article|what does|how does|explain|rule|rules|cba)\b/i;

export function normalizeCbaSeedCorpus(
  seed: CbaSeedCorpus,
  aliasConfig: CbaAliasConfig = DEFAULT_CBA_ALIAS_CONFIG,
): CbaSeedCorpus {
  const normalizedAliasConfig = normalizeAliasConfig(aliasConfig);
  return {
    document: {
      ...seed.document,
      page_count: Number(seed.document.page_count),
    },
    sections: seed.sections
      .map((section, index) => {
        const body = normalizeWhitespace(section.body);
        return {
          ...section,
          body,
          sort_key: Number(section.sort_key ?? index + 1),
          aliases: mergeAliases(section.aliases ?? [], normalizedAliasConfig.section_aliases?.[section.id] ?? []),
          chunks: section.chunks?.length
            ? section.chunks.map((chunk) => ({ ...chunk, body: normalizeWhitespace(chunk.body) }))
            : chunkSectionBody({ ...section, body }),
        };
      })
      .sort((a, b) => a.sort_key - b.sort_key || a.id.localeCompare(b.id)),
  };
}

export function chunkSectionBody(
  section: Pick<CbaSection, 'id' | 'body' | 'page_start' | 'page_end'>,
  maxWords = 190,
  overlapWords = 35,
): CbaChunk[] {
  const words = normalizeWhitespace(section.body).split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [{
      id: `${section.id}::chunk-1`,
      article_id: section.id,
      chunk_index: 1,
      body: '',
      page_start: section.page_start,
      page_end: section.page_end,
    }];
  }

  const chunks: CbaChunk[] = [];
  const stride = Math.max(40, maxWords - overlapWords);
  for (let start = 0; start < words.length; start += stride) {
    const slice = words.slice(start, start + maxWords);
    if (slice.length === 0) break;
    chunks.push({
      id: `${section.id}::chunk-${chunks.length + 1}`,
      article_id: section.id,
      chunk_index: chunks.length + 1,
      body: slice.join(' '),
      page_start: section.page_start,
      page_end: section.page_end,
    });
    if (start + maxWords >= words.length) break;
  }
  return chunks;
}

export function searchCbaSections(
  sections: CbaSection[],
  query: string,
  limit = 24,
): CbaSection[] {
  return searchCbaSectionMatches(sections, query, limit).map((item) => item.section);
}

export function searchCbaSectionMatches(
  sections: CbaSection[],
  query: string,
  limit = 24,
): CbaSectionSearchMatch[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return sections.slice(0, limit).map((section) => ({
      section,
      score: 0,
      snippet: '',
      match_terms: [],
    }));
  }
  const expanded = expandQuery(trimmed);
  return sections
    .map((section) => {
      const metadataScore = scoreText(sectionMetadataSearchText(section), expanded) * 2.2;
      const bodyScore = scoreText(section.body, expanded) * 0.25;
      const boost = sectionIntentBoost(trimmed, section);
      const matchTerms = matchTermsForText(sectionSearchText(section), expanded);
      return {
        section,
        score: metadataScore + bodyScore + boost,
        snippet: buildSearchSnippet(section.body, expanded),
        match_terms: matchTerms,
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.section.sort_key - b.section.sort_key)
    .slice(0, limit);
}

export function searchCbaChunks(
  chunks: CbaChunk[],
  sectionsById: Map<string, CbaSection>,
  query: string,
  options: { activeArticleId?: string | null; selectedChunkId?: string | null; limit?: number; minScore?: number } = {},
): CbaSearchContext[] {
  const expanded = expandQuery(query);
  const selectedChunkId = options.selectedChunkId ?? null;
  const activeArticleId = options.activeArticleId ?? null;
  const minScore = options.minScore ?? DEFAULT_MIN_CHUNK_SCORE;
  const contexts = chunks
    .map((chunk) => {
      const section = sectionsById.get(chunk.article_id);
      if (!section) return null;
      const metadataScore = scoreText(sectionMetadataSearchText(section), expanded) * 0.65;
      const bodyScore = scoreText(chunk.body, expanded);
      const headingBoost = ruleHeadingBoost(query, chunk.body, section);
      const base = metadataScore
        + bodyScore
        + headingBoost;
      const selectedBoost = selectedChunkId && chunk.id === selectedChunkId ? 80 : 0;
      const activeBoost = activeArticleId && chunk.article_id === activeArticleId ? 20 : 0;
      const score = base + selectedBoost + activeBoost;
      return {
        section,
        chunk,
        score,
        match_kind: inferMatchKind({
          query: expanded,
          chunk,
          section,
          selectedChunkId,
          activeArticleId,
          headingBoost,
          metadataScore,
          bodyScore,
        }),
        support_level: supportLevel(score),
      };
    })
    .filter((item): item is CbaSearchContext => item !== null && item.score >= minScore)
    .sort((a, b) => b.score - a.score || a.section.sort_key - b.section.sort_key || a.chunk.chunk_index - b.chunk.chunk_index);

  return dedupeContexts(contexts).slice(0, options.limit ?? 5);
}

export function requiresAnalyzeWorkspace(message: string): boolean {
  if (!TEAM_OR_LIVE_CONTEXT_RE.test(message)) return false;
  return !PURE_RULE_NAV_RE.test(message);
}

export function buildCbaNavigatorAnswer(message: string, contexts: CbaSearchContext[]): {
  text: string;
  citations: CbaCitation[];
  navigate: { article_id: string; chunk_id: string | null } | null;
  boundary: { reason: string; action: 'open_analyze' } | null;
} {
  if (requiresAnalyzeWorkspace(message)) {
    const reason = 'team_or_live_context';
    return {
      text: [
        'Boundary note: that needs current team context, cap-sheet data, or transaction modeling rather than only the CBA text.',
        'Open Analyze for live roster/cap evidence, then use CBA citations there to inspect the governing rule.',
      ].join(' '),
      citations: [],
      navigate: null,
      boundary: { reason, action: 'open_analyze' },
    };
  }

  if (contexts.length === 0) {
    return {
      text: 'I could not find a matching CBA section in the loaded reference corpus. Try a rule-family term such as "second apron", "mid-level exception", "Bird rights", or "trade rules".',
      citations: [],
      navigate: null,
      boundary: null,
    };
  }

  const primary = contexts[0];
  if (primary.support_level === 'weak') {
    return {
      text: 'I found a possible CBA match, but the retrieval support is too weak to answer from the loaded text with confidence. Try a more specific rule term such as "second apron", "non-taxpayer MLE", "Bird rights", or "sign-and-trade".',
      citations: [],
      navigate: null,
      boundary: null,
    };
  }

  const citations = contexts.slice(0, 3).map(contextToCitation);
  const pages = pageLabel(primary.section);
  const snippet = citationSnippet(primary.chunk.body, 38);
  const related = [...new Set(citations.slice(1).map((citation) => citation.label))]
    .filter((label) => label !== primary.section.label)
    .join('; ');
  const relatedLine = related ? `\nRelated sections: ${related}.` : '';
  return {
    text: [
      `Direct answer: the closest CBA match is ${primary.section.label}${pages ? ` (${pages})` : ''}.`,
      `Cited text: "${snippet}"`,
      relatedLine,
    ].join('\n').replace(/[ \t]+/g, ' ').trim(),
    citations,
    navigate: { article_id: primary.section.id, chunk_id: primary.chunk.id },
    boundary: null,
  };
}

export function contextToCitation(context: CbaSearchContext): CbaCitation {
  return {
    article_id: context.section.id,
    chunk_id: context.chunk.id,
    label: context.section.label,
    page_start: context.chunk.page_start ?? context.section.page_start,
    page_end: context.chunk.page_end ?? context.section.page_end,
    quote: citationSnippet(context.chunk.body, 32),
  };
}

export function contextToPayload(context: CbaSearchContext): CbaSearchContextPayload {
  return {
    article_id: context.section.id,
    chunk_id: context.chunk.id,
    label: context.section.label,
    page_start: context.chunk.page_start ?? context.section.page_start,
    page_end: context.chunk.page_end ?? context.section.page_end,
    quote: citationSnippet(context.chunk.body, 36),
    score: Math.round(context.score * 100) / 100,
    match_kind: context.match_kind,
    support_level: context.support_level,
  };
}

export function normalizeWhitespace(text: string): string {
  return text
    .replace(/([A-Za-z])\s*-\s*([A-Za-z])/g, '$1-$2')
    .replace(/\bT raded\b/g, 'Traded')
    .replace(/\bS heet\b/g, 'Sheet')
    .replace(/\bA gent\b/g, 'Agent')
    .replace(/\s+/g, ' ')
    .trim();
}

function sectionSearchText(section: CbaSection): string {
  return [
    section.id,
    section.label,
    section.article,
    section.section,
    section.section_number,
    ...(section.aliases ?? []),
    section.body,
  ].filter(Boolean).join(' ');
}

function sectionMetadataSearchText(section: CbaSection): string {
  return [
    section.id,
    section.label,
    section.article,
    section.section,
    section.section_number,
    ...(section.aliases ?? []),
  ].filter(Boolean).join(' ');
}

function normalizeAliasConfig(config: CbaAliasConfig): Required<CbaAliasConfig> {
  return {
    query_groups: (config.query_groups ?? []).map((group) => ({
      terms: mergeAliases(group.terms ?? []),
      aliases: mergeAliases(group.aliases ?? []),
    })),
    section_aliases: Object.fromEntries(
      Object.entries(config.section_aliases ?? {}).map(([id, aliases]) => [id, mergeAliases(aliases)]),
    ),
  };
}

function mergeAliases(...groups: string[][]): string[] {
  return [...new Set(groups.flat().map((alias) => normalizeWhitespace(alias)).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function expandQuery(query: string): string {
  const normalized = normalizeSearchText(query);
  const aliases = DEFAULT_CBA_ALIAS_CONFIG.query_groups
    .filter((group) => group.terms.some((term) => normalized.includes(normalizeSearchText(term))))
    .flatMap((group) => group.aliases);
  return [query, ...aliases].join('\n');
}

function scoreText(text: string, query: string): number {
  const haystack = normalizeSearchText(text);
  const tokens = queryTokens(query);
  if (tokens.length === 0) return 0;

  let score = 0;
  for (const phrase of queryPhrases(query)) {
    if (haystack.includes(phrase)) {
      const words = phrase.split(/\s+/).length;
      score += Math.min(90, 22 + words * 12);
    }
  }
  for (const token of tokens) {
    const matches = haystack.match(new RegExp(`\\b${escapeRegExp(token)}\\b`, 'g'))?.length ?? 0;
    score += matches * (token.length > 4 ? 7 : 3);
  }
  return score;
}

function queryTokens(query: string): string[] {
  return [...new Set(
    normalizeSearchText(query)
      .replace(/[^a-z0-9§ -]/g, ' ')
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 1 && !STOP_WORDS.has(token)),
  )];
}

function queryPhrases(query: string): string[] {
  return [...new Set(
    query
      .split(/\n+/)
      .map(normalizeSearchText)
      .filter((phrase) => phrase.includes(' ') && phrase.length >= 8),
  )];
}

function matchTermsForText(text: string, query: string, limit = 8): string[] {
  const haystack = normalizeSearchText(text);
  const phrases = queryPhrases(query).filter((phrase) => haystack.includes(phrase));
  const tokens = queryTokens(query).filter((token) => new RegExp(`\\b${escapeRegExp(token)}\\b`).test(haystack));
  return [...new Set([...phrases, ...tokens])].slice(0, limit);
}

function buildSearchSnippet(text: string, query: string, radiusWords = 24): string {
  const normalized = normalizeWhitespace(text);
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const terms = [...queryPhrases(query), ...queryTokens(query)];
  const lowerWords = words.map((word) => normalizeSearchText(word));
  const hitIndex = lowerWords.findIndex((word) => terms.some((term) => term.split(/\s+/).includes(word)));
  if (hitIndex === -1) return words.slice(0, radiusWords * 2).join(' ');
  const start = Math.max(0, hitIndex - radiusWords);
  const end = Math.min(words.length, hitIndex + radiusWords);
  const prefix = start > 0 ? '... ' : '';
  const suffix = end < words.length ? ' ...' : '';
  return `${prefix}${words.slice(start, end).join(' ')}${suffix}`;
}

function sectionIntentBoost(query: string, section: CbaSection): number {
  const q = normalizeSearchText(query);
  const id = section.id;
  if (/\b(sign and trade|sign-and-trade|signed and traded)\b/.test(q) && id === 'Article VII §8') return 180;
  if (/\b(qualifying offer|maximum qualifying offer)\b/.test(q) && id === 'Article XI §4') return 1200;
  if (/\b(restricted free agency|offer sheet|right of first refusal|rofr)\b/.test(q) && id === 'Article XI §5') return 150;
  if (/\b(bird rights|bird exception|early bird|non-bird|qualifying veteran free agent)\b/.test(q) && id === 'Article VII §6') return 150;
  if (/\b(trade aggregation|salary aggregation|traded player exception|tpe)\b/.test(q) && id === 'Article VII §6') return 130;
  if (/\b(trade rules|cash in trades|trade consent)\b/.test(q) && id === 'Article VII §8') return 130;
  if (/\b(rookie scale|rookie salary scale|first round pick)\b/.test(q) && id === 'Article VIII §1') return 150;
  if (/\b(hard cap|first apron|second apron|frozen pick|draft pick penalty)\b/.test(q) && id === 'Article VII §2') return 150;
  if (/\b(non[- ]?taxpayer|taxpayer|mid[- ]level|mle|room exception|bi[- ]annual|disabled player exception)\b/.test(q) && id === 'Article VII §6') return 140;
  if (/\b(minimum player salary|minimum annual salary|minimum salary)\b/.test(q) && id === 'Article II §6') return 1200;
  if (/\b(maximum annual salary|max salary|maximum salary)\b/.test(q) && id === 'Article II §7') return 1200;
  if (/\b(salary cap contract structure|contract structure rules|annual increases|annual decreases)\b/.test(q) && id === 'Article VII §5') return 1200;
  if (/\b(determination of team salary|team salary|cap hold|free agent amount)\b/.test(q) && id === 'Article VII §4') return 1200;
  if (/\b(designated veteran player extension|rookie scale extension|renegotiation|extension)\b/.test(q) && id === 'Article VII §7') return 1200;
  return 0;
}

function ruleHeadingBoost(query: string, text: string, section: CbaSection): number {
  const normalizedQuery = normalizeSearchText(query);
  if (!/\b(where|defined|definition)\b/.test(normalizedQuery)) return 0;

  const normalizedText = normalizeSearchText(text);
  const headingPrefix = String.raw`(?:^|\s)\([a-z0-9]+\)\s+`;
  const asksNonTaxpayer = /\b(non[- ]?taxpayer|ntmle)\b/.test(normalizedQuery)
    || /\bnon\b.*\btaxpayer\b/.test(normalizedQuery);
  const asksTaxpayer = /\btaxpayer\b/.test(normalizedQuery) && !asksNonTaxpayer;
  if (
    asksNonTaxpayer
    && /mle|mid[- ]level/.test(normalizedQuery)
    && new RegExp(`${headingPrefix}non-taxpayer mid-level salary exception`).test(normalizedText)
  ) {
    return 1000;
  }
  if (
    asksTaxpayer
    && /mle|mid[- ]level/.test(normalizedQuery)
    && new RegExp(`${headingPrefix}taxpayer mid-level salary exception`).test(normalizedText)
  ) {
    return 900;
  }
  if (
    /\b(bird rights|bird exception|early bird|non-bird|qualifying veteran free agent)\b/.test(normalizedQuery)
    && section.id === 'Article VII §6'
    && /\b(veteran free agent exception|qualifying veteran free agent|early qualifying veteran free agent|non-qualifying veteran free agent)\b/.test(normalizedText)
  ) {
    return 140;
  }
  if (
    /\b(traded player exception|trade exception|trade aggregation|salary aggregation|tpe)\b/.test(normalizedQuery)
    && section.id === 'Article VII §6'
    && /\b(traded player exception|aggregated standard traded player exception|expanded traded player exception)\b/.test(normalizedText)
  ) {
    return 130;
  }
  if (
    /\b(sign and trade|sign-and-trade|signed and traded)\b/.test(normalizedQuery)
    && section.id === 'Article VII §8'
    && /\b(signed and traded|section 8\(e\)|sign and trade)\b/.test(normalizedText)
  ) {
    return 130;
  }
  if (
    /\b(qualifying offer|maximum qualifying offer)\b/.test(normalizedQuery)
    && section.id === 'Article XI §4'
    && /\bqualifying offer\b/.test(normalizedText)
  ) {
    return 120;
  }
  if (
    /\b(restricted free agency|offer sheet|right of first refusal|rofr)\b/.test(normalizedQuery)
    && section.id === 'Article XI §5'
    && /\b(offer sheet|right of first refusal|restricted free agent)\b/.test(normalizedText)
  ) {
    return 120;
  }
  if (
    /\b(rookie scale|rookie salary scale|first round pick)\b/.test(normalizedQuery)
    && section.id === 'Article VIII §1'
    && /\b(rookie scale|rookie salary scale|first round pick)\b/.test(normalizedText)
  ) {
    return 120;
  }
  if (
    /\b(hard cap|second apron|first apron|frozen pick|draft pick penalty)\b/.test(normalizedQuery)
    && section.id === 'Article VII §2'
    && /\b(apron team salary|transaction restrictions table|draft pick penalty|second apron team)\b/.test(normalizedText)
  ) {
    return 120;
  }
  return 0;
}

function supportLevel(score: number): CbaSupportLevel {
  if (score >= STRONG_SUPPORT_SCORE) return 'strong';
  if (score >= MEDIUM_SUPPORT_SCORE) return 'medium';
  return 'weak';
}

function inferMatchKind({
  query,
  chunk,
  section,
  selectedChunkId,
  activeArticleId,
  headingBoost,
  metadataScore,
  bodyScore,
}: {
  query: string;
  chunk: CbaChunk;
  section: CbaSection;
  selectedChunkId: string | null;
  activeArticleId: string | null;
  headingBoost: number;
  metadataScore: number;
  bodyScore: number;
}): CbaSearchMatchKind {
  if (selectedChunkId && chunk.id === selectedChunkId) return 'selected_chunk';
  if (headingBoost > 0) return 'heading';
  if (hasExactPhraseMatch(chunk.body, query)) return 'exact_phrase';
  if (activeArticleId && section.id === activeArticleId) return 'active_section';
  if (metadataScore > bodyScore) return 'metadata';
  return 'body';
}

function hasExactPhraseMatch(text: string, query: string): boolean {
  const haystack = normalizeSearchText(text);
  return queryPhrases(query).some((phrase) => haystack.includes(phrase));
}

function normalizeSearchText(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/[^a-z0-9§()'"\n -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function dedupeContexts(contexts: CbaSearchContext[]): CbaSearchContext[] {
  const seen = new Set<string>();
  const out: CbaSearchContext[] = [];
  for (const context of contexts) {
    const key = `${context.section.id}:${context.chunk.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(context);
  }
  return out;
}

function citationSnippet(text: string, maxWords: number): string {
  const words = normalizeWhitespace(text).split(/\s+/).filter(Boolean);
  const clipped = words.slice(0, maxWords).join(' ');
  return words.length > maxWords ? `${clipped}...` : clipped;
}

function pageLabel(section: Pick<CbaSection, 'page_start' | 'page_end'>): string {
  if (section.page_start == null) return '';
  if (section.page_end == null || section.page_end === section.page_start) return `p. ${section.page_start}`;
  return `pp. ${section.page_start}-${section.page_end}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
