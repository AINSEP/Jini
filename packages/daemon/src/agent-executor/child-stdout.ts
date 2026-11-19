import { createToolResultDiagnosticProjection } from '../tool-result-diagnostics.js';
import { createSanitizedLineStream } from './sanitized-line-stream.js';
import { acceptsMidRunUserMessages } from './message-relay.js';
import { receivedJournalEntry } from './event-io.js';
import type { createRunEventQueue } from './event-io.js';
import type { RuntimeAgentDef } from '@jini-ai/core/contracts/agents';
import type { WireChildLifecycleContext, ChildRunSignals } from './child-lifecycle.js';
import type { StreamHandler } from './contracts.js';

/**
 * Default ceiling on the `'until-close'` or per-line stdout accumulator (see `RuntimeStdoutPolicy` in
 * `@jini-ai/agent-runtime`), in bytes of received UTF-8.
 *
 * A buffered def holds its child's entire stdout in one in-memory string until the process closes,
 * which is exactly what makes the accumulator a denial-of-service surface: the child is a
 * prompt-influenced agent CLI this driver already treats as potentially adversarial (SEC-001), and
 * nothing obliges it to ever close or to stop emitting. Without a ceiling one run could exhaust the
 * daemon's heap and take every unrelated run in the process down with it.
 *
 * 8 MiB was chosen to sit far above the original buffered print-mode auth prompt and result text
 * (a few KiB) while staying
 * small enough that a hostile child cannot meaningfully pressure the heap. A host that genuinely
 * needs more passes `CreateAgentExecutorOptions.bufferedStdoutMaxBytes`.
 */
export const DEFAULT_BUFFERED_STDOUT_MAX_BYTES = 8 * 1024 * 1024;

/** The `'until-close'` buffering switch and its sanitizer; both stay off for live and line policies. */
function untilCloseStdoutPolicy({ stdoutPolicy }: { stdoutPolicy: RuntimeAgentDef['stdoutPolicy'] }, _options = {}) {
  return {
    bufferStdoutUntilClose: stdoutPolicy?.buffering === 'until-close',
    sanitizeBufferedStdout: stdoutPolicy?.buffering === 'until-close' ? stdoutPolicy.sanitize : undefined,
  };
}

/**
 * The host-authored note appended to a truncated flush. Written *after* the def's own `sanitize`
 * runs, never before: it is this driver's own text, not agent output, and passing it through a
 * consumer-supplied redactor could silently delete the one line that says output is missing.
 */
function bufferedStdoutTruncationNotice(droppedBytes: number, maxBytes: number): string {
  return `\n[jini] agent stdout truncated: ${droppedBytes} byte(s) dropped after the ${maxBytes}-byte buffer limit was reached.\n`;
}

/** Keeps exact-byte auditing separate from retained diagnostics on the run's existing FIFO.
 * Projection retains at most one bounded frame; ordinary stdout keeps its legacy byte journal. */
export function createStdoutDiagnostics({ ctx, enqueueEmit }: {
  ctx: WireChildLifecycleContext;
  enqueueEmit: (task: () => Promise<unknown>) => void;
}, _options = {}) {
  const { runId, lifecycle, journal, stdoutJournalBlobs } = ctx;
  const projection = ctx.delegatedResultCorrelation && ctx.streamFormat === 'claude-stream-json'
    ? createToolResultDiagnosticProjection({}) : undefined;

  function emit({ text }: { text: string }): void {
    if (text) enqueueEmit(() => lifecycle.emit({ runId, input: { event: 'stdout', data: { chunk: text } } }));
  }

  return {
    record({ chunk, text }: { chunk: Buffer | string; text: string }): void {
      if (!journal) return;
      if (projection && stdoutJournalBlobs) {
        enqueueEmit(() => stdoutJournalBlobs.record({ runId, chunk }));
      } else {
        enqueueEmit(() => journal.record({ runId, entry: receivedJournalEntry('stdout', text) }));
      }
    },
    feed({ text }: { text: string }): void {
      emit({ text: projection ? projection.feed({ chunk: text }) : text });
    },
    flush(): void {
      emit({ text: projection?.flush({}) ?? '' });
    },
  };
}

export function createChildStdout({ ctx, signals, stdoutDiagnostics, enqueueEmit, scanControlLines, getParser }: {
  ctx: WireChildLifecycleContext;
  signals: ChildRunSignals;
  stdoutDiagnostics: ReturnType<typeof createStdoutDiagnostics>;
  enqueueEmit: ReturnType<typeof createRunEventQueue>['enqueueEmit'];
  scanControlLines: (text: string) => void;
  getParser: () => StreamHandler | null;
}, _options = {}) {
  const { runId, def, streamFormat, lifecycle } = ctx;
  // `def.stdoutPolicy` read once, up front, so the per-chunk handler below is a single boolean
  // test rather than a repeated union narrowing. `undefined` means
  // live — see this function's own doc.
  const stdoutPolicy = def.stdoutPolicy;
  const { bufferStdoutUntilClose, sanitizeBufferedStdout } = untilCloseStdoutPolicy({ stdoutPolicy });
  const lineStdout = stdoutPolicy?.buffering === 'line' ? createSanitizedLineStream({
    maxBytes: ctx.bufferedStdoutMaxBytes, sanitize: stdoutPolicy.sanitize,
    emit: ({ text }) => {
      stdoutDiagnostics.feed({ text });
      if (streamFormat === 'plain') enqueueEmit(() => lifecycle.emit({ runId, input: { event: 'agent', data: { type: 'text_delta', delta: text } } }));
      else getParser()?.feed({ chunk: text });
    },
    onOverflow: ({ bytes }) => enqueueEmit(() => lifecycle.emit({ runId, input: { event: 'error', data: {
      message: bufferedStdoutTruncationNotice(bytes, ctx.bufferedStdoutMaxBytes),
    } } })),
  }) : undefined;
  // Accumulator for the `'until-close'` path. Stays `''` for live and line policies, and the flush below
  // is then a no-op that emits nothing. Bounded by `ctx.bufferedStdoutMaxBytes` — see
  // {@link DEFAULT_BUFFERED_STDOUT_MAX_BYTES} for why an unbounded accumulator was a
  // denial-of-service surface rather than merely untidy.
  const state = {
    bufferedStdout: '', bufferedStdoutBytes: 0,
    /** Bytes the ceiling refused, reported verbatim on flush so truncation is never silent. */
    droppedStdoutBytes: 0,
  };

  return {
    onData: (chunk: Buffer | string) => onData({ ctx, signals, state, lineStdout, bufferStdoutUntilClose, stdoutDiagnostics, enqueueEmit, scanControlLines, getParser, chunk }),
    flushBufferedStdout: () => flushBufferedStdout({ ctx, state, sanitizeBufferedStdout, getParser, stdoutDiagnostics, enqueueEmit }),
    flushLine: () => lineStdout?.flush({}),
  };
}

function appendBufferedStdout({ state, text, maxBytes }: {
  state: { bufferedStdout: string; bufferedStdoutBytes: number; droppedStdoutBytes: number };
  text: string; maxBytes: number;
}, _options = {}): void {
  // Nothing is emitted on *either* channel yet — see this function's doc on why holding the
  // raw echo back matters as much as holding back the chat copy.
  //
  // Whole chunks only: a chunk that would cross the ceiling is dropped entirely rather than
  // sliced to fit, which keeps the accumulator free of half-written multi-byte characters (a
  // `data` event boundary already need not align with one) and makes the kept prefix exactly
  // the bytes some prefix of chunks produced. Everything after the first refusal is dropped
  // too — the point is a hard ceiling on resident bytes, not a best-effort tail.
  const chunkBytes = Buffer.byteLength(text, 'utf8');
  if (state.droppedStdoutBytes > 0 || state.bufferedStdoutBytes + chunkBytes > maxBytes) {
    state.droppedStdoutBytes += chunkBytes;
    return;
  }
  state.bufferedStdout += text;
  state.bufferedStdoutBytes += chunkBytes;
  return;
}

function onData({ ctx, signals, state, lineStdout, bufferStdoutUntilClose, stdoutDiagnostics, enqueueEmit, scanControlLines, getParser, chunk }: {
  ctx: WireChildLifecycleContext; signals: ChildRunSignals;
  state: Parameters<typeof appendBufferedStdout>[0]['state'];
  lineStdout: ReturnType<typeof createSanitizedLineStream> | undefined; bufferStdoutUntilClose: boolean;
  stdoutDiagnostics: ReturnType<typeof createStdoutDiagnostics>;
  enqueueEmit: ReturnType<typeof createRunEventQueue>['enqueueEmit'];
  scanControlLines: (text: string) => void; getParser: () => StreamHandler | null; chunk: Buffer | string;
}, _options = {}): void {
  const { runId, def, streamFormat, lifecycle } = ctx;
  const text = chunk.toString('utf8');
  stdoutDiagnostics.record({ chunk, text });
  if (lineStdout) { lineStdout.feed({ chunk: text }); return; }
  if (streamFormat === 'plain' && text.length > 0) signals.userVisibleOutputSeen = true;
  if (bufferStdoutUntilClose) {
    appendBufferedStdout({ state, text, maxBytes: ctx.bufferedStdoutMaxBytes });
    return;
  }
  if (streamFormat === 'plain') {
    enqueueEmit(() => lifecycle.emit({ runId: runId, input: { event: 'stdout', data: { chunk: text } } }));
    enqueueEmit(() => lifecycle.emit({ runId: runId, input: { event: 'agent', data: { type: 'text_delta', delta: text } } }));
    return;
  }
  stdoutDiagnostics.feed({ text });
  // Receipts, background membership and turn ends must be processed in the same wire order.
  // streamHandler is non-null here: the plain-format branch returned above.
  if (acceptsMidRunUserMessages({ def })) scanControlLines(text);
  else getParser()!.feed({ chunk: text });
}

/**
 * Emits the accumulated `'until-close'` stdout — sanitized — as exactly one raw `'stdout'` echo
 * plus one `text_delta` for plain output, or through the declared structured parser. Both use
 * the same `enqueueEmit` FIFO queue every other emit uses, so the
 * flush is ordered after every already-queued event and before `finish()`'s `'end'`. A no-op for
 * every live-streaming def (nothing was ever accumulated) and for a buffered run that produced
 * no stdout at all — an empty `text_delta` is noise, not information.
 *
 * A run whose accumulator hit its ceiling is the one case that still emits when the sanitized text
 * is empty: "the sanitizer redacted everything" and "we dropped output on the floor" must not look
 * identical to a client, so the truncation notice is information in its own right.
 */
function flushBufferedStdout({ ctx, state, sanitizeBufferedStdout, getParser, stdoutDiagnostics, enqueueEmit }: {
  ctx: WireChildLifecycleContext;
  state: Parameters<typeof appendBufferedStdout>[0]['state'];
  sanitizeBufferedStdout: ReturnType<typeof untilCloseStdoutPolicy>['sanitizeBufferedStdout'];
  getParser: () => StreamHandler | null;
  stdoutDiagnostics: ReturnType<typeof createStdoutDiagnostics>;
  enqueueEmit: ReturnType<typeof createRunEventQueue>['enqueueEmit'];
}, _options = {}): void {
  const { runId, lifecycle } = ctx;
  if (state.bufferedStdout.length === 0 && state.droppedStdoutBytes === 0) return;
  const safe = sanitizeBufferedStdout ? sanitizeBufferedStdout({ fullText: state.bufferedStdout }) : state.bufferedStdout;
  state.bufferedStdout = '';
  state.bufferedStdoutBytes = 0;
  const dropped = state.droppedStdoutBytes;
  state.droppedStdoutBytes = 0;
  if (getParser() !== null) {
    // Redact the complete wire text before parsing: structured errors can contain sign-in URLs too.
    stdoutDiagnostics.feed({ text: safe });
    getParser()!.feed({ chunk: safe });
    if (dropped > 0) enqueueEmit(() => lifecycle.emit({ runId, input: { event: 'error', data: {
      message: bufferedStdoutTruncationNotice(dropped, ctx.bufferedStdoutMaxBytes),
    } } }));
    return;
  }
  const text = dropped > 0 ? `${safe}${bufferedStdoutTruncationNotice(dropped, ctx.bufferedStdoutMaxBytes)}` : safe;
  if (text.length === 0) return;
  enqueueEmit(() => lifecycle.emit({ runId: runId, input: { event: 'stdout', data: { chunk: text } } }));
  enqueueEmit(() => lifecycle.emit({ runId: runId, input: { event: 'agent', data: { type: 'text_delta', delta: text } } }));
}
