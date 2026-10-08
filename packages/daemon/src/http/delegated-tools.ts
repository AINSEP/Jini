/**
 * @module delegated-tools
 *
 * `POST /api/delegated-tool-calls` — the daemon-side half of gap 3's MCP-callback continuation
 * transport spike (see `packages/daemon/archived provenance ledger`'s "run/chat orchestration gap 3, part 1"
 * addition and this package's own dated section in `archived provenance ledger`). The swarm-consensus Final
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
import type { Principal, ToolRegistry } from '@jini-ai/core';
import { createDelegatedToolBridge, type RunLifecycle, type ToolExecutionResult, type ToolExecutor } from '../index.js';
import { defineJsonRoute, mountJsonRoute, type AdapterContext } from '@jini-ai/http-kit';
import { validationError } from '@jini-ai/http-kit';
import { err, ok, type Result, type RouteInputContext } from '@jini-ai/http-kit';
import * as readOnlyTools from '../core/read-only-tools.js';

export interface DelegatedToolExecuteRequest {
  readonly runId: string;
  readonly toolUseId: string;
  readonly toolId: string;
  readonly input?: unknown;
  /**
   * When `true`, the call is refused unless `toolId`'s registration declares itself read-only
   * (`@jini-ai/core`'s `isReadOnlyTool`). Set by a caller that has already promised ITS own caller
   * that the surface only reads — `@jini-ai/mcp`'s `execute_readonly_delegated_tool`, whose
   * `readOnlyHint: true` annotation is exactly such a promise.
   *
   * The constraint is enforced HERE rather than in the calling process because only this side can
   * resolve a tool id against the live `ToolRegistry`. A caller-side check would be a claim; this
   * is the fact.
   *
   * Omitted means unconstrained, which is what every existing caller sends — the original
   * `execute_delegated_tool` path is untouched by this field's existence.
   */
  readonly requireReadOnly?: boolean;
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
  /**
   * The settled status when the failure is a `ToolExecutionResult` this route will not show as-is
   * (`timed-out`, `cancelled`, or a `failed` the host did not mark model-safe); absent when `error`
   * is a thrown exception. Lets a host word a timeout differently from a crash without parsing
   * `error`, which for a settled result is only `result.error ?? result.status`.
   */
  readonly status?: 'timed-out' | 'cancelled' | 'failed';
}

export interface DelegatedToolsHttpDeps {
  readonly lifecycle: RunLifecycle;
  readonly toolExecutor: ToolExecutor;
  /** Host-owned: resolves the `Principal` a given delegated-tool-call request executes as. Mandatory — see module doc; there is no safe default identity this package could assume on a host's behalf. */
  readonly resolvePrincipal: (requiredArgs: { readonly request: DelegatedToolExecuteRequest }) => Principal | Promise<Principal>;
  /** Host-owned sink for the real exception behind a generic `INTERNAL_ERROR` response (SEC-005). Defaults to `console.error`. */
  readonly onInternalError?: (context: DelegatedToolsInternalErrorContext) => void;
  /**
   * The same `ToolRegistry` `deps.toolExecutor` was built over, supplied so a
   * {@link DelegatedToolExecuteRequest.requireReadOnly} call can be checked against the descriptor
   * that will actually run. Descriptors only — this route never gains a way to reach a handler.
   *
   * Optional so that mounting this route stays a non-breaking one-liner for every host that
   * predates the constraint. A host that omits it does not get a WEAKER gate: a `requireReadOnly`
   * call it cannot verify is refused outright (the configured refusal message), never
   * waived. Unconstrained calls behave identically with or without it.
   */
  readonly toolRegistry?: ToolRegistry;
  /**
   * Host opt-in: returns `true` for a `failed` result whose `error` text the HOST has already made
   * safe to show the model — secret values blanked, an error id minted — so this route answers it
   * with `422 TOOL_EXECUTION_FAILED` carrying that text, not the SEC-005-redacted 500. The model then
   * sees why the tool failed (e.g. "no frontend is bound…") instead of an opaque INTERNAL_ERROR.
   *
   * Only consulted for `status: 'failed'` with a non-empty `error`; every other outcome, and every
   * failure it returns `false` for, keeps the existing mapping. Omitted (the default), nothing
   * changes — a host that has no redaction layer must not wire this, because this route does no
   * redaction of its own on this path.
   */
  readonly isModelSafeToolFailure?: ({ result }: { result: ToolExecutionResult }) => boolean;
  /**
   * Host opt-in: the model-safe text to send in place of `'an internal error occurred'` for every
   * failure this route would otherwise answer with the SEC-005-redacted `500 INTERNAL_ERROR` — a
   * thrown executor (e.g. an unknown tool id), a throwing `resolvePrincipal`, `timed-out`,
   * `cancelled`, and a `failed` result `isModelSafeToolFailure` did not vouch for. Without it, those
   * reach the model as a bare "INTERNAL_ERROR" it can neither act on nor report.
   *
   * The response keeps `500 INTERNAL_ERROR` and its `requestId`; only `message` changes, and
   * `onInternalError` still receives the raw failure first. Returning `undefined` or `''` keeps the
   * generic message for that failure, and so does a describer that throws — a broken describer can
   * never turn a 500 into a leak or a crash. Omitted (the default), nothing changes. The host owns
   * redaction here exactly as for `isModelSafeToolFailure`: this route sends the returned text
   * verbatim.
   */
  readonly describeInternalError?: (context: DelegatedToolsInternalErrorContext) => string | undefined;
}

/** Route preflight shares the same registration decision as nested dispatch. */
function checkReadOnlyConstraint(
  deps: DelegatedToolsHttpDeps,
  input: DelegatedToolExecuteRequest,
): ReturnType<typeof createApiError> | null {
  if (input.requireReadOnly !== true) return null;
  const refusal = readOnlyTools.checkReadOnlyTool({
    toolId: input.toolId, registry: deps.toolRegistry, messages: readOnlyTools.defaultDaemonMessages.readOnly,
  });
  if (refusal === null) return null;
  return createApiError({ code: 'TOOL_OPERATION_DENIED', message: refusal });
}

/** Logs the real failure server-side and returns the generic, correlation-id-bearing public error (SEC-005: never the raw exception). */
function defaultInternalErrorSink(context: DelegatedToolsInternalErrorContext): void {
  // eslint-disable-next-line no-console
  console.error(`[@jini-ai/http-kit] internal error (${context.source}, correlationId=${context.correlationId})`, context.error);
}

/**
 * The host's {@link DelegatedToolsHttpDeps.describeInternalError} text for `context`, or `undefined`
 * when there is no describer, it declines (`undefined`/`''`), or it throws.
 *
 * @complexity O(1) plus the describer's own cost.
 */
function describeSafely(deps: DelegatedToolsHttpDeps, context: DelegatedToolsInternalErrorContext): string | undefined {
  if (deps.describeInternalError === undefined) return undefined;
  try {
    const text = deps.describeInternalError(context);
    return typeof text === 'string' && text.length > 0 ? text : undefined;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`[@jini-ai/http-kit] describeInternalError threw (correlationId=${context.correlationId})`, error);
    return undefined;
  }
}

function reportInternalError(
  deps: DelegatedToolsHttpDeps,
  source: DelegatedToolsInternalErrorContext['source'],
  error: unknown,
  runId: string,
  toolId: string,
  status?: DelegatedToolsInternalErrorContext['status'],
): ReturnType<typeof createApiError> {
  const correlationId = randomUUID();
  const context: DelegatedToolsInternalErrorContext = {
    source,
    runId,
    toolId,
    correlationId,
    error,
    ...(status === undefined ? {} : { status }),
  };
  const sink = deps.onInternalError ?? defaultInternalErrorSink;
  sink(context);
  const message = describeSafely(deps, context) ?? 'an internal error occurred';
  return createApiError({ code: 'INTERNAL_ERROR', message: message }, { requestId: correlationId });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function parseDelegatedToolExecute(input: RouteInputContext): Result<DelegatedToolExecuteRequest> {
  if (!isRecord(input.body)) return err({ error: validationError({ message: 'body must be a JSON object' }) });

  const runId = requireNonEmptyString(input.body, 'runId');
  if (runId === undefined) {
    return err({ error: validationError({ message: 'runId must be a non-empty string' }, { issues: [{ path: 'runId', message: 'required non-empty string' }] }) });
  }
  const toolUseId = requireNonEmptyString(input.body, 'toolUseId');
  if (toolUseId === undefined) {
    return err({ error: validationError({ message: 'toolUseId must be a non-empty string' }, { issues: [{ path: 'toolUseId', message: 'required non-empty string' }] }) });
  }
  const toolId = requireNonEmptyString(input.body, 'toolId');
  if (toolId === undefined) {
    return err({ error: validationError({ message: 'toolId must be a non-empty string' }, { issues: [{ path: 'toolId', message: 'required non-empty string' }] }) });
  }
  // Spread-in rather than always-present so an unconstrained body parses to exactly the object it
  // parsed to before this field existed — the existing gateway's request shape is byte-identical,
  // which is what the "additive only" constraint means at the wire.
  //
  // Only a literal `true` arms the constraint. Anything else (absent, `false`, a truthy string) is
  // "unconstrained", never a parse error: this field can only ever TIGHTEN a call, so a malformed
  // value that fell through to the normal gateway is the same outcome as not sending it at all.
  const requireReadOnly = input.body['requireReadOnly'] === true ? { requireReadOnly: true } : {};
  return ok({ value: { runId, toolUseId, toolId, input: input.body.input, ...requireReadOnly } });
}

/**
 * Maps a settled `ToolExecutionResult` to the wire `Result` — the same status mapping
 * `db-ops.ts`'s `toolResultToApiResult` establishes for this identical `ToolExecutionResult`
 * union, kept consistent here rather than reinvented: `completed` → `200 {result}`,
 * `denied`/`confirmation-denied` → `403 TOOL_OPERATION_DENIED`, `timed-out`/`cancelled` → a
 * SEC-005-redacted `500 INTERNAL_ERROR` (the real status/error goes to `onInternalError`, never the
 * wire — unless the host supplies `deps.describeInternalError`, whose text then replaces the generic
 * message on every redacted 500 below).
 *
 * `failed` splits in two, on `result.errorKind` (`@jini-ai/daemon`'s `ToolExecutor` sets it from
 * whether the handler threw `@jini-ai/core`'s `ToolInputError`): `'validation'` means the CALLER's
 * input was the problem — a wrong/missing/malformed field name, a `themeId` that doesn't exist, a
 * path escaping its theme — so it is reported as a real `400 BAD_REQUEST` carrying the handler's own
 * actionable message (the same one a model reads to retry correctly), not redacted. Everything else
 * (`'internal'`, or no `errorKind` at all — e.g. an older `ToolExecutor` build) stays the SEC-005
 * redacted 500 path, because a handler that threw for a reason OTHER than "your input was bad" can
 * embed exactly the kind of internal detail that path exists to keep off the wire — unless the host
 * vouches for this exact result via `deps.isModelSafeToolFailure` (it has already redacted the text
 * itself), in which case it is a `422 TOOL_EXECUTION_FAILED` carrying the host's text verbatim.
 */
function toolExecutionResultToApiResult(
  deps: DelegatedToolsHttpDeps,
  runId: string,
  toolId: string,
  result: ToolExecutionResult,
): Result<DelegatedToolExecuteResponse> {
  switch (result.status) {
    case 'completed':
      return ok({ value: { result } });
    case 'denied':
      return err({ error: createApiError({ code: 'TOOL_OPERATION_DENIED', message: 'this operation was denied by policy' }) });
    case 'confirmation-denied':
      return err({ error: createApiError({ code: 'TOOL_OPERATION_DENIED', message: 'this operation was denied during confirmation' }) });
    case 'timed-out':
    case 'cancelled':
      return err({ error: reportInternalError(deps, 'delegated-tool-execute', result.status, runId, toolId, result.status) });
    case 'failed':
      if (result.errorKind === 'validation') {
        return err({ error: createApiError({ code: 'BAD_REQUEST', message: result.error ?? 'invalid tool input' }) });
      }
      if (result.error && deps.isModelSafeToolFailure?.({ result }) === true) {
        return err({ error: createApiError({ code: 'TOOL_EXECUTION_FAILED', message: result.error }) });
      }
      return err({ error: reportInternalError(deps, 'delegated-tool-execute', result.error ?? result.status, runId, toolId, 'failed') });
  }
}

/**
 * `POST /api/delegated-tool-calls` — executes one delegated tool call against an already-started
 * run. Maps `ToolExecutionResult.status` to the HTTP response via `toolExecutionResultToApiResult`
 * above — mirroring `db-ops.ts`'s precedent for the identical status union rather than treating
 * every business outcome as a `200`. A genuinely unexpected throw (an unregistered `toolId` — a
 * routing/programming error per `ToolExecutor.execute`'s own contract — or a race where the run
 * became terminal between this route's existence check and the bridge's first emitted event)
 * reaches the same SEC-005 redaction path.
 */
export const delegatedToolExecuteRoute = defineJsonRoute<
  DelegatedToolExecuteRequest,
  DelegatedToolExecuteResponse,
  DelegatedToolsHttpDeps
>({
  method: 'post', path: '/api/delegated-tool-calls', parse: parseDelegatedToolExecute, handle: async ({ input, deps }, { signal } = {}) => {
    const run = await deps.lifecycle.get({ runId: input.runId });
    if (run === undefined) {
      return err({ error: createApiError({ code: 'NOT_FOUND', message: `run "${input.runId}" was not found` }) });
    }

    // Before `resolvePrincipal`, and long before the bridge: a refused call must cost nothing
    // downstream and must leave no trace of an execution that was never going to happen. It sits
    // after the run-existence check only so that a bad `runId` still answers 404 the way it always
    // did, regardless of the constraint.
    const readOnlyRefusal = checkReadOnlyConstraint(deps, input);
    if (readOnlyRefusal !== null) return err({ error: readOnlyRefusal });

    let principal: Principal;
    try {
      principal = await deps.resolvePrincipal({ request: input });
    } catch (error) {
      return err({ error: reportInternalError(deps, 'resolve-principal', error, input.runId, input.toolId) });
    }

    // Attenuates the resolved principal itself for a `requireReadOnly` call, so the constraint
    // survives past this route: a consumer's own `ToolExecutor` composition may dispatch a tool id
    // one or more hops past the one checked above (a nested/recovery dispatch using this same
    // principal), and only the principal — not this request's `requireReadOnly` flag, which dies
    // at this function's return — reaches that far. See `constrainPrincipalToReadOnlyTools`'s own
    // doc. A no-op for every existing unconstrained caller.
    if (input.requireReadOnly === true) {
      principal = readOnlyTools.constrainPrincipalToReadOnlyTools({ principal });
    }

    // Composes the SAME enforcement decorator this package exports for a host's own use, here,
    // around whatever `ToolExecutor` the host supplied — a second, independent check of the OUTER
    // `toolId` `checkReadOnlyConstraint` already ran (never a WEAKER outcome than that check, only
    // ever redundant with it; see `withReadOnlyToolConstraint`'s own doc for why this alone cannot
    // close a nested dispatch a host's own inner decorator issues). Skipped entirely for an
    // unconstrained call so the pre-existing gateway's executor reference is untouched.
    const toolExecutor =
      input.requireReadOnly === true
        ? readOnlyTools.withReadOnlyToolConstraint({ inner: deps.toolExecutor, registry: deps.toolRegistry, messages: readOnlyTools.defaultDaemonMessages.readOnly, idGenerator: { newId: randomUUID } })
        : deps.toolExecutor;

    const bridge = createDelegatedToolBridge({ lifecycle: deps.lifecycle, toolExecutor });
    try {
      // `signal` carries the caller's HTTP connection dropping — see `mountJsonRoute`
      // (`adapter.ts`). The bridge already combines it with the run's own cancellation
      // (`DelegatedToolInvocation.signal`'s doc); this is the wire that was missing, not new
      // behaviour in the bridge or `ToolExecutor`.
      const result = await bridge.execute({
        runId: input.runId,
        toolUseId: input.toolUseId,
        toolId: input.toolId,
        principal,
        input: input.input,
        ...(signal !== undefined ? { signal } : {}),
      });
      return toolExecutionResultToApiResult(deps, input.runId, input.toolId, result);
    } catch (error) {
      return err({ error: reportInternalError(deps, 'delegated-tool-execute', error, input.runId, input.toolId) });
    }
  }
}, { requireSameOrigin: true });

/** Mounts `POST /api/delegated-tool-calls` on `app`. A pack's `http(app, services)` calls this directly. */
export function registerDelegatedToolRoutes({ app, deps, adapter }: { readonly app: Express; readonly deps: DelegatedToolsHttpDeps; readonly adapter: AdapterContext }, _optional: Record<string, never> = {}): void {
  mountJsonRoute({ app, spec: delegatedToolExecuteRoute, deps, adapter });
}
