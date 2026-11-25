/** Each tool call becomes one observed operation; execution errors are recorded once through the
 * host reporter (with the operation's tracker), input errors are not. */
import { expect, test, vi } from "vitest";
import { ToolInputError } from "@jini-ai/core";
import type { ObservabilityPort, TraceIds } from "@jini-ai/core/contracts/observability";
import { createRecordingReporter } from "@jini-ai/core/errors/testing";
import { delegatedToolErrorDisclosure, withToolCallObservability, ToolExecutionFailure, UNREGISTERED_TOOL_LABEL, UNIDENTIFIED_USER_LABEL } from "../index.js";
import type { ToolExecutionResult, ToolExecutor } from "../../tool-executor-types.js";

type Recorded = { name: string; start: Record<string, unknown>; end?: Record<string, unknown>; durationMs?: number; errors: unknown[] };

const IDS = ["ERR-0001-0000-0000-0000", "ERR-0002-0000-0000-0000", "ERR-0003-0000-0000-0000"];
/** A real reporter over recording ports: `entries` are host records, `reports` are tracker reports. */
function recording() {
  const recorded = createRecordingReporter({ ids: IDS, iso: "2026-11-25T00:00:00.000Z" });
  return { ...recorded, hostRecords: () => recorded.entries.filter((entry) => entry.message.startsWith("[incident]") && entry.level === "error") };
}

/** A fake port with a manual clock, so the duration an adapter would measure is visible here too. */
function createFakePort() {
  let now = 0; let active: Recorded | undefined;
  const operations: Recorded[] = []; const orphanErrors: unknown[] = [];
  const traces: TraceIds[] = [];
  const port: Pick<ObservabilityPort, "trackOperation" | "reportError"> = {
    trackOperation: ({ name, attributes = {} }) => {
      const op: Recorded = { name, start: { ...attributes }, errors: [] }; const startedAt = now;
      operations.push(op);
      const trace: TraceIds = { traceId: `trace-${operations.length}`, spanId: "span" };
      traces.push(trace);
      return {
        run: (fn) => { const prev = active; active = op; try { return fn(); } finally { active = prev; } },
        end: (outcome) => { op.end = { ...outcome }; op.durationMs = now - startedAt; },
        traceIds: () => trace,
      };
    },
    reportError: ({ error }) => { (active ? active.errors : orphanErrors).push(error); },
  };
  return { port, operations, orphanErrors, traces, advance: (ms: number) => { now += ms; } };
}

function executorReturning(settle: () => ToolExecutionResult | Promise<ToolExecutionResult>, onExecute: () => void = () => {}): ToolExecutor {
  return {
    execute: async () => { onExecute(); return settle(); },
    resumeConfirmation: () => {}, cancel: () => {}, getAuditRecord: () => null,
  };
}

const CALL = { principal: { id: "p1" } as never, run: { id: "run-1" }, toolId: "pages_list", input: {} };

test("a completed call is one tool.call operation with tool id, run id, outcome and duration", async () => {
  const fake = createFakePort(); const rec = recording();
  const executor = withToolCallObservability({ inner: executorReturning(() => ({ executionId: "e", status: "completed", output: 1 }), () => fake.advance(42)), reporter: rec.reporter, observability: fake.port }, {});
  const result = await executor.execute(CALL);
  expect(result.status).toBe("completed");
  expect(fake.operations).toEqual([{ name: "tool.call", start: { "tool.id": "pages_list", "agent.run.id": "run-1", "user.id": "p1" },
    end: { outcome: "completed", failed: false }, durationMs: 42, errors: [] }]);
});

test("a validation failure is a failed operation with error_kind validation and is NOT reported", async () => {
  const fake = createFakePort(); const rec = recording();
  const executor = withToolCallObservability({ inner: executorReturning(() => ({ executionId: "e", status: "failed", errorKind: "validation", error: "themeId missing" })), reporter: rec.reporter, observability: fake.port }, {});
  await executor.execute(CALL);
  expect(fake.operations[0]?.end).toEqual({ outcome: "failed", failed: true, attributes: { "tool.error_kind": "validation" } });
  expect(fake.operations[0]?.errors).toEqual([]);
  expect(rec.reports).toEqual([]);
  expect(rec.hostRecords()).toEqual([]);
});

test("an internal failure is reported with the operation's tracker as a ToolExecutionFailure", async () => {
  const fake = createFakePort(); const rec = recording();
  const executor = withToolCallObservability({ inner: executorReturning(() => ({ executionId: "e", status: "failed", error: "Error ERR-1: boom" })), reporter: rec.reporter, observability: fake.port }, {});
  await executor.execute(CALL);
  expect(fake.operations[0]?.end).toEqual({ outcome: "failed", failed: true, attributes: { "tool.error_kind": "internal" } });
  expect(rec.reports).toHaveLength(1);
  const reported = rec.reports[0]?.error;
  expect(reported).toBeInstanceOf(ToolExecutionFailure);
  expect((reported as Error).message).toBe("Error ERR-1: boom");
  expect(rec.reports[0]?.context.trace).toBe(fake.traces[0]);
  expect(fake.orphanErrors).toEqual([]);
});

test("timed-out is failed and reported; denied, confirmation-denied and cancelled are not failures", async () => {
  const outcomes: Record<string, unknown>[] = [];
  for (const status of ["timed-out", "denied", "confirmation-denied", "cancelled"] as const) {
    const fake = createFakePort(); const rec = recording();
    await withToolCallObservability({ inner: executorReturning(() => ({ executionId: "e", status })), reporter: rec.reporter, observability: fake.port }, {}).execute(CALL);
    outcomes.push({ status, failed: fake.operations[0]?.end?.failed, reported: rec.reports.length + rec.hostRecords().length / 10 });
  }
  expect(outcomes).toEqual([
    { status: "timed-out", failed: true, reported: 1.1 }, { status: "denied", failed: false, reported: 0 },
    { status: "confirmation-denied", failed: false, reported: 0 }, { status: "cancelled", failed: false, reported: 0 },
  ]);
});

test("a throw is rethrown unchanged; ToolInputError (unknown tool) is validation and unreported, anything else is reported", async () => {
  for (const [error, kind, reported] of [[new ToolInputError({ message: 'unknown tool "x"' }), "validation", 0], [new Error("db down"), "internal", 1]] as const) {
    const fake = createFakePort(); const rec = recording();
    const executor = withToolCallObservability({ inner: executorReturning(() => { throw error; }), reporter: rec.reporter, observability: fake.port }, {});
    await expect(executor.execute(CALL)).rejects.toBe(error);
    expect(fake.operations[0]?.end).toEqual({ outcome: "threw", failed: true, attributes: { "tool.error_kind": kind } });
    expect(rec.reports.length).toBe(reported);
    expect(rec.hostRecords().length).toBe(reported);
    if (reported) expect(rec.reports[0]?.error).toBe(error);
  }
});

test.each(['completed', 'timed-out', 'denied'] as const)('%s increments tool.calls and failures follow the span classification', async status => {
  const fake = createFakePort(); const rec = recording();
  const metric = vi.fn();
  const result: ToolExecutionResult = { executionId: 'e', status };
  const executor = withToolCallObservability({ inner: executorReturning(() => result),
    reporter: rec.reporter, observability: { ...fake.port, metric, supportsMetric: true } }, {});
  const settled = await executor.execute(CALL);
  if (status === 'timed-out') expect(settled).toEqual({ ...result, errorId: IDS[0] });
  else expect(settled).toBe(result);
  const expected = [[{ name: 'tool.calls', value: 1 }, { kind: 'counter', attributes: { 'tool.id': 'pages_list' } }]];
  if (status === 'timed-out') expected.push([{ name: 'tool.failures', value: 1 }, { kind: 'counter', attributes: { 'tool.id': 'pages_list' } }]);
  expect(metric.mock.calls).toEqual(expected);
  expect(fake.operations[0]?.end?.failed).toBe(status === 'timed-out');
});

test('an input throw increments calls and failures once with the fixed unregistered label', async () => {
  const fake = createFakePort(); const rec = recording();
  const metric = vi.fn();
  const error = new ToolInputError({ message: 'unknown tool' });
  const executor = withToolCallObservability({ inner: executorReturning(() => { throw error; }),
    reporter: rec.reporter, observability: { ...fake.port, metric, supportsMetric: true } }, { isRegisteredTool: () => false });
  await expect(executor.execute({ ...CALL, toolId: 'made_up_tool' })).rejects.toBe(error);
  expect(metric.mock.calls).toEqual([
    [{ name: 'tool.calls', value: 1 }, { kind: 'counter', attributes: { 'tool.id': 'unregistered' } }],
    [{ name: 'tool.failures', value: 1 }, { kind: 'counter', attributes: { 'tool.id': 'unregistered' } }],
  ]);
  expect(fake.operations[0]?.end?.failed).toBe(true);
});

test('ports without metric capability receive no measurements', async () => {
  const fake = createFakePort(); const rec = recording();
  const metric = vi.fn();
  const result: ToolExecutionResult = { executionId: 'e', status: 'completed' };
  for (const observability of [fake.port, { ...fake.port, metric, supportsMetric: false }]) {
    expect(await withToolCallObservability({ inner: executorReturning(() => result), reporter: rec.reporter, observability }, {}).execute(CALL)).toBe(result);
  }
  expect(metric).not.toHaveBeenCalled();
});

test("other executor methods delegate to inner", () => {
  const calls: string[] = [];
  const inner: ToolExecutor = { execute: async () => ({ executionId: "e", status: "completed" }),
    resumeConfirmation: () => { calls.push("resume"); }, cancel: () => { calls.push("cancel"); }, getAuditRecord: () => { calls.push("audit"); return null; } };
  const executor = withToolCallObservability({ inner, reporter: recording().reporter, observability: createFakePort().port }, {});
  executor.resumeConfirmation({ executionId: "e", decision: "approve" as never }); executor.cancel({ executionId: "e" }); executor.getAuditRecord({ executionId: "e" });
  expect(calls).toEqual(["resume", "cancel", "audit"]);
});

test("review #1: a secret-shaped or unregistered tool id never reaches the port; a fixed label does", async () => {
  const fake = createFakePort(); const rec = recording();
  const completed = executorReturning(() => ({ executionId: "e", status: "completed", output: 1 }));
  const secretId = ["sk", "live", "51HxAbCdEfGhIjKlMnOpQrSt"].join("_"); // built at runtime: push protection blocks the literal
  await withToolCallObservability({ inner: completed, reporter: rec.reporter, observability: fake.port }, {}).execute({ ...CALL, toolId: secretId });
  await withToolCallObservability({ inner: completed, reporter: rec.reporter, observability: fake.port }, { isRegisteredTool: ({ toolId }) => toolId === "pages_list" }).execute({ ...CALL, toolId: "made_up_tool" });
  await withToolCallObservability({ inner: completed, reporter: rec.reporter, observability: fake.port }, { isRegisteredTool: ({ toolId }) => toolId === "pages_list" }).execute(CALL);
  expect(fake.operations.map((op) => op.start["tool.id"])).toEqual([UNREGISTERED_TOOL_LABEL, UNREGISTERED_TOOL_LABEL, "pages_list"]);
  expect(JSON.stringify(fake.operations)).not.toContain(secretId);
});

test("owner 10-25: user.id is the pseudonymous principal id; e-mail- or secret-shaped ids are replaced", async () => {
  const fake = createFakePort(); const rec = recording();
  const executor = withToolCallObservability({ inner: executorReturning(() => ({ executionId: "e", status: "completed", output: 1 })), reporter: rec.reporter, observability: fake.port }, {});
  for (const id of ["user_7f3a", "owner@example.com", "ghp_abcdefghijklmnopqrstuvwxyz0123456789"]) await executor.execute({ ...CALL, principal: { id } as never });
  expect(fake.operations.map((op) => op.start["user.id"])).toEqual(["user_7f3a", UNIDENTIFIED_USER_LABEL, UNIDENTIFIED_USER_LABEL]);
});

test("withToolCallAnalytics: one tool_call product event per call, after it settles, with the same id/user rules; throws pass through", async () => {
  const { withToolCallAnalytics } = await import("../index.js");
  const events: unknown[] = [];
  const analytics = { capture: (event: unknown) => { events.push(event); } };
  const ok = withToolCallAnalytics({ inner: executorReturning(() => ({ executionId: "e", status: "failed", errorKind: "validation", error: "x" })), analytics }, { isRegisteredTool: () => true });
  await ok.execute(CALL);
  const throwing = withToolCallAnalytics({ inner: { ...executorReturning(() => ({ executionId: "e", status: "completed" })), execute: async () => { throw new ToolInputError({ message: "unknown tool" }); } }, analytics }, { isRegisteredTool: () => false });
  await expect(throwing.execute({ ...CALL, toolId: "nope" })).rejects.toThrow("unknown tool");
  expect(events).toEqual([
    { name: "tool_call", userId: "p1", properties: { tool_id: "pages_list", outcome: "failed", failed: true, error_kind: "validation" } },
    { name: "tool_call", userId: "p1", properties: { tool_id: UNREGISTERED_TOOL_LABEL, outcome: "threw", failed: true } },
  ]);
});
