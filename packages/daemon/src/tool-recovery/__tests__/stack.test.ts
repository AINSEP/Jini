/** The assembled assistant tool executor: registry execution, then failure redaction, then (optionally)
 * per-attempt audit — wired once so every host gets the same order. */
import { expect, test, vi } from "vitest";
import { createToolRegistry, withBatchInput, ToolInputError, type BatchResult, type ToolRegistration } from "@jini-ai/core";
import { createSurfaceExchangeStore } from "../../surface-exchanges.js";
import { createTimeoutScheduler } from "../../scheduler.js";
import { createAssistantToolExecutor, issueCredentialSetup, type ToolFailureRecord, type RedactedToolFailuresDeps } from "../index.js";

const call = { principal: { id: "operator" }, run: { id: "run-1" }, toolId: "deploy", input: {} };
const readOnlyMessages = { unverifiableMessage: "cannot verify", toolRefusalMessage: () => "write refused", unknownToolMessage: () => "unknown tool" };

function assemble({ audit, guided, toolFailures, output }: { audit?: { appended: unknown[]; sinkErrors?: unknown[] }; guided?: string[]; toolFailures?: Partial<RedactedToolFailuresDeps>; output?: { outputValidation: "enforce" | "log"; outputLogger: { warn: (...args: unknown[]) => void } } } = {}) {
  const registry = createToolRegistry({});
  const failing: ToolRegistration = {
    descriptor: { id: "deploy", metadata: { guidanceCapabilities: ["deploy-checklist"] } },
    handler: async () => { throw new Error("upstream 500"); },
    policy: { authorize: () => "allow" },
  };
  registry.register(failing);
  const failures: ToolFailureRecord[] = [];
  let ids = 0;
  const executor = createAssistantToolExecutor({
    registry,
    surfaceExchanges: createSurfaceExchangeStore({ scheduler: createTimeoutScheduler({}, {}), clock: { nowMs: () => Date.now() },
      idGenerator: { newId: () => "exchange" }, defaultChannel: "mcp-ui" }),
    newExecutionId: () => `exec-${++ids}`,
    recoveryToolId: "host-recovery",
    containsSecret: () => false,
    assertCredentialFreeField: () => {},
    readOnlyMessages,
    formatReadOnlyRemedyRefusal: ({ refusal }) => refusal,
    buildRecoveryForm: () => ({}),
    toolFailures: { mintErrorId: () => "ERR-AAAA-BBBB-CCCC-DDDD", redactSecretShapes: ({ text }) => ({ text, redactions: 0 }), onFailure: (record) => { failures.push(record); }, ...toolFailures },
    ...(output ?? {}),
    ...(guided ? { prepareGuidance: async ({ tool }: { tool: { id: string } }) => { guided.push(tool.id); return ""; } } : {}),
    ...(audit ? { toolAttemptAudit: {
      sink: { append: async (event: unknown) => { audit.appended.push(event); } },
      workspaceId: "ws-1", now: () => "2026-10-21T00:00:00Z", newAttemptId: () => "attempt-1",
      ...(audit.sinkErrors ? { onSinkError: (error: unknown) => { audit.sinkErrors!.push(error); } } : {}),
    } } : {}),
  });
  return { executor, failures, registry };
}

test("a failing registered tool comes back redacted with an error id, and the host sink gets the real record", async () => {
  const { executor, failures } = assemble();
  const result = await executor.execute(call);
  expect(result.status).toBe("failed");
  expect(result.error).toBe("Error ERR-AAAA-BBBB-CCCC-DDDD: upstream 500");
  expect(failures).toMatchObject([{ errorId: "ERR-AAAA-BBBB-CCCC-DDDD", toolId: "deploy", runId: "run-1", principalId: "operator" }]);
  expect(failures).toHaveLength(1);
  expect(executor.getAuditRecord({ executionId: result.executionId })?.events.at(-1))
    .toMatchObject({ phase: "failed", detail: "upstream 500" });
});

/** Registers a tool that declares `{ count: number }` but returns `count` as a string. */
function registerWrongShape({ registry }: { registry: ReturnType<typeof createToolRegistry> }) {
  registry.register({ descriptor: { id: "count", outputSchema: { type: "object", properties: { count: { type: "number" } } } },
    handler: async () => ({ count: "three" }), policy: { authorize: () => "allow" } });
}

test("a wrong-shaped tool output fails through the assembled stack in plain words with an error id", async () => {
  const { executor, registry } = assemble({ output: { outputValidation: "enforce", outputLogger: { warn: vi.fn() } } });
  registerWrongShape({ registry });
  const result = await executor.execute({ ...call, toolId: "count" });
  expect(result).toMatchObject({ status: "failed", error: "Error ERR-AAAA-BBBB-CCCC-DDDD: The tool count returned data in the wrong shape: count should be a number, but it was a string." });
});

test("the host's 'log' choice reaches the executor: the output passes and its logger gets the mismatch", async () => {
  const warn = vi.fn();
  const { executor, registry } = assemble({ output: { outputValidation: "log", outputLogger: { warn } } });
  registerWrongShape({ registry });
  const result = await executor.execute({ ...call, toolId: "count" });
  expect(result).toMatchObject({ status: "completed", output: { count: "three" } });
  expect(warn).toHaveBeenCalledTimes(1);
});

test("batch internal failures get the host's secret-only redaction and one error id, just like single calls", async () => {
  const secret = ["sk", "live", "batch-fixture-value"].join("_");
  let minted = 0;
  const mintErrorId = vi.fn(() => `ERR-000${++minted}-0000-0000-0000`);
  const { executor, failures, registry } = assemble({ toolFailures: {
    mintErrorId,
    redactSecretShapes: ({ text }) => {
      const parts = text.split(secret);
      return { text: parts.join("[REDACTED]"), redactions: parts.length - 1 };
    },
  } });
  const executionIds: string[] = [];
  registry.register(withBatchInput({ registration: {
    descriptor: { id: "batch", inputSchema: { type: "object", properties: { action: { type: "string" } } } },
    policy: { authorize: () => "allow" },
    handler: async ({ input, executionId }) => {
      executionIds.push(executionId);
      const { action } = input as { action: string };
      if (action === "internal") throw new Error(`upstream rejected credential ${secret}`);
      if (action === "validation") throw new ToolInputError({ message: "name is required" });
      return { saved: true };
    },
  }, tool: { toolId: "batch" } }));
  const result = await executor.execute({ ...call, toolId: "batch", input: {
    items: [{ action: "internal" }, { action: "ok" }, { action: "validation" }],
  } });
  expect(result.status).toBe("completed");
  const batch = result.output as BatchResult;
  expect(batch).toMatchObject({ succeeded: 1, failed: 2 });
  expect(batch.results).toEqual([
    { index: 0, ok: false, error: "Error ERR-0001-0000-0000-0000: upstream rejected credential [REDACTED]" },
    { index: 1, ok: true, result: { saved: true } },
    { index: 2, ok: false, error: "name is required" },
  ]);
  expect(JSON.stringify(batch)).not.toContain(secret);
  expect(mintErrorId).toHaveBeenCalledTimes(1);
  expect(failures).toEqual([{ errorId: "ERR-0001-0000-0000-0000", toolId: "batch", runId: call.run.id,
    principalId: call.principal.id, executionId: executionIds[0], redactions: 1, message: "upstream rejected credential [REDACTED]" }]);
  expect(executor.getAuditRecord({ executionId: executionIds[0]! })?.events.at(-1))
    .toMatchObject({ phase: "failed", detail: `upstream rejected credential ${secret}` });

  const single = await executor.execute({ ...call, toolId: "batch", input: { action: "internal" } });
  expect(single).toMatchObject({ status: "failed", errorKind: "internal",
    error: "Error ERR-0002-0000-0000-0000: upstream rejected credential [REDACTED]" });
  expect(mintErrorId).toHaveBeenCalledTimes(2);
  expect(failures).toHaveLength(2);
  expect(failures[1]?.executionId).toBe(single.executionId);
});

test("nested calls still bypass recovery even when the host stack is wired", async () => {
  const { executor, registry, failures } = assemble();
  const remedy = vi.fn(async () => ({ saved: true }));
  const diagnostic = issueCredentialSetup({ setupToolId: "remedy", prefill: {},
    containsSecret: () => false, assertCredentialFreeField: () => {} }, {});
  registry.register({ descriptor: { id: "remedy", inputSchema: { type: "object", properties: {} } },
    policy: { authorize: () => "allow" }, handler: remedy });
  registry.register({ descriptor: { id: "child" }, policy: { authorize: () => "allow" }, handler: async () => diagnostic });
  registry.register({ descriptor: { id: "parent" }, policy: { authorize: () => "allow" }, handler: async (_ctx, options) => {
    await options!.invokeTool!({ toolId: "child", input: {} });
    return { saved: true };
  } });
  const result = await executor.execute({ ...call, toolId: "parent" }, { emitSurface: async () => {} });
  expect(result).toMatchObject({ status: "completed", output: { saved: true } });
  expect(remedy).not.toHaveBeenCalled();
  expect(failures).toEqual([]);
});

test("with audit configured, each attempt is appended to the sink carrying the redacted failure's error id", async () => {
  for (const sinkErrors of [undefined, [] as unknown[]]) {
    const appended: unknown[] = [];
    const { executor } = assemble({ audit: { appended, ...(sinkErrors ? { sinkErrors } : {}) } });
    const result = await executor.execute(call);
    expect(result.error).toBe("Error ERR-AAAA-BBBB-CCCC-DDDD: upstream 500");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(appended.length).toBeGreaterThan(0);
    expect(appended).toContainEqual(expect.objectContaining({ workspaceId: "ws-1", runId: "run-1", toolId: "deploy", attemptId: "attempt-1" }));
    expect(sinkErrors ?? []).toEqual([]);
  }
});

test("a host's prepareGuidance hook is wired into the registry executor and consulted before the handler runs", async () => {
  const guided: string[] = [];
  const { executor } = assemble({ guided });
  const result = await executor.execute(call);
  expect(guided).toEqual(["deploy"]);
  expect(result.error).toBe("Error ERR-AAAA-BBBB-CCCC-DDDD: upstream 500");
});
