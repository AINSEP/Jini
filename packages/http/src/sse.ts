/**
 * Generic Server-Sent-Events transport primitive.
 *
 * Before this file, the only SSE machinery in this package was inlined
 * directly inside `runs.ts`'s `registerRunEventStream` (a bounded-queue,
 * backpressure-aware `res.write`/`'drain'` state machine with Last-Event-ID
 * replay support) — see `source-map.md`'s 2026-07-19 "generic lifecycle SSE
 * projection" note and the many "requires SSE (deferred)" verdicts against
 * `chat.ts`/`memory.ts`/`terminal.ts` in the routes-classification table.
 * `createSseChannel` below is that same state machine, generalized over any
 * event type (not just `RunProtocolEvent`) so a route only has to describe
 * *what* to stream, not *how* to stream it. `runs.ts` is refactored to call
 * this primitive rather than keeping its own copy — the same discipline this
 * package already applies to `origin-validation.ts`/`compat.ts` (shared
 * mechanism, one implementation, one set of tests for the mechanism itself).
 *
 * OD's own precedent for a shared SSE primitive is `ctx.http.createSseResponse`
 * (an Express-request-scoped helper both `apps/daemon/src/routes/runs.ts` and
 * `apps/daemon/src/routes/terminal.ts` receive via dependency injection and
 * call themselves) — this file is the Jini equivalent of that role, not an
 * invented-from-scratch design.
 */
import type { ServerResponse } from 'node:http';
import { createApiErrorResponse, type ApiError } from '@injini/protocol';

/** The minimal shape any event needs to flow through an `SseChannel`: an id for `Last-Event-ID` reconnect bookkeeping and a `kind` used as the wire `event:` field. */
export interface SseEvent {
  readonly opaqueCursor: string;
  readonly kind: string;
}

/**
 * Cap on events queued for one client — covers both a pre-header replay
 * burst and any backlog built up while `res.write` reports backpressure
 * (`write() === false`, awaiting `'drain'`). A stalled or malicious client
 * would otherwise let an unbounded producer grow this array without limit
 * (SEC-006, carried forward from `runs.ts`'s original constant). Once
 * exceeded, the connection is dropped rather than accepting unbounded
 * memory growth.
 */
export const DEFAULT_MAX_QUEUED_SSE_EVENTS = 1000;

/** Default wire format: `id: <cursor>\nevent: <kind>\ndata: <json>\n\n`, matching the SSE spec's field syntax. */
function defaultFormatEvent<E extends SseEvent>(event: E): string {
  return `id: ${event.opaqueCursor}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`;
}

export interface CreateSseChannelOptions<E extends SseEvent> {
  /** Queued-event ceiling before the connection is dropped. Defaults to {@link DEFAULT_MAX_QUEUED_SSE_EVENTS}. */
  readonly maxQueuedEvents?: number;
  /** When true for a given event, the channel ends the stream immediately after writing it (matches `runs.ts`'s `'end'`-kind auto-close). Omit for a channel that only ends on client disconnect/overflow/explicit `end()`. */
  readonly isEndEvent?: (event: E) => boolean;
  /** Overrides the wire format. Defaults to {@link defaultFormatEvent}. */
  readonly formatEvent?: (event: E) => string;
  /** Invoked once, synchronously, if `res.write` throws mid-flush — lets a caller log the real error without it crossing back into whatever produced the event (mirrors `runs.ts`'s `RunHttpDeps.onInternalError` seam, but this primitive itself stays logging-free: silent by default, matching a transport channel's "never throw back through the producer" contract). */
  readonly onWriteError?: (error: unknown) => void;
}

export interface SseChannel<E extends SseEvent> {
  /**
   * Queues `event` for delivery. A no-op once the channel is closed. Before
   * {@link SseChannel.open} is called, events accumulate in the same bounded
   * queue used for later backpressure, so a caller may safely `enqueue`
   * replay history before opening the stream — the client's very first
   * flush then already contains that backlog.
   */
  readonly enqueue: (event: E) => void;
  /**
   * Writes SSE headers (`200`, `text/event-stream`, `Cache-Control: no-cache,
   * no-transform`, `Connection: keep-alive`) and starts draining the queue.
   * Idempotent — a no-op if already open or already closed.
   */
  readonly open: () => void;
  /** True once the channel has closed for any reason (explicit `end()`, client disconnect, queue overflow, or a fatal write). */
  readonly isClosed: () => boolean;
  /**
   * Idempotent: marks the channel closed, unsubscribes nothing itself (a
   * caller's {@link SseChannel.onClose} callback does that), and ends the
   * underlying HTTP response if it has not already ended. Calling `res.end()`
   * a second time (e.g. after the client already disconnected) is safe and
   * documented as a no-op by Node's `http.ServerResponse` — this method does
   * not need to distinguish "we are ending it" from "the client already
   * ended it."
   */
  readonly end: () => void;
  /**
   * Idempotent: marks the channel closed and runs every registered
   * {@link SseChannel.onClose} callback — but, unlike {@link SseChannel.end},
   * never touches `res` itself. For a caller that hits a failure *before*
   * ever calling {@link SseChannel.open} and wants to send a different,
   * non-SSE response instead (e.g. a JSON error body) rather than an empty
   * ended stream. Calling {@link SseChannel.end} in that situation would
   * end the response first and make the caller's own subsequent
   * `res.status(...).json(...)` a write-after-end failure; `abandon` avoids
   * that by leaving `res` completely untouched.
   */
  readonly abandon: () => void;
  /**
   * Registers a callback invoked exactly once when the channel closes, from
   * whichever cause fires first (explicit `end()`, a client disconnect
   * observed via the response's own `'close'` event, or an internal
   * overflow/write failure). Safe to call after the channel is already
   * closed — the callback then runs immediately, synchronously.
   */
  readonly onClose: (callback: () => void) => void;
}

/**
 * Builds a bounded, backpressure-aware SSE channel over an Express `Response`.
 * The channel does not know where events come from — a route wires its own
 * event source (a `RunLifecycle.stream` subscription, an `EventEmitter`
 * fan-in, a PTY's `onData`, …) to {@link SseChannel.enqueue} and lets the
 * channel own delivery, ordering, and backpressure.
 *
 * The response's own `'close'` event (the client disconnecting) is observed
 * from construction time, before {@link SseChannel.open} is ever called —
 * this lets a caller `await` some asynchronous subscribe step (as `runs.ts`
 * does against `RunLifecycle.stream`) and still detect "the client already
 * disappeared while we were waiting" via {@link SseChannel.isClosed} once
 * that await resolves, without the disconnect handler itself trying to
 * re-end an already-gone response (see {@link SseChannel.end}'s doc for why
 * that distinction doesn't actually need special-casing).
 *
 * @param res - The response to stream over, typed against the raw `node:http` `ServerResponse`
 * rather than Express's own `Response` — Express's `Response` extends `ServerResponse` directly,
 * so every existing Express caller still satisfies this signature unchanged. Never read from — only
 * `write`/`statusCode`/`setHeader`/`flushHeaders`/`end`/`on('close'|'drain')` are used, all of
 * which exist identically on the raw type (the one genuinely Express-specific call this function
 * used to make, `res.status(200)`, is `res.statusCode = 200` here instead — the same assignment
 * Express's own `.status()` performs internally).
 * @param options - See {@link CreateSseChannelOptions}.
 * @complexity `enqueue`/`open`/`end` are O(1) amortized; a full queue drain is O(events written).
 * @overallScore 100/100
 */
export function createSseChannel<E extends SseEvent>(
  res: ServerResponse,
  options: CreateSseChannelOptions<E> = {},
): SseChannel<E> {
  const maxQueuedEvents = options.maxQueuedEvents ?? DEFAULT_MAX_QUEUED_SSE_EVENTS;
  const formatEvent = options.formatEvent ?? defaultFormatEvent;

  const queue: E[] = [];
  let flowing = false;
  let writable = true;
  let closed = false;
  const closeCallbacks: Array<() => void> = [];

  const markClosed = (): void => {
    if (closed) return;
    closed = true;
    // Copy first: a callback that itself calls `onClose` during this loop must not be invoked
    // twice or mutate the array being iterated.
    const callbacks = closeCallbacks.splice(0, closeCallbacks.length);
    for (const callback of callbacks) callback();
  };

  const end = (): void => {
    markClosed();
    if (!res.writableEnded) res.end();
  };

  const pump = (): void => {
    if (!flowing || closed) return;
    while (writable && queue.length > 0) {
      const event = queue.shift()!;
      let wroteOk: boolean;
      try {
        wroteOk = res.write(formatEvent(event));
      } catch (error) {
        // A dead/broken transport must never throw back through whatever is producing events —
        // stop this channel only.
        options.onWriteError?.(error);
        end();
        return;
      }
      if (wroteOk === false) writable = false;
      if (options.isEndEvent?.(event)) {
        end();
        return;
      }
    }
  };

  const enqueue = (event: E): void => {
    if (closed) return;
    if (queue.length >= maxQueuedEvents) {
      // Slow/stalled consumer — disconnect rather than grow memory without bound.
      end();
      return;
    }
    queue.push(event);
    pump();
  };

  const open = (): void => {
    if (closed || flowing) return;
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    flowing = true;
    pump();
  };

  res.on('drain', () => {
    writable = true;
    pump();
  });
  // The client disconnecting only marks the channel closed — it must not itself call `res.end()`
  // (see `end()`'s doc for why calling it a second time would be safe anyway, but a route that
  // still wants to send a *non-SSE* response — e.g. a JSON error — after discovering a subscribe
  // failed needs `isClosed()` to be observable without the response having been touched yet).
  res.on('close', markClosed);

  const onClose = (callback: () => void): void => {
    if (closed) {
      callback();
      return;
    }
    closeCallbacks.push(callback);
  };

  return {
    enqueue,
    open,
    isClosed: () => closed,
    end,
    abandon: markClosed,
    onClose,
  };
}

/** Reads a reconnect cursor from the standard `Last-Event-ID` header, falling back to an `afterCursor` query parameter. Shared by any SSE route that supports reconnect replay (the header takes precedence since it is what browsers set automatically on `EventSource` reconnect). */
export function requestedAfterCursor(req: {
  get(name: string): string | undefined;
  query: Record<string, unknown>;
}): string | null {
  const header = req.get('last-event-id');
  if (header && header.length > 0) return header;
  const query = req.query.afterCursor;
  return typeof query === 'string' && query.length > 0 ? query : null;
}

/**
 * Writes an `ApiError`, wrapped in the standard `{ error }` envelope, directly onto a raw
 * `ServerResponse` — for the narrow window before an `SseChannel` has opened (so Express's own
 * `res.json()` response wrapper isn't safe to use yet). Produces the identical
 * `createApiErrorResponse(error)` envelope shape `response.ts`'s `sendApiError`/`sendJson` do —
 * this just writes that same shape without going through Express's response helper.
 */
export function sendRawApiError(res: ServerResponse, status: number, error: ApiError): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(createApiErrorResponse(error)));
}
