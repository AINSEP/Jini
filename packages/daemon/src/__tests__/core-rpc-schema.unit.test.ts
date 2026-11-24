import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { DaemonCoreRequest, DaemonToolConsentSnapshot } from "@jini-ai/core/contracts/site/daemon-core-rpc";
import { createDaemonCoreRequestSchema, daemonToolConsentSnapshot, type DaemonCoreParser } from "../core-rpc-schema.js";

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

describe("public parser type", () => {
  it("is the structural DaemonCoreParser, not a schema-library type", () => {
    expectTypeOf(schema).toEqualTypeOf<DaemonCoreParser<DaemonCoreRequest<"a.one" | "a.two">>>();
    expectTypeOf(daemonToolConsentSnapshot).toEqualTypeOf<DaemonCoreParser<DaemonToolConsentSnapshot>>();
  });

  it("never mentions zod in any exported signature", () => {
    const src = readFileSync(new URL("../core-rpc-schema.ts", import.meta.url), "utf8");
    const exported = src.split("\n").filter(line => /^export /.test(line) || /^ {2}[a-z]+\(.*\): /.test(line)).map(line => line.split(" = z.")[0]).join("\n");
    expect(exported).not.toMatch(/\bz\.|zod/i);
  });

  it("keeps the throwing parse and a verdict with issues", () => {
    expect(() => schema.parse({ operation: "find", input: { runId: "r1", extra: 1 } })).toThrow();
    const verdict = daemonToolConsentSnapshot.safeParse({ permissions: { enabled: true, capabilities: {} }, revisionSeq: -1, allowed: true });
    expect(verdict.success).toBe(false);
    if (!verdict.success) expect(verdict.error.issues[0]?.path).toEqual(["revisionSeq"]);
  });
});
