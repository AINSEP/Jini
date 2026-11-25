/**
 * @file Every tool call as one observed operation. The executor is the one chokepoint every
 * delegated, BYOK and visitor tool call already passes through, so instrumenting it here covers
 * them all without touching a single tool handler or route.
 *
 * The port type comes from `@jini-ai/core/contracts/observability`, which keeps this package free of
 * `@jini-ai/diagnostics`. That keeps the daemon free of any observability vendor AND of the diagnostics
 * package; the host composes them.
 * A host whose telemetry is off should not wrap at all (diagnostics' `isNoopObservabilityPort`), so
 * a disabled install keeps its exact executor object and pays no wrapper frame.
 */
import { redactSecrets, ToolInputError, type Principal, type RunRef } from "@jini-ai/core";
// The two `ObservabilityPort` methods this decorator calls; the port itself satisfies it.
import type { ObservabilityPort } from "@jini-ai/core/contracts/observability";
import type { ToolExecutionResult, ToolExecutionStatus, ToolExecutor } from "../tool-executor-types.js";
import { decorateToolExecutor } from "./decorate-executor.js";

export const TOOL_CALL_OPERATION = "tool.call";

// Refusals count under kind: "refused" but are not failed spans or incidents; a cancellation
// is not a failure, while a timeout and a failed handler are.
const FAILED_STATUSES: ReadonlySet<ToolExecutionStatus> = new Set(["failed", "timed-out"]);

/** The settled result's text as an Error, so an error tracker gets a type to group on. The text is
 * whatever the inner stack left (the host's `withRedactedToolFailures` has already blanked secrets);
 * adapters redact again regardless. */
export class ToolExecutionFailure extends Error {
  override readonly name = "ToolExecutionFailure";
}

/** The `tool.id` label for an id nobody registered. Observation starts before the registry has looked
 * the id up, and a delegated request can carry any string there, a pasted key included (review
 * 2026-10-25 #1): an unregistered id is never exported, only this fixed label. */
export const UNREGISTERED_TOOL_LABEL = "unregistered";

/** Registered tool ids are short dotted/underscored names. Used only when the host gives no registry check. */
const TOOL_ID_SHAPE = /^[A-Za-z][\w.:-]{0,127}$/;

/** Host check, when it has one: is this id a tool the registry knows? */
export type IsRegisteredTool = (input: { toolId: string }) => boolean;

export function toolCallLabel({ toolId }: { toolId: string }, { isRegisteredTool }: { isRegisteredTool?: IsRegisteredTool | undefined }): string {
  const shapeOk = TOOL_ID_SHAPE.test(toolId) && redactSecrets({ input: toolId }) === toolId;
  return shapeOk && (isRegisteredTool?.({ toolId }) ?? true) ? toolId : UNREGISTERED_TOOL_LABEL;
}

/** WHO did it, as the principal's opaque id (owner 2026-10-25). Pseudonymous only: an id that looks
 * like an e-mail address or carries a secret shape is replaced, never exported. */
export const UNIDENTIFIED_USER_LABEL = "unidentified";

export function pseudonymousUserId({ principal }: { principal: Principal }): string {
  const id = principal.id;
  if (!id || id.includes("@") || id.length > 128 || redactSecrets({ input: id }) !== id) return UNIDENTIFIED_USER_LABEL;
  return id;
}

function errorKindOf(result: ToolExecutionResult): string | undefined {
  return result.status === "failed" ? result.errorKind ?? "internal" : undefined;
}

function recordToolCallMetrics({ observability, toolId, failureKind }: { observability: Partial<Pick<ObservabilityPort, "metric" | "supportsMetric">>; toolId: string; failureKind?: "internal" | "input" | "refused" }, _optional = {}): void {
  if (!observability.supportsMetric || !observability.metric) return;
  observability.metric({ name: "tool.calls", value: 1 }, { kind: "counter", attributes: { "tool.id": toolId } });
  if (failureKind) observability.metric({ name: "tool.failures", value: 1 }, { kind: "counter", attributes: { "tool.id": toolId, kind: failureKind } });
}

/**
 * Wraps `inner` so each `execute` is one `tool.call` operation: `tool.id` (or the fixed
 * {@link UNREGISTERED_TOOL_LABEL}), `agent.run.id` and `user.id` (the principal, pseudonymous) at start,
 * the settled status as outcome, `tool.error_kind` (`validation` vs `internal`) for a failure, and
 * the duration the adapter measures between start and end. Execution errors (an internal failure, a
 * timeout, a non-input throw) also go through `reportError`, inside the operation's scope so trace
 * adapters attach them to its span. A validation failure is NOT reported: it is the caller (usually
 * the model) sending bad input — counted on the operation, but not an incident to page anyone for.
 * @param required The executor and the observability port slice.
 * @param optional `isRegisteredTool`: the host's registry check; without it only the id's shape is checked.
 * @returns A drop-in `ToolExecutor`; results and throws pass through unchanged; other methods delegate.
 * @complexity O(1) beyond `inner`'s own cost.
 */
export function withToolCallObservability({ inner, observability }: { inner: ToolExecutor; observability: Pick<ObservabilityPort, "trackOperation" | "reportError"> & Partial<Pick<ObservabilityPort, "metric" | "supportsMetric">> }, { isRegisteredTool, observabilityEnabled }: { isRegisteredTool?: IsRegisteredTool; observabilityEnabled?: () => boolean } = {}): ToolExecutor {
  return decorateToolExecutor({ inner,
    execute: (required, options = {}) => {
      if (observabilityEnabled && !observabilityEnabled()) return inner.execute(required, options);
      return (async (
      { principal, run, toolId, input }: { principal: Principal; run: RunRef; toolId: string; input: unknown },
    ): Promise<ToolExecutionResult> => {
      const attributes = { "tool.id": toolCallLabel({ toolId }, { isRegisteredTool }), "agent.run.id": run.id, "user.id": pseudonymousUserId({ principal }) };
      const context = { operation: TOOL_CALL_OPERATION, attributes };
      const tracker = observability.trackOperation({ name: TOOL_CALL_OPERATION, attributes });
      let result: ToolExecutionResult;
      try {
        result = await tracker.run(() => inner.execute({ principal, run, toolId, input }, options));
      } catch (error) {
        // An unknown tool id throws ToolInputError: the same caller mistake as a validation failure.
        const errorKind = error instanceof ToolInputError ? "validation" : "internal";
        if (errorKind === "internal") tracker.run(() => observability.reportError({ error, context }));
        tracker.end({ outcome: "threw", failed: true, attributes: { "tool.error_kind": errorKind } });
        recordToolCallMetrics({ observability, toolId: attributes["tool.id"], failureKind: errorKind === "validation" ? "input" : "internal" });
        throw error;
      }
      const errorKind = errorKindOf(result);
      if (result.status === "timed-out" || errorKind === "internal") {
        tracker.run(() => observability.reportError({ error: new ToolExecutionFailure(result.error ?? result.status), context }));
      }
      tracker.end({ outcome: result.status, failed: FAILED_STATUSES.has(result.status), ...(errorKind ? { attributes: { "tool.error_kind": errorKind } } : {}) });
      const failureKind = result.status === "denied" || result.status === "confirmation-denied" ? "refused" : result.status === "timed-out" ? "internal" : errorKind === "validation" ? "input" : errorKind === "internal" ? "internal" : undefined;
      recordToolCallMetrics({ observability, toolId: attributes["tool.id"], ...(failureKind ? { failureKind } : {}) });
      return result;
      })(required);
    },
  });
}
