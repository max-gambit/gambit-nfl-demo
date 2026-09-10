/** Incremental SSE decoding shared by the provider adapter and browser. */
export async function* readSse(response: Response): AsyncGenerator<{ event: string; data: string }> {
  if (!response.body) throw new Error('The response has no stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let ended = false;
  try {
    while (!ended) {
      const { value, done } = await reader.read();
      ended = done;
      buffer += decoder.decode(value, { stream: !done });
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        let event = 'message';
        const data: string[] = [];
        for (const line of frame.split(/\r?\n/)) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
        }
        if (data.length) yield { event, data: data.join('\n') };
      }
    }
  } finally {
    if (!ended) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
