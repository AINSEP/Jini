/**
 * @file Blanks secret-shaped values out of a FAILED tool's error text and mints a durable, copyable
 * error ID for the ones that need server-side follow-up — the 2026-09-16 owner decision ("hide
 * secrets only"): a failed tool's error stays visible everywhere it already reaches (the model, the
 * chat transcript, the tool card, admin BYOK, the daemon's delegated-tool route, the MCP-UI
 * redemption endpoint, http-kit's server log), only a secret-shaped VALUE inside it never does.
 *
 * ## Position — see `tool-executor-stack.ts`'s own header
 * Sits between `withReadOnlyToolConstraint` and `withToolAttemptAudit`, and INSIDE
 * `withToolFailureRecovery` (which calls `inner` for the original call, the remedy, and the retry —
 * each one redacted here). A read-only refusal is set by `withToolFailureRecovery` on the OUTER
 * result, after this layer has already run, so it is never touched by it.
 *
 * ## Behavior by result
 * | Result | Action |
 * |---|---|
 * | `failed` with `errorKind` `'internal'` or missing | Redact, mint an ID, prefix `Error <ID>: `, add `errorId`, report one {@link ToolFailureRecord} |
 * | `failed` with `errorKind: 'validation'` | Redact only — no ID, no record. Byte-identical when nothing secret-shaped is present |
 * | any other status | Returned as the SAME object, untouched |
 * | inner throws | Rethrown untouched |
 *
 * A validation failure is the caller's own input problem: its message is already the full, safe
 * reason, and nothing about it needs a server-side lookup — see `contracts/core/secret-redaction.ts`
 * for why only the VALUE is ever blanked, never the surrounding text.
 *
 * Architectural role: `src/assistant` composition-layer adapter, same layer as
 * `tool-executor-audit.ts` and `tool-failure-recovery.ts`. Depends only on the Tovu policy
 * adapter over `@jini-ai/diagnostics/redaction/secrets-only` and `@jini-ai/daemon`'s `ToolExecutor` shape.
 */


import type { Principal, RunRef, SurfaceEmitter } from "@jini-ai/core";
import type { ToolExecutionResult, ToolExecutor } from "../tool-executor.js";



/** Matches a minted error ID anywhere in a string — exported for tests and for a later chat-side
 *  copy button (`ToolCard` matching this against `result.content`, tracked separately). */
export const TOOL_ERROR_ID_PATTERN = /\bERR-[0-9A-F]{4}(?:-[0-9A-F]{4}){3}\b/;

/**
 * Mints one error ID: 64 bits of `crypto.randomBytes`, formatted `ERR-XXXX-XXXX-XXXX-XXXX`.
 *
 * @returns A string always matching {@link TOOL_ERROR_ID_PATTERN}.
 * @complexity O(1).
 */
export function mintToolErrorId({ randomHex }: { randomHex: (required: { bytes: number }) => string }, _optional = {}): string {
  const hex = randomHex({ bytes: 8 }).toUpperCase();
  const groups = hex.match(/.{4}/g) ?? [];
  return `ERR-${groups.join("-")}`;
}

/** A `ToolExecutionResult` that may additionally carry the minted error ID — the ONLY field this
 *  decorator ever adds. Every other field is `inner`'s own, untouched. */
export type RedactedToolExecutionResult = ToolExecutionResult & { readonly errorId?: string };

/**
 * Reads the error ID this decorator attached, if any.
 *
 * @param result - Any `ToolExecutionResult`, redacted or not.
 * @returns The ID, or `undefined` for a result this decorator never touched (not `failed`,
 *   `errorKind: 'validation'`, or produced upstream of this layer).
 * @complexity O(1).
 */
export function readToolErrorId({ result }: { result: ToolExecutionResult }, _optional = {}): string | undefined {
  const id = (result as RedactedToolExecutionResult).errorId;
  return typeof id === "string" ? id : undefined;
}

/**
 * `@jini-ai/http-kit`'s `isModelSafeToolFailure` predicate for the delegated-tool route: `true` only
 * for a failure this decorator already redacted and minted an ID for, so the model gets
 * `Error <ID>: <reason>` instead of an opaque `INTERNAL_ERROR`. A failure without the ID never
 * passed through this layer and keeps http-kit's SEC-005 redaction.
 *
 * @param result - The settled result the route is about to map.
 * @returns Whether the route may show `result.error` to the model verbatim.
 * @complexity O(1).
 */
export function isRedactedToolFailure({ result }: { result: ToolExecutionResult }, _optional = {}): boolean {
  return readToolErrorId({ result }, {}) !== undefined;
}

/**
 * What `@jini-ai/http-kit`'s `describeInternalError` hands its describer — declared here,
 * structurally, rather than imported as `DelegatedToolsInternalErrorContext`, so this module still
 * compiles against a published http-kit that predates `status`.
 */
export interface DelegatedInternalErrorContext {
  readonly source: string;
  readonly runId: string;
  readonly toolId: string;
  /** http-kit's own id for this failure — the one its `[@jini-ai/http-kit] internal error` log line carries. */
  readonly correlationId: string;
  readonly error: unknown;
  /** Set for a settled `timed-out`/`cancelled`/`failed` result; absent for a throw. */
  readonly status?: string;
}

/** The unredacted reason for one delegated-route internal error, before {@link redactSecretShapes}. */
function delegatedInternalErrorReason(context: DelegatedInternalErrorContext): string {
  if (context.status === "timed-out") return `tool "${context.toolId}" timed out before it finished`;
  if (context.status === "cancelled") {
    return `tool "${context.toolId}" was cancelled before it finished (the run ended or the call was abandoned)`;
  }
  if (context.error instanceof Error && context.error.message.length > 0) return context.error.message;
  if (typeof context.error === "string" && context.error.length > 0) return context.error;
  return `tool "${context.toolId}" failed`;
}

/**
 * `@jini-ai/http-kit`'s `describeInternalError` for the agent daemon's delegated-tool route: the
 * text a model gets in place of the bare `INTERNAL_ERROR: an internal error occurred` for every
 * failure that route would otherwise redact whole — an unknown tool id (the executor throws), a
 * throwing `resolvePrincipal`, a `timed-out` or `cancelled` result, and a `failed` result that never
 * passed through {@link withRedactedToolFailures}. Same "hide secrets only" rule and the same
 * `Error <ID>: <reason>` shape as that decorator, with one {@link ToolFailureRecord} per call.
 *
 * There is no execution or resolved principal to record for a throw, so the record carries
 * http-kit's `correlationId` in `executionId` instead — the id that joins it to http-kit's own log
 * line for the same failure.
 *
 * @param context - The failure as http-kit reports it.
 * @param deps - Test seams; production passes nothing.
 * @returns `Error <ID>: <redacted reason>`.
 * @complexity O(reason length) for the redaction pass.
 */
export function describeDelegatedInternalError({ context, ...deps }: RedactedToolFailuresDeps & { context: DelegatedInternalErrorContext }, _optional = {}): string {
  const { text, redactions } = deps.redactSecretShapes({ text: delegatedInternalErrorReason(context) });
  const errorId = deps.mintErrorId();
  safeOnFailure(deps.onFailure, {
    errorId,
    toolId: context.toolId,
    runId: context.runId,
    principalId: "(unresolved)",
    executionId: `(none) correlationId=${context.correlationId}`,
    redactions,
    message: text,
  });
  return `Error ${errorId}: ${text}`;
}

/**
 * The two error-disclosure options the agent daemon spreads into `registerDelegatedToolRoutes`, as
 * one value so the daemon and its tests wire the identical pair: a failure this layer already
 * ID-tagged answers `422 TOOL_EXECUTION_FAILED`, and every other internal error answers `500` with
 * {@link describeDelegatedInternalError}'s text.
 *
 * @param deps - Test seams forwarded to the describer; production passes nothing.
 * @complexity O(1).
 */
export function delegatedToolErrorDisclosure(deps: RedactedToolFailuresDeps, _optional = {}): {
  readonly isModelSafeToolFailure: (required: { result: ToolExecutionResult }) => boolean;
  readonly describeInternalError: (context: DelegatedInternalErrorContext) => string;
} {
  return {
    isModelSafeToolFailure: ({ result }) => isRedactedToolFailure({ result }, {}),
    describeInternalError: (context) => describeDelegatedInternalError({ context, ...deps }, {}),
  };
}

/** The value-free server-side record for one internal failure — everything needed to find the
 *  tool, run, principal, execution and full (already redacted) message under its ID, with no secret
 *  value ever entering it. `message` is the text AFTER {@link redactSecretShapes}. */
export interface ToolFailureRecord {
  readonly errorId: string;
  readonly toolId: string;
  readonly runId: string;
  readonly principalId: string;
  readonly executionId: string;
  readonly redactions: number;
  readonly message: string;
}

export interface RedactedToolFailuresDeps {
  /** Host ID source; inject a deterministic source in tests. */
  readonly mintErrorId: () => string;
  readonly redactSecretShapes: (required: { text: string }) => { text: string; redactions: number };
  /** Where a {@link ToolFailureRecord} is reported for every internal failure — the §3(b)
   *  server-side record. Must not throw; a throwing sink is contained without logging its own
   *  exception, never allowed to turn a redacted result into a thrown
   *  error. */
  readonly onFailure: (record: ToolFailureRecord) => void;
}

/** Calls `onFailure`, containing a throw so a hostile or buggy sink can never turn a
 *  redacted result into a thrown error — audit is observation, never a gate, the same rule
 *  `tool-executor-audit.ts`'s `appendSafely` enforces for its own sink. */
function safeOnFailure(onFailure: (record: ToolFailureRecord) => void, record: ToolFailureRecord): void {
  try {
    onFailure(record);
  } catch {
    // A failing observer must neither gate the result nor leak its own exception text.
  }
}

/** The correlating ids `redactFailedResult` needs, pulled out of `execute`'s own parameters so the
 *  function below takes one small object instead of three positional strings. */
interface FailureContext {
  readonly toolId: string;
  readonly runId: string;
  readonly principalId: string;
}

/**
 * Redacts one `failed` result per this file's Behavior table — the only place this file makes a
 * decision; `withRedactedToolFailures` itself is pure plumbing around this.
 *
 * @complexity O(1) plus {@link redactSecretShapes}'s own O(text length) pass.
 */
function redactFailedResult(result: ToolExecutionResult, context: FailureContext, deps: RedactedToolFailuresDeps): ToolExecutionResult {
  if (result.errorKind === "validation") {
    if (result.error === undefined) return result;
    return { ...result, error: deps.redactSecretShapes({ text: result.error }).text };
  }

  const mintErrorId = deps.mintErrorId;
  const onFailure = deps.onFailure;
  const { text, redactions } = deps.redactSecretShapes({ text: result.error ?? `tool "${context.toolId}" failed` });
  const errorId = mintErrorId();

  safeOnFailure(onFailure, {
    errorId,
    toolId: context.toolId,
    runId: context.runId,
    principalId: context.principalId,
    executionId: result.executionId,
    redactions,
    message: text,
  });

  const redacted: RedactedToolExecutionResult = { ...result, error: `Error ${errorId}: ${text}`, errorId };
  return redacted;
}

/**
 * Wraps `inner` so every `failed` result it produces is redacted per this file's Behavior table
 * before any caller — recovery, the BYOK map, the delegated-tool bridge, the MCP-UI route, or
 * http-kit's log — ever sees it. Every other status, and every throw, passes through unchanged.
 *
 * @param inner - The executor to wrap. Its own decisions (status, `errorKind`, throwing) are never
 *   second-guessed here — this layer only ever transforms an already-`failed` result's `error` text.
 * @param deps - Test seams; production callers pass nothing and get the real minter and logger.
 * @returns A drop-in `ToolExecutor`. `resumeConfirmation`, `cancel`, `getAuditRecord` delegate
 *   straight through, matching `tool-failure-recovery.ts`'s and `tool-executor-audit.ts`'s own shape.
 * @complexity O(1) beyond `inner`'s own cost and {@link redactFailedResult}'s.
 */
export function withRedactedToolFailures({ inner, ...deps }: RedactedToolFailuresDeps & { inner: ToolExecutor }, _optional = {}): ToolExecutor {
  return {
    execute: async (
      { principal, run, toolId, input }: { principal: Principal; run: RunRef; toolId: string; input: unknown },
      { signal, emitSurface }: { signal?: AbortSignal; emitSurface?: SurfaceEmitter } = {},
    ): Promise<ToolExecutionResult> => {
      const result = await inner.execute({ principal, run, toolId, input }, { ...(signal === undefined ? {} : { signal }), ...(emitSurface === undefined ? {} : { emitSurface }) });
      if (result.status !== "failed") return result;
      return redactFailedResult(result, { toolId, runId: run.id, principalId: principal.id }, deps);
    },
    resumeConfirmation: (args) => inner.resumeConfirmation(args),
    cancel: (executionId) => inner.cancel(executionId),
    getAuditRecord: (executionId) => inner.getAuditRecord(executionId),
  };
}
