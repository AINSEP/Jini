/**
 * Generic HTTP/SSE projection of the kernel RunLifecycle. The routes own no
 * agent, tool, or product vocabulary: a host optionally supplies `onStarted`
 * to attach its chosen driver after the lifecycle has durably recorded start.
 */
import { randomUUID } from 'node:crypto';
import { createApiError, createApiErrorResponse, type ApiError, type RunProtocolEvent, type RunStatus } from '@jini-ai/protocol';
import type { RunLifecycle, StartRunInput, Unsubscribe, UserMessageDelivery } from '../index.js';
import {
  createSseStream,
  defineJsonRoute,
  err,
  jsonResponse,
  lastEventCursor,
  ok,
  statusForError,
  validationError,
  type ReportRouteInternalError,
  type Result,
  type RouteInputContext,
} from '@jini-ai/core/contracts/server';
import type { DaemonRouteHost } from './route-host.js';
import { gated, gatedJsonRoute, withHostReporter, type DaemonRoute } from './route-table.js';
import { createCommitLatch } from './sse-commit.js';
import { SSE_CHARSET_HEADERS } from './sse-wire.js';

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
  /**
   * Delivers a message the human sent mid-run into that run's live agent — a host passes its
   * `AgentExecutor.sendUserMessage`. Omitted, every such message reports `'unsupported'`, so the
   * client falls back to interrupting the run and sending the text as the next turn. Attachment
   * turns use the explicit hook below, or report unsupported without sending anything.
   */
  readonly deliverUserMessage?: (input: RunMessageRequest) => UserMessageDelivery | Promise<UserMessageDelivery>;
  /** Explicit opt-in: legacy text-only hosts must never acknowledge a turn while discarding its files. */
  readonly deliverUserMessageWithAttachments?: (input: RunMessageRequest) => UserMessageDelivery | Promise<UserMessageDelivery>;
  /** Required for direct handlers; {@link runRoutes} binds the host's reporter. */
  readonly reportInternalError: ReportRouteInternalError;
}

/**
 * Logs the real failure server-side and returns a stage-specific, correlation-id-bearing public error
 * (SEC-005: never the raw exception). `runId` is mandatory — both real call sites (`run-start`,
 * after a durably-created run's id is already known; `run-stream`, against an already-parsed path
 * parameter) always have one in hand, so an optional field with an unreachable "no runId" branch
 * was speculative flexibility no caller ever exercised.
 * @complexity O(1) time and space besides the injected diagnostic sink.
 */
function reportInternalError(
  { deps, source, error, runId }: { readonly deps: RunHttpDeps; readonly source: RunInternalErrorContext['source']; readonly error: unknown; readonly runId: string },
  _optional: Record<string, never> = {},
): ReturnType<typeof createApiError> {
  const message = source === 'run-start'
    ? 'The agent could not be started. Check the run status before starting another task. Copy the request ID and report this problem.'
    : 'The connection to run updates could not be opened. Check the run status before starting another task. Copy the request ID and report this problem.';
  // No host sink: `reportRouteInternalError`'s default line keeps the failure observable, never silent.
  return deps.reportInternalError<Omit<RunInternalErrorContext, 'correlationId'>>({ report: { source, runId, error }, logSource: source, message });
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
  if (!isRecord(input.body)) return err({ error: validationError({ message: 'body must be a JSON object' }) });
  const contextRef = optionalString(input.body, 'contextRef');
  if (contextRef === undefined || contextRef === null) {
    return err({ error: validationError({ message: 'contextRef must be a non-empty string' }, { issues: [{ path: 'contextRef', message: 'required non-empty string' }] }) });
  }
  const agentId = optionalString(input.body, 'agentId');
  const idempotencyKey = optionalString(input.body, 'idempotencyKey');
  if (agentId === null || idempotencyKey === null) {
    return err({ error: validationError({ message: 'optional string fields must be non-empty when provided' }) });
  }
  return ok({
    value: {
      contextRef,
      ...(agentId === undefined ? {} : { agentId }),
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    }
  });
}

export interface RunMessageRequest {
  /** Generated at intake and passed unchanged to the executor's queue/consumption events. */
  readonly id?: string;
  readonly runId: string;
  readonly text: string;
  /** Opaque upload capabilities; the host must authorize and prepare every ref before delivery. */
  readonly attachmentIds?: readonly string[];
}

export interface RunMessageResponse {
  readonly id: string;
  readonly delivery: 'delivered';
}

/** Ceiling on one mid-run message, matching what a person can reasonably type or paste into a composer. */
export const RUN_MESSAGE_MAX_CHARS = 100_000;

/** Most attachment refs one mid-run message may carry. */
const MAX_ATTACHMENTS_PER_MESSAGE = 10;

/** An opaque upload capability: `attachment:` then 1-128 word characters or dashes, nothing path-shaped. */
function isAttachmentRef(ref: unknown): ref is string {
  return typeof ref === 'string' && /^attachment:[\w-]{1,128}$/u.test(ref);
}

/** `attachmentIds` is optional; when present it must be an array of at most ten well-formed refs, or the whole message is refused. */
function parseAttachmentIds(value: unknown): Result<readonly string[] | undefined> {
  if (value === undefined) return ok({ value: undefined });
  if (Array.isArray(value) && value.length <= MAX_ATTACHMENTS_PER_MESSAGE && value.every(isAttachmentRef)) return ok({ value });
  return err({ error: validationError({ message: 'attachmentIds must contain at most 10 opaque attachment refs' }) });
}

function parseRunMessage(input: RouteInputContext): Result<RunMessageRequest> {
  const parsedRunId = parseRunId(input);
  if (!parsedRunId.ok) return parsedRunId;
  if (!isRecord(input.body)) return err({ error: validationError({ message: 'body must be a JSON object' }) });
  const text = optionalString(input.body, 'text');
  if (text === undefined || text === null) {
    return err({ error: validationError({ message: 'text must be a non-empty string' }, { issues: [{ path: 'text', message: 'required non-empty string' }] }) });
  }
  if (text.length > RUN_MESSAGE_MAX_CHARS) {
    return err({ error: validationError({ message: `text must be at most ${RUN_MESSAGE_MAX_CHARS} characters` }, { issues: [{ path: 'text', message: 'too long' }] }) });
  }
  const attachmentIds = parseAttachmentIds(input.body.attachmentIds);
  if (!attachmentIds.ok) return attachmentIds;
  return ok({ value: { runId: parsedRunId.value, text, ...(attachmentIds.value === undefined ? {} : { attachmentIds: attachmentIds.value }) } });
}

export interface RunListResponse {
  readonly runs: readonly RunStatus[];
}

function parseRunList(input: RouteInputContext): Result<{ contextRef?: string }> {
  const value = input.query.contextRef;
  if (value === undefined) return ok({ value: {} });
  if (typeof value !== 'string' || value.length === 0) {
    return err({ error: validationError({ message: 'contextRef must be a non-empty string when provided' }, { issues: [{ path: 'contextRef', message: 'non-empty string when provided' }] }) });
  }
  return ok({ value: { contextRef: value } });
}

function parseRunId(input: RouteInputContext): Result<string> {
  const runId = input.params.runId;
  return typeof runId === 'string' && runId.length > 0
    ? ok({ value: runId })
    : err({ error: validationError({ message: 'runId must be a non-empty path parameter' }) });
}

function parseRunCancel(input: RouteInputContext): Result<{ runId: string; reason?: string }> {
  const parsedRunId = parseRunId(input);
  if (!parsedRunId.ok) return parsedRunId;
  if (input.body === undefined || input.body === null) return ok({ value: { runId: parsedRunId.value } });
  if (!isRecord(input.body)) return err({ error: validationError({ message: 'body must be a JSON object when provided' }) });
  const reason = optionalString(input.body, 'reason');
  if (reason === null) return err({ error: validationError({ message: 'reason must be a non-empty string when provided' }) });
  return ok({ value: { runId: parsedRunId.value, ...(reason === undefined ? {} : { reason }) } });
}

export const runStartRoute = defineJsonRoute<RunCreateRequest, RunStartResponse, RunHttpDeps>({
  method: 'post', path: '/api/runs', parse: parseRunCreate, handle: async ({ input, deps }) => {
    const startInput: StartRunInput = input;
    const started = await deps.lifecycle.start({ contextRef: startInput.contextRef }, { ...startInput });
    if (started.started && deps.onStarted) {
      try {
        await deps.onStarted({ request: input, run: started.run, lifecycle: deps.lifecycle });
      } catch (error) {
        await deps.lifecycle.finish({ runId: started.run.id, status: 'failed', code: null, signal: null, resumable: false });
        return err({ error: reportInternalError({ deps, source: 'run-start', error, runId: started.run.id }) });
      }
    }
    // A host-owned driver may finish immediately (for example, a single-step
    // run). Return the lifecycle's current view rather than the snapshot
    // captured before invoking that driver.
    const run = (await deps.lifecycle.get({ runId: started.run.id })) ?? started.run;
    return ok({ value: { run, started: started.started } });
  }
}, { requireSameOrigin: true, successStatus: 201 });

/** `GET /api/runs` — lists runs, optionally scoped to a `contextRef` query parameter. */
export const runListRoute = defineJsonRoute<{ contextRef?: string }, RunListResponse, RunHttpDeps>({ method: 'get', path: '/api/runs', parse: parseRunList, handle: async ({ input, deps }) => ok({ value: { runs: await deps.lifecycle.list({}, input.contextRef === undefined ? {} : { contextRef: input.contextRef }) } }) });

export const runStatusRoute = defineJsonRoute<string, RunStatusResponse, RunHttpDeps>({
  method: 'get', path: '/api/runs/:runId', parse: parseRunId, handle: async ({ input: runId, deps }) => {
    const run = await deps.lifecycle.get({ runId });
    return run === undefined ? err({ error: createApiError({ code: 'NOT_FOUND', message: `run "${runId}" was not found` }) }) : ok({ value: { run } });
  }
});

export const runCancelRoute = defineJsonRoute<{ runId: string; reason?: string }, RunCancelResponse, RunHttpDeps>({
  method: 'post', path: '/api/runs/:runId/cancel', parse: parseRunCancel, handle: async ({ input, deps }) => {
    const run = await deps.lifecycle.get({ runId: input.runId });
    if (run === undefined) return err({ error: createApiError({ code: 'NOT_FOUND', message: `run "${input.runId}" was not found` }) });
    return ok({ value: { run: await deps.lifecycle.cancel(input) } });
  }
}, { requireSameOrigin: true });

/**
 * `POST /api/runs/:runId/messages` — a message the human sent while the run is going. `202` when it
 * reached the live agent; `409 CONFLICT` with `details.delivery` (`'unsupported'` or
 * `'not-running'`) when it did not, which tells the client to retain the next-turn queue without canceling live work.
 * Acceptance is distinct from the UUID-attributed consumption receipt in the run stream.
 */
export const runMessageRoute = defineJsonRoute<RunMessageRequest, RunMessageResponse, RunHttpDeps>({
  method: 'post', path: '/api/runs/:runId/messages', parse: parseRunMessage, handle: async ({ input, deps }) => {
    const run = await deps.lifecycle.get({ runId: input.runId });
    if (run === undefined) return err({ error: createApiError({ code: 'NOT_FOUND', message: `run "${input.runId}" was not found` }) });
    const deliver = input.attachmentIds?.length ? deps.deliverUserMessageWithAttachments : deps.deliverUserMessage;
    const id = randomUUID();
    const delivery = deliver ? await deliver({ ...input, id }) : 'unsupported';
    if (delivery === 'delivered') return ok({ value: { delivery, id } });
    return err({ error: createApiError({ code: 'CONFLICT', message: `run "${input.runId}" did not take the message` }, { details: { delivery } }) });
  }
}, { requireSameOrigin: true, successStatus: 202 });

/** The JSON answer for a stream that could not be opened. It is sent only while nothing has been committed to the client yet. */
function streamFailureResponse(failure: Exclude<Awaited<ReturnType<RunLifecycle['stream']>>, { kind: 'ok' }>): Response {
  return errorResponse({ error: streamFailureError(failure) });
}

function streamFailureError(failure: Exclude<Awaited<ReturnType<RunLifecycle['stream']>>, { kind: 'ok' }>): ApiError {
  if (failure.kind === 'unknown-run') return createApiError({ code: 'NOT_FOUND', message: 'run was not found' });
  if (failure.kind === 'invalid-cursor') return createApiError({ code: 'BAD_REQUEST', message: `invalid replay cursor "${failure.requestedCursor}"` });
  return createApiError({ code: 'CONFLICT', message: `replay gap after cursor "${failure.requestedCursor}"` }, { details: { oldestAvailableCursor: failure.oldestAvailableCursor } });
}

const errorResponse = ({ error }: { readonly error: ApiError }): Response => jsonResponse({ status: statusForError({ error }), body: createApiErrorResponse({ error }) });

/**
 * Opens `GET /api/runs/:runId/events`: canonical events as SSE, with `Last-Event-ID` reconnect support.
 *
 * Validate, commit, produce and hand off are separate events. The run's event source reports an unknown
 * run or a bad cursor itself, and delivers the whole replay before it says "subscribed", so the answer
 * cannot be chosen up front: the first of "an event arrives" (the stream) and "the source refused" (a
 * JSON error) becomes the answer ({@link createCommitLatch}). Replay frames are history already held in
 * memory, so they are queued without counting against the live-frame cap; a replay longer than the cap
 * is delivered whole instead of dropping the client. The stream has no heartbeat: this route never sent one.
 */
function openRunEventStream(
  { request, runId, deps, host }: { readonly request: Request; readonly runId: string; readonly deps: RunHttpDeps; readonly host: DaemonRouteHost },
  _optional: Record<string, never> = {},
): Promise<Response> {
  const latch = createCommitLatch();
  let unsubscribe: Unsubscribe | null = null;
  const stream = createSseStream<RunProtocolEvent>({ scheduler: host.scheduler }, {
    signal: request.signal, keepAliveMs: false, headers: SSE_CHARSET_HEADERS,
    isEndEvent: ({ event }) => event.kind === 'end',
    onClose: () => { const stop = unsubscribe; unsubscribe = null; stop?.(); },
  });
  let live = false;
  // An async closure so a source that throws before returning a promise is reported like one that rejects.
  void (async () => deps.lifecycle.stream({ runId, onEvent: (event) => {
    latch.commit({ response: stream.response });
    stream.send({ event }, { backlog: !live });
  } }, { afterCursor: lastEventCursor({ request }) }))()
    .then((subscribed) => {
      live = true;
      if (subscribed.kind !== 'ok') {
        stream.end();
        latch.commit({ response: streamFailureResponse(subscribed) });
        return;
      }
      // The client may have left (or the live-frame cap been hit) while `stream()` was resolving: unsubscribe now instead of leaking it.
      if (stream.closed) subscribed.unsubscribe();
      else unsubscribe = subscribed.unsubscribe;
      latch.commit({ response: stream.response });
    })
    .catch((error: unknown) => {
      stream.end();
      // Reported either way. After the stream was committed only the stream can end; before that the client gets the generic answer.
      latch.commit({ response: errorResponse({ error: reportInternalError({ deps, source: 'run-stream', error, runId }) }) });
    });
  return latch.response;
}

/**
 * Path the run event stream is mounted at. Exported as a constant so a caller that needs to know
 * this route exists — a reverse proxy's forward list, `route-manifest.ts` — references it rather than
 * restating the literal and later drifting from it.
 */
export const RUN_EVENTS_ROUTE_PATH = '/api/runs/:runId/events';

/** `GET /api/runs/:runId/events`. Deliberately no same-origin gate: this stream never had one, and an event source from another origin must still be answered. */
function runEventStreamRoute({ deps, host }: { readonly deps: RunHttpDeps; readonly host: DaemonRouteHost }): DaemonRoute {
  return gated({
    route: {
      method: 'GET', path: RUN_EVENTS_ROUTE_PATH,
      // The route table never matches an empty `:runId` segment, so `params.runId` is always a non-empty string here.
      handler: ({ request, params }) => openRunEventStream({ request, runId: params.runId ?? '', deps, host }),
    },
    gates: [],
  });
}

/**
 * The create/list/status/cancel/message JSON endpoints and the SSE event stream as one run transport, as data.
 * Internal failures go through the host's reporter.
 */
export function runRoutes({ deps, host }: { readonly deps: Omit<RunHttpDeps, 'reportInternalError'>; readonly host: DaemonRouteHost }, _optional: Record<string, never> = {}): DaemonRoute[] {
  const routeDeps = withHostReporter({ deps, host });
  return [
    gatedJsonRoute({ spec: runStartRoute, deps: routeDeps, host }),
    gatedJsonRoute({ spec: runListRoute, deps: routeDeps, host }),
    gatedJsonRoute({ spec: runStatusRoute, deps: routeDeps, host }),
    gatedJsonRoute({ spec: runCancelRoute, deps: routeDeps, host }),
    gatedJsonRoute({ spec: runMessageRoute, deps: routeDeps, host }),
    runEventStreamRoute({ deps: routeDeps, host }),
  ];
}
