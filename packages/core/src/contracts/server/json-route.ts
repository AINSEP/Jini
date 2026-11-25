/**
 * @file Declarative JSON routes for the `Server` contract: `jsonRoute` turns a spec (parse, handle,
 * origin policy, host ports) into one `ServerRoute`, so route modules return `ServerRoute[]` and the
 * host mounts them on whatever adapter it runs.
 */
import type { ServerMethod, ServerRoute } from '../server.js';
import type { ObservabilityPort } from '../observability.js';
import { runOperation, type DescribedFailure, type ErrorReporter, type OperationVerdict } from '../../errors/reporter.js';
import { statusForError, type ServerApiError } from './api-error.js';
import { guardSameOrigin, type OriginContext } from './origin.js';
import { readQuery } from './query.js';
import { readJsonBody } from './request-body.js';
import { ClientFacingError } from './client-facing-error.js';
import type { Result } from './result.js';

/**
 * The normalized shape of a raw HTTP request handed to a route's `parse` function: body, query,
 * and params, decoupled from any framework `Request` type so parsers are unit-testable without
 * a real server.
 */
export interface RouteInputContext {
  body: unknown;
  query: Record<string, unknown>;
  params: Record<string, string>;
  /** Only the request headers the route opted into, keyed by lower-cased name; an absent header has no key. Absent unless the route opted in. */
  headers?: Readonly<Record<string, string>>;
  /** The host-resolved request facts. Absent unless the route opted in. */
  facts?: RouteRequestFacts;
}

/**
 * Per-request facts only the host can resolve, for a route that opted in: who the client is (a rate
 * limit key, a probe's identity), its user agent, and the host it addressed. Neutral: no server framework.
 */
export interface RouteRequestFacts {
  /** The host's answer to "who is the client" under its proxy-trust policy. Never defaulted inside Jini. */
  readonly clientAddress: string;
  readonly userAgent?: string;
  readonly host?: string;
  /** The protocol the host says the request was served over (Express `req.protocol` under its trust-proxy
   *  policy) — with `host`, what a route needs to rebuild its own public origin (publish-trust identity). */
  readonly protocol?: string;
  /** The origin (`scheme://authority`) the host says this request was served from, under its own proxy-trust
   *  policy, for a route that formats absolute URLs in its answer (sitemap, feed). Absent when the request
   *  carries no authority that can form an origin (a malformed `Host`): the route then keeps its stored origin. */
  readonly servingOrigin?: string;
}

/** Parses a `RouteInputContext` into a typed `Input`, or fails with an error. */
export type InputParser<Input> = (raw: RouteInputContext) => Result<Input>;

/** HTTP verbs a `JsonRouteSpec` can be mounted under. */
export type HttpMethod = 'get' | 'post' | 'put' | 'delete' | 'patch';

/** The optional scope of one authorization: a by-id route names the entity it acts on, so the
 *  host's authorizer can decide per entity; list/import routes leave it out. */
export interface JsonRouteAuthorizeScope { readonly entityId?: string }

/** Explicit authorization remains at the route's chosen point, preserving validation precedence.
 *  `entityType` is optional for a permission that names no entity kind (list roles); the host port then
 *  receives no `entityType` key at all. */
export type JsonRouteAuthorize = {
  // Method syntax on purpose: its parameters compare bivariantly, so the many existing test doubles
  // typed `entityType: string` (from before it was optional) still type-check — the change stays additive.
  authorize(requiredArgs: { readonly permission: string; readonly entityType?: string }, optionalArgs?: JsonRouteAuthorizeScope): Promise<void>;
}['authorize'];

/**
 * Handles a parsed `Input` (plus injected `Deps`) and produces a `Result<Output>`.
 *
 * `signal` is optional and additive: it aborts if the client's connection drops before a response
 * is written; handlers read it from their optional arguments when they perform cancellable work.
 */
export type Handler<Input, Output, Deps, Context = undefined> = (
  requiredArgs: { readonly input: Input; readonly deps: Deps; readonly context?: Context | undefined; readonly authorize?: JsonRouteAuthorize },
  optionalArgs?: { readonly signal?: AbortSignal | undefined },
) => Promise<Result<Output>> | Result<Output>;

/** What a host's incident sink receives for an exception no route anticipated. */
export interface RouteHostInternalErrorContext {
  /** HTTP method of the route whose handler threw. */
  readonly method: string;
  /** Registered path of the route whose handler threw. */
  readonly path: string;
  /** Echoed back to the caller as the response's `requestId`, so an operator can tie a user's report to this log line. */
  readonly correlationId: string;
  /** The exception exactly as thrown — never sent to the caller. */
  readonly error: unknown;
}

/**
 * Records an unanticipated exception (SEC-005) and returns the caller-safe error to answer with.
 * Required on the host: generating the correlation id needs a runtime API core does not have.
 */
export type ReportRouteInternalError = <E extends { readonly error: unknown }>(
  required: { readonly report: E; readonly logSource: string; readonly message: string },
  optional?: { readonly onInternalError?: ((context: E & { readonly correlationId: string; readonly logSource: string }) => void) | undefined },
) => ServerApiError;

/**
 * The ports that put a host's routes in reporter mode: an unanticipated throw goes through the one
 * incident path (one error ID, one host record, one tracker report), and each request is one
 * `http.route` operation. The lifecycle helpers are pure functions imported from core, not ports.
 */
export interface RouteErrorPorts {
  readonly reporter: ErrorReporter;
  readonly observability: Pick<ObservabilityPort, 'trackOperation'>;
}

/** Server startup state a route needs to evaluate its same-origin guard and report incidents. */
export interface RouteHostContext extends OriginContext {
  /**
   * Host-owned sink for the real exception behind a generic `INTERNAL_ERROR` response (SEC-005).
   * The catch-all for a route that throws outside its own guarded path. Legacy mode only: with
   * `errors` present the reporter owns that record and this sink is never called.
   */
  readonly onInternalError?: (context: RouteHostInternalErrorContext) => void;
  /** Reporter mode, chosen once when the route is built. Absent → the legacy SEC-005 path. */
  readonly errors?: RouteErrorPorts;
}

/**
 * Host-owned workspace, authentication/authorization and exception policy.
 * Guards throw on rejection; the error port owns the answer. Without an error port the
 * route keeps its caller-safe-error and SEC-005 redaction policy. Authentication can await
 * host readiness; it runs after workspace rejection and before parsing or handling.
 */
export interface JsonRoutePorts<Deps, Context = undefined> {
  readonly workspace?: (required: { readonly raw: RouteInputContext; readonly deps: Deps }) => void | Promise<void>;
  readonly authenticate?: (required: { readonly raw: RouteInputContext; readonly request: Request; readonly locals: Record<string, unknown>; readonly deps: Deps }) => Context | Promise<Context>;
  readonly authorize?: (required: { readonly context: Context | undefined; readonly deps: Deps; readonly permission: string; readonly entityType?: string }, optional?: JsonRouteAuthorizeScope) => void | Promise<void>;
  /** Host error policy; returns the answer instead of writing it. */
  readonly onError?: (required: { readonly error: unknown; readonly request: Request }) => Response | Promise<Response>;
}

/** Declarative description of one JSON route. Consumed by {@link jsonRoute}. */
export interface JsonRouteSpec<Input, Output, Deps, Context = undefined> {
  method: HttpMethod;
  path: string;
  requireSameOrigin?: boolean;
  /** Body ceiling for every method but GET. Defaults to the shared JSON body limit. */
  maxBodyBytes?: number;
  parse: InputParser<Input>;
  handle: Handler<Input, Output, Deps, Context>;
  successStatus?: number;
  ports?: JsonRoutePorts<Deps, Context>;
}

/**
 * Combines required route fields and optional settings into a fresh spec while pinning its generic
 * parameters at the definition site so callers do not have to repeat them. Optional settings take
 * precedence. Never mutates either argument.
 * @complexity O(1) time/space for the fixed spec fields.
 */
export function defineJsonRoute<Input, Output, Deps, Context = undefined>(requiredArgs: Omit<JsonRouteSpec<Input, Output, Deps, Context>, 'requireSameOrigin' | 'successStatus' | 'ports' | 'maxBodyBytes'>, optionalArgs: Pick<JsonRouteSpec<Input, Output, Deps, Context>, 'requireSameOrigin' | 'successStatus' | 'ports' | 'maxBodyBytes'> = {}
): JsonRouteSpec<Input, Output, Deps, Context> {
  return { ...requiredArgs, ...optionalArgs };
}

/** Statuses whose response must not carry a body; the web `Response` constructor throws on one with a body. */
const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([204, 205, 304]);

/**
 * A JSON response with Express's `res.json` content type, so clients see the same header. A null-body
 * status (204, 205, 304) gets no body and no content type.
 */
export function jsonResponse({ status, body }: { readonly status: number; readonly body: unknown }, { headers = {} }: { readonly headers?: Readonly<Record<string, string>> } = {}): Response {
  if (NULL_BODY_STATUSES.has(status)) return new Response(null, { status, headers });
  const text = JSON.stringify(body);
  // The length is stated here because only the producer knows the body is a finished string: a host that
  // writes a `Response` cannot tell it from a stream without buffering, and Express sent this header too.
  return new Response(text, { status, headers: { 'content-type': 'application/json; charset=utf-8', 'content-length': String(new TextEncoder().encode(text).byteLength), ...headers } });
}

const errorAnswer = ({ error }: { readonly error: ServerApiError }): Response =>
  jsonResponse({ status: statusForError({ error }), body: { error } });

/** One answer and how the request's `http.route` operation ended; the verdict is classified before anything is written. */
interface TaggedAnswer { readonly response: Response; readonly verdict: OperationVerdict }

/** The non-standard "client closed request" sentinel: a bodyless answer nobody will read. */
const CLIENT_CLOSED_STATUS = 499;
const COMPLETED: OperationVerdict = { outcome: 'completed', failed: false };
const REFUSED: OperationVerdict = { outcome: 'refused', failed: false };
const FAILED: OperationVerdict = { outcome: 'failed', failed: true };
const CANCELLED: OperationVerdict = { outcome: 'cancelled', failed: false };
const HTTP_FALLBACK = {
  message: 'The server could not finish this request.',
  action: 'Check whether your change was saved, then try again. If it keeps failing, report the error ID.',
} as const;

/** Stamps the answer's status on the verdict, so the operation ends with `http.status_code`. */
function tag({ response, verdict }: { readonly response: Response; readonly verdict: OperationVerdict }): TaggedAnswer {
  return { response, verdict: { ...verdict, attributes: { ...verdict.attributes, 'http.status_code': response.status } } };
}

/**
 * A returned `INTERNAL_ERROR` was produced inside the route by its reporter-backed
 * `reportInternalError` (or `reporter.describe`), which already wrote the one record and tracker
 * report: the producer owns that report, so this only classifies it `failed` and never records it
 * again. Every other returned code is a refusal the caller caused or was told about.
 */
function verdictFor({ apiError }: { readonly apiError: ServerApiError }): OperationVerdict {
  return apiError.code === 'INTERNAL_ERROR' ? FAILED : REFUSED;
}

const errorTagged = ({ error }: { readonly error: ServerApiError }): TaggedAnswer =>
  tag({ response: errorAnswer({ error }), verdict: verdictFor({ apiError: error }) });

interface RouteCall<I, O, D, C> {
  readonly spec: JsonRouteSpec<I, O, D, C>;
  readonly deps: D;
  readonly reportInternalError: ReportRouteInternalError;
  readonly request: Request;
  readonly params: Record<string, string>;
  readonly locals: Record<string, unknown>;
}

/**
 * Builds the one `ServerRoute` for `spec`. The route's parse and handle functions operate on
 * `RouteInputContext` and `Deps`, so they are unit testable without a server. A host context is
 * required only for routes that opt into the same-origin guard or that can throw unanticipated errors.
 */
export function jsonRoute<I, O, D, C = undefined>(
  { spec, deps, reportInternalError }: {
    readonly spec: JsonRouteSpec<I, O, D, C>;
    readonly deps: D;
    // SEC-005 incident reporter. Required, with no default in core: a default would call
    // `crypto.randomUUID()` (an L6 violation), and a host-context field would force every host to build it.
    // It is a route-level argument so a route mounted with no host context (no same-origin check) still
    // never leaks an exception message.
    readonly reportInternalError: ReportRouteInternalError;
  },
  { host }: { readonly host?: RouteHostContext } = {},
): ServerRoute {
  const answer = answerJsonRoute<I, O, D, C>({ host });
  return {
    method: spec.method.toUpperCase() as ServerMethod,
    path: spec.path,
    handler: ({ request, params, locals = {} }) => answer({ spec, deps, reportInternalError, request, params: { ...params }, locals }),
  };
}

/** Picks the route's mode once, at creation: reporter mode when the host passed `errors`, else legacy. */
function answerJsonRoute<I, O, D, C>({ host }: { readonly host: RouteHostContext | undefined }): (call: RouteCall<I, O, D, C>) => Promise<Response> {
  const errors = host?.errors;
  return errors ? call => reporterAnswer(call, { host, errors }) : call => legacyAnswer(call, { host });
}

async function legacyAnswer<I, O, D, C>(call: RouteCall<I, O, D, C>, { host }: { readonly host: RouteHostContext | undefined }): Promise<Response> {
  try {
    return (await routeAnswerTagged(call, { host })).response;
  } catch (error) {
    return exceptionAnswer({ call, error }, { host });
  }
}

/**
 * Reporter mode: the request is one `http.route` operation. `runOperation` settles the work, ends
 * the operation once and only then hands back the answer, so the operation always ends before the
 * response is returned. A thrown failure is described by the reporter, which owns its one record and
 * tracker report; `onInternalError` is never called in this mode.
 */
async function reporterAnswer<I, O, D, C>(call: RouteCall<I, O, D, C>, { host, errors }: { readonly host: RouteHostContext | undefined; readonly errors: RouteErrorPorts }): Promise<Response> {
  const method = call.spec.method.toUpperCase();
  const run = await runOperation<TaggedAnswer>({
    deps: errors, operation: 'http.route', scope: 'http', step: `Handle ${method} ${call.spec.path}`, fallback: HTTP_FALLBACK,
    // The registered pattern (`/runs/:id`), never `request.url`: a URL carries ids, query strings and
    // tokens, which would leak into telemetry and give every request its own unbounded group.
    attributes: { 'http.method': method, 'http.route': call.spec.path },
    work: () => tracedAnswer(call, { host, errors }),
    classify: tagged => tagged.verdict,
    settle: error => disconnectVerdict({ request: call.request, error }),
  }, { audience: 'anonymous' });
  if (run.ok) return run.value.response;
  if ('cancelled' in run) return new Response(null, { status: CLIENT_CLOSED_STATUS });
  return failureResponse({ failure: run.failure });
}

async function tracedAnswer<I, O, D, C>(call: RouteCall<I, O, D, C>, { host, errors }: { readonly host: RouteHostContext | undefined; readonly errors: RouteErrorPorts }): Promise<TaggedAnswer> {
  try {
    return await routeAnswerTagged(call, { host });
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
 * mode (it also wins over ClientFacingError): the host owns that answer, so the reporter records
 * nothing for it and the verdict comes from the status it chose. If the policy itself throws, that
 * policy failure is recorded as its own incident and the ORIGINAL error is rethrown, so the reply
 * carries the original's ID rather than the policy's.
 */
async function hostPolicyAnswer<I, O, D, C>(
  { call, error, onError }: { readonly call: RouteCall<I, O, D, C>; readonly error: unknown; readonly onError: NonNullable<JsonRoutePorts<D, C>['onError']> },
  { errors }: { readonly errors: RouteErrorPorts },
): Promise<TaggedAnswer> {
  let response: Response;
  try {
    response = await onError({ error, request: call.request });
  } catch (policyError) {
    recordPolicyFailure({ reporter: errors.reporter, policyError });
    throw error;
  }
  return tag({ response, verdict: response.status >= 500 ? FAILED : REFUSED });
}

function recordPolicyFailure({ reporter, policyError }: { readonly reporter: ErrorReporter; readonly policyError: unknown }): void {
  // The reporter promises never to throw; this guard keeps a broken one from replacing the
  // original failure, whose ID the caller must still be given.
  try {
    reporter.record({ error: policyError, step: 'Answer with host error policy', operation: 'http.route' });
  } catch { /* the original failure is still described and answered below */ }
}

/**
 * Cancellation only when the client is gone AND the throw is the abort itself. The adapter aborts
 * `request.signal` on the response's close, so an abort-like throw after that is the handler
 * stopping because nobody is listening: nothing to report and nothing to write. Any other throw
 * after a disconnect is still a real failure and is recorded.
 */
function disconnectVerdict({ request, error }: { readonly request: Request; readonly error: unknown }): OperationVerdict | undefined {
  const { signal } = request;
  if (!signal.aborted) return undefined;
  const abortLike = error === signal.reason || (typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError');
  return abortLike ? { ...CANCELLED, attributes: { 'http.status_code': CLIENT_CLOSED_STATUS } } : undefined;
}

/** The reporter's answer: a refusal's own status and safe words (no ID), or an incident's 500 with the original incident ID as `requestId`. */
function failureResponse({ failure }: { readonly failure: DescribedFailure }): Response {
  return jsonResponse({ status: failure.status, body: { error: failure.error } });
}

async function readRawInput<I, O, D, C>({ spec, request, params }: RouteCall<I, O, D, C>): Promise<Result<RouteInputContext>> {
  const query = readQuery({ request });
  if (request.method === 'GET' || request.method === 'HEAD') return { ok: true, value: { body: {}, query, params } };
  const body = await readJsonBody({ request }, spec.maxBodyBytes === undefined ? {} : { maxBytes: spec.maxBodyBytes });
  return body.ok ? { ok: true, value: { body: body.value, query, params } } : body;
}

/**
 * The same-origin check for a hand-built route (an SSE stream, an upload) that is not a `jsonRoute` and so does not
 * get `requireSameOrigin`: the host's origin policy is asked with the request's `host`, `origin` and `sec-fetch-site`
 * headers, and a refusal is the standard 403 `Response`. Returns `undefined` when the request may proceed, so the
 * route's first line is `const refused = sameOriginRefusal(...); if (refused) return refused;`.
 */
export function sameOriginRefusal({ request, origin }: { readonly request: Request; readonly origin: OriginContext }, _optional: Record<string, never> = {}): Response | undefined {
  const header = (name: string): string | undefined => request.headers.get(name) ?? undefined;
  const verdict = guardSameOrigin({ req: { headers: { host: header('host'), origin: header('origin'), 'sec-fetch-site': header('sec-fetch-site') } }, origin });
  return verdict.ok ? undefined : errorAnswer({ error: verdict.error });
}

function originRefusal<I, O, D, C>({ spec, request }: RouteCall<I, O, D, C>, { host }: { readonly host: RouteHostContext | undefined }): Response | undefined {
  if (!spec.requireSameOrigin) return undefined;
  if (!host) throw new Error('same-origin adapter context is required');
  return sameOriginRefusal({ request, origin: host });
}

// The route chooses where authorization occurs: reads may authorize before validation,
// while writes must reject an inconsistent tenant target before asking for a permission.
function makeAuthorize<I, O, D, C>({ spec, deps, context }: { readonly spec: JsonRouteSpec<I, O, D, C>; readonly deps: D; readonly context: C | undefined }): JsonRouteAuthorize {
  // A by-id route's scope (`entityId`) reaches the host port; an id-free call reaches it with the
  // required arguments alone, exactly as before scopes existed.
  return async ({ permission, entityType }, scope) => {
    if (!spec.ports?.authorize) throw new Error('JSON route authorizer is required');
    const required = { context, deps, permission, ...(entityType === undefined ? {} : { entityType }) };
    await (scope ? spec.ports.authorize(required, scope) : spec.ports.authorize(required));
  };
}

function authenticate<I, O, D, C>({ call, raw }: { readonly call: RouteCall<I, O, D, C>; readonly raw: RouteInputContext }): C | undefined | Promise<C | undefined> {
  const { spec, deps, request, locals } = call;
  return spec.ports?.authenticate ? spec.ports.authenticate({ raw, request, locals, deps }) : undefined;
}

/** Raw read → workspace → origin → authenticate → parse → handle → final answer, each exit tagged with its verdict. */
async function routeAnswerTagged<I, O, D, C>(call: RouteCall<I, O, D, C>, { host }: { readonly host: RouteHostContext | undefined }): Promise<TaggedAnswer> {
  const { spec, deps, request } = call;
  const raw = await readRawInput(call);
  // Includes the 413 and 415 refusals of `readJsonBody`: refused, never reported.
  if (!raw.ok) return errorTagged({ error: raw.error });
  if (spec.ports?.workspace) await spec.ports.workspace({ raw: raw.value, deps });
  const refused = originRefusal(call, { host });
  if (refused) return tag({ response: refused, verdict: REFUSED });
  const context = await authenticate({ call, raw: raw.value });
  const parsed = spec.parse(raw.value);
  if (!parsed.ok) return errorTagged({ error: parsed.error });
  const authorize = makeAuthorize({ spec, deps, context });
  const result = await spec.handle({ input: parsed.value, deps, context, authorize }, { signal: request.signal });
  return finalAnswer({ spec, result, request });
}


function finalAnswer<I, O, D, C>({ spec, result, request }: { readonly spec: JsonRouteSpec<I, O, D, C>; readonly result: Result<O>; readonly request: Request }): TaggedAnswer {
  // Disconnect comes from `request.signal`, which the adapter aborts on the response's close,
  // never on the request body finishing. Aborted means the client was already gone before any
  // answer: serializing one now is wasted work and would turn a benign disconnect into a false
  // internal error if the socket rejects the write.
  if (request.signal.aborted) return tag({ response: new Response(null, { status: CLIENT_CLOSED_STATUS }), verdict: CANCELLED });
  if (!result.ok) return errorTagged({ error: result.error });
  return tag({ response: jsonResponse({ status: spec.successStatus ?? 200, body: result.value }), verdict: COMPLETED });
}

/** Legacy mode only (no `errors`): the route's own SEC-005 sink owns the record. */
async function exceptionAnswer<I, O, D, C>({ call, error }: { readonly call: RouteCall<I, O, D, C>; readonly error: unknown }, { host }: { readonly host: RouteHostContext | undefined }): Promise<Response> {
  const { spec, request } = call;
  // An explicit host error port owns exception classification and the answer, including its
  // guard rejections. Hosts without it keep the SEC-005 policy below.
  if (spec.ports?.onError) return spec.ports.onError({ error, request });
  // A route (or something it called) already classified this failure as safe to disclose, so it is
  // sent verbatim at its own status and never routed to the SEC-005 sink below.
  if (error instanceof ClientFacingError) return errorAnswer({ error: error.apiError });
  // SEC-005. This catch exists for exceptions no route anticipated, which makes it precisely the
  // path most likely to be holding something private: a driver error naming a database file, a
  // connection string, a credential a provider echoed back. The real error reaches the operator
  // through the sink, correlated to what the caller was told by the request ID.
  const apiError = call.reportInternalError<Omit<RouteHostInternalErrorContext, 'correlationId'>>({
    report: { method: spec.method, path: spec.path, error },
    logSource: `${spec.method.toUpperCase()} ${spec.path}`,
    message: 'The server could not finish this request. Check whether your change was saved, then copy the request ID and report this problem.',
  }, { onInternalError: host?.onInternalError });
  return errorAnswer({ error: apiError });
}
