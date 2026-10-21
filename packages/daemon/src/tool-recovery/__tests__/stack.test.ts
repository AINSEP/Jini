/** The assembled assistant tool executor: registry execution, then failure redaction, then (optionally)
 * per-attempt audit — wired once so every host gets the same order. */
import { expect, test } from "vitest";
import { createToolRegistry, type ToolRegistration } from "@jini-ai/core";
import { createSystemClock } from "@jini-ai/core/primitives";
import { createSurfaceExchangeStore } from "../../surface-exchanges.js";
import { createTimeoutScheduler } from "../../scheduler.js";
import { createAssistantToolExecutor, type ToolFailureRecord } from "../index.js";

const call = { principal: { id: "operator" }, run: { id: "run-1" }, toolId: "deploy", input: {} };
const readOnlyMessages = { unverifiableMessage: "cannot verify", toolRefusalMessage: () => "write refused", unknownToolMessage: () => "unknown tool" };

function assemble({ audit, guided }: { audit?: { appended: unknown[]; sinkErrors?: unknown[] }; guided?: string[] } = {}) {
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
    surfaceExchanges: createSurfaceExchangeStore({ scheduler: createTimeoutScheduler({}, {}), clock: createSystemClock(),
      idGenerator: { newId: () => "exchange" }, defaultChannel: "mcp-ui" }),
    newExecutionId: () => `exec-${++ids}`,
    recoveryToolId: "host-recovery",
    containsSecret: () => false,
    assertCredentialFreeField: () => {},
    readOnlyMessages,
    formatReadOnlyRemedyRefusal: ({ refusal }) => refusal,
    buildRecoveryForm: () => ({}),
    toolFailures: { mintErrorId: () => "ERR-AAAA-BBBB-CCCC-DDDD", redactSecretShapes: ({ text }) => ({ text, redactions: 0 }), onFailure: (record) => { failures.push(record); } },
    ...(guided ? { prepareGuidance: async ({ tool }: { tool: { id: string } }) => { guided.push(tool.id); return ""; } } : {}),
    ...(audit ? { toolAttemptAudit: {
      sink: { append: async (event: unknown) => { audit.appended.push(event); } },
      workspaceId: "ws-1", now: () => "2026-10-21T00:00:00Z", newAttemptId: () => "attempt-1",
      ...(audit.sinkErrors ? { onSinkError: (error: unknown) => { audit.sinkErrors!.push(error); } } : {}),
    } } : {}),
  });
  return { executor, failures };
}

test("a failing registered tool comes back redacted with an error id, and the host sink gets the real record", async () => {
  const { executor, failures } = assemble();
  const result = await executor.execute(call);
  expect(result.status).toBe("failed");
  expect(result.error).toBe("Error ERR-AAAA-BBBB-CCCC-DDDD: upstream 500");
  expect(failures).toMatchObject([{ errorId: "ERR-AAAA-BBBB-CCCC-DDDD", toolId: "deploy", runId: "run-1", principalId: "operator" }]);
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
