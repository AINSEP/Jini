import { describe, expect, it } from "vitest";

import type { AgentEvent } from "@jini-ai/core/contracts/site/chat-core";

import {
  createRunCheckpointer,
  type CheckpointWatch,
  type RunCheckpointerPorts,
  type RunTimerPort,
} from "../run-finalizer.js";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const NOW = 50_000;

/** Timer port with manual firing, so cadence is observed as armed entries, never by waiting. */
function manualTimers() {
  const entries: { delayMs: number; run: () => void; state: "armed" | "fired" | "canceled" }[] = [];
  const timers: RunTimerPort = {
    schedule({ delayMs, run }) {
      const entry = { delayMs, run, state: "armed" as "armed" | "fired" | "canceled" };
      entries.push(entry);
      return () => { if (entry.state === "armed") entry.state = "canceled"; };
    },
  };
  const armed = () => entries.filter((entry) => entry.state === "armed");
  return { timers, armed, fire() { const [entry] = armed(); if (!entry) throw new Error("no timer armed"); entry.state = "fired"; entry.run(); } };
}

function makeWatch(events: AgentEvent[] = []): CheckpointWatch {
  return {
    runId: "run-1", events,
    checkpointedAt: Number.NEGATIVE_INFINITY, checkpointedBytes: 0, checkpointedTextCharacters: 0,
    checkpointedExtensionEvents: 0, checkpointedTools: new Set(), checkpointPending: false, terminal: false,
  };
}
const text = (value: string): AgentEvent => ({ kind: "text", text: value });

function harness(options: { intervalMs?: number | undefined; checkpoint?: (call: { content: string; events: readonly AgentEvent[] }) => Promise<boolean>; logError?: () => unknown; bytes?: number } = {}) {
  const clock = { now: NOW };
  const { timers, armed, fire } = manualTimers();
  const writes: { content: string; events: readonly AgentEvent[] }[] = [];
  const logged: unknown[] = [];
  const ports: RunCheckpointerPorts<CheckpointWatch, readonly AgentEvent[]> = {
    project: ({ events }) => ({ content: events.map((event) => (event.kind === "text" ? event.text : "")).join(""), events }),
    ledger: { checkpoint: async ({ content, events }) => { writes.push({ content, events }); return options.checkpoint ? options.checkpoint({ content, events }) : true; } },
    now: () => clock.now,
    checkpointTimers: timers,
    log: { error: (required) => { logged.push(required); options.logError?.(); } },
    checkpointIntervalMs: "intervalMs" in options ? options.intervalMs : 0,
  };
  const checkpointer = createRunCheckpointer({ ports });
  return { checkpointer, clock, armed, fire, writes, logged };
}

describe("run checkpointer cadence", () => {
  it("writes the first growth at once and records the saved baseline", async () => {
    const h = harness({ intervalMs: undefined });
    const watch = makeWatch([text("hello")]);
    h.checkpointer.onFrame({ watch });
    await flush();
    expect(h.writes.map((write) => write.content)).toEqual(["hello"]);
    expect(watch.checkpointedAt).toBe(NOW);
    expect(watch.checkpointedTextCharacters).toBe(5);
    expect(watch.checkpointedBytes).toBe("text".length + 5);
    expect(watch.checkpointPending).toBe(false);
    expect(h.armed()).toEqual([]);
  });

  it("skips a frame inside the interval and arms one trailing write for the remainder, then writes the latest events", async () => {
    const h = harness({ intervalMs: undefined });
    const events = [text("a")];
    const watch = makeWatch(events);
    h.checkpointer.onFrame({ watch });
    await flush();
    h.clock.now = NOW + 400;
    events.push(text("b"));
    h.checkpointer.onFrame({ watch });
    await flush();
    expect(h.writes).toHaveLength(1);
    expect(h.armed().map((entry) => entry.delayMs)).toEqual([600]);
    // A further delta under an armed timer neither rescans nor re-arms.
    events.push(text("c"));
    h.checkpointer.onFrame({ watch });
    await flush();
    expect(h.armed()).toHaveLength(1);
    h.clock.now = NOW + 1_000;
    h.fire();
    await flush();
    expect(h.writes.map((write) => write.content)).toEqual(["a", "abc"]);
    expect(watch.trailing).toBeUndefined();
  });

  it("a frame arriving after the interval writes at once and cancels the trailing timer it supersedes", async () => {
    const h = harness({ intervalMs: undefined });
    const events = [text("a")];
    const watch = makeWatch(events);
    h.checkpointer.onFrame({ watch });
    await flush();
    h.clock.now = NOW + 400;
    events.push(text("b"));
    h.checkpointer.onFrame({ watch });
    await flush();
    expect(h.armed().map((entry) => entry.delayMs)).toEqual([600]);
    h.clock.now = NOW + 1_500;
    events.push(text("c"));
    h.checkpointer.onFrame({ watch });
    await flush();
    expect(h.writes.map((write) => write.content)).toEqual(["a", "abc"]);
    expect(h.armed()).toEqual([]);
    expect(watch.trailing).toBeUndefined();
  });

  it("records the saved tool identities, so the same tool call alone does not write again", async () => {
    const h = harness();
    const events: AgentEvent[] = [{ kind: "tool_use", id: "t1", name: "search", input: {} }];
    const watch = makeWatch(events);
    h.checkpointer.onFrame({ watch });
    await flush();
    expect([...watch.checkpointedTools]).toEqual(["tool_use:t1"]);
    h.checkpointer.onFrame({ watch });
    await flush();
    expect(h.writes).toHaveLength(1);
    events.push({ kind: "tool_result", toolUseId: "t1", content: "found", isError: false });
    h.checkpointer.onFrame({ watch });
    await flush();
    expect(h.writes).toHaveLength(2);
    expect([...watch.checkpointedTools]).toEqual(["tool_use:t1", "tool_result:t1"]);
  });

  it("scales the interval by the last saved payload size (1 MB -> 3 s) unless the host overrides it", async () => {
    const h = harness({ intervalMs: undefined });
    const watch = makeWatch([text("x".repeat(1_000_000 - "text".length))]);
    h.checkpointer.onFrame({ watch });
    await flush();
    expect(watch.checkpointedBytes).toBe(1_000_000);
    (watch.events as AgentEvent[]).push(text("more"));
    h.clock.now = NOW + 10;
    h.checkpointer.onFrame({ watch });
    expect(h.armed().map((entry) => entry.delayMs)).toEqual([2_990]);
  });

  it("does not arm a timer for an unchanged projection", async () => {
    const h = harness({ intervalMs: undefined });
    const watch = makeWatch([text("same")]);
    h.checkpointer.onFrame({ watch });
    await flush();
    h.clock.now = NOW + 1;
    h.checkpointer.onFrame({ watch });
    await flush();
    expect(h.writes).toHaveLength(1);
    expect(h.armed()).toEqual([]);
  });

  it("does nothing for a terminal watch, including from a callback queued before the stop", async () => {
    const h = harness({ intervalMs: undefined });
    const events = [text("a")];
    const watch = makeWatch(events);
    h.checkpointer.onFrame({ watch });
    await flush();
    h.clock.now = NOW + 100;
    events.push(text("b"));
    h.checkpointer.onFrame({ watch });
    expect(h.armed()).toHaveLength(1);
    watch.terminal = true;
    h.clock.now = NOW + 2_000;
    h.fire();
    await flush();
    expect(h.writes).toHaveLength(1);
  });
});

describe("run checkpointer write coordination", () => {
  it("never overlaps writes: frames during a pending write coalesce into one follow-up", async () => {
    let release!: (written: boolean) => void;
    let inFlight = 0; let maxInFlight = 0;
    const h = harness({ checkpoint: () => { inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); return new Promise<boolean>((resolve) => { release = (written) => { inFlight--; resolve(written); }; }); } });
    const events = [text("a")];
    const watch = makeWatch(events);
    h.checkpointer.onFrame({ watch });
    await flush();
    expect(watch.checkpointPending).toBe(true);
    events.push(text("b")); h.checkpointer.onFrame({ watch });
    events.push(text("c")); h.checkpointer.onFrame({ watch });
    await flush();
    expect(h.writes).toHaveLength(1);
    release(true);
    await flush();
    expect(h.writes.map((write) => write.content)).toEqual(["a", "abc"]);
    release(true);
    await flush();
    expect(maxInFlight).toBe(1);
    expect(h.writes).toHaveLength(2);
  });

  it("does not resurrect a watch that went terminal while its write was pending", async () => {
    let release!: (written: boolean) => void;
    const h = harness({ checkpoint: () => new Promise<boolean>((resolve) => { release = resolve; }) });
    const events = [text("a")];
    const watch = makeWatch(events);
    h.checkpointer.onFrame({ watch });
    await flush();
    events.push(text("b"));
    watch.terminal = true;
    release(true);
    await flush();
    expect(h.writes).toHaveLength(1);
    expect(h.armed()).toEqual([]);
  });

  it("a false (fenced/unchanged) result keeps the baseline, retries nothing and does not spin", async () => {
    const h = harness({ checkpoint: async () => false });
    const watch = makeWatch([text("a")]);
    h.checkpointer.onFrame({ watch });
    await flush();
    expect(watch.checkpointedTextCharacters).toBe(0);
    expect(h.writes).toHaveLength(1);
    expect(h.armed()).toEqual([]);
    expect(h.logged).toEqual([]);
  });
});

describe("run checkpointer retry", () => {
  it("reports a rejected write and arms exactly one retry no sooner than one second, which then writes", async () => {
    const failure = new Error("storage down");
    let calls = 0;
    const h = harness({ checkpoint: async () => { if (++calls === 1) throw failure; return true; } });
    const watch = makeWatch([text("partial")]);
    h.checkpointer.onFrame({ watch });
    await flush();
    expect(h.logged).toEqual([{ operation: "checkpoint", runId: "run-1", error: failure }]);
    expect(h.armed().map((entry) => entry.delayMs)).toEqual([1_000]);
    expect(watch.checkpointRetryAt).toBe(NOW + 1_000);
    expect(watch.checkpointPending).toBe(false);
    // A new frame before the backoff deadline cannot write ahead of it.
    (watch.events as AgentEvent[]).push(text("!"));
    h.checkpointer.onFrame({ watch });
    await flush();
    expect(h.writes).toHaveLength(1);
    h.clock.now = NOW + 1_000;
    h.fire();
    await flush();
    expect(h.writes.map((write) => write.content)).toEqual(["partial", "partial!"]);
    expect(watch.checkpointRetryAt).toBeUndefined();
    expect(h.armed()).toEqual([]);
  });

  it("uses the larger scaled interval as the retry delay and survives a throwing log", async () => {
    let calls = 0;
    const h = harness({ intervalMs: 4_000, checkpoint: async () => { if (++calls === 1) throw new Error("x"); return true; }, logError: () => { throw new Error("log sink down"); } });
    const watch = makeWatch([text("p")]);
    h.checkpointer.onFrame({ watch });
    await flush();
    expect(h.armed().map((entry) => entry.delayMs)).toEqual([4_000]);
  });

  it("arms no retry once the watch is terminal", async () => {
    const h = harness({ checkpoint: async () => { throw new Error("x"); } });
    const watch = makeWatch([text("p")]);
    h.checkpointer.onFrame({ watch });
    watch.terminal = true;
    await flush();
    expect(h.armed()).toEqual([]);
  });
});
