/**
 * @file Every tool call as one PRODUCT event: which tool a person's assistant used and how it ended.
 * The sibling of `./observability.ts` on the same chokepoint (`ToolExecutor.execute`), answering a
 * different question: observability asks "is the system healthy?", product analytics asks "what do
 * people actually use, and where does it fail them?". Separate decorators because the two have
 * separate switches and consent: telemetry is operator config, product analytics also needs the
 * operator's telemetry consent (enforced by the host's port, `@jini-ai/analytics/product`'s guard).
 *
 * The port is taken structurally ({@link ToolCallAnalytics}) — `@jini-ai/analytics/product`'s
 * `ProductAnalyticsPort` satisfies it — so the daemon gains no dependency. One event per call,
 * emitted after the call settles; it never changes a result or a throw.
 */
import type { Principal, RunRef, SurfaceEmitter } from "@jini-ai/core";
import type { ToolExecutionResult, ToolExecutor } from "../tool-executor.js";
import { pseudonymousUserId, toolCallLabel, type IsRegisteredTool } from "./observability.js";

/** The one `ProductAnalyticsPort` method this decorator calls. */
export interface ToolCallAnalytics {
  capture(event: { name: string; userId: string; properties?: Readonly<Record<string, string | number | boolean>> }): void;
}

export const TOOL_CALL_EVENT = "tool_call";

/**
 * Wraps `inner` so each `execute` emits one {@link TOOL_CALL_EVENT}: `tool_id` (or the fixed
 * unregistered label), `outcome` (the settled status, or `threw`), `failed`, and `error_kind` for a
 * failure, as `userId` = the principal's pseudonymous id. No input, output or error text is sent.
 * @param required The executor and the analytics port slice.
 * @param optional `isRegisteredTool`: the host's registry check (same rule as the observability decorator).
 * @returns A drop-in `ToolExecutor`; results and throws pass through unchanged.
 * @complexity O(1) beyond `inner`'s own cost.
 */
export function withToolCallAnalytics({ inner, analytics }: { inner: ToolExecutor; analytics: ToolCallAnalytics }, { isRegisteredTool }: { isRegisteredTool?: IsRegisteredTool } = {}): ToolExecutor {
  const emit = ({ principal, toolId }: { principal: Principal; toolId: string }, properties: Record<string, string | number | boolean>) => {
    try {
      analytics.capture({ name: TOOL_CALL_EVENT, userId: pseudonymousUserId({ principal }), properties: { tool_id: toolCallLabel({ toolId }, { isRegisteredTool }), ...properties } });
    } catch { /* analytics never fails a tool call */ }
  };
  return {
    execute: async (
      { principal, run, toolId, input }: { principal: Principal; run: RunRef; toolId: string; input: unknown },
      { signal, emitSurface }: { signal?: AbortSignal; emitSurface?: SurfaceEmitter } = {},
    ): Promise<ToolExecutionResult> => {
      let result: ToolExecutionResult;
      try {
        result = await inner.execute({ principal, run, toolId, input }, { ...(signal === undefined ? {} : { signal }), ...(emitSurface === undefined ? {} : { emitSurface }) });
      } catch (error) {
        emit({ principal, toolId }, { outcome: "threw", failed: true });
        throw error;
      }
      const failed = result.status === "failed" || result.status === "timed-out";
      emit({ principal, toolId }, { outcome: result.status, failed, ...(result.status === "failed" ? { error_kind: result.errorKind ?? "internal" } : {}) });
      return result;
    },
    resumeConfirmation: (args) => inner.resumeConfirmation(args),
    cancel: (args) => inner.cancel(args),
    getAuditRecord: (args) => inner.getAuditRecord(args),
  };
}
