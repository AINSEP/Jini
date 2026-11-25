/**
 * @file J60 step 1 (dedupe design, Tovu `development/refactor-patterns/dedupe/dedupe-09.terra-prompt.md`):
 * every tool-recovery decorator must forward the per-call options WHOLE to the executor it wraps.
 * Today each one rebuilds the options from `{ signal, emitSurface }` only, so a host's per-call
 * `requireConfirmation: true` (`ToolExecutor.execute`, tool-executor.ts) is dropped whenever the
 * executor is wrapped. Written by the design; expected RED for all four until the fix lands.
 */
import { describe, expect, test } from "vitest";
import type { ObservabilityPort } from "@jini-ai/core/contracts/observability";
import type { ToolExecutionResult, ToolExecutor } from "../../tool-executor-types.js";
import { withToolCallAnalytics } from "../analytics.js";
import { withToolCallObservability } from "../observability.js";
import { withFederatedRefusalDiagnosis } from "../federated-refusal.js";
import { withRedactedToolFailures } from "../redaction.js";

const COMPLETED: ToolExecutionResult = { executionId: "exec-1", status: "completed", output: 1 };

/** Inner executor that records the second `execute` argument it receives. */
function recordingInner(seen: unknown[]): ToolExecutor {
  return {
    execute: async (_args, optional) => { seen.push(optional); return COMPLETED; },
    resumeConfirmation: () => {}, cancel: () => {}, getAuditRecord: () => null,
  };
}

const observability: Pick<ObservabilityPort, "trackOperation"> = {
  trackOperation: () => ({ run: (fn) => fn(), end: () => {} }),
};
const reporter = { record: () => ({ errorId: "ERR-0001-0000-0000-0000" }) };

const wrappers: ReadonlyArray<readonly [string, (inner: ToolExecutor) => ToolExecutor]> = [
  ["withToolCallAnalytics", (inner) => withToolCallAnalytics({ inner, analytics: { capture: () => {} } })],
  ["withToolCallObservability", (inner) => withToolCallObservability({ inner, reporter, observability }, {})],
  ["withFederatedRefusalDiagnosis", (inner) => withFederatedRefusalDiagnosis({
    inner,
    isFederatedTool: () => false,
    parseConnectionId: () => null,
    findRefusal: () => null,
    newExecutionId: () => "exec-diag",
    redactSecretShapes: ({ text }) => ({ text }),
  })],
  ["withRedactedToolFailures", (inner) => withRedactedToolFailures({
    inner,
    mintErrorId: () => "ERR-0001-0000-0000-0000",
    redactSecretShapes: ({ text }) => ({ text, redactions: 0 }),
  })],
];

describe("tool-recovery decorators forward per-call options whole (J60)", () => {
  for (const [name, wrap] of wrappers) {
    test(`${name} forwards requireConfirmation and the same signal`, async () => {
      const seen: unknown[] = [];
      const signal = new AbortController().signal;
      await wrap(recordingInner(seen)).execute(
        { principal: { id: "operator" }, run: { id: "run-1" }, toolId: "pages_list", input: {} },
        { requireConfirmation: true, signal },
      );
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ requireConfirmation: true });
      expect((seen[0] as { signal?: AbortSignal }).signal).toBe(signal);
    });
  }
});
