/**
 * The module's top orchestration layer: wires request parsing, the same-origin guard, a route's
 * `handle`, and response serialization into a single Express route handler. This is the only
 * file in the module that knows about Express `req`/`res` on the mounting side.
 */
import type { Express, Request, Response } from 'express';
import { ClientFacingError, payloadTooLargeError, statusForError, type JsonRouteAuthorize, type ServerApiError, type Result, type RouteHostInternalErrorContext, type RouteHostContext } from '@jini-ai/core/contracts/server';
import { reportRouteInternalError } from './internal-error.js';
import { rawInput } from './request.js';
import { sendApiError, sendJson } from './response.js';
import { passesSameOriginGuard } from './origin.js';
import type { JsonRouteSpec } from './types.js';

/**
 * Combines required route fields and optional settings into a fresh spec while pinning its generic
 * parameters at the definition site so callers do not have to repeat them. Optional settings take
 * precedence. The returned spec is consumed by `mountJsonRoute` (live)
 * and by tests (direct invocation of `route.parse` / `route.handle`).
 * @param optionalArgs - Origin/success/body-size policy and optional injected host ports.
 * @returns A fresh route spec; never mutates either argument.
 * @complexity O(1) time/space for the fixed spec fields.
 */
export function defineJsonRoute<Input, Output, Deps, Context = undefined>(requiredArgs: Omit<JsonRouteSpec<Input, Output, Deps, Context>, 'requireSameOrigin' | 'successStatus' | 'ports' | 'maxBodyBytes'>, optionalArgs: Pick<JsonRouteSpec<Input, Output, Deps, Context>, 'requireSameOrigin' | 'successStatus' | 'ports' | 'maxBodyBytes'> = {}
): JsonRouteSpec<Input, Output, Deps, Context> {
  return { ...requiredArgs, ...optionalArgs };
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
export function mountJsonRoute<Input, Output, Deps, Context = undefined>({ app, spec, deps, adapter }: { readonly app: Express; readonly spec: JsonRouteSpec<Input, Output, Deps, Context>; readonly deps: Deps; readonly adapter?: RouteHostContext }, _optional: Record<string, never> = {}
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
      refuseOversizedBody({ spec, body: raw.body });
      if (spec.ports?.workspace) await spec.ports.workspace({ raw, deps });
      if (!allowRouteOrigin({ req, res, spec, adapter })) return;
      let context: Context | undefined;
      if (spec.ports?.authenticate) context = await spec.ports.authenticate({ raw, res, deps });
      const parsed = spec.parse(raw);
      if (!parsed.ok) refuseReturned({ error: parsed.error });
      // The route chooses where authorization occurs: reads may authorize before validation,
      // while writes must reject an inconsistent tenant target before asking for a permission.
      const authorize: JsonRouteAuthorize = async ({ permission, entityType }) => {
        if (!spec.ports?.authorize) throw new Error('JSON route authorizer is required');
        await spec.ports.authorize({ context, deps, permission, entityType });
      };
      const result = await spec.handle({ input: parsed.value, deps, context, authorize }, { signal: abortController.signal });
      sendRouteResult({ res, result, spec, signal: abortController.signal });
    } catch (e) {
      sendRouteException({ res, spec, adapter, error: e });
    } finally {
      res.off?.('close', onResponseClose);
    }
  });
}

/**
 * A returned failure (parse or handle) takes the same path as a thrown `ClientFacingError`, so a host
 * error port sees every caller-visible failure in one shape and writes it with one envelope. Without
 * an error port the answer is unchanged: the `ClientFacingError` branch sends the same status and body.
 * @returns Never; the route's catch answers it.
 * @complexity O(1) time/space.
 */
function refuseReturned({ error }: { readonly error: ServerApiError }, _optional: Record<string, never> = {}): never {
  throw new ClientFacingError({ apiError: error });
}

/**
 * Enforces the route's `maxBodyBytes`. Express has already parsed the body under the app's own (looser)
 * parser limit, and a second `express.json({ limit })` would skip an already-parsed body, so the cap
 * re-measures the parsed value — as `rejectOversizedJsonBody` does — and refuses with core's 413 error.
 * @returns Void; throws the refusal through the same path as a returned failure.
 * @complexity O(body size) to serialize and measure the parsed body.
 */
function refuseOversizedBody({ spec, body }: { readonly spec: Pick<JsonRouteSpec<unknown, unknown, unknown>, 'method' | 'maxBodyBytes'>; readonly body: unknown }, _optional: Record<string, never> = {}): void {
  if (spec.maxBodyBytes === undefined || spec.method === 'get') return;
  if (Buffer.byteLength(JSON.stringify(body ?? {}), 'utf8') > spec.maxBodyBytes) refuseReturned({ error: payloadTooLargeError({ maxBytes: spec.maxBodyBytes }) });
}

function allowRouteOrigin({ req, res, spec, adapter }: {
  readonly req: Request;
  readonly res: Response;
  readonly spec: Pick<JsonRouteSpec<unknown, unknown, unknown>, 'requireSameOrigin'>;
  readonly adapter: RouteHostContext | undefined;
}, _optional: Record<string, never> = {}): boolean {
  if (!spec.requireSameOrigin) return true;
  if (!adapter) throw new Error('same-origin adapter context is required');
  return passesSameOriginGuard({ req, res, origin: adapter });
}

function sendRouteResult<Output>({ res, result, spec, signal }: {
  readonly res: Response;
  readonly result: Result<Output>;
  readonly spec: Pick<JsonRouteSpec<unknown, Output, unknown>, 'successStatus'>;
  readonly signal: AbortSignal;
}, _optional: Record<string, never> = {}): void {
  // `signal` can only have been aborted by `onResponseClose` firing while the
  // `await spec.handle` in the request handler was pending — nothing here runs concurrently
  // with it — so this unambiguously means the client was already gone before any response was
  // sent. Writing one now would be wasted work at best and, worse, would route a benign
  // disconnect into the SEC-005 catch as a false internal error if the socket rejects the write.
  if (signal.aborted) return;
  if (!result.ok) refuseReturned({ error: result.error });
  sendJson({ res, status: spec.successStatus ?? 200, body: result.value });
}

function sendRouteException<Deps, Context>({ res, spec, adapter, error: e }: {
  readonly res: Response;
  readonly spec: Pick<JsonRouteSpec<unknown, unknown, Deps, Context>, 'method' | 'path' | 'ports'>;
  readonly adapter: RouteHostContext | undefined;
  readonly error: unknown;
}, _optional: Record<string, never> = {}): void {
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
  // Exceptions can echo credentials: the host sink gets the original; the default line prints class and code only.
  const apiError = reportRouteInternalError<Omit<RouteHostInternalErrorContext, 'correlationId'>>({
    report: { method: spec.method, path: spec.path, error: e },
    logSource: `${spec.method.toUpperCase()} ${spec.path}`,
    message: 'The server could not finish this request. Check whether your change was saved, then copy the request ID and report this problem.',
  }, { onInternalError: adapter?.onInternalError });
  sendApiError({ res, status: 500, error: apiError });
}
