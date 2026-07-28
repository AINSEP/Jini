/**
 * @module delegated-tools
 *
 * `POST /api/delegated-tool-calls` — the daemon-side half of gap 3's MCP-callback continuation
 * transport spike (see `packages/daemon/source-map.md`'s "run/chat orchestration gap 3, part 1"
 * addition and this package's own dated section in `source-map.md`). The swarm-consensus Final
 * Recommendation asked for exactly this round trip: "inject the already-shipped MCP host into
 * one MCP-capable CLI's launch config, prove a tool round-trip through the existing
 * `delegated-tool-bridge.ts`." This route is that round trip's daemon-side half — an MCP server
 * subprocess spawned alongside a `claude` run (`packages/mcp/src/bin/serve.ts`, injected via
 * `packages/daemon/src/agent-executor.ts`'s optional `mcpJsonInjection` config) calls back into
 * the daemon over loopback HTTP (`packages/mcp/src/server/daemon-client.ts`) with
 * `{runId, toolUseId, toolId, input}`; this route decodes that request and calls the
 * already-shipped, already-tested `createDelegatedToolBridge`
 * (`packages/daemon/src/delegated-tool-bridge.ts`), which is the ONLY execution path from here:
 * every injected byte still routes through `ToolExecutor`'s deny-by-default gate — no parallel
 * authorization mechanism is introduced by this route.
 *
 * `resolvePrincipal` is host-owned and has no default (mirrors gap 3's own resolved
 * human-in-the-loop answer — an explicit host-supplied allowlist/policy, never an invented
 * mechanism): whatever `Principal` a host resolves for a given delegated-tool-call request is
 * exactly what flows into `ToolExecutor.execute`'s own `ToolPolicy.authorize`/
 * `ExecutionDelegate` gates. This route does not itself decide who is allowed to do what — it
 * only decides *which run* a request may act against (an unknown or not-yet-started `runId` is
 * rejected with `404` before the bridge is ever invoked, same precedent as `runs.ts`'s
 * `runCancelRoute`).
 */
import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import { createApiError } from '@jini-ai/protocol';
import type { Principal } from '@jini-ai/core';
import { createDelegatedToolBridge, type RunLifecycle, type ToolExecutionResult, type ToolExecutor } from '@jini-ai/daemon';
import { defineJsonRoute, mountJsonRoute, type AdapterContext } from './adapter.js';
import { validationError } from './request.js';
import { err, ok, type Result, type RouteInputContext } from './types.js';

export interface DelegatedToolExecuteRequest {
  readonly runId: string;
  readonly toolUseId: string;
  readonly toolId: string;
  readonly input?: unknown;
}

export interface DelegatedToolExecuteResponse {
  readonly result: ToolExecutionResult;
}

/**
 * Diagnostic detail for an internal-error response the public API deliberately does not
 * disclose (SEC-005), matching `runs.ts`'s `RunInternalErrorContext` precedent: a thrown
 * `ToolExecutor`/registry failure can embed tool-handler internals no HTTP caller should see.
 */
export interface DelegatedToolsInternalErrorContext {
  readonly source: 'delegated-tool-execute' | 'resolve-principal';
  readonly runId: string;
  readonly toolId: string;
  readonly correlationId: string;
  readonly error: unknown;
}

export interface DelegatedToolsHttpDeps {
  readonly lifecycle: RunLifecycle;
  readonly toolExecutor: ToolExecutor;
  /** Host-owned: resolves the `Principal` a given delegated-tool-call request executes as. Mandatory — see module doc; there is no safe default identity this package could assume on a host's behalf. */
  readonly resolvePrincipal: (request: DelegatedToolExecuteRequest) => Principal | Promise<Principal>;
  /** Host-owned sink for the real exception behind a generic `INTERNAL_ERROR` response (SEC-005). Defaults to `console.error`. */
  readonly onInternalError?: (context: DelegatedToolsInternalErrorContext) => void;
}

/** Logs the real failure server-side and returns the generic, correlation-id-bearing public error (SEC-005: never the raw exception). */
function defaultInternalErrorSink(context: DelegatedToolsInternalErrorContext): void {
  // eslint-disable-next-line no-console
  console.error(`[@jini-ai/http] internal error (${context.source}, correlationId=${context.correlationId})`, context.error);
}

function reportInternalError(
  deps: DelegatedToolsHttpDeps,
  source: DelegatedToolsInternalErrorContext['source'],
  error: unknown,
  runId: string,
  toolId: string,
): ReturnType<typeof createApiError> {
  const correlationId = randomUUID();
  const sink = deps.onInternalError ?? defaultInternalErrorSink;
  sink({ source, runId, toolId, correlationId, error });
  return createApiError('INTERNAL_ERROR', 'an internal error occurred', { requestId: correlationId });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function parseDelegatedToolExecute(input: RouteInputContext): Result<DelegatedToolExecuteRequest> {
  if (!isRecord(input.body)) return err(validationError('body must be a JSON object'));

  const runId = requireNonEmptyString(input.body, 'runId');
  if (runId === undefined) {
    return err(validationError('runId must be a non-empty string', [{ path: 'runId', message: 'required non-empty string' }]));
  }
  const toolUseId = requireNonEmptyString(input.body, 'toolUseId');
  if (toolUseId === undefined) {
    return err(validationError('toolUseId must be a non-empty string', [{ path: 'toolUseId', message: 'required non-empty string' }]));
  }
  const toolId = requireNonEmptyString(input.body, 'toolId');
  if (toolId === undefined) {
    return err(validationError('toolId must be a non-empty string', [{ path: 'toolId', message: 'required non-empty string' }]));
  }
  return ok({ runId, toolUseId, toolId, input: input.body.input });
}

/**
 * `POST /api/delegated-tool-calls` — executes one delegated tool call against an already-started
 * run. Returns `200 {result}` for every legitimate business outcome (`completed`, `denied`,
 * `confirmation-denied`, `timed-out`, `cancelled`, `failed` — `ToolExecutionResult`'s own status
 * union), matching `ToolExecutor`'s own design: those are business-domain outcomes, not
 * transport errors. Only a genuinely unexpected throw (an unregistered `toolId` — a
 * routing/programming error per `ToolExecutor.execute`'s own contract — or a race where the run
 * became terminal between this route's existence check and the bridge's first emitted event)
 * reaches the SEC-005 redaction path below.
 */
export const delegatedToolExecuteRoute = defineJsonRoute<
  DelegatedToolExecuteRequest,
  DelegatedToolExecuteResponse,
  DelegatedToolsHttpDeps
>({
  method: 'post',
  path: '/api/delegated-tool-calls',
  requireSameOrigin: true,
  parse: parseDelegatedToolExecute,
  handle: async (input, deps) => {
    const run = await deps.lifecycle.get(input.runId);
    if (run === undefined) {
      return err(createApiError('NOT_FOUND', `run "${input.runId}" was not found`));
    }

    let principal: Principal;
    try {
      principal = await deps.resolvePrincipal(input);
    } catch (error) {
      return err(reportInternalError(deps, 'resolve-principal', error, input.runId, input.toolId));
    }

    const bridge = createDelegatedToolBridge({ lifecycle: deps.lifecycle, toolExecutor: deps.toolExecutor });
    try {
      const result = await bridge.execute({
        runId: input.runId,
        toolUseId: input.toolUseId,
        toolId: input.toolId,
        principal,
        input: input.input,
      });
      return ok({ result });
    } catch (error) {
      return err(reportInternalError(deps, 'delegated-tool-execute', error, input.runId, input.toolId));
    }
  },
});

/** Mounts `POST /api/delegated-tool-calls` on `app`. A pack's `http(app, services)` calls this directly. */
export function registerDelegatedToolRoutes(app: Express, deps: DelegatedToolsHttpDeps, adapter: AdapterContext): void {
  mountJsonRoute(app, delegatedToolExecuteRoute, deps, adapter);
}
