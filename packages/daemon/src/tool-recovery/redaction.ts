/**
 * @file Blanks secret-shaped values out of a FAILED tool's error text and mints a durable, copyable
 * error ID for the ones that need server-side follow-up — the 2026-09-16 owner decision ("hide
 * secrets only"): a failed tool's error stays visible everywhere it already reaches (the model, the
 * chat transcript, the tool card, admin BYOK, the daemon's delegated-tool route, the MCP-UI
 * redemption endpoint, http-kit's server log), only a secret-shaped VALUE inside it never does.
 *
 * ## Position — see `packages/daemon/src/tool-recovery/stack.ts`'s own header
 * Sits between `withReadOnlyToolConstraint` and `withToolAttemptAudit`, and INSIDE
 * `withToolFailureRecovery` (which calls `inner` for the original call, the remedy, and the retry —
 * each one redacted here). A read-only refusal is set by `withToolFailureRecovery` on the OUTER
 * result, after this layer has already run, so it is never touched by it.
 *
 * ## Behavior by result
 * | Result | Action |
 * |---|---|
 * | `failed` with `errorKind` `'internal'` or missing | Redact, mint an ID, prefix `Error <ID>: `, add `errorId`. No record here: `withToolCallObservability` (the next layer out) records it under this same id, with the operation's tracker |
 * | `failed` with `errorKind: 'validation'` | Redact only — no ID, no record. Byte-identical when nothing secret-shaped is present |
 * | any other status | Returned as the SAME object, untouched |
 * | inner throws | Rethrown untouched |
 *
 * A validation failure is the caller's own input problem: its message is already the full, safe
 * reason, and nothing about it needs a server-side lookup — see `contracts/core/secret-redaction.ts`
 * for why only the VALUE is ever blanked, never the surrounding text.
 *
 * Architectural role: `src/assistant` composition-layer adapter, same layer as
 * `packages/daemon/src/core/tool-audit.ts` and `packages/daemon/src/tool-recovery/recovery.ts`. Depends only on the host policy
 * adapter over `@jini-ai/diagnostics/redaction/secrets-only` and `@jini-ai/daemon`'s `ToolExecutor` shape.
 */


import type { Principal, RunRef } from "@jini-ai/core";
import type { ToolExecutionResult, ToolExecutor } from "../tool-executor-types.js";
import { decorateToolExecutor } from "./decorate-executor.js";
import { ToolExecutionFailure, type ToolFailureReporter } from "./observability.js";
import { readToolErrorId, TOOL_ERROR_ID_PATTERN, type RedactedToolExecutionResult } from "../core/tool-error-id.js";



/**
 * `@jini-ai/http-kit`'s `isModelSafeToolFailure` predicate for the delegated-tool route: `true` only
 * for a `failed` result this decorator already redacted and minted an ID for (a timed-out result
 * also carries an id now, stamped by the observation layer, but its text was never redacted here), so the model gets
 * `Error <ID>: <reason>` instead of an opaque `INTERNAL_ERROR`. A failure without the ID never
 * passed through this layer and keeps http-kit's SEC-005 redaction.
 *
 * @param result - The settled result the route is about to map.
 * @returns Whether the route may show `result.error` to the model verbatim.
 * @complexity O(1).
 */
export function isRedactedToolFailure({ result }: { result: ToolExecutionResult }, _optional = {}): boolean {
  return result.status === "failed" && readToolErrorId({ result }, {}) !== undefined;
}

/**
 * What `@jini-ai/http-kit`'s `describeInternalError` hands its describer — declared here,
 * structurally, rather than imported as `DelegatedToolsInternalErrorContext`, so this module still
 * compiles against a published http-kit that predates `status`.
 */
export interface DelegatedInternalErrorContext {
  readonly recoveryMessage?: string;
  readonly source: string;
  readonly runId: string;
  readonly toolId: string;
  readonly error: unknown;
  /** Set for a settled `timed-out`/`cancelled`/`failed` result; absent for a throw. */
  readonly status?: string;
  /** The id the in-process tool stack already recorded this result under (`readToolErrorId`); absent for a throw.
   *  There is no `correlationId` field: http-kit's own id for this failure — the one its `[@jini-ai/http-kit] internal error`
   *  log line carries — is not handed over, because the route now asks the describer before anything is logged. */
  readonly errorId?: string;
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

/** What the delegated route shows for one internal error: the incident's id and the model's words. */
export interface DelegatedToolErrorDisclosureResult {
  readonly errorId: string;
  readonly message: string;
}

/** What the delegated route's describer needs: the host's one reporter and its redactor. */
export interface DelegatedToolErrorDisclosureDeps {
  readonly reporter: ToolFailureReporter;
  readonly redactSecretShapes: RedactedToolFailuresDeps["redactSecretShapes"];
}

/** The id this failure is shown under. A stamped id is trusted and reused WITHOUT writing: it was
 * put on the result in-process by this daemon's own tool stack, which already recorded it (never a
 * client-supplied value). Otherwise one record: a thrown object the tool decorator already recorded
 * dedupes inside the reporter and returns that id, so the incident is still written exactly once. */
function delegatedErrorId({ context, reporter, text }: { context: DelegatedInternalErrorContext; reporter: ToolFailureReporter; text: string }): string {
  if (typeof context.errorId === "string" && TOOL_ERROR_ID_PATTERN.test(context.errorId)) return context.errorId;
  const error = typeof context.error === "object" && context.error !== null ? context.error : new ToolExecutionFailure(text);
  // A breached reporter throws out of here on purpose: the route then owns the incident through its
  // own `reportInternalError`, so the words never show an id nothing recorded.
  return reporter.record({ error, step: "Run tool", operation: "tool.call" }, { attributes: { "agent.run.id": context.runId } }).errorId;
}

/**
 * `@jini-ai/http-kit`'s `describeInternalError` for the agent daemon's delegated-tool route: the
 * text a model gets in place of the bare `INTERNAL_ERROR: an internal error occurred` for every
 * failure that route would otherwise redact whole — an unknown tool id (the executor throws), a
 * throwing `resolvePrincipal`, a `timed-out` or `cancelled` result, and a `failed` result that never
 * passed through {@link withRedactedToolFailures}. Same "hide secrets only" rule and the same
 * `Error <ID>: <reason>` shape as that decorator, with at most one host record per failure.
 *
 * There is no execution or resolved principal to record for a throw, so the record no longer carries
 * http-kit's `correlationId` in `executionId` instead: the one host record (or the stamped id) is the id
 * that joins it to the route's answer for the same failure.
 *
 * @param required The failure as http-kit reports it, plus the host reporter and redactor.
 * @returns The incident id and `Error <ID>: <redacted reason>`.
 * @throws Whatever a breached reporter throws, so the route reports the original failure itself.
 * @complexity O(reason length) for the redaction pass.
 */
export function describeDelegatedInternalError({ context, reporter, redactSecretShapes }: DelegatedToolErrorDisclosureDeps & { context: DelegatedInternalErrorContext }, _optional = {}): DelegatedToolErrorDisclosureResult {
  let reason = delegatedInternalErrorReason(context);
  if ((context.status === "timed-out" || context.status === "cancelled") && context.recoveryMessage) reason = context.recoveryMessage;
  const { text } = redactSecretShapes({ text: reason });
  const errorId = delegatedErrorId({ context, reporter, text });
  return { errorId, message: `Error ${errorId}: ${text}` };
}

/**
 * The two error-disclosure options the agent daemon spreads into `delegatedToolRoutes`, as
 * one value so the daemon and its tests wire the identical pair: a failure this layer already
 * ID-tagged answers `422 TOOL_EXECUTION_FAILED`, and every other internal error answers `500` with
 * {@link describeDelegatedInternalError}'s id and words.
 *
 * @param deps - The host reporter (the SAME instance the tool stack records through, so a thrown
 *   object dedupes across both) and the host redactor.
 * @complexity O(1).
 */
export function delegatedToolErrorDisclosure(deps: DelegatedToolErrorDisclosureDeps, _optional = {}): {
  readonly isModelSafeToolFailure: (required: { result: ToolExecutionResult }) => boolean;
  readonly describeInternalError: (context: DelegatedInternalErrorContext) => DelegatedToolErrorDisclosureResult;
} {
  return {
    isModelSafeToolFailure: ({ result }) => isRedactedToolFailure({ result }, {}),
    describeInternalError: (context) => describeDelegatedInternalError({ context, ...deps }, {}),
  };
}

/** No `onFailure` dep any more. Where a `ToolFailureRecord` was reported for every internal failure —
 *  the §3(b) server-side record — is now the host reporter the observation layer records through
 *  (`withToolCallObservability`). It must not throw; a throwing sink is contained without logging its
 *  own exception, never allowed to turn a redacted result into a thrown error.
 *
 *  This file's old `safeOnFailure` calls `onFailure`, containing a throw so a hostile or buggy sink can never
 *  turn a redacted result into a thrown error — audit is observation, never a gate, the same rule
 *  `packages/daemon/src/core/tool-audit.ts`'s `appendSafely` enforces for its own sink. That rule now
 *  lives in `observability.ts`'s `recordSafely`, which wraps the host reporter. */
export interface RedactedToolFailuresDeps {
  /** Host ID source; inject a deterministic source in tests. */
  readonly mintErrorId: () => string;
  readonly redactSecretShapes: (required: { text: string }) => { text: string; redactions: number };
}

/**
 * Redacts one `failed` result per this file's Behavior table — the only place this file makes a
 * decision; `withRedactedToolFailures` itself is pure plumbing around this.
 *
 * The value-free server-side record for one internal failure — everything needed to find the tool,
 * run, principal, execution and full (already redacted) message under its ID, with no secret value
 * ever entering it — is written by the observation layer from this result: `error` is the text AFTER
 * {@link redactSecretShapes}. The correlating ids `redactFailedResult` needs are now only `toolId`,
 * pulled out of `execute`'s own parameters so the function below takes one small object instead of
 * three positional strings.
 *
 * @complexity O(1) plus {@link redactSecretShapes}'s own O(text length) pass.
 */
export function redactFailedResult({ result, toolId, deps }: { result: ToolExecutionResult; toolId: string; deps: RedactedToolFailuresDeps }, _optional: Record<string, never> = {}): ToolExecutionResult {
  if (result.errorKind === "validation") {
    if (result.error === undefined) return result;
    return { ...result, error: deps.redactSecretShapes({ text: result.error }).text };
  }

  const { text } = deps.redactSecretShapes({ text: result.error ?? `tool "${toolId}" failed` });
  // The one mint for this failure: the model's words, the audit row and the host record all reuse it.
  const errorId = deps.mintErrorId();
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
 * @param deps - The host's id minter and secret-shape redactor.
 * @returns A drop-in `ToolExecutor`. `resumeConfirmation`, `cancel`, `getAuditRecord` delegate
 *   straight through, matching `packages/daemon/src/tool-recovery/recovery.ts`'s and `packages/daemon/src/core/tool-audit.ts`'s own shape.
 * @complexity O(1) beyond `inner`'s own cost and {@link redactFailedResult}'s.
 */
export function withRedactedToolFailures({ inner, ...deps }: RedactedToolFailuresDeps & { inner: ToolExecutor }, _optional = {}): ToolExecutor {
  return decorateToolExecutor({ inner,
    execute: async (
      { principal, run, toolId, input }: { principal: Principal; run: RunRef; toolId: string; input: unknown },
      options: Parameters<ToolExecutor['execute']>[1] = {},
    ): Promise<ToolExecutionResult> => {
      const result = await inner.execute({ principal, run, toolId, input }, options);
      if (result.status !== "failed") return result;
      return redactFailedResult({ result, toolId, deps });
    },
  });
}
