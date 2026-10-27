/**
 * @module tool-execution-routes
 *
 * `POST /internal/tool-executions` and `GET /internal/tool-catalog` — the server end of
 * `createRemoteToolExecutor`. A host whose agent runtime runs in another local process mounts these
 * over its own gated `ToolExecutor`, so that process can run tools without loading them. The wire
 * protocol and the at-most-once rules are documented on `remote-tool-executor.ts`.
 *
 * Trust boundary, checked before any body byte is parsed:
 * - a dedicated per-boot secret read from `tokenEnvVar`, compared in constant time; unset → 503 (the
 *   route fails closed, there is no "open" mode), wrong or missing → 401;
 * - the TCP peer (`req.socket.remoteAddress`, never a forwarded header) must be loopback → else 403.
 * Only then does the route's own `express.json({ limit: maxBodyBytes })` run, so an unauthenticated
 * caller cannot make the host buffer a large body, and an app-level parser with a smaller limit
 * mounted after this route never sees these requests. Over the limit → 413.
 *
 * The executor below is the host's full gate (authorize, confirm, audit); this route adds no
 * authority of its own and the serialized principal is passed through untouched for it to judge.
 *
 * Cancellation: the 200 headers are flushed before the executor runs, and the executor's signal
 * aborts when the response closes before it finished (the caller destroyed its request). A request
 * body that never completed never reaches the executor. Listeners are detached once the call
 * settles, so a long-lived keep-alive socket never accumulates them.
 */
import express, { type ErrorRequestHandler, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { createApiError, type ApiError } from '@jini-ai/protocol';
import type { Principal, SurfaceEmitter, ToolDescriptor } from '@jini-ai/core';
import { bearerTokenFromHeader, isLoopbackPeerAddress, sendApiError, statusForError, timingSafeTokenMatch } from '@jini-ai/http-kit';
import type { ToolExecutionResult, ToolExecutor } from '../tool-executor.js';
import { TOOL_EXECUTIONS_ROUTE_PATH, type ToolExecutionWireError, type ToolExecutionWireLine, type ToolExecutionWireRequest } from '../remote-tool-executor.js';

export { TOOL_EXECUTIONS_ROUTE_PATH };
export const TOOL_CATALOG_ROUTE_PATH = '/internal/tool-catalog';
export const DEFAULT_TOOL_EXEC_TOKEN_ENV_VAR = 'JINI_TOOL_EXEC_TOKEN';
/** Tool inputs carry whole documents; 16 MiB matches the largest the agent side sends. */
export const DEFAULT_TOOL_EXEC_MAX_BODY_BYTES = 16 * 1024 * 1024;

/** Anything routes can be mounted on: an Express app or a `Router`. */
export interface ToolExecutionRouteTarget {
  post(path: string, ...handlers: Array<RequestHandler | ErrorRequestHandler>): unknown;
  get(path: string, ...handlers: RequestHandler[]): unknown;
}

/** Runs one call inside host context (e.g. an AsyncLocalStorage scope) built from the wire `context`. */
export type RunWithToolContext = <T>(required: { readonly context: unknown; readonly fn: () => Promise<T> }, optional?: Record<string, never>) => Promise<T>;

export interface ToolExecutionRoutesRequired {
  readonly app: ToolExecutionRouteTarget;
  readonly executor: ToolExecutor;
  /** Built fresh on every catalog request; the route never caches it. */
  readonly listToolsFor: (required: { readonly principalId: string }, optional?: Record<string, never>) => readonly ToolDescriptor[] | Promise<readonly ToolDescriptor[]>;
}

export interface ToolExecutionRoutesOptional {
  /** Env var holding the shared secret. Defaults to {@link DEFAULT_TOOL_EXEC_TOKEN_ENV_VAR}. */
  readonly tokenEnvVar?: string;
  /** Defaults to `process.env`; injectable so tests never mutate the real env. */
  readonly env?: NodeJS.ProcessEnv;
  /** Defaults to {@link DEFAULT_TOOL_EXEC_MAX_BODY_BYTES}. */
  readonly maxBodyBytes?: number;
  readonly runWithContext?: RunWithToolContext;
}

function refusalFor({ req, expected, tokenEnvVar }: { readonly req: Request; readonly expected: string | undefined; readonly tokenEnvVar: string }): ApiError | null {
  if (!expected) return createApiError({ code: 'NOT_CONFIGURED', message: `${tokenEnvVar} is not set — remote tool execution is disabled` });
  if (!isLoopbackPeerAddress({ address: req.socket?.remoteAddress })) {
    return createApiError({ code: 'FORBIDDEN', message: 'remote tool execution accepts loopback callers only' });
  }
  const presented = bearerTokenFromHeader({ header: req.get('authorization') });
  if (presented === null || !timingSafeTokenMatch({ presented, expected })) {
    return createApiError({ code: 'UNAUTHORIZED', message: `Authorization: Bearer <${tokenEnvVar}> required` });
  }
  return null;
}

/** The token + loopback gate; mounted before any body parser. Exported for hosts that need it on another path. */
export function requireToolExecutionCaller(
  _required: Record<string, never>,
  { tokenEnvVar = DEFAULT_TOOL_EXEC_TOKEN_ENV_VAR, env = process.env }: Pick<ToolExecutionRoutesOptional, 'tokenEnvVar' | 'env'> = {},
): RequestHandler {
  return (req, res, next) => {
    const refusal = refusalFor({ req, expected: env[tokenEnvVar], tokenEnvVar });
    if (refusal === null) { next(); return; }
    sendApiError({ res, status: statusForError({ error: refusal }), error: refusal });
  };
}

/** Maps a body-parser failure (too large, malformed, aborted mid-body) to a refusal; the executor never runs. */
const bodyParserFailure: ErrorRequestHandler = (error: { status?: number }, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) { next(error); return; }
  const tooLarge = error.status === 413;
  const apiError = createApiError({ code: tooLarge ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST', message: tooLarge ? 'request body too large' : 'request body must be valid JSON' });
  sendApiError({ res, status: tooLarge ? 413 : 400, error: apiError });
};

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

function wireError(error: unknown): ToolExecutionWireError {
  if (!(error instanceof Error)) return { name: 'Error', message: String(error) };
  const code = (error as { code?: unknown }).code;
  return { name: error.name, message: error.message, ...(typeof code === 'string' ? { code } : {}) };
}

/**
 * Streams one execution as NDJSON. Headers go out first; surfaces are written as they are emitted
 * and are dropped once the call settled; exactly one terminal line follows.
 */
async function streamExecution(
  { req, res, call, executor }: { readonly req: Request; readonly res: Response; readonly call: ToolExecutionWireRequest; readonly executor: ToolExecutor },
  { runWithContext }: Pick<ToolExecutionRoutesOptional, 'runWithContext'>,
): Promise<void> {
  const controller = new AbortController();
  // `res` 'close' (not `req` 'close', which fires as soon as a completed body was read) means the
  // caller went away; after a normal end `writableFinished` is already true and nothing aborts.
  const onClose = (): void => { if (!res.writableFinished) controller.abort(); };
  const onRequestError = (): void => controller.abort();
  res.on('close', onClose);
  req.on('error', onRequestError);
  res.status(200).setHeader('content-type', 'application/x-ndjson');
  res.setHeader('cache-control', 'no-store');
  res.flushHeaders();
  let settled = false;
  const writeLine = (line: ToolExecutionWireLine): void => { if (!res.writableEnded) res.write(`${JSON.stringify(line)}\n`); };
  const emitSurface: SurfaceEmitter = async (emission) => { if (!settled) writeLine({ type: 'surface', emission }); };
  const run = (): Promise<ToolExecutionResult> => executor.execute(
    { principal: call.principal, run: call.run, toolId: call.toolId, input: call.input },
    { signal: controller.signal, emitSurface },
  );
  try {
    if (!req.complete || controller.signal.aborted) return;
    const result = runWithContext ? await runWithContext({ context: call.context, fn: run }) : await run();
    writeLine({ type: 'result', result });
  } catch (error) {
    writeLine({ type: 'throw', error: wireError(error) });
  } finally {
    settled = true;
    res.off('close', onClose);
    req.off('error', onRequestError);
    res.end();
  }
}

function executionHandler(
  { executor }: Pick<ToolExecutionRoutesRequired, 'executor'>,
  optional: Pick<ToolExecutionRoutesOptional, 'runWithContext'>,
): RequestHandler {
  return (req, res) => {
    const call = parseExecutionRequest(req.body);
    if (call === null) {
      const error = createApiError({ code: 'BAD_REQUEST', message: 'body must be { executionId, principal: { id }, run: { id }, toolId, input, context? }' });
      sendApiError({ res, status: 400, error });
      return;
    }
    void streamExecution({ req, res, call, executor }, optional);
  };
}

/**
 * Catalog for one principal. Written with `res.end` rather than `res.json` because Express adds a
 * weak ETag to `json` GET responses, and this answer must never be served from a validator cache:
 * plugin state and delete policy can change between two runs.
 */
function catalogHandler({ listToolsFor }: Pick<ToolExecutionRoutesRequired, 'listToolsFor'>): RequestHandler {
  return async (req, res) => {
    const principalId = req.query.principalId;
    if (!nonEmptyString(principalId)) {
      sendApiError({ res, status: 400, error: createApiError({ code: 'BAD_REQUEST', message: 'principalId query parameter is required' }) });
      return;
    }
    try {
      const tools = await listToolsFor({ principalId });
      res.status(200).setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      res.end(JSON.stringify({ tools }));
    } catch {
      sendApiError({ res, status: 500, error: createApiError({ code: 'INTERNAL_ERROR', message: 'an internal error occurred' }) });
    }
  };
}

/**
 * Mounts both routes on `app` (an Express app or a `Router`). Mount it BEFORE any app-level
 * `express.json()` with a smaller limit: this route parses its own body after its gate, and an
 * earlier parser would both buffer unauthenticated bodies and cap tool inputs at its own limit.
 */
export function registerToolExecutionRoutes(
  { app, executor, listToolsFor }: ToolExecutionRoutesRequired,
  { tokenEnvVar, env, maxBodyBytes = DEFAULT_TOOL_EXEC_MAX_BODY_BYTES, runWithContext }: ToolExecutionRoutesOptional = {},
): void {
  const gate = requireToolExecutionCaller({}, { ...(tokenEnvVar === undefined ? {} : { tokenEnvVar }), ...(env === undefined ? {} : { env }) });
  const parser = express.json({ limit: maxBodyBytes });
  app.post(TOOL_EXECUTIONS_ROUTE_PATH, gate, parser, executionHandler({ executor }, runWithContext === undefined ? {} : { runWithContext }), bodyParserFailure);
  app.get(TOOL_CATALOG_ROUTE_PATH, gate, catalogHandler({ listToolsFor }));
}

