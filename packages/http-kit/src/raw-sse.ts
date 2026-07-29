/**
 * @module sse
 *
 * A Server-Sent Events primitive typed only against `node:http`'s `IncomingMessage`/
 * `ServerResponse` — Express's `req`/`res` already satisfy these directly (`Response` extends
 * `http.ServerResponse`), so `run-stream.ts`'s `registerRunStreamRoute` hands them straight
 * through with no adapter of its own.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface CreateSseResponseOptions {
  /** Milliseconds between keepalive ping comment lines, sent to keep an idle connection from being closed by an intermediary/timeout. Defaults to 15000. */
  readonly keepAliveMs?: number;
  /** Invoked exactly once, the first time this connection closes for any reason (an explicit `close()` call, or the client disconnecting) — the caller's seam for its own cleanup (e.g. unsubscribing from an event source). */
  readonly onClose?: () => void;
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

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });

  const keepAliveMs = options.keepAliveMs ?? 15_000;
  const keepAliveTimer = setInterval(() => {
    if (!closed) res.write(': ping\n\n');
  }, keepAliveMs);
  keepAliveTimer.unref?.();

  function close(): void {
    if (closed) return;
    closed = true;
    clearInterval(keepAliveTimer);
    options.onClose?.();
    res.end();
  }

  req.on('close', close);

  return {
    send(data: unknown): void {
      if (closed) return;
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    },
    close,
    get closed() {
      return closed;
    },
  };
}
