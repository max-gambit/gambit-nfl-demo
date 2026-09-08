import { factualBody } from '@shared/nflFacts';
import type { FactualAnswer } from '../nfl_facts/answer.js';
import { searchNflAuthorityPassages } from './search.js';
import { buildReviewedNflAuthoritySummaries } from './summaries.js';
import type { NflAuthorityQuery } from './types.js';

export { loadNflAuthorityCorpus, getNflAuthorityCoverage } from './corpus.js';
export { searchNflAuthorityPassages } from './search.js';
export { NFL_AUTHORITY_TOPICS } from './topics.js';
export { buildReviewedNflAuthoritySummaries } from './summaries.js';
export type * from './types.js';

/** Evidence only. The caller may synthesize an answer while preserving these bindings. */
export async function searchNflAuthority(query: NflAuthorityQuery): Promise<FactualAnswer> {
  let result;
  try { result = await searchNflAuthorityPassages(query); }
  catch {
    return { body: factualBody({ answer: 'The saved NFL authority index is unavailable or failed its source-integrity check.', key_findings: [], tables: [], calculations: [], caveats: ['No rule claim was generated. Rebuild or restore the verified public-source index before answering.'], followups: [] }), sources: [] };
  }
  if (result.status === 'unsupported') return {
    body: factualBody({ answer: result.reason!, key_findings: [], tables: [], calculations: [], caveats: result.caveats, followups: [] }), sources: [],
  };
  const sources: FactualAnswer['sources'] = result.matches.map(({ passage, source, score, matched_terms, topic_ids }, index) => ({
    ref_index: index + 1, kind: source.id === 'nfl-contract-guarantees-guide' ? 'NFL_GUIDE' : passage.domain === 'cba' ? 'CBA' : passage.domain === 'playing_rules' ? 'NFL_RULEBOOK' : 'NFL_CALENDAR',
    source: source.title, title: passage.title, updated_at: source.captured_at,
    data: {
      league: 'NFL', domain: passage.domain, source_id: source.id, passage_id: passage.id,
      source_url: passage.url, source_document: source.title, source_sha256: source.sha256,
      source_locator: passage.locator, pdf_page: passage.pdf_page, printed_page: passage.printed_page,
      document_date: source.document_date, captured_at: source.captured_at, edition_year: source.edition_year,
      effective_years: source.effective_years, season_year: passage.season_year,
      excerpt: passage.text, authority_boundary: source.authority_boundary,
      continues_before: passage.continues_before, continues_after: passage.continues_after,
      contribution: 'Retrieved source text for the caller to interpret within its edition and stated conditions.',
      retrieval_score: score, matched_terms, topic_ids,
      rows: [
        { k: 'Document', v: source.title }, { k: 'Exact location', v: passage.locator },
        { k: 'Page or date', v: passage.pdf_page == null ? passage.title : `Printed p. ${passage.printed_page}; PDF page ${passage.pdf_page}` },
        { k: 'Source excerpt', v: passage.text }, { k: 'Authority boundary', v: source.authority_boundary },
        { k: 'Captured', v: source.captured_at },
      ],
    },
  }));
  return {
    body: factualBody({
      answer: `Retrieved ${sources.length} relevant NFL authority passage${sources.length === 1 ? '' : 's'} from the saved public sources.`,
      key_findings: [...buildReviewedNflAuthoritySummaries(result), ...result.matches.map(({ passage }, index) => ({ label: passage.title, body: passage.text, source_refs: [index + 1] }))],
      tables: [{ title: 'NFL authority evidence', columns: ['Source', 'Location', 'Source text'], rows: result.matches.map(({ passage, source }, index) => [`[${index + 1}] ${source.title}`, passage.pdf_page == null ? passage.locator : `${passage.locator}; printed p. ${passage.printed_page} (PDF ${passage.pdf_page})`, passage.text]), source_refs: sources.map(s => s.ref_index) }],
      calculations: [], caveats: result.caveats, followups: [],
    }), sources,
  };
}
