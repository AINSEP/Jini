import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../../../core/index.js";
import type { DurableRun, DurableRunStore, RecoveryPorts, RunProbe } from "../../../core/durable-runs/ports.js";
import { translateRunFrame } from "../../../core/run-events/entry.js";
import { notices } from "../../../core/run-events/__tests__/fixture.js";
import { createDurableRecovery } from "../recover.js";

const TIME = 1_790_000_000_000;
// Raw stdout that quotes a tool description, as the luvira incident's leaked echo tail did.
const TOOL_PROSE: AgentEvent = { kind: "raw", line: 'description":"Starts an OAuth authorization for an already-saved, OAuth-authenticated server"}]}\n' };

function harness({ events, probe }: { events: AgentEvent[]; probe: RunProbe }) {
  let current: DurableRun = {
    messageId: "answer", conversationId: "chat", runId: "old", workspaceId: "ws", principalId: "admin", engine: "daemon",
    request: { agentId: "claude", contextRef: JSON.stringify({ prompt: "Import my site", conversationId: "chat" }) },
    message: { id: "answer", role: "assistant", runId: "old", runStatus: "running", content: "", events },
    transcript: [{ id: "question", role: "user", content: "Import my site" }],
    recoveryCount: 0, recoveryDeadline: null, attemptStartedAt: TIME, lastProgressAt: TIME,
    cancelReason: null, sessionId: null, sessionConfirmed: false, child: null, attemptBase: [],
  };
  const settlements: Parameters<RecoveryPorts["settle"]>[0][] = [];
  const attached: string[] = [];
  const canceled: string[] = [];
  const launches: Parameters<RecoveryPorts["launch"]>[0][] = [];
  const store = {
    async load() { return current; },
    async advance(input: Parameters<DurableRunStore["advance"]>[0]) {
      current = { ...current, runId: input.nextRunId, recoveryCount: current.recoveryCount + 1,
        attemptBase: input.events, message: { ...current.message, runId: input.nextRunId, events: [...input.events] } };
      return true;
    },
    async recoveryClock() {},
  } as unknown as DurableRunStore;
  const ports: RecoveryPorts = {
    store, now: () => TIME + 20_000, mintRunId: () => "next",
    probe: async () => probe, attach: (run) => { attached.push(run.runId); },
    launch: async (input) => { launches.push(input); }, cancelAttempt: async (run) => { canceled.push(run.runId); },
    verifyChildDead: async () => false, supportsNativeResume: () => true,
    async settle(value) { settlements.push(value); current = { ...current, message: { ...current.message, runStatus: value.status } }; return true; },
  };
  const info: unknown[][] = [];
  const logger = { info: (...args: unknown[]) => { info.push(args); } };
  return { recovery: createDurableRecovery(ports, { logger }), settlements, attached, canceled, launches, info };
}

describe("durable recovery: one metadata-only info line per decision", () => {
  it("logs the decision and failure class once, without answer text or diagnostics", async () => {
    const h = harness({ events: [{ kind: "text", text: "private answer" }, { kind: "status", label: "context_length_exceeded", detail: "private detail" }], probe: "dead" });

    expect(await h.recovery.recover({ messageId: "answer", trigger: "boot" }, {})).toBe("finalized");
    expect(h.info).toEqual([["[durable-recovery] " + JSON.stringify({ runId: "old", trigger: "boot", probe: "dead", decision: "finalized", failureClass: "permanent" })]]);
  });

  it("does not log the watcher's routine re-confirmation of its own live run", async () => {
    const h = harness({ events: [], probe: "dead" });

    expect(await h.recovery.recover({ messageId: "answer", trigger: "timeout" }, { liveRunId: "old" })).toBe("reattached");
    expect(h.info).toEqual([]);
  });
});

describe("durable recovery: diagnostics never end a live attempt", () => {
  it("reattaches a live attempt whose raw output quotes auth words instead of canceling it as Not logged in", async () => {
    const h = harness({ events: [TOOL_PROSE], probe: "live" });
    expect(await h.recovery.recover({ messageId: "answer", trigger: "browser" }, {})).toBe("reattached");
    expect(h.attached).toEqual(["old"]);
    expect(h.canceled).toEqual([]);
    expect(h.settlements).toEqual([]);
  });

  it("keeps a quiet live watch (fresh liveRunId proof) instead of finalizing it", async () => {
    const h = harness({ events: [TOOL_PROSE], probe: "dead" });
    expect(await h.recovery.recover({ messageId: "answer", trigger: "timeout", expectedRunId: "old" }, { liveRunId: "old" })).toBe("reattached");
    expect(h.settlements).toEqual([]);
  });

  it("still finalizes a dead attempt that genuinely failed to authenticate", async () => {
    const h = harness({ events: [{ kind: "status", label: "Not logged in · Please run /login" }], probe: "dead" });
    expect(await h.recovery.recover({ messageId: "answer", trigger: "attempt-failed" }, {})).toBe("finalized");
    expect(h.settlements[0]!.status).toBe("canceled");
    expect(h.settlements[0]!.events.at(-1)).toEqual({ kind: "status", label: "Not logged in. Saved work is above." });
  });
});

describe("durable recovery: successful CLI summaries are not failure diagnostics", () => {
  it.each([
    { type: "result", is_error: false, modelUsage: { x: { contextWindow: 1000000 } } },
    { type: "result", is_error: false, result: "Reviewed forbidden responses" },
    { type: "result", is_error: false, result: "Updated billing documentation" },
    // This line remains diagnostic input, independently guarding the required separator.
    { type: "result", is_error: true, modelUsage: { x: { contextWindow: 1000000 } } },
  ])("continues after an interrupted attempt containing %j", async (summary) => {
    const h = harness({ events: [
      { kind: "raw", line: JSON.stringify(summary) },
      { kind: "status", label: "Run failed", detail: "exit code 1, signal none, resumable no" },
    ], probe: "dead" });

    expect(await h.recovery.recover({ messageId: "answer", trigger: "attempt-failed" }, {})).toBe("continued");
    expect(h.launches).toHaveLength(1);
    expect(h.launches[0]!.run.runId).toBe("next");
    expect(h.attached).toEqual(["next"]);
    expect(h.settlements).toEqual([]);
  });

  it.each([
    { kind: "raw", line: "context_length_exceeded" },
    { kind: "raw", line: "context window exceeded" },
    { kind: "raw", line: JSON.stringify({ type: "result", is_error: true, error: "context_length_exceeded" }) },
    { kind: "raw", line: JSON.stringify({ type: "result", is_error: true, error: "context window exceeded" }) },
  ] as const)("preserves a real permanent failure after a successful CLI turn: %j", async (failure) => {
    const h = harness({ events: [
      { kind: "raw", line: JSON.stringify({ type: "result", is_error: false, result: "Completed earlier work" }) },
      failure,
    ], probe: "dead" });

    expect(await h.recovery.recover({ messageId: "answer", trigger: "attempt-failed" }, {})).toBe("finalized");
    expect(h.launches).toEqual([]);
    expect(h.settlements).toHaveLength(1);
    expect(h.settlements[0]!.status).toBe("failed");
    expect(h.settlements[0]!.events.at(-1)).toEqual({ kind: "status", label: "The assistant could not continue this answer. Saved work is above." });
  });
});

describe("durable recovery: bridge failure is permanent", () => {
  it.each(["Error: bridge entry point missing", "Error: not logged in"])("finalizes MCP_BRIDGE_UNAVAILABLE once with its own message (%s)", async (reason) => {
    const message = `The assistant's tools did not load (MCP bridge "jini" status: failed). The run was stopped instead of continuing without them. Bridge exited with code 1: ${reason}`;
    const failure = translateRunFrame({ kind: "error", notices, raw: JSON.stringify({ payload: {
      message, error: { code: "MCP_BRIDGE_UNAVAILABLE", message },
    } }) });
    const h = harness({ events: [
      { kind: "status", label: "Agent started" }, ...failure.events,
      { kind: "status", label: "Run failed", detail: "exit code 1, signal none, resumable no" },
    ], probe: "dead" });

    expect(await h.recovery.recover({ messageId: "answer", trigger: "attempt-failed" }, {})).toBe("finalized");
    expect(h.launches).toEqual([]);
    expect(h.settlements).toHaveLength(1);
    expect(h.settlements[0]!.status).toBe("failed");
    expect(h.settlements[0]!.events.at(-1)).toEqual({ kind: "status", label: message });
    expect(await h.recovery.recover({ messageId: "answer", trigger: "browser" }, {})).toBe("terminal");
    expect(h.settlements).toHaveLength(1);
  });

  it("still retries an HTTP 429 rate-throttled attempt", async () => {
    const h = harness({ events: [{ kind: "status", label: "HTTP 429: rate limit exceeded" }], probe: "dead" });
    expect(await h.recovery.recover({ messageId: "answer", trigger: "attempt-failed" }, {})).toBe("continued");
    expect(h.launches).toHaveLength(1);
    expect(h.launches[0]!.run.runId).toBe("next");
    expect(h.launches[0]!.run.recoveryCount).toBe(1);
    expect(h.attached).toEqual(["next"]);
    expect(h.settlements).toEqual([]);
  });
});
