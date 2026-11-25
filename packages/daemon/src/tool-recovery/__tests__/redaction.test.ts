/** Failed-tool redaction: model-facing failures carry only a redacted message plus an error id (the
 * record is the observation layer's job, under that id), and delegated internal errors get the same
 * disclosure shape with one host record through the reporter. */
import { expect, test } from "vitest";
import { createRecordingReporter } from "@jini-ai/core/errors/testing";
import { mintToolErrorId } from "@jini-ai/core/errors/error-id";
import type { ToolExecutionResult, ToolExecutor } from "../../tool-executor-types.js";
import {
  TOOL_ERROR_ID_PATTERN,
  delegatedToolErrorDisclosure,
  describeDelegatedInternalError,
  isRedactedToolFailure,
  readToolErrorId,
  withRedactedToolFailures,
} from "../index.js";

const call = { principal: { id: "operator" }, run: { id: "run-1" }, toolId: "deploy", input: {} };
const credential = () => ["sk", "live", "abc123"].join("_");

function deps() {
  let next = 0;
  return {
    mintErrorId: () => `ERR-000${++next}-0000-0000-0000`,
    redactSecretShapes: ({ text }: { text: string }) => {
      const parts = text.split(credential());
      return { text: parts.join("[REDACTED]"), redactions: parts.length - 1 };
    },
  };
}

const IDS = ["ERR-0001-0000-0000-0000", "ERR-0002-0000-0000-0000", "ERR-0003-0000-0000-0000", "ERR-0004-0000-0000-0000", "ERR-0005-0000-0000-0000", "ERR-0006-0000-0000-0000", "ERR-0007-0000-0000-0000"];
/** The describer's deps: the host reporter (over recording ports) and the same redactor. */
function disclosureDeps() {
  // The host reporter carries its standing secrets; a thrown object is recorded as-is (so it dedupes
  // with the tool decorator) and the reporter's own redaction blanks it in the host record.
  const recorded = createRecordingReporter({ ids: IDS, iso: "2026-11-25T00:00:00.000Z" }, { redaction: { exactSecrets: [credential()] } });
  return { deps: { reporter: recorded.reporter, redactSecretShapes: deps().redactSecretShapes }, entries: recorded.entries };
}

function executor(result: ToolExecutionResult, seen: unknown[] = []): ToolExecutor {
  return {
    execute: async (_args, optional) => { seen.push(optional); return result; },
    resumeConfirmation: () => {}, cancel: () => {}, getAuditRecord: () => null,
  };
}

test("the pattern recognizes an ID minted by core's one owner of the format, and not an empty one", () => {
  const id = mintToolErrorId({ randomHex: () => "0123456789abcdef" });
  expect(id).toBe("ERR-0123-4567-89AB-CDEF");
  expect(TOOL_ERROR_ID_PATTERN.test(`see ${id}`)).toBe(true);
  expect(TOOL_ERROR_ID_PATTERN.test(mintToolErrorId({ randomHex: () => "" }))).toBe(false);
});

test("a non-validation failure is redacted and given an error id, with the id minted exactly once", async () => {
  let mints = 0;
  const failed: ToolExecutionResult = { executionId: "exec-1", status: "failed", errorKind: "internal", error: `auth ${credential()} rejected` };
  const result = await withRedactedToolFailures({ inner: executor(failed), ...deps(), mintErrorId: () => `ERR-000${++mints}-0000-0000-0000` }).execute(call);

  expect(result).toEqual({ ...failed, error: "Error ERR-0001-0000-0000-0000: auth [REDACTED] rejected", errorId: "ERR-0001-0000-0000-0000" });
  expect(readToolErrorId({ result })).toBe("ERR-0001-0000-0000-0000");
  expect(isRedactedToolFailure({ result })).toBe(true);
  expect(mints).toBe(1);
});

test("a failure with no message gets a generic one", async () => {
  const result = await withRedactedToolFailures({ inner: executor({ executionId: "e", status: "failed" }), ...deps() })
    .execute(call);
  expect(result.error).toBe('Error ERR-0001-0000-0000-0000: tool "deploy" failed');
  expect(readToolErrorId({ result })).toBe("ERR-0001-0000-0000-0000");
});

test("validation failures stay model-visible (redacted, no error id); successes and message-less validation pass through", async () => {
  let mints = 0;
  const counted = () => ({ ...deps(), mintErrorId: () => { mints += 1; return "ERR-0009-0000-0000-0000"; } });
  const validation: ToolExecutionResult = { executionId: "v", status: "failed", errorKind: "validation", error: `bad key ${credential()}` };
  const redacted = await withRedactedToolFailures({ inner: executor(validation), ...counted() }).execute(call);
  expect(redacted).toEqual({ ...validation, error: "bad key [REDACTED]" });
  expect(isRedactedToolFailure({ result: redacted })).toBe(false);

  const bare: ToolExecutionResult = { executionId: "v2", status: "failed", errorKind: "validation" };
  expect(await withRedactedToolFailures({ inner: executor(bare), ...counted() }).execute(call)).toBe(bare);
  const ok: ToolExecutionResult = { executionId: "ok", status: "completed", output: 1 };
  expect(await withRedactedToolFailures({ inner: executor(ok), ...counted() }).execute(call)).toBe(ok);
  expect(mints).toBe(0);
});

test("signal and emitSurface are forwarded only when supplied, and the other methods delegate", async () => {
  const seen: unknown[] = [];
  const calls: string[] = [];
  const inner: ToolExecutor = { ...executor({ executionId: "ok", status: "completed" }, seen),
    resumeConfirmation: ({ executionId }) => { calls.push(`resume:${executionId}`); },
    cancel: ({ executionId }) => { calls.push(`cancel:${executionId}`); },
    getAuditRecord: ({ executionId }) => { calls.push(`audit:${executionId}`); return null; } };
  const wrapped = withRedactedToolFailures({ inner, ...deps() });
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
  const base = { source: "delegated-tools", runId: "run-1", toolId: "deploy", correlationId: "corr-1" };
  const describe = (context: Parameters<typeof describeDelegatedInternalError>[0]["context"]) => {
    const { deps: described, entries } = disclosureDeps();
    const text = describeDelegatedInternalError({ context, ...described });
    records.push(entries);
    return text;
  };
  const records: { meta?: Record<string, unknown> }[][] = [];

  expect(describe({ ...base, error: new Error("ignored"), status: "timed-out" })).toBe('Error ERR-0001-0000-0000-0000: tool "deploy" timed out before it finished');
  expect(describe({ ...base, error: null, status: "cancelled" }))
    .toBe('Error ERR-0001-0000-0000-0000: tool "deploy" was cancelled before it finished (the run ended or the call was abandoned)');
  expect(describe({ ...base, error: new Error(`leaked ${credential()}`) })).toBe("Error ERR-0001-0000-0000-0000: leaked [REDACTED]");
  expect(describe({ ...base, error: "string failure" })).toBe("Error ERR-0001-0000-0000-0000: string failure");
  for (const error of [new Error(""), "", 42]) {
    expect(describe({ ...base, error })).toBe('Error ERR-0001-0000-0000-0000: tool "deploy" failed');
  }
  expect(records.map((entries) => entries.length)).toEqual(Array.from({ length: 7 }, () => 1));
  expect(records[2]?.[0]?.meta).toMatchObject({ errorId: "ERR-0001-0000-0000-0000", step: "Run tool", attributes: { "agent.run.id": "run-1" } });
  expect(JSON.stringify(records)).not.toContain(credential());
});

test("delegatedToolErrorDisclosure exposes the model-safe check and the internal-error describer over the same deps", () => {
  const { deps: described, entries } = disclosureDeps();
  const disclosure = delegatedToolErrorDisclosure(described);
  expect(disclosure.isModelSafeToolFailure({ result: { executionId: "x", status: "failed", errorId: "ERR-1" } as ToolExecutionResult })).toBe(true);
  expect(disclosure.isModelSafeToolFailure({ result: { executionId: "x", status: "failed", error: "raw" } })).toBe(false);
  // A timed-out result carries the observation layer's id, but its text was never redacted by this layer.
  expect(disclosure.isModelSafeToolFailure({ result: { executionId: "x", status: "timed-out", errorId: "ERR-1" } as ToolExecutionResult })).toBe(false);
  expect(disclosure.describeInternalError({ source: "s", runId: "r", toolId: "t", correlationId: "c", error: "boom" })).toBe("Error ERR-0001-0000-0000-0000: boom");
  expect(entries).toHaveLength(1);
});

test('delegated timeout carries host recovery facts through the same redaction and error-id boundary', () => {
  const { deps: described, entries } = disclosureDeps();
  const disclosure = delegatedToolErrorDisclosure(described);
  const message = disclosure.describeInternalError({ source: 'delegated-tool-execute', runId: 'run-1', toolId: 'publish', correlationId: 'corr', error: 'timed-out', status: 'timed-out', recoveryMessage: `Publish job job-1 is still running. Deployment: created; uploaded: 4/5; URL: https://new.test; status: BUILDING. Read job-1 before retrying. ${credential()}` });
  expect(message).toContain('Deployment: created; uploaded: 4/5');
  expect(message).toContain('Read job-1 before retrying');
  expect(message).toContain('ERR-0001-0000-0000-0000');
  expect(message).not.toContain(credential());
  expect(entries).toHaveLength(1);
  expect(JSON.stringify(entries)).not.toContain(credential());
});

test("a stamped in-process id is reused without writing a second record; a breached reporter leaves the words without an id", () => {
  const { deps: described, entries } = disclosureDeps();
  const stamped = "ERR-ABCD-0000-0000-0000";
  expect(describeDelegatedInternalError({ context: { source: "s", runId: "r", toolId: "t", correlationId: "c", error: "timed-out", status: "timed-out", errorId: stamped }, ...described }))
    .toBe(`Error ${stamped}: tool "t" timed out before it finished`);
  expect(entries).toEqual([]);
  const broken = { reporter: { record: () => { throw new Error("down"); } }, redactSecretShapes: described.redactSecretShapes };
  expect(describeDelegatedInternalError({ context: { source: "s", runId: "r", toolId: "t", correlationId: "c", error: "x" }, ...broken })).toBe("x");
});
