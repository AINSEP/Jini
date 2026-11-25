/**
 * The module's top orchestration layer: wires request parsing, the same-origin guard, a route's
 * `handle`, and response serialization into a single Express route handler. This is the only
 * file in the module that knows about Express `req`/`res` on the mounting side.
 */
import type { Express, Request, Response } from 'express';
import { ClientFacingError, isRouteReply, payloadTooLargeError, statusForError, type JsonRouteAuthorize, type RouteReply, type Result, type RouteHostInternalErrorContext, type RouteHostContext, type RouteInputContext, type ServerApiError } from '@jini-ai/core/contracts/server';
import { reportRouteInternalError } from './internal-error.js';
import { rawInput } from './request.js';
import { sendApiError, sendJson } from './response.js';
import { passesSameOriginGuard } from './origin.js';
import type { JsonRoutePorts, JsonRouteSpec, RouteMountOptions, RouteRequestOptIns } from './types.js';

/**
 * Combines required route fields and optional settings into a fresh spec while pinning its generic
 * parameters at the definition site so callers do not have to repeat them. Optional settings take
 * precedence. The returned spec is consumed by `mountJsonRoute` (live)
 * and by tests (direct invocation of `route.parse` / `route.handle`).
 * @param optionalArgs - Origin/success policy, body ceiling and optional injected host ports.
 * @returns A fresh route spec; never mutates either argument.
 * @complexity O(1) time/space for the fixed spec fields.
 */
export function defineJsonRoute<Input, Output, Deps, Context = undefined>(requiredArgs: Omit<JsonRouteSpec<Input, Output, Deps, Context>, 'requireSameOrigin' | 'successStatus' | 'ports' | 'maxBodyBytes'>, optionalArgs: Pick<JsonRouteSpec<Input, Output, Deps, Context>, 'requireSameOrigin' | 'successStatus' | 'ports' | 'maxBodyBytes' | keyof RouteRequestOptIns> = {}
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
export function mountJsonRoute<Input, Output, Deps, Context = undefined>({ app, spec, deps, adapter }: { readonly app: Express; readonly spec: JsonRouteSpec<Input, Output, Deps, Context>; readonly deps: Deps; readonly adapter?: RouteHostContext }, optional: RouteMountOptions = {}
): void {
  assertRequestFactsPort({ spec });
  // Read once at mount: the per-request callback stays within the complexity budget.
  const onReturnedError = spec.ports?.onReturnedError;
  app[spec.method](spec.path, ...(optional.bodyParsers ?? []), async (req: Request, res: Response) => {
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
      applyResponseHeaders({ res, headers: spec.responseHeaders });
      const raw = routeRequestInput({ req, spec, deps });
      if (!allowRouteBody({ req, res, spec })) return;
      if (spec.ports?.workspace) await spec.ports.workspace({ raw, deps });
      if (!allowRouteOrigin({ req, res, spec, adapter })) return;
      let context: Context | undefined;
      if (spec.ports?.authenticate) context = await spec.ports.authenticate({ raw, res, deps });
      await parseHandleAndSend({ res, raw, spec, deps, context, onReturnedError, signal: abortController.signal });
    } catch (e) {
      sendRouteException({ res, spec, adapter, error: e });
    } finally {
      res.off?.('close', onResponseClose);
    }
  });
}

/**
 * Parse, authorize, handle and answer, after the pre-parse gates admitted the request. Split out of
 * the per-request callback only to keep it within the complexity budget. Not awaited-before-handle:
 * `parse` and `authorize` are synchronous, so `handle` still starts in the same tick as before the
 * split (adapter-pins.test.ts pins that a disconnect right after dispatch reaches `handle`'s signal).
 */
async function parseHandleAndSend<Input, Output, Deps, Context>({ res, raw, spec, deps, context, onReturnedError, signal }: {
  readonly res: Response; readonly raw: RouteInputContext; readonly spec: JsonRouteSpec<Input, Output, Deps, Context>;
  readonly deps: Deps; readonly context: Context | undefined;
  readonly onReturnedError: JsonRoutePorts<Deps, Context>['onReturnedError']; readonly signal: AbortSignal;
}): Promise<void> {
  const parsed = spec.parse(raw);
  if (!parsed.ok) {
    sendReturnedFailure({ res, onReturnedError, error: parsed.error, phase: 'parse' });
    return;
  }
  const authorize = routeAuthorize({ ports: spec.ports, deps, context });
  const result = await spec.handle({ input: parsed.value, deps, context, authorize }, { signal });
  sendRouteResult({ res, result, spec: { successStatus: spec.successStatus, onReturnedError }, signal });
}

/**
 * A spec that opts into request facts needs the host's resolver: refusing at mount means a missing
 * port is a boot failure, never a route that silently runs without the client address.
 * @throws When `spec.requestFacts` is set and `spec.ports.requestFacts` is not.
 */
export function assertRequestFactsPort({ spec }: { readonly spec: Pick<RouteRequestOptIns, 'requestFacts'> & { readonly path: string; readonly ports?: { readonly requestFacts?: unknown } | undefined } }, _optional: Record<string, never> = {}): void {
  if (spec.requestFacts && !spec.ports?.requestFacts) throw new Error(`route ${spec.path} opts into requestFacts but no requestFacts port is mounted`);
}

/** Sets static or reply headers; a no-op without any, so a route that declares none writes nothing extra.
 *  `Vary` is appended (Express `res.vary`), never overwritten: a host middleware may already vary the
 *  answer (dev CORS adds `Origin`), and replacing it would let a cache serve one origin's answer to another. */
export function applyResponseHeaders({ res, headers }: { readonly res: Response; readonly headers: Readonly<Record<string, string>> | undefined }, _optional: Record<string, never> = {}): void {
  if (!headers) return;
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === 'vary') res.vary(value);
    else res.setHeader(name, value);
  }
}

/**
 * The route's `RouteInputContext` with only the opt-ins its spec declared: `raw.headers` for
 * `readHeaders`, `raw.facts` (resolved by the host port, with `req` and `deps`) for `requestFacts`.
 * Synchronous, so the gates after it keep their tick order.
 */
export function routeRequestInput<Deps, Context>({ req, spec, deps }: {
  readonly req: Request;
  readonly spec: Pick<RouteRequestOptIns, 'readHeaders' | 'requestFacts'> & { readonly ports?: JsonRoutePorts<Deps, Context> | undefined };
  readonly deps: Deps;
}, _optional: Record<string, never> = {}): RouteInputContext {
  const facts = spec.requestFacts ? spec.ports?.requestFacts?.({ req, deps }) : undefined;
  return rawInput({ req }, { ...(spec.readHeaders === undefined ? {} : { headers: spec.readHeaders }), ...(facts === undefined ? {} : { facts }) });
}

/** UTF-8 size of a body the host's parser already read: the bytes themselves, or its JSON re-serialization. */
function parsedBodyBytes(body: unknown): number {
  if (body === undefined || body === null) return 0;
  if (body instanceof Uint8Array) return body.byteLength;
  return new TextEncoder().encode(typeof body === 'string' ? body : JSON.stringify(body)).byteLength;
}

/**
 * Enforces the spec's `maxBodyBytes`, answering 413 with core's plain-words refusal when exceeded.
 * Why here and not in the parser: the host's `express.json()` already read the body with its own,
 * usually larger, limit, and a second parser skips a parsed body — so without this check the
 * route's declared ceiling was silently lost. The body is measured re-serialized, the same bytes
 * core's `jsonRoute` limits when mounted behind `node-bridge`, so both mount paths agree. A spec
 * cap above the host parser's limit is effectively clamped to it: the parser refuses first.
 * GET/HEAD are exempt, as in core.
 * The host's `ports.payloadTooLarge`, when mounted, writes the 413 instead of core's envelope.
 * @returns `false` when the refusal was written and the route must stop.
 * @complexity O(n) in the body size for the re-serialization; only when a cap is declared.
 */
export function allowRouteBody({ req, res, spec }: {
  readonly req: Request;
  readonly res: Response;
  readonly spec: Pick<JsonRouteSpec<unknown, unknown, unknown>, 'maxBodyBytes'> & { readonly ports?: { readonly payloadTooLarge?: JsonRoutePorts<unknown>['payloadTooLarge'] } | undefined };
}, _optional: Record<string, never> = {}): boolean {
  const maxBytes = spec.maxBodyBytes;
  if (maxBytes === undefined || req.method === 'GET' || req.method === 'HEAD') return true;
  if (parsedBodyBytes(req.body) <= maxBytes) return true;
  // The host's own 413 body (its admin client reads it); absent, core's envelope below is unchanged.
  if (spec.ports?.payloadTooLarge) {
    spec.ports.payloadTooLarge({ res, maxBytes });
    return false;
  }
  const error = payloadTooLargeError({ maxBytes });
  sendApiError({ res, status: statusForError({ error }), error });
  return false;
}

/**
 * The `authorize` a handler calls. The route chooses where authorization occurs: reads may
 * authorize before validation, while writes must reject an inconsistent tenant target before
 * asking for a permission. A by-id route's scope (`entityId`) reaches the host port; an id-free
 * call reaches it with the required arguments alone, exactly as before scopes existed. Likewise an
 * `entityType` reaches it only when the handler named one (list-style permissions name none).
 * @complexity O(1) plus the injected host authorizer.
 */
export function routeAuthorize<Deps, Context>({ ports, deps, context }: {
  readonly ports: JsonRoutePorts<Deps, Context> | undefined;
  readonly deps: Deps;
  readonly context: Context | undefined;
}, _optional: Record<string, never> = {}): JsonRouteAuthorize {
  return async ({ permission, entityType }, scope) => {
    if (!ports?.authorize) throw new Error('JSON route authorizer is required');
    const required = { context, deps, permission, ...(entityType === undefined ? {} : { entityType }) };
    await (scope ? ports.authorize(required, scope) : ports.authorize(required));
  };
}

export function allowRouteOrigin({ req, res, spec, adapter }: {
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
  readonly spec: { readonly successStatus: number | undefined; readonly onReturnedError: JsonRoutePorts<unknown>['onReturnedError'] };
  readonly signal: AbortSignal;
}, _optional: Record<string, never> = {}): void {
  // `signal` can only have been aborted by `onResponseClose` firing while the
  // `await spec.handle` in `parseHandleAndSend` was pending — nothing here runs concurrently
  // with it — so this unambiguously means the client was already gone before any response was
  // sent. Writing one now would be wasted work at best and, worse, would route a benign
  // disconnect into the SEC-005 catch as a false internal error if the socket rejects the write.
  if (signal.aborted) return;
  if (!result.ok) {
    sendReturnedFailure({ res, onReturnedError: spec.onReturnedError, error: result.error, phase: 'handle' });
    return;
  }
  if (isRouteReply(result.value)) {
    sendRouteReply({ res, reply: result.value });
    return;
  }
  const status = spec.successStatus ?? 200;
  // A no-content status forbids a body: end the response instead of serializing `result.value`
  // through `res.json`, matching hand-mounted handlers that answered `res.status(204).end()`.
  if (NO_CONTENT_STATUSES.has(status)) {
    res.status(status).end();
    return;
  }
  sendJson({ res, status, body: result.value });
}

/**
 * A handler's explicit `routeReply`: its headers, its status, and its JSON body — or, with no body, a
 * bare `send()` (no content type, never JSON `null`), which a 204/304 must be.
 */
function sendRouteReply({ res, reply }: { readonly res: Response; readonly reply: RouteReply }, _optional: Record<string, never> = {}): void {
  applyResponseHeaders({ res, headers: reply.headers });
  if (reply.body === undefined) {
    res.status(reply.status).send();
    return;
  }
  sendJson({ res, status: reply.status, body: reply.body });
}

/** Success statuses that must carry no response body (RFC 9110 §15.3.5, §15.3.6, §15.4.5). */
const NO_CONTENT_STATUSES: ReadonlySet<number> = new Set([204, 205, 304]);

function sendReturnedFailure({ res, onReturnedError, error, phase }: {
  readonly res: Response;
  readonly onReturnedError: JsonRoutePorts<unknown>['onReturnedError'];
  readonly error: ServerApiError;
  readonly phase: 'parse' | 'handle';
}, _optional: Record<string, never> = {}): void {
  const status = statusForError({ error });
  // Returned and thrown failures share one wire shape only when the host asks for it; the core
  // envelope stays the default so hosts that never opted in keep their pinned bodies.
  if (onReturnedError) {
    onReturnedError({ res, error, status, phase });
    return;
  }
  sendApiError({ res, status, error });
}

export function sendRouteException<Deps, Context>({ res, spec, adapter, error: e }: {
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
