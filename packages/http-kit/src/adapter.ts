/**
 * The module's top orchestration layer: wires request parsing, the same-origin guard, a route's
 * `handle`, and response serialization into a single Express route handler. This is the only
 * file in the module that knows about Express `req`/`res` on the mounting side.
 */
import { randomUUID } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import { createApiError } from '@jini-ai/protocol';
import { rawInput } from './request.js';
import { sendApiError, sendJson, statusForError } from './response.js';
import { guardSameOrigin, type OriginContext } from './origin.js';
import type { JsonRouteSpec } from './types.js';

export interface AdapterInternalErrorContext {
  /** HTTP method of the route whose handler threw. */
  readonly method: string;
  /** Registered path of the route whose handler threw. */
  readonly path: string;
  /** Echoed back to the caller as the response's `requestId`, so an operator can tie a user's report to this log line. */
  readonly correlationId: string;
  /** The exception exactly as thrown — never sent to the caller. */
  readonly error: unknown;
}

/** Server startup state a mounted route needs to evaluate its same-origin guard. */
export interface AdapterContext extends OriginContext {
  /**
   * Host-owned sink for the real exception behind a generic `INTERNAL_ERROR` response (SEC-005).
   * Defaults to `console.error`. Mirrors the per-module `onInternalError` seams (`connectors.ts`,
   * `delegated-tools.ts`, …); this one is the catch-all for a route that throws outside its own
   * guarded path.
   */
  readonly onInternalError?: (context: AdapterInternalErrorContext) => void;
}

function defaultInternalErrorSink(context: AdapterInternalErrorContext): void {
  // eslint-disable-next-line no-console
  console.error(`[@jini-ai/http-kit] internal error (${context.method.toUpperCase()} ${context.path}, correlationId=${context.correlationId})`, context.error);
}

/**
 * Identity function that pins a route spec's generic parameters at the definition site so
 * callers do not have to repeat them. The returned spec is consumed by `mountJsonRoute` (live)
 * and by tests (direct invocation of `route.parse` / `route.handle`).
 */
export function defineJsonRoute<Input, Output, Deps>(
  spec: JsonRouteSpec<Input, Output, Deps>,
): JsonRouteSpec<Input, Output, Deps> {
  return spec;
}

/**
 * Mounts one JsonRouteSpec on an Express app. The Adapter is the only code here that knows
 * about req/res; the route's parse and handle functions operate on `RouteInputContext` and
 * `Deps` respectively, so they are unit testable without Express.
 */
export function mountJsonRoute<Input, Output, Deps>(
  app: Express,
  spec: JsonRouteSpec<Input, Output, Deps>,
  deps: Deps,
  adapter: AdapterContext,
): void {
  app[spec.method](spec.path, async (req: Request, res: Response) => {
    // The client-disconnect signal a `handle` can opt into via its 3rd param. Observed on `res`,
    // not `req` — `sse.ts` already established why for this exact "detect a disconnect before
    // ever writing a response" shape (its own doc: safe to register "before `open` is ever
    // called"). `req`'s own `'close'` was tried first here and reverted: on a REAL socket, a
    // POST's body is fully read by Express's body parser before this handler ever runs, and that
    // finishes the *request* stream — firing `req`'s `'close'` immediately, long before any
    // response is sent, with no disconnect having happened at all. `res`'s `'close'` isn't
    // entangled with the request body's lifecycle, only with the response's own connection, so it
    // doesn't share that false positive. Registered before anything awaits and unconditionally
    // detached in `finally` below, so it never outlives one request.
    const abortController = new AbortController();
    const onResponseClose = () => abortController.abort();
    // Optional-called rather than assumed present: a real Express `Response` always has `.on`, but
    // several existing unit tests drive `mountJsonRoute` against a minimal `{status,json}` double
    // that doesn't implement `EventEmitter` at all. Those callers simply never observe an abort,
    // which is the correct behavior for a double that never fires `close` anyway.
    res.on?.('close', onResponseClose);
    try {
      if (spec.requireSameOrigin) {
        const origin = guardSameOrigin(req, adapter);
        if (!origin.ok) {
          sendApiError(res, statusForError(origin.error), origin.error);
          return;
        }
      }
      const parsed = spec.parse(rawInput(req));
      if (!parsed.ok) {
        sendApiError(res, statusForError(parsed.error), parsed.error);
        return;
      }
      const result = await spec.handle(parsed.value, deps, abortController.signal);
      // `abortController.signal` can only have been aborted by `onResponseClose` firing while the
      // `await` above was pending — nothing here runs concurrently with it — so this unambiguously
      // means the client was already gone before any response was sent. Writing one now would be
      // wasted work at best and, worse, would route a benign disconnect into the SEC-005 catch
      // below as a false internal error if the socket rejects the write.
      if (abortController.signal.aborted) return;
      if (!result.ok) {
        sendApiError(res, statusForError(result.error), result.error);
        return;
      }
      sendJson(res, spec.successStatus ?? 200, result.value);
    } catch (e) {
      // SEC-005. This catch exists for exceptions no route anticipated, which makes it precisely
      // the path most likely to be holding something private: a driver error naming a database
      // file, a connection string, a credential a provider echoed back. Serializing `e.message`
      // into the response handed all of that to the caller — and because `health.ts`'s probes are
      // mounted ahead of the security middleware and exempted from the bearer gate, an unauthorized
      // caller could read it too, simply by getting a readiness dependency to fail. The real error
      // still reaches the operator through the sink, correlated to what the caller was told.
      const correlationId = randomUUID();
      const sink = adapter.onInternalError ?? defaultInternalErrorSink;
      sink({ method: spec.method, path: spec.path, correlationId, error: e });
      sendApiError(res, 500, createApiError('INTERNAL_ERROR', 'an internal error occurred', { requestId: correlationId }));
    } finally {
      res.off?.('close', onResponseClose);
    }
  });
}
