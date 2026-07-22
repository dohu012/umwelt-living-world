/**
 * Incremental parser for OpenAI-style SSE chat-completion streams: newline-delimited
 * `data: {...}` lines, terminated by `data: [DONE]`. Feed it raw text chunks as they arrive off
 * the wire; each feed() call returns the JSON payloads completed by that chunk. Partial lines
 * split across chunk boundaries are buffered internally. Pure/no I/O, so it's testable without a
 * real HTTP server.
 */
export function createSSEParser() {
  let buffer = '';
  let done = false;

  function feed(chunk) {
    buffer += chunk;
    const events = [];
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith('data:')) continue;

      const payload = line.slice('data:'.length).trim();
      if (payload === '[DONE]') {
        done = true;
        continue;
      }
      try {
        events.push(JSON.parse(payload));
      } catch {
        // Malformed/partial line — drop it rather than crash the stream.
      }
    }
    return events;
  }

  return { feed, isDone: () => done };
}
