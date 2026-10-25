/** Each tool call becomes one observed operation; execution errors are reported, input errors are not. */
import { expect, test } from "vitest";
import { ToolInputError } from "@jini-ai/core";
import { withToolCallObservability, ToolExecutionFailure, type ToolCallObservability } from "../index.js";
import type { ToolExecutionResult, ToolExecutor } from "../../tool-executor.js";

type Recorded = { name: string; start: Record<string, unknown>; end?: Record<string, unknown>; durationMs?: number; errors: unknown[] };

/** A fake port with a manual clock, so the duration an adapter would measure is visible here too. */
function createFakePort() {
  let now = 0; let active: Recorded | undefined;
  const operations: Recorded[] = []; const orphanErrors: unknown[] = [];
  const port: ToolCallObservability = {
    trackOperation: ({ name, attributes = {} }) => {
      const op: Recorded = { name, start: { ...attributes }, errors: [] }; const startedAt = now;
      operations.push(op);
      return {
        run: (fn) => { const prev = active; active = op; try { return fn(); } finally { active = prev; } },
        end: (outcome) => { op.end = { ...outcome }; op.durationMs = now - startedAt; },
      };
    },
    reportError: ({ error }) => { (active ? active.errors : orphanErrors).push(error); },
  };
  return { port, operations, orphanErrors, advance: (ms: number) => { now += ms; } };
}

function executorReturning(settle: () => ToolExecutionResult | Promise<ToolExecutionResult>, onExecute: () => void = () => {}): ToolExecutor {
  return {
    execute: async () => { onExecute(); return settle(); },
    resumeConfirmation: () => {}, cancel: () => {}, getAuditRecord: () => null,
  };
}

const CALL = { principal: { id: "p1" } as never, run: { id: "run-1" }, toolId: "pages_list", input: {} };

test("a completed call is one tool.call operation with tool id, run id, outcome and duration", async () => {
  const fake = createFakePort();
  const executor = withToolCallObservability({ inner: executorReturning(() => ({ executionId: "e", status: "completed", output: 1 }), () => fake.advance(42)), observability: fake.port }, {});
  const result = await executor.execute(CALL);
  expect(result.status).toBe("completed");
  expect(fake.operations).toEqual([{ name: "tool.call", start: { "tool.id": "pages_list", "agent.run.id": "run-1" },
    end: { outcome: "completed", failed: false }, durationMs: 42, errors: [] }]);
});

test("a validation failure is a failed operation with error_kind validation and is NOT reported", async () => {
  const fake = createFakePort();
  const executor = withToolCallObservability({ inner: executorReturning(() => ({ executionId: "e", status: "failed", errorKind: "validation", error: "themeId missing" })), observability: fake.port }, {});
  await executor.execute(CALL);
  expect(fake.operations[0]?.end).toEqual({ outcome: "failed", failed: true, attributes: { "tool.error_kind": "validation" } });
  expect(fake.operations[0]?.errors).toEqual([]);
});

test("an internal failure is reported inside the operation's scope as a ToolExecutionFailure", async () => {
  const fake = createFakePort();
  const executor = withToolCallObservability({ inner: executorReturning(() => ({ executionId: "e", status: "failed", error: "Error ERR-1: boom" })), observability: fake.port }, {});
  await executor.execute(CALL);
  expect(fake.operations[0]?.end).toEqual({ outcome: "failed", failed: true, attributes: { "tool.error_kind": "internal" } });
  const [reported] = fake.operations[0]?.errors ?? [];
  expect(reported).toBeInstanceOf(ToolExecutionFailure);
  expect((reported as Error).message).toBe("Error ERR-1: boom");
  expect(fake.orphanErrors).toEqual([]);
});

test("timed-out is failed and reported; denied, confirmation-denied and cancelled are not failures", async () => {
  const outcomes: Record<string, unknown>[] = [];
  for (const status of ["timed-out", "denied", "confirmation-denied", "cancelled"] as const) {
    const fake = createFakePort();
    await withToolCallObservability({ inner: executorReturning(() => ({ executionId: "e", status })), observability: fake.port }, {}).execute(CALL);
    outcomes.push({ status, failed: fake.operations[0]?.end?.failed, reported: fake.operations[0]?.errors.length });
  }
  expect(outcomes).toEqual([
    { status: "timed-out", failed: true, reported: 1 }, { status: "denied", failed: false, reported: 0 },
    { status: "confirmation-denied", failed: false, reported: 0 }, { status: "cancelled", failed: false, reported: 0 },
  ]);
});

test("a throw is rethrown unchanged; ToolInputError (unknown tool) is validation and unreported, anything else is reported", async () => {
  for (const [error, kind, reported] of [[new ToolInputError({ message: 'unknown tool "x"' }), "validation", 0], [new Error("db down"), "internal", 1]] as const) {
    const fake = createFakePort();
    const executor = withToolCallObservability({ inner: executorReturning(() => { throw error; }), observability: fake.port }, {});
    await expect(executor.execute(CALL)).rejects.toBe(error);
    expect(fake.operations[0]?.end).toEqual({ outcome: "threw", failed: true, attributes: { "tool.error_kind": kind } });
    expect(fake.operations[0]?.errors.length).toBe(reported);
  }
});

test("other executor methods delegate to inner", () => {
  const calls: string[] = [];
  const inner: ToolExecutor = { execute: async () => ({ executionId: "e", status: "completed" }),
    resumeConfirmation: () => { calls.push("resume"); }, cancel: () => { calls.push("cancel"); }, getAuditRecord: () => { calls.push("audit"); return null; } };
  const executor = withToolCallObservability({ inner, observability: createFakePort().port }, {});
  executor.resumeConfirmation({ executionId: "e", decision: "approve" as never }); executor.cancel({ executionId: "e" }); executor.getAuditRecord({ executionId: "e" });
  expect(calls).toEqual(["resume", "cancel", "audit"]);
});
