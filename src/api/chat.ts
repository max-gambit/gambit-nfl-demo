import type { ChatStreamEvent } from '@shared/types';
import { SERVER_URL } from './client';

// Streams chat tokens from the server. Yields parsed ChatStreamEvent objects
// in arrival order. Throws on transport errors; logical errors are emitted
// as `{ type: 'error', ... }` events for the caller to handle inline.
export async function* streamChat(
  briefId: string,
  message: string,
  signal?: AbortSignal,
): AsyncGenerator<ChatStreamEvent> {
  const res = await fetch(`${SERVER_URL}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ briefId, message }),
    signal,
  });

  if (!res.ok) {
    let detail = '';
    try { detail = await res.text(); } catch { /* ignore */ }
    throw new Error(`POST /chat ${res.status}: ${detail || res.statusText}`);
  }
  if (!res.body) {
    throw new Error('POST /chat returned no body');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  // SSE parser: events are separated by `\n\n`, each event has one or more
  // `data: <json>` lines. We only emit `data` payloads — `event:` and `id:`
  // lines are ignored since the JSON itself carries the discriminator.
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);

      const dataLines: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('data: ')) dataLines.push(line.slice(6));
        else if (line.startsWith('data:')) dataLines.push(line.slice(5));
      }
      if (dataLines.length === 0) continue;

      const payload = dataLines.join('\n');
      try {
        yield JSON.parse(payload) as ChatStreamEvent;
      } catch (err) {
        // Skip malformed events but log so we notice in dev.
        console.warn('[streamChat] failed to parse SSE payload', payload, err);
      }
    }
  }
}
