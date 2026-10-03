// Characterization assertions copied and generalized from assistant/__tests__/tool-executor-audit.test.ts
import assert from "node:assert/strict";
import { test, vi, onTestFinished } from "vitest";

import type { Principal, RunRef, SurfaceEmitter } from "@jini-ai/core";
import type { ToolExecutionResult, ToolExecutor } from "../tool-executor.js";

import { createInMemoryToolAttemptAuditSink } from "./audit-fixture.js";
import type { ToolAttemptAuditSink } from "../tool-audit.js";
import { describeInput, withToolAttemptAudit } from "./audit-fixture.js";

function recorded<T>(items: readonly T[], index: number): T {
  const item = items[index];
  assert.ok(item !== undefined, `Expected recorded item ${index}`);
  return item;
}

const WORKSPACE_ID = "ws-audit";
const PRINCIPAL: Principal = { id: "principal-1" };
const RUN: RunRef = { id: "run-1" };

function fakeExecutor(behavior: { result?: ToolExecutionResult & { errorId?: string }; throws?: unknown }): ToolExecutor & { calls: number; arguments: Parameters<ToolExecutor["execute"]>[] } {
  const executor = {
    calls: 0,
    arguments: [] as Parameters<ToolExecutor["execute"]>[],
    execute: async (...args: Parameters<ToolExecutor["execute"]>): Promise<ToolExecutionResult> => {
      executor.calls += 1;
      executor.arguments.push(args);
      if (behavior.throws !== undefined) throw behavior.throws;
      assert.ok(behavior.result, "fakeExecutor needs either a result or a throws");
      return behavior.result;
    },
    resumeConfirmation: () => {},
    cancel: () => {},
    getAuditRecord: () => null,
  };
  return executor;
}

function wrap(inner: ToolExecutor, sink: ToolAttemptAuditSink) {
  let sequence = 0;
  return withToolAttemptAudit(inner, sink, {
    workspaceId: WORKSPACE_ID,
    now: () => `2026-07-29T00:00:0${sequence++}.000Z`,
    newAttemptId: () => "attempt-1",
    onSinkError: () => {},
  });
}

test("audit forwards every execute argument, including the cancellation and surface channels", async () => {
  const inner = fakeExecutor({ result: { executionId: "e", status: "completed" } });
  const input = { key: "recipe" };
  const signal = new AbortController().signal;
  const emit: SurfaceEmitter = async () => {};
  await wrap(inner, createInMemoryToolAttemptAuditSink()).execute({ principal: PRINCIPAL, run: RUN, toolId: "t", input: input }, { signal: signal, emitSurface: emit });
  assert.equal(inner.arguments.length, 1);
  const expected = [PRINCIPAL, RUN, "t", input, signal, emit];
  assert.equal(recorded(inner.arguments, 0).length, 2);
  const [args, options] = recorded(inner.arguments, 0);
  const actual = [args.principal, args.run, args.toolId, args.input, options?.signal, options?.emitSurface];
  for (const [index, argument] of expected.entries()) assert.equal(actual[index], argument);
});

test("ORDERING GAP: an unknown tool leaves a durable attempt record — Jini writes none at all, because it throws before minting one", async () => {
  const sink = createInMemoryToolAttemptAuditSink();
  const inner = fakeExecutor({ throws: new Error('ToolExecutor: unknown tool "collections_typo"') });

  await assert.rejects(() => wrap(inner, sink).execute({ principal: PRINCIPAL, run: RUN, toolId: "collections_typo", input: { key: "x" } }), /unknown tool/);

  assert.deepEqual(
    sink.events.map((e) => e.phase),
    ["requested", "unknown-tool"],
  );
  assert.equal(recorded(sink.events, 0).executionId, null, "there is no Jini executionId for this case — that is exactly why it was invisible");
  assert.equal(recorded(sink.events, 1).executionId, null);
  assert.equal(recorded(sink.events, 1).toolId, "collections_typo", "the attempted id must be recorded even though no such tool exists");
  assert.equal(recorded(sink.events, 0).attemptId, recorded(sink.events, 1).attemptId, "both phases must join on the host's attempt id");
});

test("the 'requested' row is appended BEFORE the inner executor is called, which is what makes the case above recordable", async () => {
  const order: string[] = [];
  const sink: ToolAttemptAuditSink = { append: async (e) => void order.push(`append:${e.phase}`) };
  const inner = {
    execute: async (): Promise<ToolExecutionResult> => {
      order.push("inner.execute");
      return { executionId: "exec-1", status: "completed", output: null };
    },
    resumeConfirmation: () => {},
    cancel: () => {},
    getAuditRecord: () => null,
  } as unknown as ToolExecutor;

  await wrap(inner, sink).execute({ principal: PRINCIPAL, run: RUN, toolId: "collections_content_type_define", input: {} });

  assert.deepEqual(order, ["append:requested", "inner.execute", "append:completed"]);
});

test("a denied execution records requested + denied, carrying Jini's executionId", async () => {
  const sink = createInMemoryToolAttemptAuditSink();
  const inner = fakeExecutor({ result: { executionId: "exec-9", status: "denied" } });

  const result = await wrap(inner, sink).execute({ principal: PRINCIPAL, run: RUN, toolId: "collections_content_type_tombstone", input: { key: "recipe" } });

  assert.equal(result.status, "denied");
  assert.deepEqual(
    sink.events.map((e) => e.phase),
    ["requested", "denied"],
  );
  assert.equal(recorded(sink.events, 1).executionId, "exec-9");
});

test("a completed execution records requested + completed and returns the inner result unchanged", async () => {
  const sink = createInMemoryToolAttemptAuditSink();
  const inner = fakeExecutor({ result: { executionId: "exec-2", status: "completed", output: { contentType: { key: "recipe" } } } });

  const result = await wrap(inner, sink).execute({ principal: PRINCIPAL, run: RUN, toolId: "collections_content_type_define", input: { key: "recipe" } });

  assert.deepEqual(result, { executionId: "exec-2", status: "completed", output: { contentType: { key: "recipe" } } });
  assert.deepEqual(
    sink.events.map((e) => e.phase),
    ["requested", "completed"],
  );
});

test("every non-throwing result status is recorded under its own phase, so the table can distinguish them", async () => {
  for (const status of ["completed", "denied", "confirmation-denied", "timed-out", "cancelled", "failed"] as const) {
    const sink = createInMemoryToolAttemptAuditSink();
    await wrap(fakeExecutor({ result: { executionId: "e", status } }), sink).execute({ principal: PRINCIPAL, run: RUN, toolId: "t", input: {} });

    assert.equal(recorded(sink.events, 1).phase, status, `status '${status}' must map to its own phase`);
  }
});

test("a throwing handler records requested + failed, and the original error still propagates untouched", async () => {
  const sink = createInMemoryToolAttemptAuditSink();
  const boom = new TypeError("cannot read properties of null");
  const inner = fakeExecutor({ throws: boom });

  const thrown = await wrap(inner, sink).execute({ principal: PRINCIPAL, run: RUN, toolId: "collections_content_type_define", input: {} }).then(
    () => null,
    (e: unknown) => e,
  );

  assert.equal(thrown, boom, "the decorator must rethrow the SAME error object, not a wrapped one");
  assert.deepEqual(
    sink.events.map((e) => e.phase),
    ["requested", "failed"],
  );
  assert.equal(recorded(sink.events, 1).phase, "failed");
  assert.notEqual(recorded(sink.events, 1).phase, "unknown-tool", "a handler failure must be distinguishable from a misrouted call");
});

test("ADVERSARIAL: a sink that throws on every append cannot break tool execution — audit is observation, not a gate", async () => {
  const sinkErrors: unknown[] = [];
  const hostileSink: ToolAttemptAuditSink = {
    append: async () => {
      throw new Error("disk full");
    },
  };
  const inner = fakeExecutor({ result: { executionId: "exec-3", status: "completed", output: "ok" } });
  const executor = withToolAttemptAudit(inner, hostileSink, { workspaceId: WORKSPACE_ID, onSinkError: (e) => sinkErrors.push(e) });

  const result = await executor.execute({ principal: PRINCIPAL, run: RUN, toolId: "collections_content_type_define", input: {} });

  assert.deepEqual(result, { executionId: "exec-3", status: "completed", output: "ok" });
  assert.equal(inner.calls, 1, "the tool must still have run");
  assert.equal(sinkErrors.length, 2, "both appends failed and both were reported — loud, but not fatal");
});

test("ADVERSARIAL: a throwing sink on the error path does not mask the tool's own error", async () => {
  const hostileSink: ToolAttemptAuditSink = {
    append: async () => {
      throw new Error("disk full");
    },
  };
  const boom = new Error("the real failure");
  const executor = withToolAttemptAudit(fakeExecutor({ throws: boom }), hostileSink, { workspaceId: WORKSPACE_ID, onSinkError: () => {} });

  const thrown = await executor.execute({ principal: PRINCIPAL, run: RUN, toolId: "t", input: {} }).then(
    () => null,
    (e: unknown) => e,
  );

  assert.equal(thrown, boom, "a sink failure must never replace the error the caller needs to see");
});

test("REDACTION: detail records the input's key names and array sizes, never any value", async () => {
  const sink = createInMemoryToolAttemptAuditSink();
  const secret = "s3cret-operator-content";
  const inner = fakeExecutor({ result: { executionId: "exec-4", status: "completed", output: null } });

  await wrap(inner, sink).execute({ principal: PRINCIPAL, run: RUN, toolId: "collections_content_type_define", input: { key: secret, label: secret, fields: [{ name: secret }] } });

  const detail = String(recorded(sink.events, 0).detail);
  assert.equal(detail.includes(secret), false, `detail leaked operator content: ${detail}`);
  assert.equal(detail, "keys: fields[1], key, label");
});

test("REDACTION: a thrown error contributes only its class name, never its message", async () => {
  const sink = createInMemoryToolAttemptAuditSink();
  const secret = "s3cret-operator-content";

  await wrap(fakeExecutor({ throws: new RangeError(`failed on ${secret}`) }), sink)
    .execute({ principal: PRINCIPAL, run: RUN, toolId: "t", input: {} })
    .catch(() => {});

  assert.equal(recorded(sink.events, 1).detail, "RangeError");
  assert.equal(String(recorded(sink.events, 1).detail).includes(secret), false);
});

test("every row carries the workspace, run, tool and principal needed to attribute it", async () => {
  const sink = createInMemoryToolAttemptAuditSink();
  await wrap(fakeExecutor({ result: { executionId: "exec-5", status: "completed", output: null } }), sink).execute({ principal: PRINCIPAL, run: RUN, toolId: "collections_content_type_deprecate", input: {} });

  for (const event of sink.events) {
    assert.equal(event.workspaceId, WORKSPACE_ID);
    assert.equal(event.runId, "run-1");
    assert.equal(event.principalId, "principal-1");
    assert.equal(event.toolId, "collections_content_type_deprecate");
    assert.match(event.at, /^2026-07-29T/);
  }
});

test("a truncated output is noted, since the recorded result is then not the whole story", async () => {
  const sink = createInMemoryToolAttemptAuditSink();
  await wrap(fakeExecutor({ result: { executionId: "exec-6", status: "completed", output: "abc", truncated: true } }), sink).execute({ principal: PRINCIPAL, run: RUN, toolId: "t", input: {} });

  assert.equal(recorded(sink.events, 1).detail, "output truncated");
});

test("2026-09-16: a redacted internal failure's row links to its error ID, never its (already redacted) text", async () => {
  const sink = createInMemoryToolAttemptAuditSink();
  const secret = "sk_" + "live_" + "Ab3".repeat(8);
  const errorId = "ERR-AAAA-BBBB-CCCC-DDDD";
  const inner = fakeExecutor({
    result: { executionId: "exec-8", status: "failed", errorKind: "internal", error: `Error ${errorId}: boom ${secret}`, errorId },
  });

  await wrap(inner, sink).execute({ principal: PRINCIPAL, run: RUN, toolId: "t", input: {} });

  assert.equal(recorded(sink.events, 1).detail, `errorId=${errorId}`);
  assert.equal(String(recorded(sink.events, 1).detail).includes("boom"), false, "the detail must never carry the error's own text");
  assert.equal(String(recorded(sink.events, 1).detail).includes(secret), false);
});

test("distinct executions get distinct attempt ids, so concurrent runs cannot be conflated", async () => {
  const sink = createInMemoryToolAttemptAuditSink();
  const executor = withToolAttemptAudit(fakeExecutor({ result: { executionId: "e", status: "completed", output: null } }), sink, { workspaceId: WORKSPACE_ID });

  await Promise.all([executor.execute({ principal: PRINCIPAL, run: RUN, toolId: "t", input: {} }), executor.execute({ principal: PRINCIPAL, run: RUN, toolId: "t", input: {} })]);

  assert.equal(new Set(sink.events.map((e) => e.attemptId)).size, 2, "two executions must not share one attempt id");
  assert.equal(sink.events.length, 4);
});

test("resumeConfirmation, cancel and getAuditRecord delegate straight through — Jini keeps its own contract", () => {
  const calls: string[] = [];
  const record = { executionId: "exec-7", toolId: "t", principalId: "p", runId: "r", events: [] };
  const inner = {
    execute: async () => ({ executionId: "e", status: "completed" as const }),
    resumeConfirmation: ({ executionId: id, decision }: { executionId: string; decision: string }) => calls.push(`resume:${id}:${decision}`),
    cancel: ({ executionId: id }: { executionId: string }) => calls.push(`cancel:${id}`),
    getAuditRecord: ({ executionId: id }: { executionId: string }) => {
      calls.push(`get:${id}`);
      return record;
    },
  } as unknown as ToolExecutor;

  const executor = withToolAttemptAudit(inner, createInMemoryToolAttemptAuditSink(), { workspaceId: WORKSPACE_ID });
  executor.resumeConfirmation({ executionId: "exec-7", decision: "confirm" });
  executor.cancel({ executionId: "exec-7" });

  assert.equal(executor.getAuditRecord({ executionId: "exec-7" }), record, "Jini's in-memory record stays its own source of truth — this table is additive");
  assert.deepEqual(calls, ["resume:exec-7:confirm", "cancel:exec-7", "get:exec-7"]);
});

test("describeInput handles every shape without throwing, and never returns a value", () => {
  assert.equal(describeInput({ key: "recipe", fields: [1, 2] }), "keys: fields[2], key");
  assert.equal(describeInput({}), "keys: none");
  assert.equal(describeInput(null), "input: null");
  assert.equal(describeInput(undefined), "input: undefined");
  assert.equal(describeInput([1, 2, 3]), "input: an array of 3");
  assert.equal(describeInput("a-secret-string"), "input: a string");
  assert.equal(describeInput(42), "input: a number");
});
