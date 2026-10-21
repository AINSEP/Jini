/** Failed-tool redaction: model-facing failures carry only a redacted message plus an error id, the
 * real record goes to the host sink, and delegated internal errors get the same disclosure shape. */
import { expect, test } from "vitest";
import type { ToolExecutionResult, ToolExecutor } from "../../tool-executor.js";
import {
  TOOL_ERROR_ID_PATTERN,
  delegatedToolErrorDisclosure,
  describeDelegatedInternalError,
  isRedactedToolFailure,
  mintToolErrorId,
  readToolErrorId,
  withRedactedToolFailures,
  type ToolFailureRecord,
} from "../index.js";

const call = { principal: { id: "operator" }, run: { id: "run-1" }, toolId: "deploy", input: {} };
const credential = () => ["sk", "live", "abc123"].join("_");

function deps(records: ToolFailureRecord[], { sinkThrows = false }: { sinkThrows?: boolean } = {}) {
  let next = 0;
  return {
    mintErrorId: () => `ERR-000${++next}-0000-0000-0000`,
    redactSecretShapes: ({ text }: { text: string }) => {
      const parts = text.split(credential());
      return { text: parts.join("[REDACTED]"), redactions: parts.length - 1 };
    },
    onFailure: (record: ToolFailureRecord) => { records.push(record); if (sinkThrows) throw new Error("sink down"); },
  };
}

function executor(result: ToolExecutionResult, seen: unknown[] = []): ToolExecutor {
  return {
    execute: async (_args, optional) => { seen.push(optional); return result; },
    resumeConfirmation: () => {}, cancel: () => {}, getAuditRecord: () => null,
  };
}

test("mintToolErrorId formats 8 random bytes as an upper-case ERR id the pattern recognizes", () => {
  const requested: number[] = [];
  const id = mintToolErrorId({ randomHex: ({ bytes }) => { requested.push(bytes); return "0123456789abcdef"; } });
  expect(id).toBe("ERR-0123-4567-89AB-CDEF");
  expect(requested).toEqual([8]);
  expect(TOOL_ERROR_ID_PATTERN.test(`see ${id}`)).toBe(true);
  expect(mintToolErrorId({ randomHex: () => "" })).toBe("ERR-");
});

test("a non-validation failure is redacted, given an error id, and reported once to the host sink", async () => {
  const records: ToolFailureRecord[] = [];
  const failed: ToolExecutionResult = { executionId: "exec-1", status: "failed", errorKind: "internal", error: `auth ${credential()} rejected` };
  const result = await withRedactedToolFailures({ inner: executor(failed), ...deps(records) }).execute(call);

  expect(result).toEqual({ ...failed, error: "Error ERR-0001-0000-0000-0000: auth [REDACTED] rejected", errorId: "ERR-0001-0000-0000-0000" });
  expect(readToolErrorId({ result })).toBe("ERR-0001-0000-0000-0000");
  expect(isRedactedToolFailure({ result })).toBe(true);
  expect(records).toEqual([{ errorId: "ERR-0001-0000-0000-0000", toolId: "deploy", runId: "run-1", principalId: "operator",
    executionId: "exec-1", redactions: 1, message: "auth [REDACTED] rejected" }]);
});

test("a failure with no message gets a generic one, and a throwing sink never changes the result", async () => {
  const records: ToolFailureRecord[] = [];
  const result = await withRedactedToolFailures({ inner: executor({ executionId: "e", status: "failed" }), ...deps(records, { sinkThrows: true }) })
    .execute(call);
  expect(result.error).toBe('Error ERR-0001-0000-0000-0000: tool "deploy" failed');
  expect(records).toHaveLength(1);
});

test("validation failures stay model-visible (redacted, no error id); successes and message-less validation pass through", async () => {
  const records: ToolFailureRecord[] = [];
  const validation: ToolExecutionResult = { executionId: "v", status: "failed", errorKind: "validation", error: `bad key ${credential()}` };
  const redacted = await withRedactedToolFailures({ inner: executor(validation), ...deps(records) }).execute(call);
  expect(redacted).toEqual({ ...validation, error: "bad key [REDACTED]" });
  expect(isRedactedToolFailure({ result: redacted })).toBe(false);

  const bare: ToolExecutionResult = { executionId: "v2", status: "failed", errorKind: "validation" };
  expect(await withRedactedToolFailures({ inner: executor(bare), ...deps(records) }).execute(call)).toBe(bare);
  const ok: ToolExecutionResult = { executionId: "ok", status: "completed", output: 1 };
  expect(await withRedactedToolFailures({ inner: executor(ok), ...deps(records) }).execute(call)).toBe(ok);
  expect(records).toEqual([]);
});

test("signal and emitSurface are forwarded only when supplied, and the other methods delegate", async () => {
  const seen: unknown[] = [];
  const calls: string[] = [];
  const inner: ToolExecutor = { ...executor({ executionId: "ok", status: "completed" }, seen),
    resumeConfirmation: ({ executionId }) => { calls.push(`resume:${executionId}`); },
    cancel: ({ executionId }) => { calls.push(`cancel:${executionId}`); },
    getAuditRecord: ({ executionId }) => { calls.push(`audit:${executionId}`); return null; } };
  const wrapped = withRedactedToolFailures({ inner, ...deps([]) });
  const signal = new AbortController().signal;
  const emitSurface = async () => {};
  await wrapped.execute(call);
  await wrapped.execute(call, { signal, emitSurface });
  wrapped.resumeConfirmation({ executionId: "a", decision: "deny" });
  wrapped.cancel({ executionId: "b" });
  expect(wrapped.getAuditRecord({ executionId: "c" })).toBeNull();
  expect(seen).toEqual([{}, { signal, emitSurface }]);
  expect(calls).toEqual(["resume:a", "cancel:b", "audit:c"]);
});

test("a delegated internal error is described by status, then by its own message, then generically — always redacted and id-tagged", () => {
  const records: ToolFailureRecord[] = [];
  const base = { source: "delegated-tools", runId: "run-1", toolId: "deploy", correlationId: "corr-1" };
  const describe = (context: Parameters<typeof describeDelegatedInternalError>[0]["context"]) =>
    describeDelegatedInternalError({ context, ...deps(records) });

  expect(describe({ ...base, error: new Error("ignored"), status: "timed-out" })).toBe('Error ERR-0001-0000-0000-0000: tool "deploy" timed out before it finished');
  expect(describe({ ...base, error: null, status: "cancelled" }))
    .toBe('Error ERR-0001-0000-0000-0000: tool "deploy" was cancelled before it finished (the run ended or the call was abandoned)');
  expect(describe({ ...base, error: new Error(`leaked ${credential()}`) })).toBe("Error ERR-0001-0000-0000-0000: leaked [REDACTED]");
  expect(describe({ ...base, error: "string failure" })).toBe("Error ERR-0001-0000-0000-0000: string failure");
  for (const error of [new Error(""), "", 42]) {
    expect(describe({ ...base, error })).toBe('Error ERR-0001-0000-0000-0000: tool "deploy" failed');
  }
  expect(records[2]).toEqual({ errorId: "ERR-0001-0000-0000-0000", toolId: "deploy", runId: "run-1", principalId: "(unresolved)",
    executionId: "(none) correlationId=corr-1", redactions: 1, message: "leaked [REDACTED]" });
});

test("delegatedToolErrorDisclosure exposes the model-safe check and the internal-error describer over the same deps", () => {
  const records: ToolFailureRecord[] = [];
  const disclosure = delegatedToolErrorDisclosure(deps(records));
  expect(disclosure.isModelSafeToolFailure({ result: { executionId: "x", status: "failed", errorId: "ERR-1" } as ToolExecutionResult })).toBe(true);
  expect(disclosure.isModelSafeToolFailure({ result: { executionId: "x", status: "failed", error: "raw" } })).toBe(false);
  expect(disclosure.describeInternalError({ source: "s", runId: "r", toolId: "t", correlationId: "c", error: "boom" })).toBe("Error ERR-0001-0000-0000-0000: boom");
  expect(records).toHaveLength(1);
});
