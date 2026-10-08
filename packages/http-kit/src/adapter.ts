/**
 * The module's top orchestration layer: wires request parsing, the same-origin guard, a route's
 * `handle`, and response serialization into a single Express route handler. This is the only
 * file in the module that knows about Express `req`/`res` on the mounting side.
 */
import { randomUUID } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import { createApiError, type ApiError } from '@jini-ai/protocol';
import { rawInput } from './request.js';
import { sendApiError, sendJson, statusForError } from './response.js';
import { guardSameOrigin, type OriginContext } from './origin.js';
import type { JsonRouteAuthorize, JsonRouteSpec } from './types.js';

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
 * Thrown by a route's `handle` — or by anything it calls, at any depth — to bypass the SEC-005
 * redaction below with an `ApiError` the throwing code has already decided is safe for the caller
 * to see. This is the general-purpose version of a carve-out every consuming module of this catch
 * otherwise hand-rolls for itself: `attachments.ts`'s `AttachmentRejectedError`/
 * `respondToUploadFailure`, and `delegated-tools.ts`'s `errorKind: 'validation'` split on
 * `ToolExecutionResult`, both exist because nothing at THIS layer distinguished "the code that threw
 * already classified this as caller-safe" from "something unanticipated happened" — so a route with
 * no such local carve-out has no way to disclose even a deliberately-safe failure, and everything it
 * throws redacts identically to a stray filesystem or driver error.
 *
 * Prefer returning `err(apiError)` from `handle` when the failure is anticipated at that point —
 * that path already reaches the caller with full fidelity and never touches this catch at all. This
 * class exists for the same kind of failure discovered a level deeper: inside an awaited call
 * `handle` itself did not (or could not) wrap in its own `try`.
 *
 * Not a way to defeat SEC-005: the only way to reach the branch that reads this class is for code to
 * construct one itself, naming the exact `ApiError` — code and message — it is choosing to disclose.
 * Any thrown value that is not this class (including a plain `Error` with an actionable-looking
 * message) still redacts exactly as before; nothing here widens what a route can leak by accident.
 */
export class ClientFacingError extends Error {
  readonly apiError: ApiError;

  constructor({ apiError }: { readonly apiError: ApiError }, _optional: Record<string, never> = {}) {
    super(apiError.message);
    this.name = 'ClientFacingError';
    this.apiError = apiError;
  }
}

/**
 * Combines required route fields and optional settings into a fresh spec while pinning its generic
 * parameters at the definition site so callers do not have to repeat them. Optional settings take
 * precedence. The returned spec is consumed by `mountJsonRoute` (live)
 * and by tests (direct invocation of `route.parse` / `route.handle`).
 * @param optionalArgs - Origin/success policy and optional injected host ports.
 * @returns A fresh route spec; never mutates either argument.
 * @complexity O(1) time/space for the fixed spec fields.
 */
export function defineJsonRoute<Input, Output, Deps, Context = undefined>(requiredArgs: Omit<JsonRouteSpec<Input, Output, Deps, Context>, 'requireSameOrigin' | 'successStatus' | 'ports'>, optionalArgs: Pick<JsonRouteSpec<Input, Output, Deps, Context>, 'requireSameOrigin' | 'successStatus' | 'ports'> = {}
): JsonRouteSpec<Input, Output, Deps, Context> {
  const spec = { ...requiredArgs, ...optionalArgs };
  return spec;
}

/**
 * Mounts one JsonRouteSpec on an Express app. The Adapter is the only code here that knows
 * about req/res; the route's parse and handle functions operate on `RouteInputContext` and
 * `Deps` respectively, so they are unit testable without Express. Optional host ports preserve
 * workspace/auth/error policy without coupling this toolkit to a domain. An origin context is
 * required only for routes that opt into the same-origin guard.
 * @returns Void; registers one handler, without starting a listener.
 * @complexity O(1) setup and per-request overhead, plus parsing, host ports and handling.
 */
export function mountJsonRoute<Input, Output, Deps, Context = undefined>({ app, spec, deps, adapter }: { readonly app: Express; readonly spec: JsonRouteSpec<Input, Output, Deps, Context>; readonly deps: Deps; readonly adapter?: AdapterContext }, _optional: Record<string, never> = {}
): void {
  app[spec.method](spec.path, async (req: Request, res: Response) => {
    // The client-disconnect signal a `handle` can opt into via optional arguments. Observed on `res`,
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
      const raw = rawInput({ req });
      if (spec.ports?.workspace) await spec.ports.workspace({ raw, deps });
      if (spec.requireSameOrigin) {
        if (!adapter) throw new Error('same-origin adapter context is required');
        const origin = guardSameOrigin({ req, origin: adapter });
        if (!origin.ok) {
          sendApiError({ res, status: statusForError({ error: origin.error }), error: origin.error });
          return;
        }
      }
      let context: Context | undefined;
      if (spec.ports?.authenticate) context = await spec.ports.authenticate({ raw, res, deps });
      const parsed = spec.parse(raw);
      if (!parsed.ok) {
        sendApiError({ res, status: statusForError({ error: parsed.error }), error: parsed.error });
        return;
      }
      // The route chooses where authorization occurs: reads may authorize before validation,
      // while writes must reject an inconsistent tenant target before asking for a permission.
      const authorize: JsonRouteAuthorize = async ({ permission, entityType }) => {
        if (!spec.ports?.authorize) throw new Error('JSON route authorizer is required');
        await spec.ports.authorize({ context, deps, permission, entityType });
      };
      const result = await spec.handle({ input: parsed.value, deps, context, authorize }, { signal: abortController.signal });
      // `abortController.signal` can only have been aborted by `onResponseClose` firing while the
      // `await` above was pending — nothing here runs concurrently with it — so this unambiguously
      // means the client was already gone before any response was sent. Writing one now would be
      // wasted work at best and, worse, would route a benign disconnect into the SEC-005 catch
      // below as a false internal error if the socket rejects the write.
      if (abortController.signal.aborted) return;
      if (!result.ok) {
        sendApiError({ res, status: statusForError({ error: result.error }), error: result.error });
        return;
      }
      sendJson({ res, status: spec.successStatus ?? 200, body: result.value });
    } catch (e) {
      // An explicit host error port owns exception classification and serialization, including
      // its guard rejections. Hosts without it retain the SEC-005 policy below unchanged.
      if (spec.ports?.onError) {
        spec.ports.onError({ res, error: e });
        return;
      }
      // A route (or something it called) already classified this failure as safe to disclose —
      // see `ClientFacingError`'s own doc. Sent verbatim, at its own status; never routed to the
      // SEC-005 sink below, because nothing unanticipated happened.
      if (e instanceof ClientFacingError) {
        sendApiError({ res, status: statusForError({ error: e.apiError }), error: e.apiError });
        return;
      }
      // SEC-005. This catch exists for exceptions no route anticipated, which makes it precisely
      // the path most likely to be holding something private: a driver error naming a database
      // file, a connection string, a credential a provider echoed back. Serializing `e.message`
      // into the response handed all of that to the caller — and because `health.ts`'s probes are
      // mounted ahead of the security middleware and exempted from the bearer gate, an unauthorized
      // caller could read it too, simply by getting a readiness dependency to fail. The real error
      // still reaches the operator through the sink, correlated to what the caller was told.
      const correlationId = randomUUID();
      const sink = adapter?.onInternalError ?? defaultInternalErrorSink;
      sink({ method: spec.method, path: spec.path, correlationId, error: e });
      sendApiError({ res, status: 500, error: createApiError({ code: 'INTERNAL_ERROR', message: 'an internal error occurred' }, { requestId: correlationId }) });
    } finally {
      res.off?.('close', onResponseClose);
    }
  });
}
