import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../../../core/index.js";
import type { DurableRun, DurableRunStore, RecoveryPorts, RunProbe } from "../../../core/durable-runs/ports.js";
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
  const store = {
    async load() { return current; },
    async advance() { return false; },
    async recoveryClock() {},
  } as unknown as DurableRunStore;
  const ports: RecoveryPorts = {
    store, now: () => TIME + 20_000, mintRunId: () => "next",
    probe: async () => probe, attach: (run) => { attached.push(run.runId); },
    launch: async () => {}, cancelAttempt: async (run) => { canceled.push(run.runId); },
    verifyChildDead: async () => false, supportsNativeResume: () => true,
    async settle(value) { settlements.push(value); current = { ...current, message: { ...current.message, runStatus: value.status } }; return true; },
  };
  return { recovery: createDurableRecovery(ports, {}), settlements, attached, canceled };
}

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
