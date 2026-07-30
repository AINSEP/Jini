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
import type { Express, Request, Response } from 'express';
import { createApiError } from '@jini-ai/protocol';
import type { FrontendSessionHandle, FrontendSessionRegistry } from '@jini-ai/daemon';
import { defineJsonRoute, mountJsonRoute, type AdapterContext } from './adapter.js';
import { createSseResponse } from './raw-sse.js';
import { validationError } from './request.js';
import { err, ok, type Result, type RouteInputContext } from './types.js';

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
    else console.error(`[@jini-ai/http-kit] internal error (frontend-sessions:${source})`, error);
  } catch (sinkError) {
    // A diagnostic sink must never turn a contained failure into an unhandled rejection of its own.
    // eslint-disable-next-line no-console
    console.error(`[@jini-ai/http-kit] internal error sink failed (frontend-sessions:${source})`, sinkError);
  }
}

/**
 * Reads the repeatable `?capability=` query parameter.
 *
 * Express gives a single value as a string and repeats as an array; anything else (a nested object
 * from a bracketed query string) is rejected rather than coerced.
 */
export function parseCapabilityQuery(raw: unknown): readonly string[] | null {
  const values = raw === undefined ? [] : (Array.isArray(raw) ? raw : [raw]);
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
 * SSE commits `text/event-stream` headers before anything else can be known, so a bad request is
 * reported as one `{type:'error'}` data event and then closed — there is no status-code channel
 * left. Same precedent as `run-stream.ts`.
 */
export function handleFrontendSessionStream(
  req: Request,
  res: Response,
  deps: FrontendSessionsHttpDeps,
): void {
  const capabilities = parseCapabilityQuery(req.query['capability']);

  // Assigned below, after the connection exists — `attach` needs something to deliver through, and
  // `onClose` has to be armed before then so a connection that dies during setup still detaches.
  let handle: FrontendSessionHandle | undefined;
  const connection = createSseResponse(req, res, {
    // Detach on close rather than on an explicit teardown call: this fires for a closed tab and a
    // dropped connection too, which an unregister route would not.
    onClose: () => handle?.detach(),
  });

  if (capabilities === null) {
    connection.send({
      type: 'error',
      message: 'each "capability" query parameter must be a non-empty string',
    } satisfies FrontendSessionErrorEvent);
    connection.close();
    return;
  }

  const sessionId = (deps.newSessionId ?? randomUUID)();
  handle = deps.registry.attach(
    { sessionId, capabilities },
    (invocation) => connection.send({ type: 'invocation', ...invocation } satisfies FrontendSessionInvocationEvent),
  );

  connection.send({
    type: 'attached',
    sessionId,
    bindToken: handle.bindToken,
  } satisfies FrontendSessionAttachedEvent);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseFrontendSessionResponse(input: RouteInputContext): Result<FrontendSessionResponseRequest> {
  const sessionId = input.params['sessionId'];
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    return err(validationError('sessionId must be a non-empty string', [{ path: 'sessionId', message: 'required non-empty string' }]));
  }
  if (!isRecord(input.body)) return err(validationError('body must be a JSON object'));

  const invocationId = input.body['invocationId'];
  if (typeof invocationId !== 'string' || invocationId.trim().length === 0) {
    return err(validationError('invocationId must be a non-empty string', [{ path: 'invocationId', message: 'required non-empty string' }]));
  }
  const okFlag = input.body['ok'];
  if (typeof okFlag !== 'boolean') {
    return err(validationError('ok must be a boolean', [{ path: 'ok', message: 'required boolean' }]));
  }
  if (!okFlag) {
    const message = input.body['message'];
    if (typeof message !== 'string' || message.trim().length === 0) {
      // A failure with no reason gives the agent nothing to act on, which is how a caller ends up
      // retrying the same refusal forever.
      return err(validationError('message must be a non-empty string when ok is false', [{ path: 'message', message: 'required when ok is false' }]));
    }
    return ok({ sessionId, invocationId, ok: false, message });
  }
  return ok({ sessionId, invocationId, ok: true, output: input.body['output'] });
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
  method: 'post',
  path: FRONTEND_SESSION_RESPONSE_ROUTE_PATH,
  requireSameOrigin: true,
  parse: parseFrontendSessionResponse,
  handle: (input, deps) => {
    const settled = deps.registry.settle(
      input.sessionId,
      input.invocationId,
      input.ok
        ? { ok: true, output: input.output }
        : { ok: false, message: input.message },
    );
    return ok({ settled });
  },
});

/** Mounts both frontend-session routes on `app`. */
export function registerFrontendSessionRoutes(
  app: Express,
  deps: FrontendSessionsHttpDeps,
  adapter: AdapterContext,
): void {
  app.get(FRONTEND_SESSION_STREAM_ROUTE_PATH, (req: Request, res: Response) => {
    try {
      handleFrontendSessionStream(req, res, deps);
    } catch (error) {
      reportInternalError(deps, 'stream', error);
      if (!res.headersSent) {
        res.status(500).json({ error: createApiError('INTERNAL_ERROR', 'an internal error occurred') });
      } else if (!res.writableEnded) {
        res.end();
      }
    }
  });
  mountJsonRoute(app, frontendSessionResponseRoute, deps, adapter);
}
