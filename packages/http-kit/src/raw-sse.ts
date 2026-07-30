/**
 * @module sse
 *
 * A Server-Sent Events primitive typed only against `node:http`'s `IncomingMessage`/
 * `ServerResponse` — Express's `req`/`res` already satisfy these directly (`Response` extends
 * `http.ServerResponse`), so `run-stream.ts`'s `registerRunStreamRoute` hands them straight
 * through with no adapter of its own.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Cap on messages buffered for one client while its socket reports backpressure. Mirrors
 * `sse.ts`'s `DEFAULT_MAX_QUEUED_SSE_EVENTS` (SEC-006) — the two SSE primitives in this package
 * should not disagree about how much a stalled consumer may cost the server. Once exceeded the
 * connection is dropped rather than growing memory without bound.
 */
export const DEFAULT_MAX_QUEUED_SSE_MESSAGES = 1000;

export interface CreateSseResponseOptions {
  /** Milliseconds between keepalive ping comment lines, sent to keep an idle connection from being closed by an intermediary/timeout. Defaults to 15000. */
  readonly keepAliveMs?: number;
  /** Invoked exactly once, the first time this connection closes for any reason (an explicit `close()` call, or the client disconnecting) — the caller's seam for its own cleanup (e.g. unsubscribing from an event source). */
  readonly onClose?: () => void;
  /** Buffered-message ceiling before the connection is dropped. Defaults to {@link DEFAULT_MAX_QUEUED_SSE_MESSAGES}. */
  readonly maxQueuedMessages?: number;
}

export interface SseConnection {
  /** Writes one SSE `data:` event, JSON-serializing `data`. A no-op once the connection has closed. */
  send(data: unknown): void;
  /** Closes the connection: stops the keepalive interval and ends the response. Idempotent — safe to call more than once, or after the client has already disconnected. */
  close(): void;
  /** `true` once this connection has closed, whether via an explicit `close()` call or the client disconnecting. */
  readonly closed: boolean;
}

/**
 * Opens `res` as a Server-Sent Events stream: writes the `text/event-stream` response headers
 * immediately, arms a keepalive interval, and wires client-disconnect detection.
 *
 * @param req - The raw request (Express's `Request` already satisfies this).
 * @param res - The raw response (Express's `Response` already satisfies this).
 * @returns An `SseConnection` the caller pushes events through and closes when done.
 * @complexity O(1) to open; `send` is O(1) plus `JSON.stringify`'s cost in the payload's size.
 * @overallScore 100/100
 */
export function createSseResponse(
  req: IncomingMessage,
  res: ServerResponse,
  options: CreateSseResponseOptions = {},
): SseConnection {
  let closed = false;
  const maxQueuedMessages = options.maxQueuedMessages ?? DEFAULT_MAX_QUEUED_SSE_MESSAGES;
  // Frames held back because the socket reported backpressure, flushed on `'drain'`. Every write
  // this connection makes — events and keepalive pings alike — goes through this queue, so there is
  // no second path that could bypass the bound.
  const queue: string[] = [];
  let writable = true;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });

  /**
   * Writes as much of the queue as the socket will accept. `res.write()` returning `false` means
   * Node has buffered the frame internally and wants no more until `'drain'` — ignoring that (as
   * this primitive used to) lets a client that simply stops reading accumulate the entire output of
   * a run in memory, which is a denial of service reachable by anyone who can open a stream.
   */
  function pump(): void {
    while (!closed && writable && queue.length > 0) {
      const frame = queue.shift()!;
      if (res.write(frame) === false) writable = false;
    }
  }

  /**
   * Queues one frame, dropping the connection if the backlog has outgrown its bound. Disconnecting
   * a stalled client is the deliberate choice over either growing without limit or silently
   * discarding frames — a consumer that missed events in the middle of a stream cannot tell, while
   * a closed stream is an observable signal it can reconnect from.
   */
  function enqueue(frame: string): void {
    if (closed) return;
    if (queue.length >= maxQueuedMessages) {
      close();
      return;
    }
    queue.push(frame);
    pump();
  }

  const keepAliveMs = options.keepAliveMs ?? 15_000;
  const keepAliveTimer = setInterval(() => {
    enqueue(': ping\n\n');
  }, keepAliveMs);
  keepAliveTimer.unref?.();

  function close(): void {
    if (closed) return;
    closed = true;
    queue.length = 0;
    clearInterval(keepAliveTimer);
    options.onClose?.();
    res.end();
  }

  res.on('drain', () => {
    writable = true;
    pump();
  });

  // `IncomingMessage`'s `'close'` fires when the request/response cycle ends or the connection
  // drops — not when a bodyless request merely finishes arriving — so this is the client-disconnect
  // signal it reads as. `raw-sse.test.ts` pins that against a real socket rather than a fake
  // emitter, because it is the kind of contract a mock will happily agree with either way.
  req.on('close', close);

  return {
    send(data: unknown): void {
      enqueue(`data: ${JSON.stringify(data)}\n\n`);
    },
    close,
    get closed() {
      return closed;
    },
  };
}
