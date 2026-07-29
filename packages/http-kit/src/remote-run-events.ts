/**
 * @module remote-run-events
 *
 * `POST /api/runs/:runId/tool-use` and `POST /api/runs/:runId/tool-result` — lets a tool call that
 * executed in a DIFFERENT OS process from the one holding this run's `RunLifecycle` report its
 * outcome back into the run's own event log, so SSE subscribers (a chat UI, a reattaching client)
 * see it exactly as they would a locally-executed delegated tool call.
 *
 * This exists to relax `@jini-ai/daemon`'s co-location requirement (`RunLifecycle`/`ToolExecutor`
 * previously had to live in one process per run, because `DelegatedToolBridge.execute()` calls
 * `lifecycle.emit()` in-process with no remote path — see this repo's own `tovu-learnings.md` §1a).
 * It does not remove any authorization: whatever executed the tool remotely already ran it through
 * its OWN `ToolExecutor`/`ToolPolicy` gate before calling here. This route only lets that outcome
 * be recorded into a run it does not own the process of.
 *
 * **Deliberately a separate trust boundary from `registerApiBearerAuthMiddleware`'s general API
 * token** (`api-security-middleware.ts`): that token may reach browser-adjacent callers depending
 * on deployment. This route is meant only for a host's own trusted backend-to-backend delegation
 * (e.g. a sidecar tool-execution process reporting back to the process that owns the run), so its
 * token has no "disabled" escape hatch and does not exempt loopback peers the way the general
 * bearer gate does — a loopback bind is exactly the shape a same-machine but lower-trust process
 * would also present, and this route grants direct run-event-injection, a materially different
 * capability from what the general API token was designed to gate.
 */
import type { Express, NextFunction, Request, Response } from 'express';
import { createApiError } from '@jini-ai/protocol';
import type { RemoteToolEventRecorder, RunLifecycle } from '@jini-ai/daemon';
import { defineJsonRoute, mountJsonRoute, type AdapterContext } from './adapter.js';
import { validationError } from './request.js';
import { err, ok, type Result, type RouteInputContext } from './types.js';

export interface RemoteToolBridgeTokenConfig {
  /** Env var name for the required shared secret. Defaults to `JINI_REMOTE_TOOL_BRIDGE_TOKEN`. */
  readonly tokenEnvVar?: string;
}

export interface RemoteRunEventHttpDeps {
  /** Used only to distinguish "unknown run" (404) from other outcomes before recording — same precedent as `delegated-tools.ts`'s `delegatedToolExecuteRoute`. */
  readonly lifecycle: RunLifecycle;
  readonly recorder: RemoteToolEventRecorder;
  readonly tokenConfig?: RemoteToolBridgeTokenConfig;
  /** Defaults to `process.env`. Threaded through so tests never have to mutate real process env. */
  readonly env?: NodeJS.ProcessEnv;
}

const DEFAULT_TOKEN_ENV_VAR = 'JINI_REMOTE_TOOL_BRIDGE_TOKEN';
const BEARER_TOKEN_PATTERN = /^Bearer\s+(\S+)\s*$/i;

/**
 * Gates both remote-run-event routes behind a dedicated shared secret. Unlike
 * `registerApiBearerAuthMiddleware`, there is no "unset means open" or "disabled" mode: a route
 * that lets a caller inject events into someone else's run must never silently run unauthenticated
 * just because a host forgot to configure the token. If the token isn't configured, the route
 * fails closed with 503, not 200.
 */
export function requireRemoteToolBridgeToken(deps: {
  readonly tokenConfig?: RemoteToolBridgeTokenConfig;
  readonly env?: NodeJS.ProcessEnv;
}) {
  const tokenEnvVar = deps.tokenConfig?.tokenEnvVar ?? DEFAULT_TOKEN_ENV_VAR;
  const env = deps.env ?? process.env;
  return (req: Request, res: Response, next: NextFunction): void => {
    const token = env[tokenEnvVar];
    if (!token) {
      res.status(503).json({
        error: {
          code: 'REMOTE_TOOL_BRIDGE_NOT_CONFIGURED',
          message: `${tokenEnvVar} is not set — remote run-event ingestion is disabled`,
        },
      });
      return;
    }
    const match = BEARER_TOKEN_PATTERN.exec(req.get('authorization') ?? '');
    if (!match || match[1] !== token) {
      res.status(401).json({
        error: { code: 'REMOTE_TOOL_BRIDGE_TOKEN_REQUIRED', message: `Authorization: Bearer <${tokenEnvVar}> required` },
      });
      return;
    }
    next();
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

/**
 * Like {@link requireNonEmptyString} but accepts `''`, for the one field where empty is a real
 * value rather than a missing one: a tool's result `content`.
 *
 * The local path already produces empty content legitimately — `serializeDelegatedToolOutput`
 * (`@jini-ai/daemon`'s `delegated-tool-bridge.ts`) maps a handler returning `undefined` to `''`,
 * and `DelegatedToolBridge.execute()` emits that verbatim as the `tool_result` event's `content`.
 * Rejecting `''` here would mean a tool that legitimately produces no output can be reported
 * in-process but **not** remotely — a silent semantic divergence between the two paths that would
 * surface as a 400 on the one tool call a host least expects to fail. Identifiers (`runId`,
 * `toolUseId`, `toolId`) keep the non-empty check: for those, empty really is missing.
 */
function requireString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === 'string' ? value : undefined;
}

function parseRunId(input: RouteInputContext): Result<string> {
  const runId = input.params.runId;
  return typeof runId === 'string' && runId.length > 0
    ? ok(runId)
    : err(validationError('runId must be a non-empty path parameter'));
}

export interface RemoteToolUseRequest {
  readonly runId: string;
  readonly toolUseId: string;
  readonly toolId: string;
  readonly input?: unknown;
}

export interface RemoteToolResultRequest {
  readonly runId: string;
  readonly toolUseId: string;
  readonly content: string;
  readonly isError?: boolean;
}

export interface RemoteRunEventResponse {
  readonly recorded: true;
}

function parseRemoteToolUse(input: RouteInputContext): Result<RemoteToolUseRequest> {
  const parsedRunId = parseRunId(input);
  if (!parsedRunId.ok) return parsedRunId;
  if (!isRecord(input.body)) return err(validationError('body must be a JSON object'));

  const toolUseId = requireNonEmptyString(input.body, 'toolUseId');
  if (toolUseId === undefined) {
    return err(validationError('toolUseId must be a non-empty string', [{ path: 'toolUseId', message: 'required non-empty string' }]));
  }
  const toolId = requireNonEmptyString(input.body, 'toolId');
  if (toolId === undefined) {
    return err(validationError('toolId must be a non-empty string', [{ path: 'toolId', message: 'required non-empty string' }]));
  }
  return ok({ runId: parsedRunId.value, toolUseId, toolId, input: input.body.input });
}

function parseRemoteToolResult(input: RouteInputContext): Result<RemoteToolResultRequest> {
  const parsedRunId = parseRunId(input);
  if (!parsedRunId.ok) return parsedRunId;
  if (!isRecord(input.body)) return err(validationError('body must be a JSON object'));

  const toolUseId = requireNonEmptyString(input.body, 'toolUseId');
  if (toolUseId === undefined) {
    return err(validationError('toolUseId must be a non-empty string', [{ path: 'toolUseId', message: 'required non-empty string' }]));
  }
  // Empty is allowed here, deliberately — see `requireString`'s own doc for the local-path parity
  // this preserves. Only a non-string (or absent) `content` is a validation failure.
  const content = requireString(input.body, 'content');
  if (content === undefined) {
    return err(validationError('content must be a string', [{ path: 'content', message: 'required string' }]));
  }
  const isError = input.body.isError;
  if (isError !== undefined && typeof isError !== 'boolean') {
    return err(validationError('isError must be a boolean when provided', [{ path: 'isError', message: 'boolean when provided' }]));
  }
  return ok({ runId: parsedRunId.value, toolUseId, content, ...(isError === undefined ? {} : { isError }) });
}

/**
 * Records a caught `recordToolUse`/`recordToolResult` throw as the right HTTP outcome:
 * `RunLifecycle.emit()` throws for two distinct reasons (see `run-lifecycle.ts`'s own `emit`) —
 * unknown `runId` (already ruled out by the `lifecycle.get()` check above this call, but kept as a
 * defensive fallback) and "already terminal", which is a legitimate business conflict, not a
 * server fault, so it is reported as `CONFLICT` with the real message rather than SEC-005-redacted.
 */
function toRemoteEventError(error: unknown, runId: string): ReturnType<typeof createApiError> {
  const message = error instanceof Error ? error.message : String(error);
  return createApiError('CONFLICT', message, { details: { runId } });
}

export const remoteToolUseRoute = defineJsonRoute<RemoteToolUseRequest, RemoteRunEventResponse, RemoteRunEventHttpDeps>({
  method: 'post',
  path: '/api/runs/:runId/tool-use',
  parse: parseRemoteToolUse,
  handle: async (input, deps) => {
    const run = await deps.lifecycle.get(input.runId);
    if (run === undefined) return err(createApiError('NOT_FOUND', `run "${input.runId}" was not found`));
    try {
      await deps.recorder.recordToolUse(input.runId, { toolUseId: input.toolUseId, toolId: input.toolId, input: input.input });
      return ok({ recorded: true });
    } catch (error) {
      return err(toRemoteEventError(error, input.runId));
    }
  },
});

export const remoteToolResultRoute = defineJsonRoute<RemoteToolResultRequest, RemoteRunEventResponse, RemoteRunEventHttpDeps>({
  method: 'post',
  path: '/api/runs/:runId/tool-result',
  parse: parseRemoteToolResult,
  handle: async (input, deps) => {
    const run = await deps.lifecycle.get(input.runId);
    if (run === undefined) return err(createApiError('NOT_FOUND', `run "${input.runId}" was not found`));
    try {
      await deps.recorder.recordToolResult(input.runId, {
        toolUseId: input.toolUseId,
        content: input.content,
        ...(input.isError === undefined ? {} : { isError: input.isError }),
      });
      return ok({ recorded: true });
    } catch (error) {
      return err(toRemoteEventError(error, input.runId));
    }
  },
});

/**
 * Mounts both remote-run-event routes on `app`, gated by {@link requireRemoteToolBridgeToken}.
 * Unlike `registerRunRoutes`/`registerDelegatedToolRoutes`, these routes do not use
 * `requireSameOrigin` — they are not meant to be called from a browser at all, only from a host's
 * own trusted backend process, so the dedicated bearer token above is the sole gate.
 */
export function registerRemoteRunEventRoutes(app: Express, deps: RemoteRunEventHttpDeps, adapter: AdapterContext): void {
  const gate = requireRemoteToolBridgeToken(deps);
  app.use('/api/runs/:runId/tool-use', gate);
  app.use('/api/runs/:runId/tool-result', gate);
  mountJsonRoute(app, remoteToolUseRoute, deps, adapter);
  mountJsonRoute(app, remoteToolResultRoute, deps, adapter);
}
