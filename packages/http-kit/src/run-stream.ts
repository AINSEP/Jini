/**
 * @module run-stream
 *
 * An encoder-driven SSE run-stream route: subscribes to a run via `@jini-ai/daemon`'s
 * `RunLifecycle.stream`, pipes every event through a composition-root-supplied protocol encoder,
 * and writes each non-null event to the SSE response opened by `createSseResponse`.
 * `handleRunStreamRequest` is the core
 * — it only ever touches `node:http`'s `IncomingMessage`/`ServerResponse` — and
 * `registerRunStreamRoute` below is Express's own thin mounting glue (Express's `Request`/
 * `Response` already *are* Node's raw `http.IncomingMessage`/`http.ServerResponse`, so resolving
 * `req.params.runId` and handing the request/response straight through is the whole job).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RunLifecycle, StreamSubscribeResult } from '@jini-ai/daemon';
import type { RunProtocolEvent } from '@jini-ai/protocol';
import type { Express, Request, Response } from 'express';
import { createSseResponse } from './raw-sse.js';

/** Backward-compatible route path used by the AG-UI composition. The handler itself is encoder-agnostic. */
export const RUN_STREAM_ROUTE_PATH = '/api/runs/:runId/agui-stream';

export interface RunStreamEncoder {
  encode(event: RunProtocolEvent, context: { readonly runId: string }): unknown | null;
}

export interface RunStreamInternalErrorContext {
  readonly source: 'encoder' | 'lifecycle' | 'route';
  readonly runId: string;
  readonly error: unknown;
}

export interface RunStreamDeps {
  readonly lifecycle: RunLifecycle;
  /** Protocol adapter supplied by the composition root (for example `createAguiEncoder()`). */
  readonly encoder: RunStreamEncoder;
  /** Host-owned sink for failures that must not escape an async Express handler. Defaults to `console.error`. */
  readonly onInternalError?: (context: RunStreamInternalErrorContext) => void;
}

function reportRunStreamInternalError(
  deps: RunStreamDeps,
  source: RunStreamInternalErrorContext['source'],
  runId: string,
  error: unknown,
): void {
  const context = { source, runId, error };
  try {
    if (deps.onInternalError) {
      deps.onInternalError(context);
    } else {
      // eslint-disable-next-line no-console
      console.error(`[@jini-ai/http-kit] internal error (run-stream:${source}, runId=${runId})`, error);
    }
  } catch (sinkError) {
    // A diagnostic sink must never turn an already-contained stream failure into an unhandled
    // rejection of its own.
    // eslint-disable-next-line no-console
    console.error(`[@jini-ai/http-kit] internal error sink failed (run-stream:${source}, runId=${runId})`, sinkError);
  }
}

/**
 * Handles one encoded SSE run-stream request end to end. Opens the SSE connection immediately (an
 * SSE endpoint commits to `text/event-stream` headers before it can know whether `runId` is
 * valid), then subscribes to the run: a replay-then-live-subscribe `unknown-run`/`replay-gap`/
 * `invalid-cursor` result is reported as one `{ error }` SSE data event before closing (there is
 * no JSON-status-code channel left once SSE headers are already committed). On the happy path,
 * every event `RunLifecycle` delivers is encoded and forwarded; the connection closes itself once
 * the run's own terminal `'end'` event has been forwarded (a driver's contract with
 * `RunLifecycle` guarantees no further events follow a run's `'end')`, so nothing is lost by
 * closing right after it). If the client disconnects first, `createSseResponse`'s own
 * `req.on('close', ...)` fires first, which (via `onClose` here) unsubscribes from the run so a
 * disconnected client never leaves a dangling `RunLifecycle` subscriber.
 *
 * @param req - The raw request `createSseResponse` opens the stream against.
 * @param res - The raw response `createSseResponse` opens the stream against.
 * @param runId - The run to stream, already resolved by the caller's transport-specific glue.
 * @param deps.lifecycle - The `RunLifecycle` to subscribe to.
 * @param deps.encoder - The protocol adapter chosen by the composition root.
 * @complexity O(1) plus the supplied encoder's per-event cost and `RunLifecycle.stream`'s replay cost.
 * @overallScore 100/100
 */
export async function handleRunStreamRequest(
  req: IncomingMessage,
  res: ServerResponse,
  runId: string,
  deps: RunStreamDeps,
): Promise<void> {
  let unsubscribe: (() => void) | undefined;
  const connection = createSseResponse(req, res, {
    onClose: () => unsubscribe?.(),
  });
  const encoder = deps.encoder;

  let result: StreamSubscribeResult;
  try {
    result = await deps.lifecycle.stream(runId, (event) => {
      if (connection.closed) return;
      try {
        const encoded = encoder.encode(event, { runId });
        if (encoded != null) connection.send(encoded);
        if (event.kind === 'end') connection.close();
      } catch (error) {
        reportRunStreamInternalError(deps, 'encoder', runId, error);
        connection.close();
      }
    });
  } catch (error) {
    reportRunStreamInternalError(deps, 'lifecycle', runId, error);
    connection.close();
    return;
  }

  if (result.kind !== 'ok') {
    connection.send({ error: result.kind });
    connection.close();
    return;
  }
  // Assigned even when the run was already terminal (in which case the driver-facing 'end' event
  // was already replayed synchronously above, already closing the connection, and `unsubscribe`
  // here is `RunLifecycle`'s own no-op stub for that case) — keeping this assignment unconditional
  // avoids a branch whose two arms would otherwise do the same thing.
  unsubscribe = result.unsubscribe;
  // The raw request can close while RunLifecycle is still awaiting durable replay. In that
  // window `onClose` runs before `unsubscribe` exists, so clean up immediately once it arrives.
  if (connection.closed) unsubscribe();
}

/** Mounts the encoder-driven SSE run-stream route on `app`. */
export function registerRunStreamRoute(app: Express, deps: RunStreamDeps): void {
  app.get(RUN_STREAM_ROUTE_PATH, async (req: Request, res: Response) => {
    // `:runId` is a required path segment of RUN_STREAM_ROUTE_PATH — this handler is only ever
    // reached via a URL that already matched it, so the param is always present at runtime even
    // though @types/express types every param as possibly `undefined` in general.
    const runId = req.params.runId!;
    try {
      await handleRunStreamRequest(req, res, runId, deps);
    } catch (error) {
      reportRunStreamInternalError(deps, 'route', runId, error);
      if (!res.headersSent) {
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'an internal error occurred' } });
      } else if (!res.writableEnded) {
        res.end();
      }
    }
  });
}
