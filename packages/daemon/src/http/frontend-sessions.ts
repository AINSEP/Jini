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
import { inspect } from 'node:util';
import { redactSecrets } from '@jini-ai/core';
import { randomUUID } from 'node:crypto';
import type { ToolApprovalDecision } from '@jini-ai/core';
import type { Express, Request, Response } from 'express';
import { createApiError } from '@jini-ai/protocol';
import type { FrontendSessionHandle, FrontendSessionRegistry, FrontendSessionOwner } from '../frontend-session-registry.js';
import { FrontendSessionCapacityError } from '../frontend-session-registry.js';
import { defineJsonRoute, mountJsonRoute, type AdapterContext } from '@jini-ai/http-kit';
import { guardSameOrigin } from '@jini-ai/http-kit';
import { createSseResponse } from '@jini-ai/http-kit';
import { validationError } from '@jini-ai/http-kit';
import { sendApiError, statusForError } from '@jini-ai/http-kit';
import { err, ok, type Result, type RouteInputContext } from '@jini-ai/http-kit';

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

export interface FrontendSessionsHttpDeps {
  readonly registry: FrontendSessionRegistry;
  /** An isolated public instance supplies its own endpoints and authenticated guest/tab owner. */
  readonly routePrefix?: string;
  /** Must authenticate same-origin metadata as well as credentials on every request. */
  readonly resolveOwner?: (args: { req: Request; res: Response }) => Promise<FrontendSessionOwner | null>;
  readonly allowedCapabilities?: readonly string[];
  readonly sessionTtlMs?: number;
  /** Trusted quota identities supplied by the host, not query parameters. */
  readonly resolveCapacityKeys?: (args: { req: Request; owner?: FrontendSessionOwner }) => readonly string[];
  /**
   * Mints session ids. Defaults to `randomUUID`. A surface never supplies its own: an id the
   * caller chose could collide with, or deliberately impersonate, a session already attached.
   */
  readonly newSessionId?: () => string;
  /** Host-owned sink for failures that must not escape an async Express handler. Defaults to `console.error`. */
  readonly onInternalError?: (context: { readonly source: string; readonly error: unknown }) => void;
}

function reportInternalError(deps: FrontendSessionsHttpDeps, source: string, error: unknown): void {
  try {
    if (deps.onInternalError) deps.onInternalError({ source, error });
    // eslint-disable-next-line no-console
    else console.error(`[@jini-ai/http-kit] internal error (frontend-sessions:${source})`, redactSecrets({ input: inspect(error) }, { redactPii: false }));
  } catch (sinkError) {
    // A diagnostic sink must never turn a contained failure into an unhandled rejection of its own.
    // eslint-disable-next-line no-console
    console.error(`[@jini-ai/http-kit] internal error sink failed (frontend-sessions:${source})`, redactSecrets({ input: inspect(sinkError) }, { redactPii: false }));
  }
}

/**
 * Reads the repeatable `?capability=` query parameter.
 *
 * Express gives a single value as a string and repeats as an array; anything else (a nested object
 * from a bracketed query string) is rejected rather than coerced.
 */
export function parseCapabilityQuery({ raw }: { readonly raw: unknown }, _optional: Record<string, never> = {}): readonly string[] | null {
  const listed = Array.isArray(raw) ? raw : [raw];
  const values = raw === undefined ? [] : listed;
  const capabilities: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string' || value.trim().length === 0) return null;
    capabilities.push(value);
  }
  return capabilities;
}

/**
 * Handles one surface's stream from open to close.
 *
 * Invalid capability queries use a final SSE error event. Capacity admission happens before
 * opening the stream so resource refusals retain a real HTTP status and create no connection.
 */
export function handleFrontendSessionStream({ req, res, deps, owner }: { readonly req: Request; readonly res: Response; readonly deps: FrontendSessionsHttpDeps; readonly owner?: FrontendSessionOwner }, _optional: Record<string, never> = {}
): void {
  const requested = parseCapabilityQuery({ raw: req.query['capability'] });
  const capabilities = requested?.filter(id => !deps.allowedCapabilities || deps.allowedCapabilities.includes(id)) ?? null;

  // Assigned below, after the connection exists — `attach` needs something to deliver through, and
  // `onClose` has to be armed before then so a connection that dies during setup still detaches.
  let handle: FrontendSessionHandle | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  // Reserve capacity before committing SSE headers, so a full scope gets a real 429.
  // Delivery cannot occur until the attached token has been sent to the client.
  let connection: ReturnType<typeof createSseResponse>;
  if (capabilities !== null) {
    handle = attachFrontendSession({ req, deps, capabilities, owner,
      deliver: invocation => connection.send({ data: { type: 'invocation', ...invocation } satisfies FrontendSessionInvocationEvent }),
      cancel: ({ invocationId }) => connection.send({ data: { type: 'cancelled', invocationId } }) });
  }
  try {
    connection = createSseResponse({ req, res }, {
      // Close and expiry release the same quota reservation, without a separate counter lifecycle.
      onClose: () => { clearTimeout(expiry); handle?.detach({}); },
    });
  } catch (error) { handle?.detach({}); throw error; }

  if (capabilities === null) {
    connection.send({
      data: {
        type: 'error',
        message: 'each "capability" query parameter must be a non-empty string',
      } satisfies FrontendSessionErrorEvent
    });
    connection.close();
    return;
  }

  expiry = expireScopedSession({ owner, handle: handle!, close: () => connection.close(), ttl: deps.sessionTtlMs });
  connection.send({
    data: {
      type: 'attached',
      sessionId: handle!.sessionId,
      bindToken: handle!.bindToken,
    } satisfies FrontendSessionAttachedEvent
  });
}

/** Reserve the registry's capacity before SSE commits headers. Host keys are never client input. */
function attachFrontendSession({ req, deps, capabilities, owner, deliver, cancel }: {
  req: Request; deps: FrontendSessionsHttpDeps; capabilities: readonly string[]; owner: FrontendSessionOwner | undefined;
  deliver: Parameters<FrontendSessionRegistry['attach']>[0]['deliver'];
  cancel: NonNullable<Parameters<FrontendSessionRegistry['attach']>[0]['cancel']>;
}): FrontendSessionHandle {
  const sessionId = (deps.newSessionId ?? randomUUID)();
  const capacityKeys = deps.resolveCapacityKeys?.({ req, ...(owner ? { owner } : {}) });
  return deps.registry.attach({ descriptor: { sessionId, capabilities, ...(owner ? { owner } : {}), ...(capacityKeys ? { capacityKeys } : {}) },
    deliver, cancel });
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

/**
 * Mounts both frontend-session routes on `app`.
 *
 * The stream route bypasses `mountJsonRoute` (raw `app.get`, for the SSE response shape), so it
 * does not get `requireSameOrigin` for free the way `frontendSessionResponseRoute` does — the
 * guard is applied here directly, before the SSE channel is opened, so a cross-origin request
 * never gets a stream (and, notably, never mints a session id or `bindToken` either).
 */
export function registerFrontendSessionRoutes({ app, deps, adapter }: { readonly app: Express; readonly deps: FrontendSessionsHttpDeps; readonly adapter: AdapterContext }, _optional: Record<string, never> = {}
): void {
  const prefix = deps.routePrefix ?? '/api/frontend-sessions';
  app.get(`${prefix}/stream`, async (req: Request, res: Response) => {
    // Scoped hosts authenticate origin together with guest/tab ownership in resolveOwner.
    const origin = deps.resolveOwner ? ok({ value: undefined }) : guardSameOrigin({ req, origin: adapter });
    if (!origin.ok) {
      sendApiError({ res, status: statusForError({ error: origin.error }), error: origin.error });
      return;
    }
    try {
      const owner = deps.resolveOwner ? await deps.resolveOwner({ req, res }) : undefined;
      if (owner === null) { res.sendStatus(403); return; }
      handleFrontendSessionStream({ req, res, deps, ...(owner ? { owner } : {}) });
    } catch (error) {
      endStreamOnError({ error, res, deps });
    }
  });
  const responsePath = `${prefix}/:sessionId/responses`;
  if (deps.resolveOwner) app.post(responsePath, async (req, res, next) => {
    try {
      const owner = await deps.resolveOwner!({ req, res });
      const bindToken = req.get('x-frontend-bind-token') ?? '';
      if (!owner || !deps.registry.ownsSession({ sessionId: String(req.params['sessionId']), owner, bindToken })) {
        res.sendStatus(403); return;
      }
      next();
    } catch { res.sendStatus(403); }
  });
  mountJsonRoute({ app, spec: { ...frontendSessionResponseRoute, path: responsePath, requireSameOrigin: !deps.resolveOwner }, deps, adapter });
}

/** Capacity is ordinary admission refusal, not a loggable internal failure. */
function endStreamOnError({ error, res, deps }: { error: unknown; res: Response; deps: FrontendSessionsHttpDeps }): void {
  if (error instanceof FrontendSessionCapacityError && !res.headersSent) { res.sendStatus(429); return; }
  reportInternalError(deps, 'stream', error);
  if (res.headersSent) {
    if (!res.writableEnded) res.end();
  } else {
    res.status(500).json({ error: createApiError({ code: 'INTERNAL_ERROR', message: 'an internal error occurred' }) });
  }
}

/** Expiry tears down addressing and the stream together, including clients which never disconnect. */
function expireScopedSession({ owner, handle, close, ttl = 30 * 60_000 }: { owner?: FrontendSessionOwner | undefined; handle: FrontendSessionHandle; close: () => void; ttl?: number | undefined }): ReturnType<typeof setTimeout> | undefined {
  if (!owner) return undefined;
  const timer = setTimeout(() => { handle.detach({}); close(); }, ttl);
  timer.unref();
  return timer;
}
