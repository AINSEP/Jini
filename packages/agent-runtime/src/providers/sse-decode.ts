/**
 * @module providers/sse-decode
 *
 * Minimal, tolerant Server-Sent-Events *frame decoder* for an INBOUND
 * provider stream — the response body a call to the Anthropic Messages API
 * or the OpenAI Chat Completions API sends back when `stream: true` is
 * requested. This is deliberately not `@jini-ai/http`'s `sse.ts`: that module
 * is the OUTBOUND channel a route uses to push events to a browser client
 * (bounded queue, backpressure, `Last-Event-ID` replay). This module has
 * none of that — it only turns a raw byte/text stream into `{event, data}`
 * frames per the SSE wire format (`text/event-stream`, RFC-ish: fields
 * separated by `\n`, records separated by a blank line), so a provider-
 * specific turn-runner (`anthropic-messages.ts`, `openai-chat.ts`) can
 * `JSON.parse` each frame's `data` field without re-deriving line/record
 * framing itself.
 *
 * New file, not a port — chat.ts's origin used the Node `fetch` global's
 * response body directly with ad hoc inline buffering per call site; this
 * factors that concern into one shared, independently-tested primitive so
 * both provider turn-runners consume the same framing logic (the same
 * "shared mechanism, one implementation" discipline `@jini-ai/http`'s
 * `sse.ts`/`origin-validation.ts` already apply to their own domains).
 */

/** One decoded SSE record. `event` is `null` when the record had no `event:` line (OpenAI's Chat Completions stream never sends one; every `data:` line is implicitly a plain message). `data` is the joined value of every `data:` line in the record (multi-line `data:` fields are joined with `\n`, per the SSE spec). */
export interface DecodedSseEvent {
  readonly event: string | null;
  readonly data: string;
}

/**
 * Decodes an inbound byte/text stream into SSE records. Accepts either
 * `Uint8Array` chunks (a real `fetch` response body) or `string` chunks (test
 * fixtures, or any caller that already has decoded text) in the same
 * iterable — this keeps unit tests free of any need to construct a real web
 * `ReadableStream`, matching this package's existing `fetch`-mocking
 * convention (`vi.stubGlobal('fetch', ...)`, see `model-catalog.test.ts`).
 *
 * Tolerant per the SSE spec: accepts both `\n` and `\r\n` line endings,
 * ignores comment lines (leading `:`) and unrecognized field names (`id`/
 * `retry` are parsed by real SSE clients for reconnect bookkeeping, which is
 * meaningless for a single proxied request/response pair, so this decoder
 * intentionally drops them), and flushes a trailing unterminated record —
 * even one whose very last line has no trailing `\n` at all — once the
 * source iterable ends, so a provider closing the connection immediately
 * after its last byte never silently loses that last record.
 */
export async function* decodeSseStream(
  source: AsyncIterable<Uint8Array | string>,
): AsyncGenerator<DecodedSseEvent> {
  const decoder = new TextDecoder();
  let buffer = '';
  let eventType: string | null = null;
  let dataLines: string[] = [];
  let sawAnyField = false;

  /** Processes one already-`\r`-stripped line, mutating the in-progress record. Returns the completed record when `line` is the blank line terminating a non-empty record; `null` otherwise (including a blank line with no preceding fields, which starts no record at all). */
  function handleLine(line: string): DecodedSseEvent | null {
    if (line === '') {
      if (!sawAnyField) return null;
      const completed: DecodedSseEvent = { event: eventType, data: dataLines.join('\n') };
      eventType = null;
      dataLines = [];
      sawAnyField = false;
      return completed;
    }
    if (line.startsWith(':')) return null; // comment line, per spec

    const colonIndex = line.indexOf(':');
    const field = colonIndex === -1 ? line : line.slice(0, colonIndex);
    let value = colonIndex === -1 ? '' : line.slice(colonIndex + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    if (field === 'event') {
      eventType = value;
      sawAnyField = true;
    } else if (field === 'data') {
      dataLines.push(value);
      sawAnyField = true;
    }
    // Every other field name (id/retry/anything a future provider adds) is
    // intentionally ignored — see module doc.
    return null;
  }

  function* drainCompleteLines(): Generator<DecodedSseEvent> {
    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      let line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      const completed = handleLine(line);
      if (completed) yield completed;
    }
  }

  for await (const chunk of source) {
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    yield* drainCompleteLines();
  }
  buffer += decoder.decode();
  yield* drainCompleteLines();

  // Flush whatever is left: either a trailing unterminated line (no final
  // `\n` at all — `buffer` still holds it, never having been handed to
  // `handleLine`), or a fully-parsed-but-not-blank-line-terminated record
  // (`buffer` is empty, but `sawAnyField` is true from lines already
  // processed above).
  if (buffer.length > 0) {
    const completed = handleLine(buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer);
    if (completed) yield completed;
  }
  if (sawAnyField) {
    yield { event: eventType, data: dataLines.join('\n') };
  }
}
