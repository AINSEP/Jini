import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../../../core/index.js";
import type { DurableRun, DurableRunStore, RecoveryPorts, RecoveryTrigger, RunProbe } from "../../../core/durable-runs/ports.js";
import { unusedStoreMethods } from "./store-fake.js";
import { AWAITING_ANSWER_NOTICE, createDurableRecovery, EXHAUSTED_NOTICE, RUN_STALENESS_MS } from "../recover.js";

const TIME = 1_790_000_000_000;
const STOPPED = "Stopped. Saved work is above.";

interface HarnessOptions {
  readonly events?: AgentEvent[];
  readonly probe?: RunProbe;
  readonly run?: Partial<DurableRun>;
  readonly now?: number;
  readonly advance?: boolean;
  /** Replaces what `load` returns after the first (pre-decision) read. */
  readonly reload?: (current: DurableRun) => DurableRun | null;
  readonly ports?: Partial<RecoveryPorts>;
}

function harness({ events = [], probe = "dead", run = {}, now = TIME + 20_000, advance = true, reload, ports: overrides = {} }: HarnessOptions) {
  let current: DurableRun | null = {
    messageId: "answer", conversationId: "chat", runId: "old", workspaceId: "ws", principalId: "admin", engine: "daemon",
    request: { agentId: "claude", contextRef: JSON.stringify({ prompt: "Import my site", conversationId: "chat" }) },
    message: { id: "answer", role: "assistant", runId: "old", runStatus: "running", content: "", events },
    transcript: [{ id: "question", role: "user", content: "Import my site" }],
    recoveryCount: 0, recoveryDeadline: null, attemptStartedAt: TIME, lastProgressAt: TIME,
    cancelReason: null, sessionId: null, sessionConfirmed: false, child: null, attemptBase: [],
    ...run,
  };
  let loads = 0;
  const clocks: Parameters<DurableRunStore["recoveryClock"]>[0][] = [];
  const advances: Parameters<DurableRunStore["advance"]>[0][] = [];
  const store: DurableRunStore = {
    async load() {
      loads += 1;
      if (loads > 1 && reload && current) current = reload(current);
      return current;
    },
    async advance(input) {
      advances.push(input);
      if (!advance || !current) return false;
      current = { ...current, runId: input.nextRunId, recoveryCount: current.recoveryCount + 1,
        attemptBase: input.events, message: { ...current.message, runId: input.nextRunId, events: [...input.events] } };
      return true;
    },
    async recoveryClock(input) { clocks.push(input); },
    ...unusedStoreMethods,
  };
  const settlements: Parameters<RecoveryPorts["settle"]>[0][] = [];
  const attached: string[] = [];
  const launches: Parameters<RecoveryPorts["launch"]>[0][] = [];
  const nativeQueries: string[] = [];
  const ports: RecoveryPorts = {
    store, now: () => now, mintRunId: () => "next",
    probe: async () => probe, attach: (value) => { attached.push(value.runId); },
    launch: async (input) => { launches.push(input); }, cancelAttempt: async () => {},
    verifyChildDead: async () => true,
    supportsNativeResume: ({ agentId }) => { nativeQueries.push(agentId); return true; },
    async settle(value) { settlements.push(value); return true; },
    ...overrides,
  };
  const info: unknown[][] = [];
  const recovery = createDurableRecovery(ports, { logger: { info: (...args: unknown[]) => { info.push(args); } } });
  const recover = (trigger: RecoveryTrigger = "boot", options: { liveRunId?: string; expectedRunId?: string } = {}) =>
    recovery.recover({ messageId: "answer", trigger, ...(options.expectedRunId ? { expectedRunId: options.expectedRunId } : {}) },
      options.liveRunId ? { liveRunId: options.liveRunId } : {});
  return { recover, settlements, attached, launches, clocks, advances, nativeQueries, info, ports, current: () => current, replace: (run: DurableRun) => { current = run; } };
}

const NATIVE_RUN: Partial<DurableRun> = { sessionConfirmed: true, sessionId: "session-1", child: { pid: 10, startedAt: "start" } };
const recoveryMode = (launch: Parameters<RecoveryPorts["launch"]>[0]) => JSON.parse(launch.request.contextRef).recoveryMode;

describe("durable recovery boundaries: before any decision", () => {
  it("returns gone when the message has no durable run", async () => {
    const settlements: unknown[] = [];
    const recovery = createDurableRecovery({
      store: storeReturning(null), now: () => TIME, mintRunId: () => "next", probe: async () => "dead", attach: () => {},
      launch: async () => {}, cancelAttempt: async () => {}, verifyChildDead: async () => true, supportsNativeResume: () => true, settle: async (value) => { settlements.push(value); return true; },
    }, { logger: { info: () => {} } });
    expect(await recovery.recover({ messageId: "answer", trigger: "boot" }, {})).toBe("gone");
    expect(settlements).toEqual([]);
  });

  it.each(["succeeded", "failed", "canceled"] as const)("returns terminal for a %s message without logging", async (runStatus) => {
    const h = harness({ run: { message: { id: "answer", role: "assistant", runId: "old", runStatus, content: "" } } });
    expect(await h.recover()).toBe("terminal");
    expect(h.info).toEqual([]);
  });

  it("returns superseded when the caller expected an older generation", async () => {
    const h = harness({});
    expect(await h.recover("boot", { expectedRunId: "older" })).toBe("superseded");
    expect(h.info).toEqual([]);
  });

  it("treats a queued message as recoverable", async () => {
    const h = harness({ run: { message: { id: "answer", role: "assistant", runId: "old", runStatus: "queued", content: "" } } });
    expect(await h.recover("attempt-failed")).toBe("continued");
  });
});

function storeReturning(run: DurableRun | null): DurableRunStore {
  return {
    load: async () => run, advance: async () => false, recoveryClock: async () => {},
    ...unusedStoreMethods,
  };
}

describe("durable recovery boundaries: excluded runs", () => {
  it.each([
    { name: "a canceled run", run: { cancelReason: "user" } },
    { name: "a run without a principal", run: { principalId: null } },
    { name: "a non-daemon run", run: { engine: "browser" } },
  ])("finalizes $name as canceled without probing", async ({ run }) => {
    let probed = 0;
    const h = harness({ run, ports: { probe: async () => { probed += 1; return "live"; } } });
    expect(await h.recover()).toBe("finalized");
    expect(probed).toBe(0);
    expect(h.settlements[0]!.status).toBe("canceled");
    expect(h.settlements[0]!.events.at(-1)).toEqual({ kind: "status", label: STOPPED });
    expect(h.info).toEqual([["[durable-recovery] " + JSON.stringify({ runId: "old", trigger: "boot", decision: "finalized" })]]);
  });

  it("still settles when canceling the old attempt rejects", async () => {
    const h = harness({ run: { cancelReason: "user" }, ports: { cancelAttempt: async () => { throw new Error("daemon unreachable"); } } });
    expect(await h.recover()).toBe("finalized");
    expect(h.settlements).toHaveLength(1);
  });

  it("stamps the settlement with the port clock and the saved content", async () => {
    const h = harness({ run: { cancelReason: "user", message: { id: "answer", role: "assistant", runId: "old", runStatus: "running", content: "Saved" } } });
    await h.recover();
    expect(h.settlements[0]!.endedAt).toBe(TIME + 20_000);
    expect(h.settlements[0]!.content).toBe("Saved");
    expect(h.settlements[0]!.events).toEqual([{ kind: "status", label: STOPPED }]);
  });
});

describe("durable recovery boundaries: liveness", () => {
  it("reattaches a probed live run and stops its recovery clock", async () => {
    const h = harness({ probe: "live" });
    expect(await h.recover("browser")).toBe("reattached");
    expect(h.clocks).toEqual([{ runId: "old", now: TIME + 20_000, active: false }]);
    expect(h.attached).toEqual(["old"]);
  });

  it("does not trust a live probe on attempt-failed: the attempt is dead", async () => {
    const h = harness({ probe: "live" });
    expect(await h.recover("attempt-failed")).toBe("continued");
  });

  it("keeps waiting on an uncertain probe without spending recovery budget", async () => {
    const h = harness({ probe: "uncertain" });
    expect(await h.recover("timeout")).toBe("waiting");
    expect(h.clocks).toEqual([{ runId: "old", now: TIME + 20_000, active: false }]);
    expect(h.attached).toEqual(["old"]);
    expect(h.launches).toEqual([]);
    expect(h.info).toEqual([["[durable-recovery] " + JSON.stringify({ runId: "old", trigger: "timeout", probe: "uncertain", decision: "waiting" })]]);
  });

  it("gives a freshly started dead attempt 10 s before continuing it", async () => {
    const h = harness({ probe: "dead", now: TIME + 9_999 });
    expect(await h.recover("boot")).toBe("waiting");
    expect(h.launches).toEqual([]);
  });

  it("continues a dead attempt exactly 10 s after it started", async () => {
    const h = harness({ probe: "dead", now: TIME + 10_000 });
    expect(await h.recover("boot")).toBe("continued");
  });

  it("continues a just-started attempt that reported its own failure", async () => {
    const h = harness({ probe: "dead", now: TIME + 1 });
    expect(await h.recover("attempt-failed")).toBe("continued");
  });
});

describe("durable recovery boundaries: generation fencing", () => {
  it("returns superseded when another caller advanced the run while probing", async () => {
    const h = harness({ reload: (run) => ({ ...run, runId: "newer" }) });
    expect(await h.recover("attempt-failed")).toBe("superseded");
    expect(h.advances).toEqual([]);
  });

  it("returns gone when the probe reload finds nothing", async () => {
    let loads = 0;
    const attached: string[] = [];
    const recovery = createDurableRecovery({
      store: {
        ...storeReturning(null),
        load: async () => { loads += 1; return loads === 1 ? runFixture() : null; },
      },
      now: () => TIME + 20_000, mintRunId: () => "next", probe: async () => "uncertain", attach: (run) => { attached.push(run.runId); },
      launch: async () => {}, cancelAttempt: async () => {}, verifyChildDead: async () => true, supportsNativeResume: () => true, settle: async () => true,
    }, { logger: { info: () => {} } });
    expect(await recovery.recover({ messageId: "answer", trigger: "timeout" }, {})).toBe("gone");
    expect(attached).toEqual([]);
  });

  it("returns superseded when the advance CAS loses", async () => {
    const h = harness({ advance: false });
    expect(await h.recover("attempt-failed")).toBe("superseded");
    expect(h.launches).toEqual([]);
  });

  it("returns superseded when the run disappears after the advance", async () => {
    let loads = 0;
    const h = harness({ reload: (run) => { loads += 1; return loads >= 3 ? null : run; } });
    expect(await h.recover("attempt-failed")).toBe("superseded");
    expect(h.launches).toEqual([]);
  });

  it("returns superseded when a newer generation than the minted one is stored", async () => {
    let loads = 0;
    const h = harness({ reload: (run) => { loads += 1; return loads >= 3 ? { ...run, runId: "other" } : run; } });
    expect(await h.recover("attempt-failed")).toBe("superseded");
    expect(h.launches).toEqual([]);
  });

  it("finalizes the new generation as canceled when a cancel won the fence", async () => {
    let loads = 0;
    const h = harness({ reload: (run) => { loads += 1; return loads >= 3 ? { ...run, cancelReason: "user" } : run; } });
    expect(await h.recover("attempt-failed")).toBe("finalized");
    expect(h.launches).toEqual([]);
    expect(h.settlements[0]!.runId).toBe("next");
    expect(h.settlements[0]!.status).toBe("canceled");
  });
});

function runFixture(): DurableRun {
  return {
    messageId: "answer", conversationId: "chat", runId: "old", workspaceId: "ws", principalId: "admin", engine: "daemon",
    request: { agentId: "claude", contextRef: JSON.stringify({ prompt: "Import my site", conversationId: "chat" }) },
    message: { id: "answer", role: "assistant", runId: "old", runStatus: "running", content: "", events: [] },
    transcript: [], recoveryCount: 0, recoveryDeadline: null, attemptStartedAt: TIME, lastProgressAt: TIME,
    cancelReason: null, sessionId: null, sessionConfirmed: false, child: null, attemptBase: [],
  };
}

describe("durable recovery boundaries: continuation launch", () => {
  it("still attaches the new attempt when its launch rejects, without stopping the clock", async () => {
    const h = harness({ ports: { launch: async () => { throw new Error("lost start response"); } } });
    expect(await h.recover("attempt-failed")).toBe("continued");
    expect(h.attached).toEqual(["next"]);
    expect(h.clocks).toEqual([{ runId: "old", now: TIME + 20_000, active: true }]);
  });

  it("stops the recovery clock of the launched generation", async () => {
    const h = harness({});
    await h.recover("attempt-failed");
    expect(h.clocks.at(-1)).toEqual({ runId: "next", now: TIME + 20_000, active: false });
  });

  it("seeds saved content as text when the saved events hold no text", async () => {
    const h = harness({ run: { message: { id: "answer", role: "assistant", runId: "old", runStatus: "running", content: "Partial", events: [] } } });
    await h.recover("attempt-failed");
    expect(h.advances[0]!.events[0]).toEqual({ kind: "text", text: "Partial" });
  });

  it("does not duplicate content already saved as a text event", async () => {
    const h = harness({ run: { message: { id: "answer", role: "assistant", runId: "old", runStatus: "running", content: "Partial", events: [{ kind: "text", text: "Partial" }] } } });
    await h.recover("attempt-failed");
    expect(h.advances[0]!.events.filter((event) => event.kind === "text" && event.text === "Partial")).toHaveLength(1);
  });

  it("resumes natively when the session is confirmed, supported and its child is dead", async () => {
    const h = harness({ run: NATIVE_RUN });
    await h.recover("attempt-failed");
    expect(recoveryMode(h.launches[0]!)).toBe("native");
  });

  it("asks native-resume support for the claude agent when the request names none", async () => {
    const h = harness({ run: { ...NATIVE_RUN, request: { contextRef: JSON.stringify({ prompt: "Go" }) } } });
    await h.recover("attempt-failed");
    expect(h.nativeQueries).toEqual(["claude"]);
  });

  it.each([
    { name: "an unconfirmed session", run: { ...NATIVE_RUN, sessionConfirmed: false } },
    { name: "a missing session id", run: { ...NATIVE_RUN, sessionId: null } },
    { name: "a missing child", run: { ...NATIVE_RUN, child: null } },
  ])("reconstructs for $name", async ({ run }) => {
    const h = harness({ run });
    await h.recover("attempt-failed");
    expect(recoveryMode(h.launches[0]!)).toBe("reconstruction");
    expect(h.nativeQueries).toEqual([]);
  });

  it("reconstructs when the agent does not support native resume", async () => {
    const h = harness({ run: NATIVE_RUN, ports: { supportsNativeResume: () => false } });
    await h.recover("attempt-failed");
    expect(recoveryMode(h.launches[0]!)).toBe("reconstruction");
  });

  it("reconstructs when the child may still be alive", async () => {
    const h = harness({ run: NATIVE_RUN, ports: { verifyChildDead: async () => false } });
    await h.recover("attempt-failed");
    expect(recoveryMode(h.launches[0]!)).toBe("reconstruction");
  });

  it("reconstructs when verifying the child's death rejects", async () => {
    const h = harness({ run: NATIVE_RUN, ports: { verifyChildDead: async () => { throw new Error("ps failed"); } } });
    await h.recover("attempt-failed");
    expect(recoveryMode(h.launches[0]!)).toBe("reconstruction");
  });

  it("keeps a missing-rollout diagnostic for a non-codex agent on the native path", async () => {
    const h = harness({ run: NATIVE_RUN, events: [{ kind: "raw", line: "no rollout found for thread id t" }] });
    await h.recover("attempt-failed");
    expect(recoveryMode(h.launches[0]!)).toBe("native");
  });
});

describe("durable recovery boundaries: failure classes", () => {
  it.each(["inactivity_timeout", "Inactivity watchdog fired", "watchdog will kill the agent"])("cancels an inactivity-watchdog stop (%s)", async (label) => {
    const h = harness({ events: [{ kind: "status", label }] });
    expect(await h.recover("attempt-failed")).toBe("finalized");
    expect(h.settlements[0]!.status).toBe("canceled");
    expect(h.settlements[0]!.events.at(-1)).toEqual({ kind: "status", label: STOPPED });
  });

  it.each(["HTTP 400 bad request", "status code: 403", "error 404", "code: 422"])("treats a 4xx request failure as permanent (%s)", async (label) => {
    const h = harness({ events: [{ kind: "status", label }] });
    expect(await h.recover("attempt-failed")).toBe("finalized");
    expect(h.settlements[0]!.status).toBe("failed");
    expect(h.settlements[0]!.events.at(-1)).toEqual({ kind: "status", label: EXHAUSTED_NOTICE, detail: label });
  });

  it("retries an HTTP 408 request timeout", async () => {
    const h = harness({ events: [{ kind: "status", label: "HTTP 408 request timeout" }] });
    expect(await h.recover("attempt-failed")).toBe("continued");
  });

  // Stryker L5 (2026-10-25): the success-summary and task_notification filters (recover.ts:28-30)
  // could be forced to true or false with no failure. Each row isolates one side of one filter.
  it.each([
    ["a successful result summary quoting billing", '{"type":"result","is_error":false,"result":"billing"}', "continued"],
    ["a failed result summary", '{"type":"result","is_error":true,"result":"billing"}', "finalized"],
    ["a result whose is_error is the string false", '{"type":"result","is_error":"false","result":"billing"}', "finalized"],
    ["a non-result line with is_error false", '{"type":"assistant","is_error":false,"text":"billing"}', "finalized"],
    ["a subagent task_notification quoting billing", '{"type":"system","subtype":"task_notification","text":"billing"}', "continued"],
    ["another system subtype", '{"type":"system","subtype":"init","text":"billing"}', "finalized"],
    ["a task_notification subtype on a non-system line", '{"type":"user","subtype":"task_notification","text":"billing"}', "finalized"],
  ])("classifies %s", async (_label, line, expected) => {
    const h = harness({ events: [{ kind: "raw", line }] });
    expect(await h.recover("attempt-failed")).toBe(expected);
  });

  it("filters each line of a multi-line raw event on its own (LF and CRLF)", async () => {
    const h = harness({ events: [{ kind: "raw", line: '{"type":"result","is_error":false,"result":"billing"}\r\nok\nforbidden' }] });
    expect(await h.recover("attempt-failed")).toBe("finalized");
    expect(h.settlements[0]!.events.at(-1)).toEqual({ kind: "status", label: EXHAUSTED_NOTICE, detail: "forbidden" });
  });

  it("reads a status event's detail as diagnostics", async () => {
    const h = harness({ events: [{ kind: "status", label: "stopped", detail: "payment required" }] });
    expect(await h.recover("attempt-failed")).toBe("finalized");
    expect(h.settlements[0]!.events.at(-1)).toEqual({ kind: "status", label: EXHAUSTED_NOTICE, detail: "payment required" });
  });

  it("text and tool results are never diagnostics", async () => {
    const h = harness({ events: [{ kind: "text", text: "forbidden billing" }, { kind: "tool_result", toolUseId: "t", content: "billing", isError: true } as AgentEvent] });
    expect(await h.recover("attempt-failed")).toBe("continued");
  });

  it("a message with no events at all continues", async () => {
    const h = harness({ run: { message: { id: "answer", role: "assistant", runId: "old", runStatus: "running", content: "" } } });
    expect(await h.recover("attempt-failed")).toBe("continued");
  });

  it("classifies a non-JSON raw line as diagnostic input", async () => {
    const h = harness({ events: [{ kind: "raw", line: "fatal: billing" }] });
    expect(await h.recover("attempt-failed")).toBe("finalized");
    expect(h.settlements[0]!.events.at(-1)).toEqual({ kind: "status", label: EXHAUSTED_NOTICE, detail: "fatal: billing" });
  });

  it("classifies a JSON null raw line as diagnostic input", async () => {
    const h = harness({ events: [{ kind: "status", label: "HTTP 400" }, { kind: "raw", line: "null" }] });
    expect(await h.recover("attempt-failed")).toBe("finalized");
    expect(h.settlements[0]!.events.at(-1)).toEqual({ kind: "status", label: EXHAUSTED_NOTICE, detail: "null" });
  });

  it("uses the last non-blank diagnostic line as the permanent failure detail", async () => {
    const h = harness({ events: [{ kind: "status", label: "forbidden" }, { kind: "status", label: " " }] });
    expect(await h.recover("attempt-failed")).toBe("finalized");
    expect(h.settlements[0]!.events.at(-1)).toEqual({ kind: "status", label: EXHAUSTED_NOTICE, detail: "forbidden" });
  });

  it("skips the attempt base when it holds no recovery marker", async () => {
    const h = harness({ run: { attemptBase: [{ kind: "status", label: "forbidden" }] }, events: [{ kind: "status", label: "forbidden" }] });
    expect(await h.recover("attempt-failed")).toBe("continued");
  });
});

describe("durable recovery boundaries: preflight answer wait", () => {
  it("keeps a card pending when consent came from another conversation", async () => {
    const h = harness({ events: [
      { kind: "ext", name: "mcp-ui", data: { type: "resource" } },
      { kind: "ext", name: "agent_plugins", data: { conversationId: "elsewhere" } },
    ] });
    expect(await h.recover("attempt-failed")).toBe("finalized");
    expect(h.settlements[0]!.events.at(-1)).toEqual({ kind: "status", label: AWAITING_ANSWER_NOTICE });
  });

  it("re-opens the wait for a card shown after an earlier consent", async () => {
    const h = harness({ events: [
      { kind: "ext", name: "agent_plugins", data: { conversationId: "chat" } },
      { kind: "ext", name: "mcp-ui", data: null },
    ] });
    expect(await h.recover("attempt-failed")).toBe("finalized");
  });

  it("ignores ext events that are neither cards nor consent", async () => {
    const h = harness({ events: [{ kind: "ext", name: "other", data: null }] });
    expect(await h.recover("attempt-failed")).toBe("continued");
  });

  it("ignores a card shown after a model tool ran", async () => {
    const h = harness({ events: [
      { kind: "tool_use", id: "t", name: "read", input: {} },
      { kind: "tool_result", toolUseId: "t", content: "ok", isError: false },
      { kind: "ext", name: "mcp-ui", data: null },
    ] });
    expect(await h.recover("attempt-failed")).toBe("continued");
  });
});

describe("durable recovery boundaries: stale budget", () => {
  it("waits for proof of death even when an uncertain stale run has a pending card", async () => {
    const h = harness({ probe: "uncertain", run: { lastProgressAt: TIME + 20_000 - RUN_STALENESS_MS }, events: [{ kind: "ext", name: "mcp-ui", data: null }] });
    expect(await h.recover("timeout")).toBe("waiting");
    expect(h.settlements).toEqual([]);
    expect(h.clocks).toEqual([{ runId: "old", now: TIME + 20_000, active: false }]);
  });

  it("keeps waiting one millisecond before the staleness bound", async () => {
    const h = harness({ probe: "uncertain", run: { lastProgressAt: TIME + 20_001 - RUN_STALENESS_MS } });
    expect(await h.recover("timeout")).toBe("waiting");
  });
});


describe("uncertain recovery does not terminate live work", () => {
  it("uncertain_then_live_never_cancels_or_settles", async () => {
    const canceled: string[] = [];
    let probe: RunProbe = "uncertain";
    const h = harness({ events: [{ kind: "status", label: "billing" }], ports: {
      probe: async () => probe, cancelAttempt: async run => { canceled.push(run.runId); },
    } });
    expect(await h.recover("browser")).toBe("waiting");
    probe = "live";
    expect(await h.recover("timeout")).toBe("reattached");
    expect(canceled).toEqual([]);
    expect(h.settlements).toEqual([]);
    expect(h.advances).toEqual([]);
    expect(h.clocks).toEqual([
      { runId: "old", now: TIME + 20_000, active: false },
      { runId: "old", now: TIME + 20_000, active: false },
    ]);
  });

  it("uncertain_with_expired_budgets_reprobes_before_finalizing", async () => {
    for (const nextProbe of ["live", "dead"] as const) {
      let probes = 0;
      const h = harness({ run: { recoveryCount: 100, recoveryDeadline: TIME - 1, lastProgressAt: TIME - RUN_STALENESS_MS }, ports: {
        probe: async () => { probes += 1; return probes === 1 ? "uncertain" : nextProbe; },
      } });
      expect(await h.recover("timeout")).toBe("waiting");
      expect(h.clocks).toEqual([{ runId: "old", now: TIME + 20_000, active: false }]);
      expect(h.settlements).toEqual([]);
      expect(await h.recover("timeout")).toBe(nextProbe === "live" ? "reattached" : "finalized");
      expect(probes).toBe(2);
      expect(h.settlements).toHaveLength(nextProbe === "live" ? 0 : 1);
      expect(h.advances).toEqual([]);
    }
  });

  it("1166_live_reattaches_spend_no_recovery_budget", async () => {
    const h = harness({ probe: "live", run: { recoveryCount: 2, recoveryDeadline: TIME - 1, lastProgressAt: TIME - RUN_STALENESS_MS } });
    for (let index = 0; index < 1166; index++) expect(await h.recover("browser")).toBe("reattached");
    expect(h.current()!.recoveryCount).toBe(2);
    expect(h.clocks).toHaveLength(1166);
    expect(h.clocks.every(clock => clock.active === false)).toBe(true);
    expect(h.advances).toEqual([]);
    expect(h.settlements).toEqual([]);
  });

  it("reprobe_generation_change_cannot_cancel_new_attempt", async () => {
    let probe: RunProbe = "uncertain";
    const canceled: string[] = [];
    let onProbe = async (): Promise<RunProbe> => probe;
    const h = harness({ ports: { probe: () => onProbe(), cancelAttempt: async run => { canceled.push(run.runId); } } });
    expect(await h.recover("browser")).toBe("waiting");
    const current = h.current()!;
    probe = "dead";
    onProbe = async () => {
      h.replace({ ...current, runId: "new-generation", message: { ...current.message, runId: "new-generation" } });
      return "dead";
    };
    expect(await h.recover("timeout")).toBe("superseded");
    expect(canceled).toEqual([]);
    expect(h.settlements).toEqual([]);
    expect(h.clocks).toEqual([{ runId: "old", now: TIME + 20_000, active: false }]);
  });
});


it.each(['succeeded', 'failed', 'canceled'] as const)('honors a %s settlement saved while the uncertain probe awaited', async runStatus => {
  const h = harness({ probe: 'uncertain', reload: run => ({ ...run, message: { ...run.message, runStatus } }) });
  expect(await h.recover('browser')).toBe('terminal');
  expect(h.settlements).toEqual([]);
  expect(h.attached).toEqual([]);
  expect(h.clocks).toEqual([]);
});

it('honors explicit cancellation saved while the uncertain probe awaited', async () => {
  const h = harness({ probe: 'uncertain', reload: run => ({ ...run, cancelReason: 'user' }) });
  expect(await h.recover('browser')).toBe('finalized');
  expect(h.settlements[0]!.status).toBe('canceled');
  expect(h.attached).toEqual([]);
});
