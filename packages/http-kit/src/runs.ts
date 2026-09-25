/**
 * Generic HTTP/SSE projection of the kernel RunLifecycle. The routes own no
 * agent, tool, or product vocabulary: a host optionally supplies `onStarted`
 * to attach its chosen driver after the lifecycle has durably recorded start.
 */
import { randomUUID } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import { createApiError, type RunProtocolEvent, type RunStatus } from '@jini-ai/protocol';
import type { RunLifecycle, StartRunInput, Unsubscribe } from '@jini-ai/daemon';
import { defineJsonRoute, mountJsonRoute, type AdapterContext } from './adapter.js';
import { validationError } from './request.js';
import { sendApiError } from './response.js';
import { createSseChannel, requestedAfterCursor, sendRawApiError } from './sse.js';
import type { ServerResponse } from 'node:http';
import { err, ok, type Result, type RouteInputContext } from './types.js';

/**
 * Diagnostic detail for an internal-error response the public API deliberately does not
 * disclose (SEC-005): spawn/storage/adapter failures can embed executable paths, working
 * directories, hostnames, or third-party provider text. The correlation id is the only thing
 * that crosses the boundary; the real `error` goes only to this host-owned sink so an operator
 * can still find and act on it.
 */
export interface RunInternalErrorContext {
  readonly source: 'run-start' | 'run-stream';
  readonly runId: string;
  readonly correlationId: string;
  readonly error: unknown;
}

/** Default sink when a host does not supply `onInternalError`: still observable, never silent. */
function defaultInternalErrorSink(context: RunInternalErrorContext): void {
  // eslint-disable-next-line no-console
  console.error(`[@jini-ai/http-kit] internal error (${context.source}, correlationId=${context.correlationId})`, context.error);
}

export interface RunCreateRequest {
  readonly contextRef: string;
  readonly agentId?: string;
  readonly idempotencyKey?: string;
}

export interface RunStartContext {
  readonly request: RunCreateRequest;
  readonly run: RunStatus;
  /** The lifecycle this driver must use for emitted events, cancellation observation, and terminal completion. */
  readonly lifecycle: RunLifecycle;
}

/** Host-owned execution hook. It attaches a driver only after a durable run has been created. */
export type RunStartHandler = (context: RunStartContext) => Promise<void> | void;

export interface RunHttpDeps {
  readonly lifecycle: RunLifecycle;
  readonly onStarted?: RunStartHandler;
  /** Host-owned sink for the real exception behind a generic `INTERNAL_ERROR` response (SEC-005). Defaults to `console.error`. */
  readonly onInternalError?: (context: RunInternalErrorContext) => void;
}

/**
 * Logs the real failure server-side and returns the generic, correlation-id-bearing public error
 * (SEC-005: never the raw exception). `runId` is mandatory — both real call sites (`run-start`,
 * after a durably-created run's id is already known; `run-stream`, against an already-parsed path
 * parameter) always have one in hand, so an optional field with an unreachable "no runId" branch
 * was speculative flexibility no caller ever exercised.
 */
function reportInternalError(
  deps: RunHttpDeps,
  source: RunInternalErrorContext['source'],
  error: unknown,
  runId: string,
): ReturnType<typeof createApiError> {
  const correlationId = randomUUID();
  const sink = deps.onInternalError ?? defaultInternalErrorSink;
  sink({ source, runId, correlationId, error });
  return createApiError('INTERNAL_ERROR', 'an internal error occurred', { requestId: correlationId });
}

export interface RunStartResponse {
  readonly run: RunStatus;
  readonly started: boolean;
}

export interface RunStatusResponse {
  readonly run: RunStatus;
}

export interface RunCancelResponse {
  readonly run: RunStatus;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(body: Record<string, unknown>, key: string): string | undefined | null {
  const value = body[key];
  if (value === undefined) return undefined;
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function parseRunCreate(input: RouteInputContext): Result<RunCreateRequest> {
  if (!isRecord(input.body)) return err(validationError('body must be a JSON object'));
  const contextRef = optionalString(input.body, 'contextRef');
  if (contextRef === undefined || contextRef === null) {
    return err(validationError('contextRef must be a non-empty string', [{ path: 'contextRef', message: 'required non-empty string' }]));
  }
  const agentId = optionalString(input.body, 'agentId');
  const idempotencyKey = optionalString(input.body, 'idempotencyKey');
  if (agentId === null || idempotencyKey === null) {
    return err(validationError('optional string fields must be non-empty when provided'));
  }
  return ok({
    contextRef,
    ...(agentId === undefined ? {} : { agentId }),
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
  });
}

export interface RunListResponse {
  readonly runs: readonly RunStatus[];
}

function parseRunList(input: RouteInputContext): Result<{ contextRef?: string }> {
  const value = input.query.contextRef;
  if (value === undefined) return ok({});
  if (typeof value !== 'string' || value.length === 0) {
    return err(validationError('contextRef must be a non-empty string when provided', [{ path: 'contextRef', message: 'non-empty string when provided' }]));
  }
  return ok({ contextRef: value });
}

function parseRunId(input: RouteInputContext): Result<string> {
  const runId = input.params.runId;
  return typeof runId === 'string' && runId.length > 0
    ? ok(runId)
    : err(validationError('runId must be a non-empty path parameter'));
}

function parseRunCancel(input: RouteInputContext): Result<{ runId: string; reason?: string }> {
  const parsedRunId = parseRunId(input);
  if (!parsedRunId.ok) return parsedRunId;
  if (input.body === undefined || input.body === null) return ok({ runId: parsedRunId.value });
  if (!isRecord(input.body)) return err(validationError('body must be a JSON object when provided'));
  const reason = optionalString(input.body, 'reason');
  if (reason === null) return err(validationError('reason must be a non-empty string when provided'));
  return ok({ runId: parsedRunId.value, ...(reason === undefined ? {} : { reason }) });
}

export const runStartRoute = defineJsonRoute<RunCreateRequest, RunStartResponse, RunHttpDeps>({
  method: 'post',
  path: '/api/runs',
  requireSameOrigin: true,
  parse: parseRunCreate,
  handle: async (input, deps) => {
    const startInput: StartRunInput = input;
    const started = await deps.lifecycle.start(startInput);
    if (started.started && deps.onStarted) {
      try {
        await deps.onStarted({ request: input, run: started.run, lifecycle: deps.lifecycle });
      } catch (error) {
        await deps.lifecycle.finish({ runId: started.run.id, status: 'failed', code: null, signal: null, resumable: false });
        return err(reportInternalError(deps, 'run-start', error, started.run.id));
      }
    }
    // A host-owned driver may finish immediately (for example, a single-step
    // run). Return the lifecycle's current view rather than the snapshot
    // captured before invoking that driver.
    const run = (await deps.lifecycle.get(started.run.id)) ?? started.run;
    return ok({ run, started: started.started });
  },
  successStatus: 201,
});

/** `GET /api/runs` — lists runs, optionally scoped to a `contextRef` query parameter. */
export const runListRoute = defineJsonRoute<{ contextRef?: string }, RunListResponse, RunHttpDeps>({
  method: 'get',
  path: '/api/runs',
  parse: parseRunList,
  handle: async (input, deps) => ok({ runs: await deps.lifecycle.list(input.contextRef) }),
});

export const runStatusRoute = defineJsonRoute<string, RunStatusResponse, RunHttpDeps>({
  method: 'get',
  path: '/api/runs/:runId',
  parse: parseRunId,
  handle: async (runId, deps) => {
    const run = await deps.lifecycle.get(runId);
    return run === undefined ? err(createApiError('NOT_FOUND', `run "${runId}" was not found`)) : ok({ run });
  },
});

export const runCancelRoute = defineJsonRoute<{ runId: string; reason?: string }, RunCancelResponse, RunHttpDeps>({
  method: 'post',
  path: '/api/runs/:runId/cancel',
  requireSameOrigin: true,
  parse: parseRunCancel,
  handle: async (input, deps) => {
    const run = await deps.lifecycle.get(input.runId);
    if (run === undefined) return err(createApiError('NOT_FOUND', `run "${input.runId}" was not found`));
    return ok({ run: await deps.lifecycle.cancel(input) });
  },
});

function sendStreamFailure(res: ServerResponse, kind: Exclude<Awaited<ReturnType<RunLifecycle['stream']>>, { kind: 'ok' }>): void {
  if (kind.kind === 'unknown-run') {
    sendRawApiError(res, 404, createApiError('NOT_FOUND', 'run was not found'));
    return;
  }
  if (kind.kind === 'invalid-cursor') {
    sendRawApiError(res, 400, createApiError('BAD_REQUEST', `invalid replay cursor "${kind.requestedCursor}"`));
    return;
  }
  sendRawApiError(
    res,
    409,
    createApiError('CONFLICT', `replay gap after cursor "${kind.requestedCursor}"`, {
      details: { oldestAvailableCursor: kind.oldestAvailableCursor },
    }),
  );
}

/**
 * The core of `GET /api/runs/:runId/events` — canonical events as SSE, with Last-Event-ID
 * reconnect support. Takes `runId`/`afterCursor` already resolved by the caller. `res` is typed
 * against the raw `node:http` `ServerResponse` rather than Express's own `Response` type — Express's
 * `Response` extends it directly, so this is a no-op widening, the same pattern `run-stream.ts`'s
 * AG-UI handler already established.
 */
export async function handleRunEventStreamRequest(
  res: ServerResponse,
  runId: string,
  afterCursor: string | null,
  deps: RunHttpDeps,
): Promise<void> {
  if (runId.length === 0) {
    sendRawApiError(res, 400, createApiError('BAD_REQUEST', 'runId must be a non-empty path parameter'));
    return;
  }

  // `createSseChannel` (`sse.ts`) owns the bounded queue, backpressure, and client-disconnect
  // handling that used to be inlined here — see that module's doc for the generalization.
  const channel = createSseChannel<RunProtocolEvent>(res, { isEndEvent: (event) => event.kind === 'end' });

  let unsubscribeFn: Unsubscribe | null = null;
  channel.onClose(() => {
    const stop = unsubscribeFn;
    unsubscribeFn = null;
    stop?.();
  });

  try {
    const subscribed = await deps.lifecycle.stream(runId, channel.enqueue, { afterCursor });
    if (subscribed.kind !== 'ok') {
      // Nothing was ever subscribed, so `abandon()` has nothing to unsubscribe — it only marks
      // the channel closed. `res` itself is untouched, leaving `sendStreamFailure` free to send
      // a normal JSON error response instead of an SSE stream.
      channel.abandon();
      sendStreamFailure(res, subscribed);
      return;
    }
    if (channel.isClosed()) {
      // The client already disconnected (or the bounded queue already gave up) while
      // `stream()` was resolving — unsubscribe immediately instead of leaking it.
      subscribed.unsubscribe();
      return;
    }
    unsubscribeFn = subscribed.unsubscribe;
    channel.open();
  } catch (error) {
    if (!res.headersSent) {
      // `channel.open()` never ran (or never got past `flushHeaders`) — abandon without
      // touching `res`, so the JSON error response below is the only thing written.
      // Using `channel.end()` here instead would end the response before this write, turning
      // it into a write-after-end failure.
      channel.abandon();
      sendRawApiError(res, 500, reportInternalError(deps, 'run-stream', error, runId));
      return;
    }
    // Headers were already sent (the stream had started, or `open()` partially ran before
    // throwing) — end the stream itself rather than attempting a second, incompatible response.
    channel.end();
  }
}

/**
 * Path {@link registerRunEventStream} mounts. Exported as a constant so a caller that needs to know
 * this route exists — a reverse proxy's forward list, `route-manifest.ts` — references it rather than
 * restating the literal and later drifting from it.
 */
export const RUN_EVENTS_ROUTE_PATH = '/api/runs/:runId/events';

/** Express mounting glue for {@link handleRunEventStreamRequest} — resolves `runId`/`afterCursor` from an Express `Request` and hands the request straight through. */
export function registerRunEventStream(app: Express, deps: RunHttpDeps): void {
  app.get(RUN_EVENTS_ROUTE_PATH, async (req: Request, res: Response) => {
    const runId = req.params.runId;
    if (typeof runId !== 'string' || runId.length === 0) {
      sendApiError(res, 400, createApiError('BAD_REQUEST', 'runId must be a non-empty path parameter'));
      return;
    }
    await handleRunEventStreamRequest(res, runId, requestedAfterCursor(req), deps);
  });
}

/** Mounts create/status/cancel JSON endpoints and the SSE event stream as one run transport. */
export function registerRunRoutes(app: Express, deps: RunHttpDeps, adapter: AdapterContext): void {
  mountJsonRoute(app, runStartRoute, deps, adapter);
  mountJsonRoute(app, runListRoute, deps, adapter);
  mountJsonRoute(app, runStatusRoute, deps, adapter);
  mountJsonRoute(app, runCancelRoute, deps, adapter);
  registerRunEventStream(app, deps);
}
