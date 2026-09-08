import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import type { NflAuthorityCorpus } from './types.js';

let corpusPromise: Promise<NflAuthorityCorpus> | undefined;

/** Validate binding once; a missing/corrupt snapshot fails closed at the answer boundary. */
export async function loadNflAuthorityCorpus(): Promise<NflAuthorityCorpus> {
  return corpusPromise ??= (async () => {
    const [bytes, manifestText] = await Promise.all([
      readFile(new URL('../../../data/nfl-authority/authority.json.gz', import.meta.url)),
      readFile(new URL('../../../data/nfl-authority/manifest.json', import.meta.url), 'utf8'),
    ]);
    const manifest = JSON.parse(manifestText);
    if (createHash('sha256').update(bytes).digest('hex') !== manifest.index_sha256) throw new Error('NFL authority index hash mismatch');
    const corpus = JSON.parse(gunzipSync(bytes).toString('utf8')) as NflAuthorityCorpus;
    if (corpus.schema !== 'nfl_authority.v1' || corpus.league !== 'NFL' || !Array.isArray(corpus.sources) || !Array.isArray(corpus.passages)) throw new Error('Invalid NFL authority schema');
    const sources = new Map(corpus.sources.map(source => [source.id, source]));
    const ids = new Set<string>();
    for (const source of corpus.sources) {
      const host = new URL(source.url).hostname;
      if (source.league !== 'NFL' || !['nflpaweb.blob.core.windows.net', 'static.www.nfl.com', 'operations.nfl.com'].includes(host) || !/^[a-f0-9]{64}$/.test(source.sha256)) throw new Error('Invalid NFL authority source');
    }
    for (const passage of corpus.passages) {
      const source = sources.get(passage.source_id);
      if (!source || source.domain !== passage.domain || ids.has(passage.id) || !passage.text.trim() || !passage.locator || passage.url.split('#')[0] !== source.url) throw new Error('Unbound NFL authority passage');
      if (passage.pdf_page !== null && (!Number.isInteger(passage.pdf_page) || passage.pdf_page < 1 || passage.pdf_page > (source.pdf_page_count ?? 0))) throw new Error('Invalid NFL authority PDF page');
      ids.add(passage.id);
    }
    if (manifest.passage_count !== corpus.passages.length) throw new Error('NFL authority passage count mismatch');
    return corpus;
  })().catch(error => { corpusPromise = undefined; throw error; });
}

export async function getNflAuthorityCoverage() {
  const corpus = await loadNflAuthorityCorpus();
  return {
    schema: corpus.schema, league: corpus.league, captured_at: corpus.captured_at,
    coverage: corpus.coverage, sources: corpus.sources,
    passages_by_domain: Object.fromEntries(['cba', 'playing_rules', 'league_dates'].map(domain => [domain, corpus.passages.filter(p => p.domain === domain).length])),
    text_extraction_boundary: 'Text passages omit illustrations, rotated exhibit text and table layout. CBA Article 69 on PDF page 350 is a scanned page and is not text-indexed. Source PDFs remain authoritative. Retrieval is not consolidated verification of later amendments or current player-specific facts.',
  };
}
