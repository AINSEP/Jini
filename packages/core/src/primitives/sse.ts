/**
 * @module primitives/sse
 *
 * Minimal, tolerant Server-Sent-Events *frame decoder* for an INBOUND
 * provider stream — the response body a call to the Anthropic Messages API
 * or the OpenAI Chat Completions API sends back when `stream: true` is
 * requested. This is deliberately not `@jini-ai/http-kit`'s `sse.ts`: that module
 * is the OUTBOUND channel a route uses to push events to a browser client
 * (bounded queue, backpressure, `Last-Event-ID` replay). This module has
 * none of that — it only turns a raw byte/text stream into `{event, data}`
 * frames per the SSE wire format (`text/event-stream`, RFC-ish: fields
 * separated by `\n`, records separated by a blank line), so a provider-
 * specific turn-runner (`anthropic-messages.ts`, `openai-chat.ts`) can
 * `JSON.parse` each frame's `data` field without re-deriving line/record
 * framing itself.
 *
 * Field parsing and framing are shared by providers and durable run consumers.
 * The public leaf has no Node imports; callers keep their own JSON, EOF and
 * reader-ownership policies rather than re-deriving line/record framing.
 */

/** Provider-facing record. Metadata remains absent from this compatibility contract. */
export interface DecodedSseEvent {
  /** Null without event: (OpenAI Chat Completions implicitly sends plain messages). */
  readonly event: string | null;
  /** Multiple data: values joined with newlines, per the SSE spec. */
  readonly data: string;
}

/** Raw field values, including explicit (possibly empty) IDs; IDs do not carry across records. */
export interface DecodedSseFrame extends DecodedSseEvent {
  readonly id?: string;
  readonly dataLines: readonly string[];
}

export interface SseFramingOptions {
  /** Providers flush EOF tails; durable run readers require a terminating blank line. */
  readonly flushFinalFrame?: boolean;
  /** Bounds all pending record text, including comments and ignored fields, in UTF-16 units. */
  readonly maxBufferChars?: number;
}

/** Owns field parsing for both raw records and incremental streams; callers own interpretation. */
function createRecordDecoder() {
  let event: string | null = null;
  let id: string | undefined;
  let dataLines: string[] = [];
  return {
    line(raw: string) {
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
      if (line.startsWith(':')) return; // comment line, per spec
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') event = value;
      else if (field === 'data') dataLines.push(value);
      else if (field === 'id') id = value;
      // retry/unknown fields do not belong to per-record interpretation.
    },
    take(): DecodedSseFrame {
      const frame = { event, data: dataLines.join('\n'), dataLines, ...(id !== undefined ? { id } : {}) };
      event = null;
      id = undefined;
      dataLines = [];
      return frame;
    },
  };
}

/** Parse one delimiter-free record without JSON interpretation. O(text) time and space. */
export function parseSseRecord({ rawFrame }: { rawFrame: string }, _options: Record<string, never> = {}): DecodedSseFrame {
  const record = createRecordDecoder();
  for (const line of rawFrame.split('\n')) record.line(line);
  return record.take();
}

/**
 * Browser-safe inbound framing for byte/text iterables; accepts LF and CRLF, including split
 * UTF-8 and CRLF chunks. Reader ownership stays with the source iterator. Optional bounds throw
 * RangeError before buffered text exceeds the limit. Early return closes the source iterator.
 * @complexity O(text + repeated copying of an unfinished line); O(pending record + chunk) space.
 */
export async function* decodeSseFrames({ source }: { source: AsyncIterable<Uint8Array | string> },
  options: SseFramingOptions = {},
): AsyncGenerator<DecodedSseFrame> {
  const decoder = new TextDecoder();
  const record = createRecordDecoder();
  let buffer = '';
  let scanFrom = 0;
  let recordChars = 0;

  function* drainCompleteLines(): Generator<DecodedSseFrame> {
    if (options.maxBufferChars !== undefined && recordChars + buffer.length > options.maxBufferChars) {
      throw new RangeError(`SSE stream exceeded the ${options.maxBufferChars}-character unterminated-frame buffer limit`);
    }
    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf('\n', scanFrom)) !== -1) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      scanFrom = 0;
      if (line === '' || line === '\r') {
        const completed = record.take();
        recordChars = 0;
        if (completed.event !== null || completed.dataLines.length > 0 || completed.id !== undefined) yield completed;
      } else {
        recordChars += newlineIndex + 1;
        record.line(line);
      }
    }
    scanFrom = buffer.length;
  }

  for await (const chunk of source) {
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    yield* drainCompleteLines();
  }
  buffer += decoder.decode();
  yield* drainCompleteLines();
  if (options.flushFinalFrame === false) return;

  // Flush whatever is left: either a trailing unterminated line (no final
  // `\n` at all), or a fully-parsed-but-not-blank-line-terminated record.
  // A provider closing immediately after its last byte must not silently lose it.
  if (buffer.length > 0) record.line(buffer);
  const completed = record.take();
  if (completed.event !== null || completed.dataLines.length > 0 || completed.id !== undefined) yield completed;
}

/**
 * Provider compatibility entry: drops reconnect metadata (meaningless for a single proxied
 * request/response pair) and flushes unterminated EOF records. Keeps the published frame shape.
 * @complexity Inherits decodeSseFrames' streaming cost and buffer size.
 */
export async function* decodeSseStream({ source }: { source: AsyncIterable<Uint8Array | string> },
  _options: Record<string, never> = {},
): AsyncGenerator<DecodedSseEvent> {
  for await (const frame of decodeSseFrames({ source })) {
    if (frame.event !== null || frame.dataLines.length > 0) yield { event: frame.event, data: frame.data };
  }
}

