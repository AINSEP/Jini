/**
 * @file Every tool call as one observed operation. The executor is the one chokepoint every
 * delegated, BYOK and visitor tool call already passes through, so instrumenting it here covers
 * them all without touching a single tool handler or route.
 *
 * The port is taken structurally ({@link ToolCallObservability}), not imported: this package does not
 * depend on `@jini-ai/diagnostics`, and `ObservabilityPort` satisfies the slice as-is. That keeps the
 * daemon free of any observability vendor AND of the diagnostics package; the host composes them.
 * A host whose telemetry is off should not wrap at all (diagnostics' `isNoopObservabilityPort`), so
 * a disabled install keeps its exact executor object and pays no wrapper frame.
 */
import { ToolInputError, type Principal, type RunRef, type SurfaceEmitter } from "@jini-ai/core";
import type { ToolExecutionResult, ToolExecutionStatus, ToolExecutor } from "../tool-executor.js";

type Attributes = Readonly<Record<string, string | number>>;
/** The two `ObservabilityPort` methods this decorator calls; the port itself satisfies it. */
export interface ToolCallObservability {
  trackOperation(input: { name: string; attributes?: Attributes }): {
    run<T>(fn: () => T): T;
    end(outcome: { outcome: string; failed: boolean; attributes?: Attributes }): void;
  };
  reportError(report: { error: unknown; context: { operation: string; attributes?: Attributes } }): void;
}

export const TOOL_CALL_OPERATION = "tool.call";

// A denial, a declined confirmation and a cancellation are the system working as designed, not
// failures; a timeout and a failed handler are.
const FAILED_STATUSES: ReadonlySet<ToolExecutionStatus> = new Set(["failed", "timed-out"]);

/** The settled result's text as an Error, so an error tracker gets a type to group on. The text is
 * whatever the inner stack left (Tovu's `withRedactedToolFailures` has already blanked secrets);
 * adapters redact again regardless. */
export class ToolExecutionFailure extends Error {
  override readonly name = "ToolExecutionFailure";
}

function errorKindOf(result: ToolExecutionResult): string | undefined {
  return result.status === "failed" ? result.errorKind ?? "internal" : undefined;
}

/**
 * Wraps `inner` so each `execute` is one `tool.call` operation: `tool.id` and `agent.run.id` at start,
 * the settled status as outcome, `tool.error_kind` (`validation` vs `internal`) for a failure, and
 * the duration the adapter measures between start and end. Execution errors (an internal failure, a
 * timeout, a non-input throw) also go through `reportError`, inside the operation's scope so trace
 * adapters attach them to its span. A validation failure is NOT reported: it is the caller (usually
 * the model) sending bad input — counted on the operation, but not an incident to page anyone for.
 * @param required The executor and the observability port slice.
 * @returns A drop-in `ToolExecutor`; results and throws pass through unchanged; other methods delegate.
 * @complexity O(1) beyond `inner`'s own cost.
 */
export function withToolCallObservability({ inner, observability }: { inner: ToolExecutor; observability: ToolCallObservability }, _optional: Record<string, never> = {}): ToolExecutor {
  return {
    execute: async (
      { principal, run, toolId, input }: { principal: Principal; run: RunRef; toolId: string; input: unknown },
      { signal, emitSurface }: { signal?: AbortSignal; emitSurface?: SurfaceEmitter } = {},
    ): Promise<ToolExecutionResult> => {
      const attributes = { "tool.id": toolId, "agent.run.id": run.id };
      const context = { operation: TOOL_CALL_OPERATION, attributes };
      const tracker = observability.trackOperation({ name: TOOL_CALL_OPERATION, attributes });
      let result: ToolExecutionResult;
      try {
        result = await tracker.run(() => inner.execute({ principal, run, toolId, input }, { ...(signal === undefined ? {} : { signal }), ...(emitSurface === undefined ? {} : { emitSurface }) }));
      } catch (error) {
        // An unknown tool id throws ToolInputError: the same caller mistake as a validation failure.
        const errorKind = error instanceof ToolInputError ? "validation" : "internal";
        if (errorKind === "internal") tracker.run(() => observability.reportError({ error, context }));
        tracker.end({ outcome: "threw", failed: true, attributes: { "tool.error_kind": errorKind } });
        throw error;
      }
      const errorKind = errorKindOf(result);
      if (result.status === "timed-out" || errorKind === "internal") {
        tracker.run(() => observability.reportError({ error: new ToolExecutionFailure(result.error ?? result.status), context }));
      }
      tracker.end({ outcome: result.status, failed: FAILED_STATUSES.has(result.status), ...(errorKind ? { attributes: { "tool.error_kind": errorKind } } : {}) });
      return result;
    },
    resumeConfirmation: (args) => inner.resumeConfirmation(args),
    cancel: (args) => inner.cancel(args),
    getAuditRecord: (args) => inner.getAuditRecord(args),
  };
}
