import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { db } from '../db/client.js';
import { normalizeCbaSeedCorpus, type CbaSeedCorpus } from './corpus.js';

export const DEFAULT_CBA_CORPUS_PATH = fileURLToPath(
  new URL('../../../data/cba/2023-nba-nbpa-cba.json', import.meta.url),
);

export async function loadCbaCorpusSeed(path = DEFAULT_CBA_CORPUS_PATH): Promise<CbaSeedCorpus> {
  const raw = await readFile(path, 'utf8');
  return normalizeCbaSeedCorpus(JSON.parse(raw) as CbaSeedCorpus);
}

export async function seedCbaCorpus(seed: CbaSeedCorpus): Promise<{
  document_id: string;
  section_count: number;
  chunk_count: number;
}> {
  const corpus = normalizeCbaSeedCorpus(seed);
  const documentInsert = await db
    .from('cba_documents')
    .upsert(corpus.document)
    .select('id')
    .single();
  if (documentInsert.error) throw new Error(`cba_documents upsert failed: ${documentInsert.error.message}`);

  const sectionRows = corpus.sections.map(({ chunks: _chunks, ...section }) => section);
  await pruneStaleCbaArticles(corpus.document.id, sectionRows.map((section) => section.id));

  const articleInsert = await db.from('cba_articles').upsert(sectionRows);
  if (articleInsert.error) throw new Error(`cba_articles upsert failed: ${articleInsert.error.message}`);

  const chunkRows = corpus.sections.flatMap((section) => section.chunks ?? []);
  await deleteExistingChunks(sectionRows.map((section) => section.id));

  const chunkInsert = await db.from('cba_chunks').upsert(chunkRows);
  if (chunkInsert.error) throw new Error(`cba_chunks upsert failed: ${chunkInsert.error.message}`);

  return {
    document_id: corpus.document.id,
    section_count: sectionRows.length,
    chunk_count: chunkRows.length,
  };
}

async function pruneStaleCbaArticles(documentId: string, nextArticleIds: string[]): Promise<void> {
  const { data, error } = await db
    .from('cba_articles')
    .select('id')
    .eq('document_id', documentId);
  if (error) throw new Error(`cba_articles stale select failed: ${error.message}`);

  const next = new Set(nextArticleIds);
  const staleIds = (data ?? [])
    .map((row) => String(row.id))
    .filter((id) => !next.has(id));
  for (const batch of batches(staleIds, 100)) {
    const deleted = await db.from('cba_articles').delete().in('id', batch);
    if (deleted.error) throw new Error(`cba_articles stale delete failed: ${deleted.error.message}`);
  }
}

async function deleteExistingChunks(articleIds: string[]): Promise<void> {
  for (const batch of batches(articleIds, 100)) {
    const deleted = await db.from('cba_chunks').delete().in('article_id', batch);
    if (deleted.error) throw new Error(`cba_chunks refresh delete failed: ${deleted.error.message}`);
  }
}

function batches<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
