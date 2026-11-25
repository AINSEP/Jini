/**
 * @module terminals
 *
 * Interactive-terminal HTTP surface, mirroring OD's
 * `apps/daemon/src/routes/terminal.ts` (`/api/projects/:id/terminals` +
 * `.../:tid/{stream,stdin,resize,kill}`) generalized under `/api/terminals`.
 * See `ADS-memory/reports/proposals/PROP-http-route-packs-terminal-pty-2026-07-21.md`
 * for the design discussion and `@jini-ai/daemon`'s `terminal-session.ts` module
 * doc for the session-ownership/gating decisions this route pack calls into.
 *
 * This file is deliberately thin — no PTY spawning, no session registry, no
 * ownership logic lives here (that is `@jini-ai/daemon`'s `TerminalSessionManager`,
 * injected as `deps.manager`). This package only:
 *
 * - Resolves a `POST /api/terminals` request's `resourceRef` to a spawn `cwd`
 *   via `workspace-root.ts` (the same port `host-tools.ts`'s open-in route
 *   uses), then routes creation through `deps.toolExecutor.execute(...,
 *   'terminal.create', ...)` — the one call `@jini-ai/daemon`'s module gates by
 *   policy (matching `db-ops.ts`'s tool-execution-boundary precedent).
 * - Routes `stdin`/`resize`/`kill`/`stream` directly to `deps.manager`'s
 *   lighter, session-ownership-checked methods — deliberately **not** through
 *   `ToolExecutor` again (see the daemon module's doc for why a full
 *   authorize/confirm round-trip per keystroke would make a terminal
 *   unusable).
 * - Adapts `deps.manager.attach`'s push/end sink to core's SSE stream, the
 *   same way `runs.ts` adapts `RunLifecycle.stream`.
 */
import { randomUUID } from 'node:crypto';
import type { Principal } from '@jini-ai/core';
import type {
  TerminalSessionActionResult,
  TerminalSessionInfo,
  TerminalSessionManager,
} from '../index.js';
import type { TerminalSseSink } from '@jini-ai/core/contracts/runtime';
import { TERMINAL_CREATE_TOOL_ID } from '../index.js';
import type { ToolExecutionResult, ToolExecutor } from '../index.js';
import { createApiError, createApiErrorResponse, type ApiError } from '@jini-ai/protocol';
import {
  createSseStream,
  defineJsonRoute,
  err,
  jsonResponse,
  lastEventCursor,
  ok,
  sameOriginRefusal,
  statusForError,
  validationError,
  type ReportRouteInternalError,
  type Result,
  type RouteInputContext,
  type SseEvent,
} from '@jini-ai/core/contracts/server';
import type { DaemonRouteHost } from './route-host.js';
import { gated, gatedJsonRoute, withHostReporter, type DaemonRoute } from './route-table.js';
import { SSE_CHARSET_HEADERS } from './sse-wire.js';
import { denyAllWorkspaceRoots, type WorkspaceRootResolver } from './workspace-root.js';
import { isRecord, readOptionalNonEmptyString, readOptionalNumber, resolveResourceRoot, withoutUndefined } from './resource-request.js';

/** Diagnostic detail for an internal-error response the public API deliberately does not disclose (SEC-005, matching `runs.ts`/`db-ops.ts`): a spawn failure (e.g. a missing/uncompiled native addon) can embed executable paths or host detail. */
export interface TerminalsInternalErrorContext {
  readonly source: 'terminal-create';
  readonly correlationId: string;
  readonly error: unknown;
}

/** Everything this route pack needs from the host. */
export interface TerminalsHttpDeps {
  readonly manager: TerminalSessionManager;
  readonly toolExecutor: ToolExecutor;
  /** The identity these routes act as — same fixed, host-supplied-value shape as `db-ops.ts`'s `DaemonDbHttpDeps.principal` (this transport has no session/identity subsystem of its own). */
  readonly principal: Principal;
  /** Resolves a `resourceRef` to a spawn working directory. Defaults to {@link denyAllWorkspaceRoots} — a host that never wires a real resolver gets a 404 on every create call, never a guessed path (see `workspace-root.ts`). */
  readonly resolveRoot?: WorkspaceRootResolver;
  /** Required for direct handlers; {@link terminalRoutes} binds the host's reporter. */
  readonly reportInternalError: ReportRouteInternalError;
}

/** Every one-off `terminal.create` tool call gets its own opaque `RunRef` — matching `db-ops.ts`'s `freshRun()`: these are single requests, not steps of a longer-lived agent run. */
function freshRun(): { readonly id: string } {
  return { id: randomUUID() };
}

function toolResultToApiResult(deps: TerminalsHttpDeps, result: ToolExecutionResult): Result<TerminalSessionInfo> {
  switch (result.status) {
    case 'completed':
      return ok({ value: result.output as TerminalSessionInfo });
    case 'denied':
      return err({ error: createApiError({ code: 'TOOL_OPERATION_DENIED', message: 'this operation was denied by policy' }) });
    case 'confirmation-denied':
      return err({ error: createApiError({ code: 'TOOL_OPERATION_DENIED', message: 'this operation was denied during confirmation' }) });
    case 'timed-out':
    case 'cancelled':
    case 'failed': {
      const message = 'The terminal could not be opened. Try again; if it keeps failing, copy the request ID and report this problem.';
      // No host sink: `reportRouteInternalError`'s default line keeps the failure observable, never silent.
      return err({ error: deps.reportInternalError<Omit<TerminalsInternalErrorContext, 'correlationId'>>({ report: { source: 'terminal-create', error: result.status === 'failed' ? result.error : result.status }, logSource: 'terminal-create', message }) });
    }
    default: {
      // Unreachable: every tool result status has a case above, and a new one fails typecheck here.
      const unhandled: never = result.status;
      throw new TypeError(`Unhandled tool result status: ${String(unhandled)}`);
    }
  }
}

export interface TerminalCreateRequest {
  readonly resourceRef: string;
  readonly detail?: string;
  readonly cols?: number;
  readonly rows?: number;
  readonly shell?: string;
}

function parseTerminalCreate(input: RouteInputContext): Result<TerminalCreateRequest> {
  const body = input.body;
  if (!isRecord(body)) return err({ error: validationError({ message: 'body must be a JSON object' }) });
  const resourceRef = body.resourceRef;
  if (typeof resourceRef !== 'string' || resourceRef.length === 0) {
    return err({ error: validationError({ message: 'resourceRef is required' }, { issues: [{ path: 'resourceRef', message: 'required non-empty string' }] }) });
  }
  // Checked in this fixed order: the first invalid field is the one reported.
  const detail = readOptionalNonEmptyString({ body, field: 'detail' });
  if (!detail.ok) return detail;
  const cols = readOptionalNumber({ body, field: 'cols' });
  if (!cols.ok) return cols;
  const rows = readOptionalNumber({ body, field: 'rows' });
  if (!rows.ok) return rows;
  const shell = readOptionalNonEmptyString({ body, field: 'shell' });
  if (!shell.ok) return shell;
  return ok({ value: { resourceRef, ...withoutUndefined({ detail: detail.value, cols: cols.value, rows: rows.value, shell: shell.value }) } });
}

/**
 * `POST /api/terminals` — the one gated call (see module doc). Resolves
 * `resourceRef` to a working directory the same way `host-tools.ts`'s
 * open-in route does, then authorizes+spawns the session through
 * `ToolExecutor.execute(..., 'terminal.create', ...)`.
 */
export const terminalCreateRoute = defineJsonRoute<TerminalCreateRequest, TerminalSessionInfo, TerminalsHttpDeps>({
  method: 'post', path: '/api/terminals', parse: parseTerminalCreate, handle: async ({ input, deps }) => {
    const root = await resolveResourceRoot({ resourceRef: input.resourceRef, detail: input.detail }, { resolver: deps.resolveRoot ?? denyAllWorkspaceRoots });
    if (!root.ok) return root;
    const toolInput = { resourceRef: input.resourceRef, cwd: root.value, ...withoutUndefined({ cols: input.cols, rows: input.rows, shell: input.shell }) };
    const result = await deps.toolExecutor.execute({ principal: deps.principal, run: freshRun(), toolId: TERMINAL_CREATE_TOOL_ID, input: toolInput });
    return toolResultToApiResult(deps, result);
  }
}, { requireSameOrigin: true, successStatus: 201 });

export interface TerminalListResponse {
  readonly terminals: readonly TerminalSessionInfo[];
}

function parseTerminalList(input: RouteInputContext): Result<{ resourceRef?: string }> {
  const value = input.query.resourceRef;
  if (value === undefined) return ok({ value: {} });
  if (typeof value !== 'string' || value.length === 0) {
    return err({ error: validationError({ message: 'resourceRef must be a non-empty string when provided' }) });
  }
  return ok({ value: { resourceRef: value } });
}

/** `GET /api/terminals` — sessions the calling principal owns, optionally narrowed by `resourceRef`. Never gated through `ToolExecutor` — a read scoped to the caller's own sessions, matching `runs.ts`'s `runListRoute` precedent. */
export const terminalListRoute = defineJsonRoute<{ resourceRef?: string }, TerminalListResponse, TerminalsHttpDeps>({
  method: 'get', path: '/api/terminals', parse: parseTerminalList, handle: ({ input, deps }) =>
    ok({ value: { terminals: deps.manager.list({ principal: deps.principal }, { filter: input.resourceRef === undefined ? {} : { resourceRef: input.resourceRef } }) } })
});

function parseTerminalId(input: RouteInputContext): Result<string> {
  const id = input.params.id;
  return typeof id === 'string' && id.length > 0 ? ok({ value: id }) : err({ error: validationError({ message: 'id must be a non-empty path parameter' }) });
}

export interface TerminalActionResponse {
  readonly ok: boolean;
  readonly terminal?: TerminalSessionInfo;
}

/**
 * Exported (not just internal) so the `result.session === null` branch — a real race
 * (`write`/`resize`/`kill` finding metadata for an id whose underlying session was concurrently
 * killed between the ownership check and the critical section, per `@jini-ai/daemon`'s
 * `terminal-session.ts` `currentSnapshot`) — is directly unit-testable against a synthetic
 * `TerminalSessionActionResult` rather than requiring a real, hard-to-deterministically-force race
 * through the full `TerminalSessionManager`. Same "extract into a directly-testable pure function" shape as
 * the other route files' parse helpers.
 */
export function actionResultToApiResult({ result, notFoundMessage }: { readonly result: TerminalSessionActionResult; readonly notFoundMessage: string }, _optional: Record<string, never> = {}): Result<TerminalActionResponse> {
  if (result.status === 'not-found') return err({ error: createApiError({ code: 'NOT_FOUND', message: notFoundMessage }) });
  return ok({ value: { ok: result.ok, ...(result.session ? { terminal: result.session } : {}) } });
}

function parseStdinInput(input: RouteInputContext): Result<{ id: string; data: string }> {
  const parsedId = parseTerminalId(input);
  if (!parsedId.ok) return parsedId;
  if (!isRecord(input.body)) return err({ error: validationError({ message: 'body must be a JSON object' }) });
  const data = input.body.data;
  if (typeof data !== 'string') {
    return err({ error: validationError({ message: 'data (string) is required' }, { issues: [{ path: 'data', message: 'required string' }] }) });
  }
  return ok({ value: { id: parsedId.value, data } });
}

/** `POST /api/terminals/:id/stdin` — writes `data` to the session's pty. Ownership-checked by `deps.manager.write` directly, not re-gated through `ToolExecutor` (see module doc). */
export const terminalStdinRoute = defineJsonRoute<{ id: string; data: string }, TerminalActionResponse, TerminalsHttpDeps>({
  method: 'post', path: '/api/terminals/:id/stdin', parse: parseStdinInput, handle: async ({ input, deps }) => {
    const result = await deps.manager.write({ principal: deps.principal, id: input.id, input: input.data });
    return actionResultToApiResult({ result, notFoundMessage: `terminal "${input.id}" was not found` });
  }
}, { requireSameOrigin: true });

function parseResizeInput(input: RouteInputContext): Result<{ id: string; cols: number; rows: number }> {
  const parsedId = parseTerminalId(input);
  if (!parsedId.ok) return parsedId;
  if (!isRecord(input.body)) return err({ error: validationError({ message: 'body must be a JSON object' }) });
  const cols = Number(input.body.cols);
  const rows = Number(input.body.rows);
  if (!Number.isFinite(cols) || !Number.isFinite(rows)) {
    return err({ error: validationError({ message: 'cols and rows (numbers) are required' }) });
  }
  return ok({ value: { id: parsedId.value, cols, rows } });
}

/** `POST /api/terminals/:id/resize` — resizes the session's pty. */
export const terminalResizeRoute = defineJsonRoute<{ id: string; cols: number; rows: number }, TerminalActionResponse, TerminalsHttpDeps>({
  method: 'post', path: '/api/terminals/:id/resize', parse: parseResizeInput, handle: async ({ input, deps }) => {
    const result = await deps.manager.resize({ principal: deps.principal, id: input.id, cols: input.cols, rows: input.rows });
    return actionResultToApiResult({ result, notFoundMessage: `terminal "${input.id}" was not found` });
  }
}, { requireSameOrigin: true });

function handleKill(id: string, deps: TerminalsHttpDeps): Promise<Result<TerminalActionResponse>> {
  return deps.manager.kill({ principal: deps.principal, id }, { signal: 'SIGTERM' }).then((result) => actionResultToApiResult({ result, notFoundMessage: `terminal "${id}" was not found` }));
}

/** `POST /api/terminals/:id/kill` — sends `SIGTERM` to the session's pty. */
export const terminalKillRoute = defineJsonRoute<string, TerminalActionResponse, TerminalsHttpDeps>({ method: 'post', path: '/api/terminals/:id/kill', parse: parseTerminalId, handle: ({ input: id, deps }) => handleKill(id, deps) }, { requireSameOrigin: true });

/** `DELETE /api/terminals/:id` — alias for `kill`, matching OD's dual `POST .../kill` / `DELETE` routes. */
export const terminalDeleteRoute = defineJsonRoute<string, TerminalActionResponse, TerminalsHttpDeps>({ method: 'delete', path: '/api/terminals/:id', parse: parseTerminalId, handle: ({ input: id, deps }) => handleKill(id, deps) }, { requireSameOrigin: true });

/** The wire shape the stream carries for a terminal — the underlying `@jini-ai/platform` event's `id`/`event`/`data` triple, reshaped to `SseEvent`'s `opaqueCursor`/`kind` naming. */
interface TerminalWireEvent extends SseEvent {
  readonly data: unknown;
}

/** Path the terminal output stream is mounted at. */
const TERMINAL_STREAM_ROUTE_PATH = '/api/terminals/:id/stream';

const errorResponse = ({ error }: { readonly error: ApiError }): Response => jsonResponse({ status: statusForError({ error }), body: createApiErrorResponse({ error }) });

/**
 * Opens `GET /api/terminals/:id/stream`: the session's output as SSE, with `Last-Event-ID`/`afterCursor` reconnect replay.
 *
 * `deps.manager.attach` is synchronous and may deliver the whole replay, and even call `sink.end()`, from inside
 * that one call (an already-exited session). Everything it sends before it returns is history already held
 * in memory, so it is queued as `backlog` (it does not count against the live-frame cap), and `sink.end()`
 * ends the stream after the frames already queued: an exited session's replay is delivered whole, then the stream ends.
 * An unknown session is answered as JSON 404 before any frame is produced. The stream has no heartbeat: this route never sent one.
 */
function openTerminalStream(
  { request, id, deps, host }: { readonly request: Request; readonly id: string; readonly deps: TerminalsHttpDeps; readonly host: DaemonRouteHost },
  _optional: Record<string, never> = {},
): Response {
  const cursor = lastEventCursor({ request });
  let attachedSink: TerminalSseSink | null = null;
  let attaching = true;
  const stream = createSseStream<TerminalWireEvent>({ scheduler: host.scheduler }, {
    signal: request.signal, keepAliveMs: false, headers: SSE_CHARSET_HEADERS,
    isEndEvent: ({ event }) => event.kind === 'exit',
    onClose: () => { const sink = attachedSink; attachedSink = null; if (sink) deps.manager.detach({ id, sink }); },
  });
  const sink: TerminalSseSink = {
    send: (event, data, eventId) => stream.send({ event: { opaqueCursor: String(eventId), kind: event, data } }, { backlog: attaching }),
    end: () => stream.end(),
  };
  const result = deps.manager.attach({ principal: deps.principal, id, lastEventId: cursor === null ? 0 : Number(cursor), sink });
  attaching = false;
  if (result === 'not-found') {
    stream.end();
    return errorResponse({ error: createApiError({ code: 'NOT_FOUND', message: `terminal "${id}" was not found` }) });
  }
  // The client may have left while `attach` ran: detach now instead of leaking the sink.
  if (result === 'attached') {
    if (stream.closed) deps.manager.detach({ id, sink });
    else attachedSink = sink;
  }
  return stream.response;
}

/** `GET /api/terminals/:id/stream`. The same-origin check runs before the manager is touched, so a cross-origin request never gets a stream. */
function terminalStreamRoute({ deps, host }: { readonly deps: TerminalsHttpDeps; readonly host: DaemonRouteHost }): DaemonRoute {
  return gated({
    route: {
      method: 'GET', path: TERMINAL_STREAM_ROUTE_PATH,
      // The route table never matches an empty `:id` segment, so `params.id` is always a non-empty string here.
      handler: ({ request, params }) => sameOriginRefusal({ request, origin: host.context }) ?? openTerminalStream({ request, id: params.id ?? '', deps, host }),
    },
    gates: [{ name: 'same-origin' }],
  });
}

/** Every terminal route (`list`/`create`/`stdin`/`resize`/`kill`/`delete`/`stream`) as data. A pack's `http` mounts the list. Internal failures go through the host's reporter. */
export function terminalRoutes({ deps, host }: { readonly deps: Omit<TerminalsHttpDeps, 'reportInternalError'>; readonly host: DaemonRouteHost }, _optional: Record<string, never> = {}): DaemonRoute[] {
  const routeDeps = withHostReporter({ deps, host });
  return [
    gatedJsonRoute({ spec: terminalListRoute, deps: routeDeps, host }),
    gatedJsonRoute({ spec: terminalCreateRoute, deps: routeDeps, host }),
    gatedJsonRoute({ spec: terminalStdinRoute, deps: routeDeps, host }),
    gatedJsonRoute({ spec: terminalResizeRoute, deps: routeDeps, host }),
    gatedJsonRoute({ spec: terminalKillRoute, deps: routeDeps, host }),
    gatedJsonRoute({ spec: terminalDeleteRoute, deps: routeDeps, host }),
    terminalStreamRoute({ deps: routeDeps, host }),
  ];
}
