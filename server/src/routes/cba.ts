import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { db } from '../db/client.js';
import {
  buildCbaNavigatorAnswer,
  contextToPayload,
  searchCbaChunks,
  searchCbaSectionMatches,
} from '../cba/corpus.js';
import type {
  CbaArticleResponse,
  CbaChatRequest,
  CbaChatStreamEvent,
  CbaChunk,
  CbaDocument,
  CbaSearchResponse,
  CbaSection,
  CbaTocResponse,
} from '@shared/types';

export const cbaRoutes = new Hono();
const PRIMARY_CBA_DOCUMENT_ID = '2023-nba-nbpa-cba';

cbaRoutes.get('/', async (c) => {
  const [document, sections] = await Promise.all([
    loadPrimaryCbaDocument(),
    loadCbaSections(),
  ]);
  return c.json({ document, sections: sections.map(stripSectionBody) } satisfies CbaTocResponse);
});

cbaRoutes.get('/articles', async (c) => {
  const query = c.req.query('query') ?? '';
  const sections = await loadCbaSections();
  return c.json({
    query,
    sections: searchCbaSectionMatches(sections, query).map((match) => stripSectionBody({
      ...match.section,
      snippet: match.snippet,
      match_terms: match.match_terms,
    })),
  } satisfies CbaSearchResponse);
});

cbaRoutes.get('/articles/:id', async (c) => {
  const id = decodeURIComponent(c.req.param('id'));
  const section = await loadCbaSection(id);
  if (!section) return c.json({ error: 'cba_article_not_found' }, 404);
  const chunks = await loadCbaChunksForArticle(id);
  return c.json({ section, chunks } satisfies CbaArticleResponse);
});

cbaRoutes.post('/chat', async (c) => {
  let body: CbaChatRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  if (!body.message || typeof body.message !== 'string' || !body.message.trim()) {
    return c.json({ error: 'message required' }, 400);
  }

  const [sections, chunks] = await Promise.all([loadCbaSections(), loadCbaChunks()]);
  const sectionsById = new Map(sections.map((section) => [section.id, section]));
  const contexts = searchCbaChunks(chunks, sectionsById, body.message, {
    activeArticleId: body.activeArticleId ?? null,
    selectedChunkId: body.selectedChunkId ?? null,
    limit: 5,
  });
  const answer = buildCbaNavigatorAnswer(body.message, contexts);

  return streamSSE(c, async (stream) => {
    const writeEvent = (event: CbaChatStreamEvent) =>
      stream.writeSSE({ data: JSON.stringify(event) });

    await writeEvent({
      type: 'context',
      sections: uniqueContextSections(contexts).map(stripSectionBody),
      citations: answer.citations,
      contexts: contexts.map(contextToPayload),
    });

    for (const citation of answer.citations) {
      await writeEvent({ type: 'citation', citation });
    }

    if (answer.navigate) {
      await writeEvent({ type: 'navigate', ...answer.navigate });
    }

    if (answer.boundary) {
      await writeEvent({ type: 'boundary', ...answer.boundary, question: body.message });
    }

    for (const token of answer.text.match(/\S+\s*/g) ?? []) {
      await writeEvent({ type: 'token', text: token });
    }
    await writeEvent({ type: 'done' });
  });
});

async function loadPrimaryCbaDocument(): Promise<CbaDocument | null> {
  const { data, error } = await db
    .from('cba_documents')
    .select('*')
    .eq('id', PRIMARY_CBA_DOCUMENT_ID)
    .maybeSingle();
  if (error) throw new Error(`cba_documents select failed: ${error.message}`);
  return data as CbaDocument | null;
}

async function loadCbaSections(): Promise<CbaSection[]> {
  const { data, error } = await db
    .from('cba_articles')
    .select('id,label,body,document_id,article,section,section_number,page_start,page_end,sort_key,aliases,source_url')
    .eq('document_id', PRIMARY_CBA_DOCUMENT_ID)
    .neq('article', '')
    .order('sort_key', { ascending: true });
  if (error) throw new Error(`cba_articles select failed: ${error.message}`);
  return (data ?? []).map(toCbaSection);
}

async function loadCbaSection(id: string): Promise<CbaSection | null> {
  const { data, error } = await db
    .from('cba_articles')
    .select('id,label,body,document_id,article,section,section_number,page_start,page_end,sort_key,aliases,source_url')
    .eq('document_id', PRIMARY_CBA_DOCUMENT_ID)
    .eq('id', id)
    .neq('article', '')
    .maybeSingle();
  if (error) throw new Error(`cba_articles select failed: ${error.message}`);
  return data ? toCbaSection(data) : null;
}

function stripSectionBody(section: CbaSection): CbaSection {
  return { ...section, body: '' };
}

function uniqueContextSections(
  contexts: Array<{ section: CbaSection }>,
): CbaSection[] {
  const seen = new Set<string>();
  const sections: CbaSection[] = [];
  for (const context of contexts) {
    if (seen.has(context.section.id)) continue;
    seen.add(context.section.id);
    sections.push(context.section);
  }
  return sections;
}

async function loadCbaChunksForArticle(articleId: string): Promise<CbaChunk[]> {
  const { data, error } = await db
    .from('cba_chunks')
    .select('id,article_id,chunk_index,body,page_start,page_end')
    .eq('article_id', articleId)
    .order('chunk_index', { ascending: true });
  if (error) throw new Error(`cba_chunks select failed: ${error.message}`);
  return (data ?? []) as CbaChunk[];
}

async function loadCbaChunks(): Promise<CbaChunk[]> {
  const { data, error } = await db
    .from('cba_chunks')
    .select('id,article_id,chunk_index,body,page_start,page_end')
    .order('article_id', { ascending: true })
    .order('chunk_index', { ascending: true });
  if (error) throw new Error(`cba_chunks select failed: ${error.message}`);
  return (data ?? []) as CbaChunk[];
}

function toCbaSection(row: Record<string, unknown>): CbaSection {
  return {
    id: String(row.id),
    label: String(row.label),
    body: String(row.body),
    document_id: String(row.document_id ?? '2023-nba-nbpa-cba'),
    article: String(row.article ?? ''),
    section: row.section == null ? null : String(row.section),
    section_number: row.section_number == null ? null : String(row.section_number),
    page_start: row.page_start == null ? null : Number(row.page_start),
    page_end: row.page_end == null ? null : Number(row.page_end),
    sort_key: Number(row.sort_key ?? 0),
    aliases: Array.isArray(row.aliases) ? row.aliases.map(String) : [],
    source_url: String(row.source_url ?? ''),
  };
}
