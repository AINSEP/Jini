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
import { randomUUID } from 'node:crypto';
import type { Express, NextFunction, Request, Response } from 'express';
import { createApiError, isTerminalRunState } from '@jini-ai/protocol';
import type { RemoteToolEventRecorder, RunLifecycle } from '@jini-ai/daemon';
import { defineJsonRoute, mountJsonRoute, type AdapterContext } from './adapter.js';
import { bearerTokenFromHeader, timingSafeTokenMatch } from './api-security-middleware.js';
import { validationError } from './request.js';
import { err, ok, type Result, type RouteInputContext } from './types.js';

export interface RemoteToolBridgeTokenConfig {
  /** Env var name for the required shared secret. Defaults to `JINI_REMOTE_TOOL_BRIDGE_TOKEN`. */
  readonly tokenEnvVar?: string;
}

export interface RemoteRunEventInternalErrorContext {
  readonly source: 'tool-use' | 'tool-result';
  readonly correlationId: string;
  readonly error: unknown;
}

export interface RemoteRunEventHttpDeps {
  /** Used to distinguish "unknown run" (404) from other outcomes before recording — same precedent as `delegated-tools.ts`'s `delegatedToolExecuteRoute` — and again afterwards to classify a recorder failure (see {@link toRemoteEventError}). */
  readonly lifecycle: RunLifecycle;
  readonly recorder: RemoteToolEventRecorder;
  readonly tokenConfig?: RemoteToolBridgeTokenConfig;
  /** Defaults to `process.env`. Threaded through so tests never have to mutate real process env. */
  readonly env?: NodeJS.ProcessEnv;
  /** Host-owned sink for the real exception behind a generic `INTERNAL_ERROR` response (SEC-005). Defaults to `console.error`. */
  readonly onInternalError?: (context: RemoteRunEventInternalErrorContext) => void;
}

function defaultInternalErrorSink(context: RemoteRunEventInternalErrorContext): void {
  // eslint-disable-next-line no-console
  console.error(`[@jini-ai/http-kit] internal error (remote-run-events/${context.source}, correlationId=${context.correlationId})`, context.error);
}

const DEFAULT_TOKEN_ENV_VAR = 'JINI_REMOTE_TOOL_BRIDGE_TOKEN';

/**
 * Gates both remote-run-event routes behind a dedicated shared secret. Unlike
 * `registerApiBearerAuthMiddleware`, there is no "unset means open" or "disabled" mode: a route
 * that lets a caller inject events into someone else's run must never silently run unauthenticated
 * just because a host forgot to configure the token. If the token isn't configured, the route
 * fails closed with 503, not 200.
 *
 * Kept as its own middleware rather than folded into `api-security-middleware.ts`'s
 * `requireStrictBearerToken` (which has the identical fail-closed/no-loopback-exemption posture)
 * because these two routes own their own error codes — `REMOTE_TOOL_BRIDGE_*`, distinct from the
 * general API token's, so an operator can tell which secret is missing from the response alone.
 * The *decision* logic is shared: header parsing and the constant-time comparison both come from
 * that module, so the two gates cannot drift on what counts as a well-formed header or on
 * comparison safety.
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
    const presented = bearerTokenFromHeader(req.get('authorization'));
    if (presented === null || !timingSafeTokenMatch(presented, token)) {
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
 * Records a caught `recordToolUse`/`recordToolResult` throw as the right HTTP outcome.
 *
 * `RunLifecycle.emit()` throws for two documented reasons (see `run-lifecycle.ts`'s own `emit`) —
 * unknown `runId` and "already terminal" — but the recorder call it sits behind can also fail for
 * reasons that are nobody's business but the operator's: an event-log write hitting a full disk, a
 * SQLite error naming its own file path, a driver fault carrying a credential in its message.
 *
 * This previously reported *every* one of those as `CONFLICT` carrying `error.message` verbatim,
 * which turned any such fault into an unauthenticated-adjacent information leak and mislabelled a
 * server fault as a client-resolvable conflict. So the outcome is now decided by the run's actual
 * state rather than by whatever the exception happened to say:
 *
 * - run is gone -> `NOT_FOUND` (it was there for the pre-check; it isn't now).
 * - run is terminal -> `CONFLICT`, the one legitimate business conflict. The message is
 *   *constructed here* from data this module already owns rather than forwarded from the
 *   exception, so even a misattributed error cannot smuggle its text out through this branch.
 * - anything else -> SEC-005: a generic `INTERNAL_ERROR` plus a correlation id, with the real
 *   error handed to the host's sink so it is diagnosable server-side but never echoed.
 *
 * Residual, deliberately accepted: a genuine storage fault that happens to coincide with an
 * already-terminal run is reported as `CONFLICT` rather than `INTERNAL_ERROR`. Distinguishing those
 * would require matching on `emit`'s message text, trading a rare wrong status code for a check
 * that breaks silently the next time that string is reworded. Either way nothing leaks, which is
 * the property that mattered.
 */
async function toRemoteEventError(
  error: unknown,
  runId: string,
  deps: RemoteRunEventHttpDeps,
  source: RemoteRunEventInternalErrorContext['source'],
): Promise<ReturnType<typeof createApiError>> {
  const status = await deps.lifecycle.get(runId).catch(() => undefined);
  if (status === undefined) {
    return createApiError('NOT_FOUND', `run "${runId}" was not found`);
  }
  if (isTerminalRunState(status.state)) {
    return createApiError('CONFLICT', `run "${runId}" is already terminal — no further events can be recorded`, {
      details: { runId },
    });
  }
  const correlationId = randomUUID();
  const sink = deps.onInternalError ?? defaultInternalErrorSink;
  sink({ source, correlationId, error });
  return createApiError('INTERNAL_ERROR', 'an internal error occurred', { requestId: correlationId });
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
      return err(await toRemoteEventError(error, input.runId, deps, 'tool-use'));
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
      return err(await toRemoteEventError(error, input.runId, deps, 'tool-result'));
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
