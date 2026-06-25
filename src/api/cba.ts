import type {
  CbaArticleResponse,
  CbaChatRequest,
  CbaChatStreamEvent,
  CbaSearchResponse,
  CbaTocResponse,
} from '@shared/types';
import { SERVER_URL } from './client';

export async function listCba(): Promise<CbaTocResponse> {
  const res = await fetch(`${SERVER_URL}/cba`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GET /cba failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<CbaTocResponse>;
}

export async function searchCbaArticles(query: string): Promise<CbaSearchResponse> {
  const params = new URLSearchParams();
  if (query.trim()) params.set('query', query.trim());
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const res = await fetch(`${SERVER_URL}/cba/articles${suffix}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GET /cba/articles failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<CbaSearchResponse>;
}

export async function getCbaArticle(id: string): Promise<CbaArticleResponse> {
  const res = await fetch(`${SERVER_URL}/cba/articles/${encodeURIComponent(id)}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GET /cba/articles/${id} failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<CbaArticleResponse>;
}

export async function* streamCbaChat(
  request: CbaChatRequest,
  signal?: AbortSignal,
): AsyncGenerator<CbaChatStreamEvent> {
  const res = await fetch(`${SERVER_URL}/cba/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`POST /cba/chat failed: ${res.status} ${text}`);
  }
  if (!res.body) throw new Error('POST /cba/chat returned no body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const dataLines = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.replace(/^data:\s?/, ''));
      if (dataLines.length === 0) continue;
      try {
        yield JSON.parse(dataLines.join('\n')) as CbaChatStreamEvent;
      } catch (err) {
        console.warn('[cba] failed to parse SSE payload', dataLines.join('\n'), err);
      }
    }
  }
}
