/**
 * @module tool-execution-routes
 *
 * `POST /internal/tool-executions` and `GET /internal/tool-catalog` — the server end of
 * `createRemoteToolExecutor`. A host whose agent runtime runs in another local process mounts these
 * over its own gated `ToolExecutor`, so that process can run tools without loading them. The wire
 * protocol and the at-most-once rules are documented on `remote-tool-executor.ts`.
 *
 * Trust boundary, checked before any body byte is read (see `tool-execution-caller.ts`):
 * - a dedicated per-boot secret read from `tokenEnvVar`, compared in constant time; unset → 503 (the
 *   route fails closed, there is no "open" mode), wrong or missing → 401;
 * - the TCP peer (the connection's address, never a forwarded header) must be loopback → else 403.
 * Only then does the route read its own body (at most `maxBodyBytes`), so an unauthenticated
 * caller cannot make the host buffer a large body, and a host parser with a smaller limit mounted
 * after this list never sees these requests: mount the list with no parser above it. Over the limit → 413.
 *
 * The executor below is the host's full gate (authorize, confirm, audit); this route adds no
 * authority of its own and the serialized principal is passed through untouched for it to judge.
 *
 * Cancellation: the 200 headers leave as soon as the route returns its response, which is before the
 * executor finishes, and the executor's signal aborts when the caller goes away. A request body that
 * never completed never reaches the executor (reading it fails first).
 */
import { createApiError, createApiErrorResponse } from '@jini-ai/protocol';
import type { Principal, ToolDescriptor } from '@jini-ai/core';
import { jsonResponse, readJsonBody, readQuery, statusForError, type ServerMiddleware } from '@jini-ai/core/contracts/server';
import type { ToolExecutor } from "../tool-executor-types.js";
import { TOOL_EXECUTIONS_ROUTE_PATH, type ToolExecutionWireRequest } from '../remote-tool-executor.js';
import type { DaemonRouteHost } from './route-host.js';
import { createLineStream } from './line-stream.js';
import { DEFAULT_TOOL_EXEC_TOKEN_ENV_VAR, toolExecutionCallerRefusal } from './tool-execution-caller.js';
import { gated, type DaemonRoute } from './route-table.js';
import { writeToolExecution, type RunWithToolContext } from './tool-execution-stream.js';

export { TOOL_EXECUTIONS_ROUTE_PATH };
export const TOOL_CATALOG_ROUTE_PATH = '/internal/tool-catalog';
/** Tool inputs carry whole documents; 16 MiB matches the largest the agent side sends. */
export const DEFAULT_TOOL_EXEC_MAX_BODY_BYTES = 16 * 1024 * 1024;

/**
 * What a host's run check sees, after the body is read and before it is validated: the raw parsed JSON of an
 * execution (not yet validated), or the raw query of a catalog request.
 */
export type ToolRunAuthorization =
  | { readonly kind: 'execute'; readonly body: unknown }
  | { readonly kind: 'catalog'; readonly query: { readonly runId: unknown; readonly principalId: unknown } };

/**
 * The host's verdict on a tool call. `allowed` may narrow who the call runs as: when `principal` is present it
 * REPLACES the principal the caller wrote in the body (so no other field the caller supplied survives); when
 * absent the body's own principal is used. A refusal carries the answer to send.
 */
export type ToolRunVerdict =
  | { readonly allowed: true; readonly principal?: { readonly id: string; readonly toolAccess?: 'read-only' } }
  | { readonly allowed: false; readonly response: Response };

/**
 * Host-owned live-run/identity check. It runs after the body is read and BEFORE the body is validated, so a
 * malformed call for a dead run is refused by this check (not answered 400). A thrown error reaches the host's
 * own error path and nothing executes.
 */
export type AuthorizeToolRun = (
  required: ToolRunAuthorization,
  optional?: { readonly signal?: AbortSignal },
) => Promise<ToolRunVerdict>;

/** Where an unexpected failure's original error goes (the reporter's own sink argument). */
type RouteInternalErrorSink = NonNullable<Parameters<DaemonRouteHost['reportInternalError']>[1]>['onInternalError'];

export interface ToolExecutionRoutesRequired {
  readonly executor: ToolExecutor;
  /** Built fresh on every catalog request; the route never caches it. */
  readonly listToolsFor: (required: { readonly principalId: string }, optional?: Record<string, never>) => readonly ToolDescriptor[] | Promise<readonly ToolDescriptor[]>;
  /** Where the shared secret is read from. Required: the daemon never reaches for `process.env`. */
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly host: DaemonRouteHost;
}

export interface ToolExecutionRoutesOptional {
  /** Env var holding the shared secret. Defaults to {@link DEFAULT_TOOL_EXEC_TOKEN_ENV_VAR}. */
  readonly tokenEnvVar?: string;
  /** Defaults to {@link DEFAULT_TOOL_EXEC_MAX_BODY_BYTES}. */
  readonly maxBodyBytes?: number;
  readonly runWithContext?: RunWithToolContext;
  /** Host-owned live-run/identity gate, after the body is read and before either route dispatches. */
  readonly authorizeRun?: AuthorizeToolRun;
  /** Receives an unexpected route failure with its request ID; defaults to a redacted `console.error`. */
  readonly onInternalError?: RouteInternalErrorSink | undefined;
}

function callerGate({ env, host }: Pick<ToolExecutionRoutesRequired, 'env' | 'host'>, { tokenEnvVar }: { readonly tokenEnvVar?: string | undefined }): ServerMiddleware {
  return ({ request, client, next }) => {
    const refusal = toolExecutionCallerRefusal(
      { authorization: request.headers.get('authorization') ?? undefined, peerAddress: client?.address, env, timingSafeEqual: host.timingSafeEqual },
      tokenEnvVar === undefined ? {} : { tokenEnvVar },
    );
    return refusal === null ? next() : jsonResponse({ status: refusal.status, body: createApiErrorResponse({ error: refusal.error }) });
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasStringId(value: unknown): boolean {
  return isRecord(value) && typeof value.id === 'string' && value.id.length > 0;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Validates the wire body; `null` → 400. The principal object is kept whole for the host's gate. */
function parseExecutionRequest(body: unknown): ToolExecutionWireRequest | null {
  if (!isRecord(body) || !nonEmptyString(body.executionId) || !nonEmptyString(body.toolId)) return null;
  if (!hasStringId(body.principal) || !hasStringId(body.run)) return null;
  const run = body.run as { id: string };
  return {
    executionId: body.executionId,
    principal: body.principal as unknown as Principal,
    run: { id: run.id },
    toolId: body.toolId,
    input: body.input,
    ...(body.context === undefined ? {} : { context: body.context }),
  };
}

const refusal = ({ status, error }: { readonly status: number; readonly error: ReturnType<typeof createApiError> }): Response =>
  jsonResponse({ status, body: createApiErrorResponse({ error }) });

/** What a body the route could not read answers: too large → 413, an unreadable body → 400, a body no host may send (compressed) → the reader's own refusal. */
function unreadableBody({ error }: { readonly error: { readonly code: string; readonly message: string } }): Response {
  if (error.code === 'PAYLOAD_TOO_LARGE') return refusal({ status: 413, error: createApiError({ code: 'PAYLOAD_TOO_LARGE', message: 'request body too large' }) });
  if (error.code === 'UNSUPPORTED_MEDIA_TYPE') return refusal({ status: statusForError({ error }), error: createApiError({ code: error.code, message: error.message }) });
  return refusal({ status: 400, error: createApiError({ code: 'BAD_REQUEST', message: 'request body must be valid JSON' }) });
}

/** Body → host run check (which may narrow the principal) → validation → one NDJSON answer, headers first. */
function executionRoute(
  { executor, host }: Pick<ToolExecutionRoutesRequired, 'executor' | 'host'>,
  { maxBodyBytes, authorizeRun, runWithContext }: { readonly maxBodyBytes: number; readonly authorizeRun?: AuthorizeToolRun | undefined; readonly runWithContext?: RunWithToolContext | undefined },
): (required: { readonly request: Request }) => Promise<Response> {
  return async ({ request }) => {
    const read = await readJsonBody({ request }, { maxBytes: maxBodyBytes });
    // Refuse a too-large, malformed, or interrupted body before the executor can run.
    if (!read.ok) return unreadableBody({ error: read.error });
    let body = read.value;
    const verdict = authorizeRun ? await authorizeRun({ kind: 'execute', body }, { signal: request.signal }) : undefined;
    if (verdict && !verdict.allowed) return verdict.response;
    if (verdict?.principal !== undefined && isRecord(body)) body = { ...body, principal: verdict.principal };
    const call = parseExecutionRequest(body);
    if (call === null) {
      return refusal({ status: 400, error: createApiError({ code: 'BAD_REQUEST', message: 'body must be { executionId, principal: { id }, run: { id }, toolId, input, context? }' }) });
    }
    const stream = createLineStream({ scheduler: host.scheduler, signal: request.signal });
    // Not awaited: the answer's headers must leave before the tool finishes. It never rejects (a failure is the stream's `throw` line).
    void writeToolExecution({ stream, call, executor }, runWithContext === undefined ? {} : { runWithContext });
    return stream.response;
  };
}

/**
 * Catalog for one principal. Answered with `no-store` and no validator: plugin state and delete policy can
 * change between two runs, so this answer must never be served from a validator cache.
 */
function catalogRoute(
  { listToolsFor, host }: Pick<ToolExecutionRoutesRequired, 'listToolsFor' | 'host'>,
  { authorizeRun, onInternalError }: { readonly authorizeRun?: AuthorizeToolRun | undefined; readonly onInternalError?: ToolExecutionRoutesOptional['onInternalError'] },
): (required: { readonly request: Request }) => Promise<Response> {
  return async ({ request }) => {
    const query = readQuery({ request });
    const verdict = authorizeRun ? await authorizeRun({ kind: 'catalog', query: { runId: query.runId, principalId: query.principalId } }, { signal: request.signal }) : undefined;
    if (verdict && !verdict.allowed) return verdict.response;
    const principalId = query.principalId;
    if (!nonEmptyString(principalId)) {
      return refusal({ status: 400, error: createApiError({ code: 'BAD_REQUEST', message: 'principalId query parameter is required' }) });
    }
    try {
      return jsonResponse({ status: 200, body: { tools: await listToolsFor({ principalId }) } }, { headers: { 'cache-control': 'no-store' } });
    } catch (error) {
      const failure = host.reportInternalError({
        report: { source: 'tool-catalog', error }, logSource: 'tool-catalog',
        message: 'The tool list could not be loaded. Try again; if it keeps failing, copy the request ID and report this problem.',
      }, { onInternalError });
      return jsonResponse({ status: 500, body: createApiErrorResponse({ error: failure }) });
    }
  };
}

/**
 * Both routes as data, each behind the caller gate (token + loopback + bearer, run before any body byte is
 * read). Mount the list with no body parser above it: the execution route reads its own body (at most
 * `maxBodyBytes`) after its gate, so an unauthenticated caller cannot make the host buffer a large body and an
 * earlier parser cannot cap tool inputs at its own limit.
 */
export function toolExecutionRoutes(
  { executor, listToolsFor, env, host }: ToolExecutionRoutesRequired,
  { tokenEnvVar, maxBodyBytes = DEFAULT_TOOL_EXEC_MAX_BODY_BYTES, runWithContext, authorizeRun, onInternalError }: ToolExecutionRoutesOptional = {},
): DaemonRoute[] {
  const gates = [{ name: 'tool-exec-caller' as const, middleware: callerGate({ env, host }, { tokenEnvVar }) }];
  return [
    gated({ route: { method: 'POST', path: TOOL_EXECUTIONS_ROUTE_PATH, handler: executionRoute({ executor, host }, { maxBodyBytes, authorizeRun, runWithContext }) }, gates }),
    gated({ route: { method: 'GET', path: TOOL_CATALOG_ROUTE_PATH, handler: catalogRoute({ listToolsFor, host }, { authorizeRun, onInternalError }) }, gates }),
  ];
}
