import { describe, expect, it } from "vitest";
import { createDaemonCoreRequestSchema, daemonToolConsentSnapshot } from "../core-rpc-schema.js";

const schema = createDaemonCoreRequestSchema({ cliConsentKeys: ["enabled", "shell", "web"], settingsNamespaces: ["a.one", "a.two"] });
const allowInput = { runId: "r1", agentId: "agent", keys: ["web"], expectedRevisionSeq: 4 };

describe("createDaemonCoreRequestSchema", () => {
  it("accepts a run-bound consent target and only the injected, bounded keys", () => {
    expect(schema.safeParse({ operation: "cliConsentSnapshot", input: { runId: "r1", agentId: "agent" } }).success).toBe(true);
    expect(schema.safeParse({ operation: "cliConsentAllow", input: allowInput }).success).toBe(true);
    for (const field of ["principalId", "workspaceId", "site", "permissions"]) {
      expect(schema.safeParse({ operation: "cliConsentAllow", input: { ...allowInput, [field]: "caller-controlled" } }).success).toBe(false);
    }
    for (const keys of [["unknown"], [], ["shell", "shell", "shell", "shell"]]) {
      expect(schema.safeParse({ operation: "cliConsentAllow", input: { ...allowInput, keys } }).success).toBe(false);
    }
    expect(schema.safeParse({ operation: "cliConsentAllow", input: { ...allowInput, keys: ["enabled", "shell", "web"] } }).success).toBe(true);
  });

  it("restricts getEffective to the injected settings namespaces", () => {
    const read = (namespace: string) => schema.safeParse({ operation: "getEffective", input: { namespace, key: "k", scopeContext: { workspaceId: "w" } } }).success;
    expect(read("a.two")).toBe(true);
    expect(read("core.interface")).toBe(false);
  });

  it("validates attempt and telemetry operations strictly", () => {
    expect(schema.safeParse({ operation: "captureSession", input: { runId: "r1", sessionId: "s", child: { pid: 7, startedAt: "t" } } }).success).toBe(true);
    expect(schema.safeParse({ operation: "captureSession", input: { runId: "r1", sessionId: "s", child: { pid: 0, startedAt: "t" } } }).success).toBe(false);
    expect(schema.safeParse({ operation: "find", input: { runId: "r1", extra: 1 } }).success).toBe(false);
    expect(schema.safeParse({ operation: "guardTool", input: { runId: "r1", toolId: "t", input: { any: "thing" } } }).success).toBe(true);
    expect(schema.safeParse({ operation: "telemetryError", input: { name: "n", message: "m", operation: "o", level: "fatal" } }).success).toBe(false);
    expect(schema.safeParse({ operation: "telemetryFlush", input: {} }).success).toBe(true);
    expect(schema.safeParse({ operation: "telemetryTrace", input: { kind: "run_finished", traceId: "t", at: 1, outcome: "succeeded", error: null,
      totals: { turns: 1, toolCalls: 0, toolErrors: 0, inputTokens: null, outputTokens: null, costUsd: null } } }).success).toBe(true);
    expect(schema.safeParse({ operation: "telemetryTrace", input: { kind: "run_finished", traceId: "t", at: 1, outcome: "exploded", error: null, totals: {} } }).success).toBe(false);
  });
});

describe("daemonToolConsentSnapshot", () => {
  it("is strict: no extra fields, revisionSeq a non-negative integer", () => {
    const ok = { permissions: { enabled: true, capabilities: { web: false } }, revisionSeq: 4, allowed: true };
    expect(daemonToolConsentSnapshot.safeParse(ok).success).toBe(true);
    expect(daemonToolConsentSnapshot.safeParse({ ...ok, extra: 1 }).success).toBe(false);
    expect(daemonToolConsentSnapshot.safeParse({ ...ok, revisionSeq: -1 }).success).toBe(false);
  });
});
