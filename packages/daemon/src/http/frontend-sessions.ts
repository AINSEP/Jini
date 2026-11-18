/**
 * @module frontend-sessions
 *
 * The transport half of `@jini-ai/daemon`'s `FrontendSessionRegistry`: how a browser surface reaches
 * the daemon, and how the daemon reaches back into it.
 *
 * Two routes, because the connection *is* the session:
 *
 * - `GET /api/frontend-sessions/stream` opens an SSE channel. The daemon mints the session id,
 *   attaches the surface, sends `{type:'attached', sessionId}` as the first event, and pushes one
 *   `{type:'invocation', ...}` per capability call. When the connection closes for any reason —
 *   navigation, a crashed tab, a pulled network cable — the surface is detached and every
 *   invocation still awaiting it is failed.
 * - `POST /api/frontend-sessions/:sessionId/responses` carries the surface's answer back.
 *
 * There is deliberately **no separate register/unregister pair**. A surface whose lifetime is a
 * `POST` to create and a `DELETE` to destroy leaks a session every time a tab dies without running
 * its unload handler, and those leaked sessions keep claiming capabilities they can no longer
 * serve. Tying the lifetime to the stream makes the failure mode impossible instead of unlikely.
 *
 * **The response route does not execute anything.** It settles a promise that a `ToolHandler` is
 * already awaiting, so the call it answers has already passed `ToolExecutor`'s authorization,
 * confirmation, timeout, cancellation, truncation, and audit. An answer for an unknown or
 * already-settled invocation is reported as `{settled:false}` rather than being an error: a stream
 * reconnect or a retried POST is expected, not exceptional.
 *
 * Binding a run to a session is NOT exposed here. Which surface owns a run is a decision only the
 * composition root can make (it is the thing that starts runs), so it calls `registry.bindRun`
 * directly — see `@jini-ai/daemon`'s own module doc for why attach and bind are separate.
 */
import { randomUUID } from 'node:crypto';
import type { ToolApprovalDecision } from '@jini-ai/core';
import type { FrontendSessionHandle, FrontendSessionRegistry, FrontendSessionOwner } from '../frontend-session-registry.js';
import { FrontendSessionCapacityError } from '../frontend-session-registry.js';
import { defineJsonRoute, jsonResponse, createSseStream, sameOriginRefusal, validationError, err, ok, type Result, type RouteInputContext, type ServerMiddleware, type SseEvent } from '@jini-ai/core/contracts/server';
import type { FrontendHookInput } from './frontend-hook-input.js';
import type { DaemonRouteHost } from './route-host.js';
import { gated, gatedJsonRoute, type DaemonRoute } from './route-table.js';

export const FRONTEND_SESSION_STREAM_ROUTE_PATH = '/api/frontend-sessions/stream';
export const FRONTEND_SESSION_RESPONSE_ROUTE_PATH = '/api/frontend-sessions/:sessionId/responses';

/** First event on the stream, telling the surface the id it must answer under. */
export interface FrontendSessionAttachedEvent {
  readonly type: 'attached';
  readonly sessionId: string;
  /**
   * Secret this surface presents to bind a run to itself. Delivered here and nowhere else: this
   * stream is the one channel already proven to belong to the surface that opened it.
   *
   * Never put this in a URL, a query string, or a log. It is separate from `sessionId` precisely
   * because that id already travels in a request path (`…/:sessionId/responses`) and therefore
   * leaks into access logs and proxies by design — see `@jini-ai/daemon`'s `FrontendSessionHandle`.
   */
  readonly bindToken: string;
}

/** One capability call for the surface to execute. */
export interface FrontendSessionInvocationEvent {
  readonly type: 'invocation';
  readonly invocationId: string;
  readonly capabilityId: string;
  readonly input: Record<string, unknown>;
}

/** Sent instead of `attached` when the request itself was unusable; the stream then closes. */
export interface FrontendSessionErrorEvent {
  readonly type: 'error';
  readonly message: string;
}

export type FrontendSessionStreamEvent =
  | { readonly type: 'cancelled'; readonly invocationId: string }
  | FrontendSessionAttachedEvent
  | FrontendSessionInvocationEvent
  | FrontendSessionErrorEvent;

/**
 * A surface's answer, as a discriminated union rather than a flat record with two optional fields.
 *
 * The parser already refuses a failure with no message, so `message?: string` alongside
 * `ok: boolean` would let the type describe a state the parser guarantees cannot exist — and force
 * a `?? 'no message'` fallback at the use site that no input could ever reach. Encoding the
 * guarantee here removes the branch instead of leaving it to be covered by a test that would have
 * to fabricate an impossible input.
 */
export type FrontendSessionResponseRequest =
  | { readonly sessionId: string; readonly invocationId: string; readonly phase: 'approval-pending' | 'execution-started'; readonly decision?: ToolApprovalDecision }
  | {
    readonly sessionId: string;
    readonly invocationId: string;
    readonly ok: true;
    readonly output?: unknown;
  }
  | {
    readonly sessionId: string;
    readonly invocationId: string;
    readonly ok: false;
    readonly message: string;
  };

export interface FrontendSessionResponseBody {
  /** `false` when the invocation was unknown or already settled — a duplicate answer, not an error. */
  readonly settled: boolean;
}

/** Schedules `callback` once after `delayMs`. The host owns timers (a Node host binds `setTimeout` and `unref`s it), so this module holds none. */
export type FrontendSessionTimer = (required: { readonly callback: () => void; readonly delayMs: number }, optional?: Record<string, never>) => { cancel(): void };

export interface FrontendSessionsHttpDeps {
  readonly registry: FrontendSessionRegistry;
  /** An isolated public instance supplies its own endpoints and authenticated guest/tab owner. */
  readonly routePrefix?: string;
  /** Must authenticate same-origin metadata as well as credentials on every request. */
  readonly resolveOwner?: (required: FrontendHookInput) => Promise<FrontendSessionOwner | null>;
  readonly allowedCapabilities?: readonly string[];
  readonly sessionTtlMs?: number;
  /** Trusted quota identities supplied by the host, not query parameters. */
  readonly resolveCapacityKeys?: (required: FrontendHookInput & { readonly owner?: FrontendSessionOwner }) => readonly string[];
  /**
   * Mints session ids. Defaults to `randomUUID`. A surface never supplies its own: an id the
   * caller chose could collide with, or deliberately impersonate, a session already attached.
   */
  readonly newSessionId?: () => string;
  /** Ends an owned session whose client never disconnects (see {@link FrontendSessionTimer}). */
  readonly setTimer: FrontendSessionTimer;
}

/** Plain words for a stream that could not open before its headers; the caller also gets the request ID. */
const FRONTEND_STREAM_FAILED_MESSAGE = 'The page connection could not be opened. Reload the page; if it keeps failing, copy the request ID and report this problem.';

/** What the stream says when a `capability` value is empty or a bracketed spelling is used. */
const BAD_CAPABILITY_MESSAGE = 'each "capability" query parameter must be a non-empty string';

/**
 * Reads the repeatable `?capability=` query parameter.
 *
 * A bracketed spelling (`capability[x]=y`, `capability[]=y`) is refused rather than read as a plain
 * key: a host parser used to turn it into an object or a list and this reader would otherwise
 * silently drop or coerce it. The old parser also read `capability[]=a` as a list of one; that
 * spelling is now refused too (D-FS1): no client sends it, and the change only ever refuses.
 */
export function parseCapabilityQuery({ searchParams }: { readonly searchParams: URLSearchParams }, _optional: Record<string, never> = {}): readonly string[] | null {
  for (const key of searchParams.keys()) if (key.startsWith('capability[')) return null;
  const capabilities = searchParams.getAll('capability');
  return capabilities.every(value => value.trim().length > 0) ? capabilities : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseFrontendSessionResponse(input: RouteInputContext): Result<FrontendSessionResponseRequest> {
  const sessionId = input.params['sessionId'];
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    return err({ error: validationError({ message: 'sessionId must be a non-empty string' }, { issues: [{ path: 'sessionId', message: 'required non-empty string' }] }) });
  }
  if (!isRecord(input.body)) return err({ error: validationError({ message: 'body must be a JSON object' }) });

  const invocationId = input.body['invocationId'];
  if (typeof invocationId !== 'string' || invocationId.trim().length === 0) {
    return err({ error: validationError({ message: 'invocationId must be a non-empty string' }, { issues: [{ path: 'invocationId', message: 'required non-empty string' }] }) });
  }
  return parseResponseOutcome({ sessionId, invocationId, body: input.body });
}

/** Progress is scoped to a pending invocation; only fixed, value-free decisions enter the audit. */
function parseApprovalProgress(
  { sessionId, invocationId, phase, decision }: { sessionId: string; invocationId: string; phase: 'approval-pending' | 'execution-started'; decision: unknown },
  _options = {},
): Result<FrontendSessionResponseRequest> {
  if (decision === undefined) return ok({ value: { sessionId, invocationId, phase } });
  if (phase !== 'execution-started' || typeof decision !== 'string' || !['approved', 'declined', 'expired', 'abandoned'].includes(decision)) {
    return err({ error: validationError({ message: 'invalid approval decision' }) });
  }
  return ok({ value: { sessionId, invocationId, phase, decision: decision as ToolApprovalDecision } });
}

/** Identity parsing precedes outcome parsing so progress and results share exactly one scope. */
function parseResponseOutcome({ sessionId, invocationId, body }: { sessionId: string; invocationId: string; body: Record<string, unknown> }, _options = {}): Result<FrontendSessionResponseRequest> {
  const phase = body['phase'];
  if (phase === 'approval-pending' || phase === 'execution-started') return parseApprovalProgress({ sessionId, invocationId, phase, decision: body['decision'] });
  const okFlag = body['ok'];
  if (typeof okFlag !== 'boolean') {
    return err({ error: validationError({ message: 'ok must be a boolean' }, { issues: [{ path: 'ok', message: 'required boolean' }] }) });
  }
  if (!okFlag) {
    const message = body['message'];
    if (typeof message !== 'string' || message.trim().length === 0) {
      // A failure with no reason gives the agent nothing to act on, which is how a caller ends up
      // retrying the same refusal forever.
      return err({ error: validationError({ message: 'message must be a non-empty string when ok is false' }, { issues: [{ path: 'message', message: 'required when ok is false' }] }) });
    }
    return ok({ value: { sessionId, invocationId, ok: false, message } });
  }
  return ok({ value: { sessionId, invocationId, ok: true, output: body['output'] } });
}

/**
 * `POST /api/frontend-sessions/:sessionId/responses` — delivers a surface's answer to the tool
 * handler awaiting it. Always `200`; `{settled:false}` reports a duplicate or unknown answer,
 * which is an expected outcome rather than a transport error.
 */
export const frontendSessionResponseRoute = defineJsonRoute<
  FrontendSessionResponseRequest,
  FrontendSessionResponseBody,
  FrontendSessionsHttpDeps
>({
  method: 'post', path: FRONTEND_SESSION_RESPONSE_ROUTE_PATH, parse: parseFrontendSessionResponse, handle: ({ input, deps }) => {
    if ('phase' in input) return ok({ value: { settled: deps.registry.progress({ sessionId: input.sessionId, invocationId: input.invocationId, pending: input.phase === 'approval-pending', ...(input.decision ? { decision: input.decision } : {}) }) } });
    const settled = deps.registry.settle({ sessionId: input.sessionId, invocationId: input.invocationId, outcome: input.ok
        ? { ok: true, output: input.output }
        : { ok: false, message: input.message } });
    return ok({ value: { settled } });
  }
}, { requireSameOrigin: true });

/** Plain-text refusal with the status's own words, the shape `res.sendStatus` gave (no `ETag`: DM-ETAG). */
function plainStatus({ status, text }: { readonly status: number; readonly text: string }): Response {
  return new Response(text, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

/** The data-only frame the stream has always written; `kind` only names the event for the route's own tests. */
interface FrontendWireEvent extends SseEvent {
  readonly payload: FrontendSessionStreamEvent;
}

const wire = ({ payload }: { readonly payload: FrontendSessionStreamEvent }): FrontendWireEvent => ({ opaqueCursor: '', kind: payload.type, payload });
const formatFrame = ({ event }: { readonly event: FrontendWireEvent }): string => `data: ${JSON.stringify(event.payload)}\n\n`;

/** Reserve the registry's capacity before the stream exists. Host keys are never client input. */
function attachFrontendSession({ input, deps, capabilities, owner, deliver, cancel }: {
  readonly input: FrontendHookInput; readonly deps: FrontendSessionsHttpDeps; readonly capabilities: readonly string[]; readonly owner: FrontendSessionOwner | undefined;
  readonly deliver: Parameters<FrontendSessionRegistry['attach']>[0]['deliver'];
  readonly cancel: NonNullable<Parameters<FrontendSessionRegistry['attach']>[0]['cancel']>;
}): FrontendSessionHandle {
  const sessionId = (deps.newSessionId ?? randomUUID)();
  const capacityKeys = deps.resolveCapacityKeys?.({ ...input, ...(owner ? { owner } : {}) });
  return deps.registry.attach({ descriptor: { sessionId, capabilities, ...(owner ? { owner } : {}), ...(capacityKeys ? { capacityKeys } : {}) },
    deliver, cancel });
}

/** An owned session ends with its TTL even when the client never disconnects; an unowned one has no expiry. */
function startExpiry({ owner, handle, close, deps }: { readonly owner: FrontendSessionOwner | undefined; readonly handle: FrontendSessionHandle; readonly close: () => void; readonly deps: FrontendSessionsHttpDeps }): { cancel(): void } | undefined {
  if (!owner) return undefined;
  return deps.setTimer({ callback: () => { handle.detach({}); close(); }, delayMs: deps.sessionTtlMs ?? 30 * 60_000 });
}

/** The 500 a stream gets when something threw before its headers were committed; the real error goes to the host's sink. */
function streamFailure({ error, host }: { readonly error: unknown; readonly host: DaemonRouteHost }): Response {
  const apiError = host.reportInternalError({ report: { source: 'stream', error }, logSource: 'frontend-sessions:stream', message: FRONTEND_STREAM_FAILED_MESSAGE });
  return jsonResponse({ status: 500, body: { error: apiError } });
}

/**
 * Opens one surface's stream. Invalid capability queries use a final error event. Capacity admission
 * happens before the stream exists, so a resource refusal keeps a real HTTP status and creates no connection.
 */
function openFrontendSessionStream({ request, input, deps, host, owner }: {
  readonly request: Request; readonly input: FrontendHookInput; readonly deps: FrontendSessionsHttpDeps; readonly host: DaemonRouteHost; readonly owner: FrontendSessionOwner | undefined;
}): Response {
  const requested = parseCapabilityQuery({ searchParams: new URL(request.url).searchParams });
  const capabilities = requested?.filter(id => !deps.allowedCapabilities || deps.allowedCapabilities.includes(id)) ?? null;
  // Assigned below, after the stream exists: `attach` needs something to deliver through, and
  // `onClose` has to be armed before then so a connection that dies during setup still detaches.
  let handle: FrontendSessionHandle | undefined;
  let expiry: { cancel(): void } | undefined;
  let stream: ReturnType<typeof createSseStream<FrontendWireEvent>>;
  if (capabilities !== null) {
    try {
      handle = attachFrontendSession({ input, deps, capabilities, owner,
        deliver: invocation => stream.send({ event: wire({ payload: { type: 'invocation', ...invocation } satisfies FrontendSessionInvocationEvent }) }),
        cancel: ({ invocationId }) => stream.send({ event: wire({ payload: { type: 'cancelled', invocationId } }) }) });
    } catch (error) {
      // Capacity is ordinary admission refusal, not a loggable internal failure.
      return error instanceof FrontendSessionCapacityError ? plainStatus({ status: 429, text: 'Too Many Requests' }) : streamFailure({ error, host });
    }
  }
  // Close and expiry release the same quota reservation, without a separate counter lifecycle.
  stream = createSseStream<FrontendWireEvent>({ scheduler: host.scheduler }, { signal: request.signal, formatEvent: formatFrame, onClose: () => { expiry?.cancel(); handle?.detach({}); } });
  if (capabilities === null) {
    stream.send({ event: wire({ payload: { type: 'error', message: BAD_CAPABILITY_MESSAGE } satisfies FrontendSessionErrorEvent }) });
    stream.end();
    return stream.response;
  }
  expiry = startExpiry({ owner, handle: handle!, close: () => stream.end(), deps });
  stream.send({ event: wire({ payload: { type: 'attached', sessionId: handle!.sessionId, bindToken: handle!.bindToken } satisfies FrontendSessionAttachedEvent }) });
  return stream.response;
}

/** The owner hook's answer for the stream: an owner, `undefined` (no hook), or the refusal/500 to send instead. */
async function resolveStreamOwner({ input, deps, host }: { readonly input: FrontendHookInput; readonly deps: FrontendSessionsHttpDeps; readonly host: DaemonRouteHost }): Promise<{ readonly owner?: FrontendSessionOwner } | { readonly refusal: Response }> {
  if (!deps.resolveOwner) return {};
  try {
    const owner = await deps.resolveOwner(input);
    return owner === null ? { refusal: plainStatus({ status: 403, text: 'Forbidden' }) } : { owner };
  } catch (error) {
    return { refusal: streamFailure({ error, host }) };
  }
}

/**
 * `GET <prefix>/stream`. The stream route is hand-built (an SSE response is not a JSON route), so it
 * does not get `requireSameOrigin` for free: the guard runs here, before the stream opens, so a
 * cross-origin request never gets a stream (and never mints a session id or `bindToken` either).
 * A host with an owner hook authenticates origin together with guest/tab ownership in that hook.
 */
function frontendStreamRoute({ deps, host, prefix }: { readonly deps: FrontendSessionsHttpDeps; readonly host: DaemonRouteHost; readonly prefix: string }): DaemonRoute {
  return gated({
    route: {
      method: 'GET', path: `${prefix}/stream`,
      handler: async ({ request, locals }) => {
        const refused = deps.resolveOwner ? undefined : sameOriginRefusal({ request, origin: host.context });
        if (refused) return refused;
        const input: FrontendHookInput = { request, locals: locals ?? {} };
        const resolved = await resolveStreamOwner({ input, deps, host });
        if ('refusal' in resolved) return resolved.refusal;
        return openFrontendSessionStream({ request, input, deps, host, owner: resolved.owner });
      },
    },
    gates: [{ name: deps.resolveOwner ? 'frontend-session-owner' : 'same-origin' }],
  });
}

/** The gate in front of the responses route when the host authenticates owners: the owner must hold the session and its bind token. */
function sessionOwnerGate({ deps, host, resolveOwner }: { readonly deps: FrontendSessionsHttpDeps; readonly host: DaemonRouteHost; readonly resolveOwner: NonNullable<FrontendSessionsHttpDeps['resolveOwner']> }): ServerMiddleware {
  return async ({ request, params, locals, next }) => {
    try {
      const owner = await resolveOwner({ request, locals });
      const bindToken = request.headers.get('x-frontend-bind-token') ?? '';
      if (!owner || !deps.registry.ownsSession({ sessionId: String(params['sessionId']), owner, bindToken })) return plainStatus({ status: 403, text: 'Forbidden' });
    } catch (error) {
      // Same 403 bytes as a refused owner; the error itself goes to the host's sink instead of being swallowed.
      host.reportInternalError({ report: { source: 'frontend-session-owner', error }, logSource: 'frontend-sessions:owner', message: 'Forbidden' });
      return plainStatus({ status: 403, text: 'Forbidden' });
    }
    return next();
  };
}

/** `POST <prefix>/:sessionId/responses`, behind the owner gate when the host has an owner hook, else behind the same-origin check. */
function frontendResponseRoute({ deps, host, prefix }: { readonly deps: FrontendSessionsHttpDeps; readonly host: DaemonRouteHost; readonly prefix: string }): DaemonRoute {
  const route = gatedJsonRoute({ spec: { ...frontendSessionResponseRoute, path: `${prefix}/:sessionId/responses`, requireSameOrigin: !deps.resolveOwner }, deps, host });
  if (!deps.resolveOwner) return route;
  return gated({ route, gates: [{ name: 'frontend-session-owner', middleware: sessionOwnerGate({ deps, host, resolveOwner: deps.resolveOwner }) }] });
}

/**
 * Both frontend-session routes as data: the SSE stream that carries invocations down to a surface, and
 * the POST that carries its answers back. A host mounts the list on its own server.
 */
export function frontendSessionRoutes({ deps, host }: { readonly deps: FrontendSessionsHttpDeps; readonly host: DaemonRouteHost }, _optional: Record<string, never> = {}): DaemonRoute[] {
  const prefix = deps.routePrefix ?? '/api/frontend-sessions';
  return [frontendStreamRoute({ deps, host, prefix }), frontendResponseRoute({ deps, host, prefix })];
}
