/**
 * The module's top orchestration layer: wires request parsing, the same-origin guard, a route's
 * `handle`, and response serialization into a single Express route handler. This is the only
 * file in the module that knows about Express `req`/`res` on the mounting side.
 */
import type { Express, Request, Response } from 'express';
import { ClientFacingError, guardSameOrigin, httpFallbackCopy, internalErrorMessage, isRouteReply, payloadTooLargeError, statusForError, type JsonRouteAuthorize, type RouteReply, type Result, type RouteHostInternalErrorContext, type RouteErrorPorts, type RouteHostContext, type RouteInputContext, type ServerApiError } from '@jini-ai/core/contracts/server';
import { runOperation, UNAVAILABLE_ERROR_ID, type DescribedFailure, type ErrorReporter, type OperationVerdict } from '@jini-ai/core/errors/reporter';
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
export function mountJsonRoute<Input, Output, Deps, Context = undefined>({ app, spec, deps: mountedDeps, adapter }: { readonly app: Express; readonly spec: JsonRouteSpec<Input, Output, Deps, Context>; readonly deps: Deps; readonly adapter?: RouteHostContext }, optional: RouteMountOptions<Deps> = {}
): void {
  assertRequestFactsPort({ spec });
  // Read once at mount: the per-request callback stays within the complexity budget.
  const onReturnedError = spec.ports?.onReturnedError;
  // The mode is chosen here, once per mount (never per request), so two requests of one host can
  // never take different incident paths: reporter mode when the host passed `errors`, else legacy.
  const errors = adapter?.errors;
  // `optional.bodyParsers` run between the path and this handler, for this one route only.
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
    // detached in `finally` below, so it never outlives one request. In reporter mode the same
    // signal is what turns an abort-like throw into a cancelled operation with no write and no report.
    const abortController = new AbortController();
    const onResponseClose = () => abortController.abort();
    // Optional-called rather than assumed present: a real Express `Response` always has `.on`, but
    // several existing unit tests drive `mountJsonRoute` against a minimal `{status,json}` double
    // that doesn't implement `EventEmitter` at all. Those callers simply never observe an abort,
    // which is the correct behavior for a double that never fires `close` anyway.
    res.on?.('close', onResponseClose);
    const call: ExpressRouteCall<Input, Output, Deps, Context> = { req, res, spec, mountedDeps, mountOptions: optional, adapter, onReturnedError, signal: abortController.signal };
    try {
      await (errors ? reporterServe(call, { errors }) : legacyServe(call));
    } finally {
      res.off?.('close', onResponseClose);
    }
  });
}

/** One request through `mountJsonRoute`: everything a mode needs, gathered once by the callback. */
interface ExpressRouteCall<Input, Output, Deps, Context> {
  readonly req: Request;
  readonly res: Response;
  readonly spec: JsonRouteSpec<Input, Output, Deps, Context>;
  /** The deps given at mount; `serveExpressRoute` binds them to the request through `mountOptions.requestDeps`. */
  readonly mountedDeps: Deps;
  readonly mountOptions: Pick<RouteMountOptions<Deps>, 'requestDeps'>;
  readonly adapter: RouteHostContext | undefined;
  readonly onReturnedError: JsonRoutePorts<Deps, Context>['onReturnedError'];
  readonly signal: AbortSignal;
}

/**
 * What the route decided, before anything is written: the verdict the operation ends with and the
 * adapter-owned write that answers it. Keeping the write a closure is what lets reporter mode end
 * the operation first and write second; legacy mode simply calls it at once.
 */
interface ExpressAnswer {
  readonly write: () => void;
  readonly verdict: OperationVerdict;
}

const COMPLETED: OperationVerdict = { outcome: 'completed', failed: false };
const REFUSED: OperationVerdict = { outcome: 'refused', failed: false };
const FAILED: OperationVerdict = { outcome: 'failed', failed: true };
/** The non-standard "client closed request" sentinel, used only as the ended operation's status label. */
const CLIENT_CLOSED_STATUS = 499;
const noWrite = (): void => {};

/** Stamps the status the write will send on the verdict, so the operation ends with `http.status_code`. */
function answer({ verdict, status, write }: { readonly verdict: OperationVerdict; readonly status: number; readonly write: () => void }): ExpressAnswer {
  return { write, verdict: { ...verdict, attributes: { ...verdict.attributes, 'http.status_code': status } } };
}

/**
 * A returned `INTERNAL_ERROR` was produced inside the route by its reporter-backed
 * `reportInternalError`, which already wrote the one record and tracker report: the producer owns
 * that report, so this only classifies it `failed` and never records it again.
 */
function verdictFor({ apiError }: { readonly apiError: ServerApiError }): OperationVerdict {
  return apiError.code === 'INTERNAL_ERROR' ? FAILED : REFUSED;
}

/** Legacy mode (no `errors`): today's flow, every write at once, the SEC-005 sink on a throw. */
async function legacyServe<Input, Output, Deps, Context>(call: ExpressRouteCall<Input, Output, Deps, Context>): Promise<void> {
  const { res, spec, adapter } = call;
  try {
    (await serveExpressRoute(call)).write();
  } catch (e) {
    sendRouteException({ res, spec, adapter, error: e });
  }
}

/**
 * Reporter mode: the request is one `http.route` operation. `runOperation` settles the work and
 * ends the operation exactly once, and only then does the adapter write: the operation's owner is
 * `runOperation`, the answer's owner is this function. A thrown failure is described by the
 * reporter (one ID, one host record, one tracker report); `onInternalError` is never called here.
 */
async function reporterServe<Input, Output, Deps, Context>(call: ExpressRouteCall<Input, Output, Deps, Context>, { errors }: { readonly errors: RouteErrorPorts }): Promise<void> {
  const method = call.spec.method.toUpperCase();
  const run = await runOperation<ExpressAnswer>({
    deps: errors, operation: 'http.route', scope: 'http', step: `Handle ${method} ${call.spec.path}`, fallback: httpFallbackCopy({ method }),
    // The registered pattern (`/runs/:id`), never `req.originalUrl`: a URL carries ids, query strings
    // and tokens, which would leak into telemetry and give every request its own unbounded group.
    attributes: { 'http.method': method, 'http.route': call.spec.path },
    work: () => tracedServe(call, { errors }),
    classify: tagged => tagged.verdict,
    settle: error => disconnectVerdict({ signal: call.signal, error }),
  }, { audience: 'anonymous' });
  // A client that already went away gets nothing: a cancelled run, and equally a real failure
  // recorded after the disconnect, have nobody to answer.
  if ('cancelled' in run || call.signal.aborted) return;
  const write = run.ok ? run.value.write : () => writeFailure({ res: call.res, failure: run.failure });
  deliver({ call, write }, { errors });
}

async function tracedServe<Input, Output, Deps, Context>(call: ExpressRouteCall<Input, Output, Deps, Context>, { errors }: { readonly errors: RouteErrorPorts }): Promise<ExpressAnswer> {
  try {
    return await serveExpressRoute(call);
  } catch (error) {
    const onError = call.spec.ports?.onError;
    // No host policy: the throw reaches `runOperation`, whose reporter classifies it (a
    // ClientFacingError or catalog refusal, else one incident).
    if (!onError) throw error;
    return hostPolicyAnswer({ call, error, onError }, { errors });
  }
}

/**
 * An explicit host error port answers BEFORE the reporter classifies anything, exactly as in legacy
 * mode (it also wins over ClientFacingError). The Express port writes to `res` itself, so it is the
 * one exception to end-before-write: it runs inside the operation, is called once, and the verdict
 * comes from the status it actually set. If the policy throws, that failure is recorded as its own
 * incident and the ORIGINAL error is rethrown, so the reply (if headers are still unsent) carries
 * the original's ID rather than the policy's.
 */
function hostPolicyAnswer<Input, Output, Deps, Context>(
  { call, error, onError }: { readonly call: ExpressRouteCall<Input, Output, Deps, Context>; readonly error: unknown; readonly onError: NonNullable<JsonRoutePorts<Deps, Context>['onError']> },
  { errors }: { readonly errors: RouteErrorPorts },
): ExpressAnswer {
  // The route's static headers are already on `res`: `serveExpressRoute` set them before any gate ran.
  const { res } = call;
  try {
    onError({ res, error });
  } catch (policyError) {
    recordQuietly({ reporter: errors.reporter, error: policyError, step: 'Answer with host error policy' });
    throw error;
  }
  return answer({ verdict: res.statusCode >= 500 ? FAILED : REFUSED, status: res.statusCode, write: noWrite });
}

/** The reporter promises never to throw; this guard keeps a broken one from replacing the failure being answered. */
function recordQuietly({ reporter, error, step }: { readonly reporter: ErrorReporter; readonly error: unknown; readonly step: string }): { readonly errorId?: string } {
  try {
    return reporter.record({ error, step, operation: 'http.route' });
  } catch {
    return {};
  }
}

/**
 * Cancellation only when the client is gone AND the throw is the abort itself: an abort-like throw
 * after the response closed is the handler stopping because nobody is listening. Any other throw
 * after a disconnect is still a real failure and is recorded (and, with nobody listening, not written).
 */
function disconnectVerdict({ signal, error }: { readonly signal: AbortSignal; readonly error: unknown }): OperationVerdict | undefined {
  if (!signal.aborted) return undefined;
  const abortLike = error === signal.reason || (typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError');
  return abortLike ? { outcome: 'cancelled', failed: false, attributes: { 'http.status_code': CLIENT_CLOSED_STATUS } } : undefined;
}

/**
 * Runs the adapter-owned write after the operation ended. A write that throws (a body that will not
 * serialize, a socket that refuses) is transport-owned: it is recorded once, never a new route
 * operation and never a reason to run the handler again; the caller still gets an answer when
 * nothing was sent yet, else the half-written response is destroyed.
 */
function deliver<Input, Output, Deps, Context>({ call, write }: { readonly call: ExpressRouteCall<Input, Output, Deps, Context>; readonly write: () => void }, { errors }: { readonly errors: RouteErrorPorts }): void {
  const { res, spec } = call;
  try {
    // The route's static (and admitted) headers are already on `res`: `serveExpressRoute` set them
    // before its gates, in merge order, so an admitted header still wins over a static one of the same name.
    write();
  } catch (writeError) {
    const { errorId } = recordQuietly({ reporter: errors.reporter, error: writeError, step: `Write ${spec.method.toUpperCase()} ${spec.path} response` });
    const id = errorId ?? UNAVAILABLE_ERROR_ID;
    const fallback = httpFallbackCopy({ method: spec.method });
    const error: ServerApiError = { code: 'INTERNAL_ERROR', message: `${fallback.message} ${fallback.action} (error ${id})`, requestId: id };
    if (res.headersSent) res.destroy?.();
    else sendApiError({ res, status: 500, error });
  }
}

/**
 * The reporter's answer: a refusal's own status and safe words (no ID), or an incident's 500 with
 * the original incident ID as `requestId`. Once headers are out (a host policy wrote, then threw)
 * nothing is answered a second time; an unfinished response is destroyed instead.
 */
function writeFailure({ res, failure }: { readonly res: Response; readonly failure: DescribedFailure }): void {
  if (res.headersSent) {
    if (!res.writableEnded) res.destroy?.();
    return;
  }
  sendApiError({ res, status: failure.status, error: failure.error });
}

/**
 * Parse, authorize, handle and answer, after the pre-parse gates admitted the request (those gates now
 * run here too), deciding the answer without writing it (`write` does). Split out of the per-request
 * callback only to keep it within the complexity budget, and so reporter mode can end the operation
 * before that write.
 * Gate order: static headers → request-scoped deps → raw input → body cap → workspace → admitted
 * headers → origin → authenticate → parse → handle. Setting a header is not a write on the wire, so
 * reporter mode still ends the operation before anything is sent.
 * Not awaited-before-handle: `parse` and `authorize` are synchronous, so `handle` still starts in
 * the same tick as before the split (adapter-pins.test.ts pins that a disconnect right after dispatch
 * reaches `handle`'s signal).
 */
async function serveExpressRoute<Input, Output, Deps, Context>(call: ExpressRouteCall<Input, Output, Deps, Context>): Promise<ExpressAnswer> {
  const { req, res, spec, adapter, onReturnedError, signal } = call;
  applyResponseHeaders({ res, headers: spec.responseHeaders });
  // Once per request, before every gate: the ports and `handle` see this request's bound deps.
  const deps = requestScopedDeps({ req, res, deps: call.mountedDeps }, call.mountOptions);
  const raw = routeRequestInput({ req, spec, deps });
  const tooLarge = routeBodyRefusal({ req, spec });
  if (tooLarge) return answer({ verdict: REFUSED, status: statusForError({ error: tooLarge.error }), write: () => writeBodyRefusal({ res, spec, refusal: tooLarge }) });
  if (spec.ports?.workspace) await spec.ports.workspace({ raw, deps });
  applyAdmittedResponseHeaders({ res, raw, spec });
  const crossOrigin = routeOriginRefusal({ req, spec, adapter });
  if (crossOrigin) return refusalAnswer({ res, error: crossOrigin });
  let context: Context | undefined;
  if (spec.ports?.authenticate) context = await spec.ports.authenticate({ raw, res, deps });
  const parsed = spec.parse(raw);
  if (!parsed.ok) return returnedFailureAnswer({ res, onReturnedError, error: parsed.error, phase: 'parse' });
  const authorize = routeAuthorize({ ports: spec.ports, deps, context });
  const result = await spec.handle({ input: parsed.value, deps, context, authorize }, { signal });
  return routeResultAnswer({ res, result, spec: { successStatus: spec.successStatus, onReturnedError }, signal });
}

/** The origin gate's refusal: its own status and core's words, written by the adapter (the body cap has `writeBodyRefusal`). */
function refusalAnswer({ res, error }: { readonly res: Response; readonly error: ServerApiError }): ExpressAnswer {
  const status = statusForError({ error });
  return answer({ verdict: REFUSED, status, write: () => sendApiError({ res, status, error }) });
}

/**
 * A spec that opts into request facts needs the host's resolver: refusing at mount means a missing
 * port is a boot failure, never a route that silently runs without the client address.
 * @throws When `spec.requestFacts` is set and `spec.ports.requestFacts` is not.
 */
export function assertRequestFactsPort({ spec }: { readonly spec: Pick<RouteRequestOptIns, 'requestFacts'> & { readonly path: string; readonly ports?: { readonly requestFacts?: unknown } | undefined } }, _optional: Record<string, never> = {}): void {
  if (spec.requestFacts && !spec.ports?.requestFacts) throw new Error(`route ${spec.path} opts into requestFacts but no requestFacts port is mounted`);
}

/**
 * The deps one request runs with: the host's `requestDeps` binding (`RouteMountOptions`) evaluated for
 * this request, or the mounted deps unchanged when the mount declared none.
 * @complexity O(1) plus the host binding.
 */
export function requestScopedDeps<Deps>({ req, res, deps }: { readonly req: Request; readonly res: Response; readonly deps: Deps }, { requestDeps }: Pick<RouteMountOptions<Deps>, 'requestDeps'> = {}): Deps {
  return requestDeps ? requestDeps({ req, res, deps }) : deps;
}

/**
 * The spec's `admittedResponseHeaders` for this request, called right after the workspace port: only an
 * admitted request carries them, so the workspace refusal (a throw from that port) never does.
 * Synchronous, so a mount without a workspace port keeps its tick order (adapter-pins.test.ts).
 * @complexity O(h) in the header count.
 */
export function applyAdmittedResponseHeaders({ res, raw, spec }: {
  readonly res: Response; readonly raw: RouteInputContext; readonly spec: Pick<RouteRequestOptIns, 'admittedResponseHeaders'>;
}, _optional: Record<string, never> = {}): void {
  if (spec.admittedResponseHeaders) applyResponseHeaders({ res, headers: spec.admittedResponseHeaders(raw) });
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
  const refusal = routeBodyRefusal({ req, spec });
  if (!refusal) return true;
  writeBodyRefusal({ res, spec, refusal });
  return false;
}

/** A body over the spec's cap: the ceiling it broke and core's refusal for it. */
interface BodyRefusal { readonly maxBytes: number; readonly error: ServerApiError }

/** The body-cap decision of {@link allowRouteBody} without the write, so reporter mode can end the
 *  operation before the 413 goes out. `undefined` admits the request. */
function routeBodyRefusal({ req, spec }: { readonly req: Request; readonly spec: Pick<JsonRouteSpec<unknown, unknown, unknown>, 'maxBodyBytes'> }): BodyRefusal | undefined {
  const maxBytes = spec.maxBodyBytes;
  if (maxBytes === undefined || req.method === 'GET' || req.method === 'HEAD') return undefined;
  if (parsedBodyBytes(req.body) <= maxBytes) return undefined;
  return { maxBytes, error: payloadTooLargeError({ maxBytes }) };
}

/** Writes a body-cap refusal: the host's own 413 body when `ports.payloadTooLarge` is mounted (its
 *  admin client reads it); absent, core's envelope is unchanged. */
function writeBodyRefusal({ res, spec, refusal }: {
  readonly res: Response;
  readonly spec: { readonly ports?: { readonly payloadTooLarge?: JsonRoutePorts<unknown>['payloadTooLarge'] } | undefined };
  readonly refusal: BodyRefusal;
}): void {
  // The host's own 413 body (its admin client reads it); absent, core's envelope below is unchanged.
  if (spec.ports?.payloadTooLarge) {
    spec.ports.payloadTooLarge({ res, maxBytes: refusal.maxBytes });
    return;
  }
  sendApiError({ res, status: statusForError({ error: refusal.error }), error: refusal.error });
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

/** The same-origin decision without the write (`passesSameOriginGuard` writes the 403 itself), so
 *  the adapter owns that write and can make it after the operation ended. `undefined` admits. */
function routeOriginRefusal({ req, spec, adapter }: {
  readonly req: Request;
  readonly spec: Pick<JsonRouteSpec<unknown, unknown, unknown>, 'requireSameOrigin'>;
  readonly adapter: RouteHostContext | undefined;
}): ServerApiError | undefined {
  if (!spec.requireSameOrigin) return undefined;
  if (!adapter) throw new Error('same-origin adapter context is required');
  const verdict = guardSameOrigin({ req, origin: adapter });
  return verdict.ok ? undefined : verdict.error;
}

function routeResultAnswer<Output>({ res, result, spec, signal }: {
  readonly res: Response;
  readonly result: Result<Output>;
  readonly spec: { readonly successStatus: number | undefined; readonly onReturnedError: JsonRoutePorts<unknown>['onReturnedError'] };
  readonly signal: AbortSignal;
}, _optional: Record<string, never> = {}): ExpressAnswer {
  // `signal` can only have been aborted by `onResponseClose` firing while the `await spec.handle`
  // in `serveExpressRoute` was pending — nothing here runs concurrently with it — so this
  // unambiguously means the client was already gone before any response was sent. Writing one now
  // would be wasted work at best and, worse, would route a benign disconnect into the SEC-005
  // catch as a false internal error if the socket rejects the write.
  if (signal.aborted) return answer({ verdict: { outcome: 'cancelled', failed: false }, status: CLIENT_CLOSED_STATUS, write: noWrite });
  if (!result.ok) return returnedFailureAnswer({ res, onReturnedError: spec.onReturnedError, error: result.error, phase: 'handle' });
  const value = result.value;
  if (isRouteReply(value)) return answer({ verdict: COMPLETED, status: value.status, write: () => sendRouteReply({ res, reply: value }) });
  const status = spec.successStatus ?? 200;
  // A no-content status forbids a body: end the response instead of serializing `result.value`
  // through `res.json`, matching hand-mounted handlers that answered `res.status(204).end()`.
  if (NO_CONTENT_STATUSES.has(status)) return answer({ verdict: COMPLETED, status, write: () => { res.status(status).end(); } });
  return answer({ verdict: COMPLETED, status, write: () => sendJson({ res, status, body: value }) });
}

/**
 * A returned parse/handle failure. It is classified here, from the core status, BEFORE the host's
 * `onReturnedError` shapes the wire: that port only chooses the bytes, never the verdict, so a
 * host that re-maps the status cannot turn a producer-reported `INTERNAL_ERROR` into a refusal.
 */
function returnedFailureAnswer({ res, onReturnedError, error, phase }: {
  readonly res: Response;
  readonly onReturnedError: JsonRoutePorts<unknown>['onReturnedError'];
  readonly error: ServerApiError;
  readonly phase: 'parse' | 'handle';
}): ExpressAnswer {
  return answer({ verdict: verdictFor({ apiError: error }), status: statusForError({ error }), write: () => sendReturnedFailure({ res, onReturnedError, error, phase }) });
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
    message: internalErrorMessage({ method: spec.method }),
  }, { onInternalError: adapter?.onInternalError });
  sendApiError({ res, status: 500, error: apiError });
}
