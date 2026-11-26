/**
 * Non-JSON routes (HTML, streams, uploads, downloads, a redirect that sets cookies) on the same gates
 * and host ports as `mountJsonRoute`: the handler answers with a web `Response`, which is written back
 * through the node bridge's writer. Mounted with `app[method](path, handler)`, never `app.use`, so a
 * host's route-table inventory sees exactly one route per spec, as it does for a JSON spec.
 */
import type { Express, Request, Response } from 'express';
import type { OperationAttributes } from '@jini-ai/core/contracts/observability';
import { httpFallbackCopy, type RouteErrorPorts, type RouteHostContext } from '@jini-ai/core/contracts/server';
import { runOperation, UNAVAILABLE_ERROR_ID, type DescribedFailure, type ErrorReporter, type OperationVerdict } from '@jini-ai/core/errors/reporter';
import { allowRouteOrigin, routeAuthorize, sendRouteException } from './adapter.js';
import { allowRouteBody, applyAdmittedResponseHeaders, applyResponseHeaders, assertRequestFactsPort, requestScopedDeps, routeRequestInput } from './adapter-request.js';
import { deferredBodyReader } from './deferred-body.js';
import { sendWebResponse } from './node-bridge.js';
import { sendApiError } from './response.js';
import type { JsonRoutePorts, RawRouteSpec, RouteMountOptions, RouteDepsSource } from './types.js';

/** The optional fields of a raw spec, settable in `defineRawRoute`'s second argument. */
type RawRouteOptionalKey = 'requireSameOrigin' | 'maxBodyBytes' | 'ports' | 'readHeaders' | 'requestFacts' | 'responseHeaders' | 'admittedResponseHeaders' | 'bufferedReply';

/**
 * Combines required route fields and optional settings into a fresh raw spec, pinning its generic
 * parameters at the definition site. Optional settings take precedence; neither argument is mutated.
 * @complexity O(1).
 */
export function defineRawRoute<Deps, Context = undefined>(requiredArgs: Omit<RawRouteSpec<Deps, Context>, RawRouteOptionalKey>, optionalArgs: Pick<RawRouteSpec<Deps, Context>, RawRouteOptionalKey> = {}): RawRouteSpec<Deps, Context> {
  return { ...requiredArgs, ...optionalArgs };
}

/**
 * Mounts one raw spec. Gates run in `mountJsonRoute`'s order — static response headers, body cap,
 * workspace (then `admittedResponseHeaders`), same-origin, authenticate — then `handle`, whose `raw.readBody` reads the request body only
 * when called (so a route that defers its body never reads an unauthorized one); a thrown error takes the same `onError` /
 * SEC-005 path. The returned `Response` is written with its status, every header (each `Set-Cookie`
 * on its own line) and its body: none ends the answer, a stream is piped and cancelled when the
 * client leaves, and `handle`'s `signal` aborts on that same disconnect.
 * `optional.bodyParsers` are registered between the path and the handler of this one route (`RouteMountOptions`).
 * @throws At mount, when the spec opts into `requestFacts` without the host's resolver port.
 * @complexity O(1) setup; per request, the gates, the host ports, `handle` and the body copy.
 */
export function mountRawRoute<Deps, Context = undefined>(required: { readonly app: Express; readonly spec: RawRouteSpec<Deps, Context>; readonly adapter?: RouteHostContext } & RouteDepsSource<Deps>, optional: RouteMountOptions<Deps> = {}): void {
  const { app, spec, adapter } = required;
  const mountedDeps = required.deps;
  const resolveDeps = required.depsForRequest ?? ((facts: { req: Request; res: Response }) => requestScopedDeps<Deps>({ ...facts, deps: mountedDeps! }, optional));
  assertRequestFactsPort({ spec });
  // The mode is chosen once, at mount: with `errors`, every request of this route uses the same
  // mounted reporter for its execution, its exception and its write failures.
  const errors = adapter?.errors;
  app[spec.method](spec.path, ...(optional.bodyParsers ?? []), async (req: Request, res: Response) => {
    // Observed on `res`, not `req`, for the reason `mountJsonRoute` documents: a parsed request
    // body has already ended the request stream, so `req`'s `close` is not a disconnect. This abort
    // is also how reporter mode tells a client that left (cancelled, nothing reported) from a failure.
    const abortController = new AbortController();
    const onResponseClose = () => abortController.abort();
    res.on('close', onResponseClose);
    const call: RawCall<Deps, Context> = { req, res, spec, resolveDeps, mountOptions: optional, adapter, signal: abortController.signal };
    try {
      await (errors ? reporterRawRoute(call, { errors }) : legacyRawRoute(call));
    } finally {
      res.off('close', onResponseClose);
    }
  });
}

/** One request of one raw route: what the gates, `handle` and the writers need. `deps` are the
 *  mounted ones; `executeRawRoute` binds them to the request through `mountOptions.requestDeps`. */
interface RawCall<Deps, Context> {
  readonly req: Request; readonly res: Response; readonly spec: RawRouteSpec<Deps, Context>;
  readonly resolveDeps: (facts: { req: Request; res: Response }) => Deps; readonly mountOptions: Pick<RouteMountOptions<Deps>, 'requestDeps' | 'preserveHostErrorRouting'>;
  readonly adapter: RouteHostContext | undefined; readonly signal: AbortSignal;
}

/** Legacy mode (no `errors`): today's try/catch, with the SEC-005 sink of `sendRouteException`. */
async function legacyRawRoute<Deps, Context>(call: RawCall<Deps, Context>): Promise<void> {
  const { req, res, spec, adapter, signal } = call;
  try {
    const response = await executeRawRoute(call);
    if (response) await writeRawResponse({ req, res, spec, response, signal });
  } catch (e) {
    // A body that fails after the head went out cannot be answered any more: cut the connection.
    if (res.headersSent) res.destroy();
    else sendRouteException({ res, spec, adapter, error: e });
  }
}

/**
 * Covers the gates, `handle`, and the write-back of its `Response`; returns early when a gate answered,
 * with `undefined` (the gate helpers own that refusal's write, as in `mountJsonRoute`). The write-back
 * itself is the caller's, after the operation ends (`writeTracedResponse`): this hands it back unwritten.
 */
async function executeRawRoute<Deps, Context>({ req, res, spec, resolveDeps, adapter, signal }: RawCall<Deps, Context>): Promise<globalThis.Response | undefined> {
  applyResponseHeaders({ res, headers: spec.responseHeaders });
  // Once per request, before every gate: the ports and `handle` see this request's bound deps.
  const deps = resolveDeps({ req, res });
  // `readBody` reads nothing until `handle` calls it, after every gate below (`deferred-body.ts`).
  const raw = { ...routeRequestInput({ req, spec, deps }), readBody: deferredBodyReader({ req, res }) };
  if (!allowRouteBody({ req, res, spec })) return undefined;
  if (spec.ports?.workspace) await spec.ports.workspace({ raw, deps });
  applyAdmittedResponseHeaders({ res, raw, spec });
  if (!allowRouteOrigin({ req, res, spec, adapter })) return undefined;
  const context = spec.ports?.authenticate ? await spec.ports.authenticate({ raw, res, deps }) : undefined;
  const authorize = routeAuthorize({ ports: spec.ports, deps, context });
  return spec.handle({ raw, deps, context, authorize }, { signal });
}

/** Writes `handle`'s `Response` back; the transport owns this write and the body's drain. */
async function writeRawResponse({ req, res, spec, response, signal }: Pick<RawCall<unknown, unknown>, 'req' | 'res' | 'signal'> & {
  readonly spec: Pick<RawRouteSpec<unknown, unknown>, 'bufferedReply'>; readonly response: globalThis.Response;
}): Promise<void> {
  // The client left while `handle` ran: release the body's producer instead of writing to a closed socket.
  if (signal.aborted) {
    await response.body?.cancel();
    return;
  }
  if (spec.bufferedReply === 'redirect') await sendRedirectOrBufferedReply({ response, res });
  else if (spec.bufferedReply) await sendBufferedReply({ response, res });
  else await sendWebResponse({ response, res }, { headOnly: req.method === 'HEAD' });
}

/** What a client that hung up is logged as (nginx's convention); nobody receives it. */
const CLIENT_CLOSED_STATUS = 499;
const CANCELLED: OperationVerdict = { outcome: 'cancelled', failed: false, attributes: { 'http.status_code': CLIENT_CLOSED_STATUS } };

/** The work's result: `handle`'s `Response` (absent when a gate or `onError` already answered) and its verdict. */
interface RawTagged { readonly response: globalThis.Response | undefined; readonly verdict: OperationVerdict; readonly forwarded?: { readonly error: unknown } }

/**
 * Reporter mode: one `http.route` operation spans the gates, `handle` and the creation of its
 * `Response`, and ends before anything of that response is written. A stream's drain can outlive
 * the request by minutes (SSE), so it is transport-owned and never held inside the operation.
 */
async function reporterRawRoute<Deps, Context>(call: RawCall<Deps, Context>, { errors }: { readonly errors: RouteErrorPorts }): Promise<void> {
  const method = call.spec.method.toUpperCase();
  // The registered pattern (`/files/:id`), never `req.url`: a URL carries ids, query strings and tokens.
  const attributes = { 'http.method': method, 'http.route': call.spec.path };
  const run = await runOperation<RawTagged>({
    deps: errors, operation: 'http.route', scope: 'http', step: `Handle ${method} ${call.spec.path}`, fallback: httpFallbackCopy({ method }), attributes,
    work: () => tracedRawRoute(call, { errors }),
    classify: (tagged) => tagged.verdict,
    settle: (error) => disconnectVerdict({ signal: call.signal, error }),
  }, { audience: 'anonymous' });
  // The operation has ended. Every write below is the transport's, so a failure in it is recorded on
  // its own and never reopens or re-ends the route operation.
  if (run.ok) {
    if (run.value.forwarded) throw run.value.forwarded.error;
    if (run.value.response) await writeTracedResponse(call, { reporter: errors.reporter, attributes, response: run.value.response });
    return;
  }
  // A cancelled run is a client that left: there is nobody to answer and nothing to report.
  if (!('cancelled' in run)) writeFailure({ res: call.res, failure: run.failure });
}

/** The gates and `handle`, tagged; a throw goes to the host's `onError` first, as in legacy mode. */
async function tracedRawRoute<Deps, Context>(call: RawCall<Deps, Context>, { errors }: { readonly errors: RouteErrorPorts }): Promise<RawTagged> {
  try {
    const response = await executeRawRoute(call);
    // A gate wrote and finished its refusal, and that finished response's `close` aborts `signal` too:
    // only a client gone before `handle`'s `Response` could be written is a cancellation.
    if (!response) return { response, verdict: answeredVerdict({ status: call.res.statusCode, aborted: false }) };
    return { response, verdict: answeredVerdict({ status: response.status, aborted: call.signal.aborted }) };
  } catch (error) {
    const onError = call.spec.ports?.onError;
    // No host policy, or a head already on the wire: the throw reaches `runOperation`, whose reporter
    // classifies it (a ClientFacingError or catalog refusal, else one incident).
    if (!onError || call.res.headersSent) throw error;
    return hostPolicyAnswer({ res: call.res, error, onError }, { reporter: errors.reporter, mountOptions: call.mountOptions });
  }
}

/**
 * The host's `onError` answers BEFORE the reporter classifies anything, as in legacy mode. It writes
 * to `res` itself, so this one write precedes the operation's end; the verdict is the status it chose.
 * A policy that throws is its own incident, and the ORIGINAL error is rethrown so the reply carries its ID.
 */
function hostPolicyAnswer({ res, error, onError }: { readonly res: Response; readonly error: unknown; readonly onError: NonNullable<JsonRoutePorts<unknown, unknown>['onError']> }, { reporter, mountOptions }: { readonly reporter: Pick<ErrorReporter, 'record'>; readonly mountOptions: Pick<RouteMountOptions, 'preserveHostErrorRouting'> }): RawTagged {
  try {
    onError({ res, error });
  } catch (policyError) {
    if (mountOptions.preserveHostErrorRouting) return { response: undefined, verdict: { outcome: 'failed', failed: true }, forwarded: { error: policyError } };
    recordOnce({ reporter, error: policyError, step: 'Answer with host error policy' });
    throw error;
  }
  return { response: undefined, verdict: answeredVerdict({ status: res.statusCode, aborted: false }) };
}

/** A route's own answer: a 5xx it built is `failed` (its producer owns any report), a 4xx `refused`. */
function answeredVerdict({ status, aborted }: { readonly status: number; readonly aborted: boolean }): OperationVerdict {
  if (aborted) return CANCELLED;
  const outcome = status >= 500 ? 'failed' : status >= 400 ? 'refused' : 'completed';
  return { outcome, failed: outcome === 'failed', attributes: { 'http.status_code': status } };
}

function isAbortLike({ signal, error }: { readonly signal: AbortSignal; readonly error: unknown }): boolean {
  return error === signal.reason || (typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError');
}

/**
 * Cancellation only when the client is gone (the response's `close` aborted `signal`) AND the throw
 * is that abort: the handler stopped because nobody is listening. Any other throw after a disconnect
 * is a real failure and is recorded.
 */
function disconnectVerdict({ signal, error }: { readonly signal: AbortSignal; readonly error: unknown }): OperationVerdict | undefined {
  return signal.aborted && isAbortLike({ signal, error }) ? CANCELLED : undefined;
}

/** The reporter's answer, written after the operation ended; a head already sent means the connection is cut instead. */
function writeFailure({ res, failure }: { readonly res: Response; readonly failure: DescribedFailure }): void {
  if (res.headersSent) res.destroy();
  else sendApiError({ res, status: failure.status, error: failure.error });
}

/** Records a failure the reporter owns no operation for; a broken reporter still yields the stand-in ID. */
function recordOnce({ reporter, error, step, attributes }: { readonly reporter: Pick<ErrorReporter, 'record'>; readonly error: unknown; readonly step: string; readonly attributes?: OperationAttributes }): string {
  try {
    return reporter.record({ error, step, operation: 'http.route' }, attributes ? { attributes } : {}).errorId;
  } catch {
    return UNAVAILABLE_ERROR_ID;
  }
}

/**
 * Writes `handle`'s `Response`. The transport owns this write: a stream that fails mid-way is recorded
 * once here (the route operation already ended `completed` and is not touched), then the connection is
 * closed, or answered with the ID when no head went out yet (a buffered body). A client that left is
 * not a failure: the response's `close` aborted `signal`, so an abort-like rejection is just cut.
 */
async function writeTracedResponse<Deps, Context>(call: RawCall<Deps, Context>, { reporter, attributes, response }: {
  readonly reporter: Pick<ErrorReporter, 'record'>; readonly attributes: OperationAttributes; readonly response: globalThis.Response;
}): Promise<void> {
  const { res, signal } = call;
  try {
    await writeRawResponse({ ...call, response });
  } catch (error) {
    if (disconnectVerdict({ signal, error })) {
      res.destroy();
      return;
    }
    if (!res.headersSent && call.mountOptions.preserveHostErrorRouting && call.spec.ports?.onError) {
      call.spec.ports.onError({ res, error });
      return;
    }
    const errorId = recordOnce({ reporter, error, step: 'Write response', attributes });
    const fallback = httpFallbackCopy({ method: call.spec.method });
    if (res.headersSent) res.destroy();
    else sendApiError({ res, status: 500, error: { code: 'INTERNAL_ERROR', message: `${fallback.message} ${fallback.action} (error ${errorId})`, requestId: errorId } });
  }
}

/**
 * The `bufferedReply` write: the whole body is read, then handed to Express's own `res.send(Buffer)`, so
 * the answer is exactly what a hand-written `res.status(s).set(h).send(buffer)` route gave — `Content-Length`,
 * the host app's `etag` setting (Express's default: a weak ETag of the body; none when a header already names
 * one), a bodiless 304 when the GET/HEAD is fresh (`If-None-Match` / `If-Modified-Since`, 2xx only), and no
 * body for HEAD. Headers are copied as the streaming writer copies them (each `Set-Cookie` on its own line,
 * `Vary` merged); a header the `Response` lacks is not invented, except the `application/octet-stream`
 * `Content-Type` Express gives a buffer with none.
 * @complexity O(n) in the body size: the body is held in memory, so this is for finished answers, never streams.
 */
async function sendBufferedReply({ response, res }: { readonly response: globalThis.Response; readonly res: Response }): Promise<void> {
  const body = Buffer.from(await response.arrayBuffer());
  res.statusCode = response.status;
  copyResponseHeaders({ response, res });
  res.send(body);
}

/** Every header of `response` onto `res` as `sendBufferedReply` copies them (each `Set-Cookie` on its own line, `Vary` merged), minus `skip`. O(h). */
function copyResponseHeaders({ response, res }: { readonly response: globalThis.Response; readonly res: Response }, { skip = '' }: { readonly skip?: string } = {}): void {
  const cookies = response.headers.getSetCookie();
  response.headers.forEach((value, name) => {
    if (name === 'vary') res.vary(value);
    else if (name !== 'set-cookie' && name !== skip) res.setHeader(name, value);
  });
  for (const cookie of cookies) res.append('set-cookie', cookie);
}

/**
 * The `bufferedReply: 'redirect'` write: a 3xx `Response` with a `Location` is answered by Express's own
 * `res.redirect(status, location)`, after its other headers and cookies are copied as `sendBufferedReply`
 * copies them, so the answer is exactly what a hand-written `res.redirect` route gave — the Accept-negotiated
 * HTML / plain-text / empty body, `Vary: Accept`, `Content-Length`, no body for HEAD. (`Location` itself is
 * left to `res.redirect`, which writes it through `res.location`'s encoding, as the hand-written route did.)
 * Any other answer takes `sendBufferedReply`.
 * @complexity O(h) headers for a redirect (its body is discarded); otherwise `sendBufferedReply`'s.
 */
async function sendRedirectOrBufferedReply({ response, res }: { readonly response: globalThis.Response; readonly res: Response }): Promise<void> {
  const location = response.headers.get('location');
  if (response.status < 300 || response.status > 399 || location === null) { await sendBufferedReply({ response, res }); return; }
  await response.body?.cancel();
  copyResponseHeaders({ response, res }, { skip: 'location' });
  res.redirect(response.status, location);
}
