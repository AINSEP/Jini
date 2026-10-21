/** Call-time federated refusal diagnosis: an unknown-tool throw for a federated id becomes a nameable,
 * model-safe failure (refused, still connecting, failed to connect) instead of an opaque 500. */
import { expect, test } from "vitest";
import type { SurfaceEmitter } from "@jini-ai/core";
import type { ToolExecutionResult, ToolExecutor } from "../../tool-executor.js";
import { withFederatedRefusalDiagnosis, type FederatedRefusalDiagnosisDeps, type FederationBootStatus } from "../index.js";

const call = { principal: { id: "operator" }, run: { id: "run-1" }, toolId: "mcp__github__create_issue", input: { title: "x" } };
const unknownTool = new Error('ToolExecutor: unknown tool "mcp__github__create_issue"');

interface Harness { readonly wrapped: ToolExecutor; readonly seen: unknown[]; readonly delegated: string[] }

function harness(
  execute: ToolExecutor["execute"],
  overrides: Partial<Omit<FederatedRefusalDiagnosisDeps, "inner">> = {},
): Harness {
  const seen: unknown[] = [];
  const delegated: string[] = [];
  const inner: ToolExecutor = {
    execute: async (args, optional) => { seen.push(optional); return execute(args, optional); },
    resumeConfirmation: ({ executionId, decision }) => { delegated.push(`resume:${executionId}:${decision}`); },
    cancel: ({ executionId }) => { delegated.push(`cancel:${executionId}`); },
    getAuditRecord: ({ executionId }) => { delegated.push(`audit:${executionId}`); return null; },
  };
  const wrapped = withFederatedRefusalDiagnosis({
    inner,
    isFederatedTool: ({ toolId }) => toolId.startsWith("mcp__"),
    parseConnectionId: ({ toolId }) => toolId.split("__")[1] ?? null,
    findRefusal: () => null,
    newExecutionId: () => "exec-diag",
    redactSecretShapes: ({ text }) => ({ text: text.replace(/ghp_[A-Za-z0-9]+/g, "[REDACTED]") }),
    ...overrides,
  });
  return { wrapped, seen, delegated };
}

const throwing = (error: unknown): ToolExecutor["execute"] => async () => { throw error; };

test("a successful call passes straight through, forwarding signal/emitSurface only when supplied", async () => {
  const ok: ToolExecutionResult = { executionId: "exec-1", status: "completed", output: 1 };
  const { wrapped, seen } = harness(async () => ok);
  const signal = new AbortController().signal;
  const emitSurface: SurfaceEmitter = async () => {};

  expect(await wrapped.execute(call)).toBe(ok);
  expect(await wrapped.execute(call, { signal, emitSurface })).toBe(ok);
  expect(seen).toEqual([{}, { signal, emitSurface }]);
});

test("errors that are not an unknown-tool throw for a federated id propagate unchanged", async () => {
  const plain = new Error("database exploded");
  await expect(harness(throwing(plain)).wrapped.execute(call)).rejects.toBe(plain);
  // A non-Error throw carrying the same words is not the executor's unknown-tool error.
  await expect(harness(throwing("unknown tool")).wrapped.execute(call)).rejects.toBe("unknown tool");
  // A local (non-federated) unknown tool is a genuine routing error.
  await expect(harness(throwing(unknownTool), { isFederatedTool: () => false }).wrapped.execute(call)).rejects.toBe(unknownTool);
});

test("a tool this boot refused becomes a redacted validation failure naming the server and the reason", async () => {
  const { wrapped } = harness(throwing(unknownTool), {
    findRefusal: () => ({ remoteName: "create_issue", connectionId: "github", explanation: "token ghp_abc123 lacks scope" }),
  });

  expect(await wrapped.execute(call)).toEqual({
    executionId: "exec-diag",
    status: "failed",
    errorKind: "validation",
    error: 'tool "create_issue" on external server "github" was refused: token [REDACTED] lacks scope',
  });
});

test("with no refusal and no boot status, the unknown-tool error propagates", async () => {
  await expect(harness(throwing(unknownTool)).wrapped.execute(call)).rejects.toBe(unknownTool);
});

test("while federation is still connecting, a configured (or unlisted-config) server's tool reports still connecting", async () => {
  const connecting = (configured?: readonly string[]): FederationBootStatus => ({
    settled: false, connectFailures: [], ...(configured ? { configuredConnectionIds: configured } : {}),
  });
  const stillConnecting = { executionId: "exec-diag", status: "failed", errorKind: "validation",
    error: "External MCP server 'github' is still connecting — try again in a moment." };

  expect(await harness(throwing(unknownTool), { getBootStatus: () => connecting() }).wrapped.execute(call)).toEqual(stillConnecting);
  expect(await harness(throwing(unknownTool), { getBootStatus: () => connecting(["github"]) }).wrapped.execute(call)).toEqual(stillConnecting);
  // A connection id the operator never configured is not "still connecting": it never will.
  await expect(harness(throwing(unknownTool), { getBootStatus: () => connecting(["slack"]) }).wrapped.execute(call)).rejects.toBe(unknownTool);
  // An id the host cannot parse a connection from gets no diagnosis either.
  await expect(harness(throwing(unknownTool), { getBootStatus: () => connecting(), parseConnectionId: () => null }).wrapped.execute(call))
    .rejects.toBe(unknownTool);
});

test("after federation settled, a server that failed to connect is named with its redacted reason; any other server propagates", async () => {
  const settled: FederationBootStatus = { settled: true, connectFailures: [{ connectionId: "github", reason: "401 for ghp_secret9" }] };

  expect(await harness(throwing(unknownTool), { getBootStatus: () => settled }).wrapped.execute(call)).toEqual({
    executionId: "exec-diag", status: "failed", errorKind: "validation",
    error: "External MCP server 'github' failed to connect: 401 for [REDACTED]",
  });
  const healthy: FederationBootStatus = { settled: true, connectFailures: [{ connectionId: "slack", reason: "down" }] };
  await expect(harness(throwing(unknownTool), { getBootStatus: () => healthy }).wrapped.execute(call)).rejects.toBe(unknownTool);
});

test("resumeConfirmation, cancel and getAuditRecord delegate to the inner executor", () => {
  const { wrapped, delegated } = harness(async () => ({ executionId: "x", status: "completed" }));
  wrapped.resumeConfirmation({ executionId: "e1", decision: "confirm" });
  wrapped.cancel({ executionId: "e2" });
  expect(wrapped.getAuditRecord({ executionId: "e3" })).toBeNull();
  expect(delegated).toEqual(["resume:e1:confirm", "cancel:e2", "audit:e3"]);
});
