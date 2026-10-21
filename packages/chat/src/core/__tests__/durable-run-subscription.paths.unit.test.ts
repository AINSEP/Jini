import { describe, expect, it, vi } from "vitest";
import { followDurableRun, type DurableRunBinding, type DurableSubscriptionPorts } from "../assistant-client/durable-run-subscription.js";
import type { ChatMessage } from "../messages.js";

const NOTICES = {
  toolStepLimit: { kind: "status" as const, label: "Limit" }, interrupted: { kind: "status" as const, label: "Interrupted" },
  neverStarted: { kind: "status" as const, label: "Never started" }, canceledLabel: "Canceled", failedLabel: "Failed", terminalDetail: () => "Ended",
};

/** Hand-written ports: reads answer from a queue, streams and timers are recorded for the test to drive. */
function fakePorts(answers: (ChatMessage | null | "gone")[]) {
  const reads: { runId: string; messageId?: string; recover?: boolean | undefined }[] = [];
  const streams: (Parameters<DurableSubscriptionPorts["stream"]>[0] & { closed: boolean })[] = [];
  const timers: (() => void)[] = [];
  const ports: DurableSubscriptionPorts = {
    read: async (required, { recover }) => { reads.push({ ...required, recover }); return answers.shift() ?? null; },
    stream: (input) => { const entry = { ...input, closed: false }; streams.push(entry); return () => { entry.closed = true; }; },
    schedule: ({ work }) => { timers.push(work); return () => {}; },
  };
  return { ports, reads, streams, timers };
}

const handlers = () => ({ onEvent: vi.fn(), onDone: vi.fn(), onError: vi.fn() });
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const saved = (extra: Partial<ChatMessage>): ChatMessage => ({ id: "m1", role: "assistant", content: "", runId: "run", ...extra });

describe("followDurableRun without a checkpoint handler", () => {
  it("renders live agent frames and fails a run the saved row marks failed, with its saved events", async () => {
    const { ports, streams, timers } = fakePorts([saved({ runStatus: "failed", events: [{ kind: "text", text: "partial" }] })]);
    const h = handlers();
    followDurableRun({ runId: "run", ports, notices: NOTICES, bindings: new Map(), handlers: h });
    streams[0]!.frame("agent", '{"payload":{"type":"text_delta","delta":"Hi"}}', "");
    expect(h.onEvent).toHaveBeenCalledWith({ kind: "text", text: "Hi" });
    timers[0]!();
    await flush();
    expect(h.onError).toHaveBeenCalledWith(new Error("The assistant could not finish this answer. Saved work is above."));
    expect(h.onDone).toHaveBeenCalledWith([{ kind: "text", text: "partial" }]);
    expect(streams[0]!.closed).toBe(true);
    streams[0]!.frame("agent", '{"payload":{"type":"text_delta","delta":"late"}}', "5");
    expect(h.onEvent).toHaveBeenCalledTimes(1);
  });

  it("finishes a succeeded row with no saved events as an empty transcript", async () => {
    const { ports, timers } = fakePorts([saved({ runStatus: "succeeded" })]);
    const h = handlers();
    followDurableRun({ runId: "run", ports, notices: NOTICES, bindings: new Map(), handlers: h });
    timers[0]!();
    await flush();
    expect(h.onError).not.toHaveBeenCalled();
    expect(h.onDone).toHaveBeenCalledWith([]);
  });
});

describe("followDurableRun with a binding and checkpoints", () => {
  it("reads by the bound message id and follows a recovered attempt under its new run id", async () => {
    const binding: DurableRunBinding = { messageId: "m1", conversationId: "c1" };
    const bindings = new Map<string, DurableRunBinding>();
    const { ports, reads, streams, timers } = fakePorts([null, saved({ runId: "run-2", runStatus: "running" }), saved({ runId: "run-2", runStatus: "running" })]);
    const onCheckpoint = vi.fn();
    followDurableRun({ runId: "run", binding, bindings, ports, notices: NOTICES, handlers: { ...handlers(), onCheckpoint } });
    streams[0]!.frame("agent", '{"payload":{"type":"text_delta","delta":"x"}}', "3");
    timers[0]!();
    await flush();
    expect(reads[0]).toEqual({ runId: "run", messageId: "m1", recover: true });
    expect(onCheckpoint).not.toHaveBeenCalled();
    timers[1]!();
    await flush();
    expect(bindings.get("run-2")).toBe(binding);
    expect(streams[0]!.closed).toBe(true);
    expect(streams[1]).toMatchObject({ runId: "run-2", cursor: "" });
    timers[2]!();
    await flush();
    expect(streams).toHaveLength(2);
    expect(onCheckpoint).toHaveBeenCalledTimes(2);
  });

  it("checkpoints a row with no status yet, then hands a failed row to the checkpoint owner instead of erroring", async () => {
    const failed = saved({ runStatus: "failed" });
    const { ports, timers } = fakePorts([saved({ content: "draft" }), failed]);
    const h = handlers();
    const onCheckpoint = vi.fn();
    followDurableRun({ runId: "run", ports, notices: NOTICES, bindings: new Map(), handlers: { ...h, onCheckpoint } });
    timers[0]!();
    await flush();
    expect(onCheckpoint).toHaveBeenLastCalledWith(expect.objectContaining({ content: "draft" }));
    timers[1]!();
    await flush();
    expect(onCheckpoint).toHaveBeenLastCalledWith(failed);
    expect(h.onError).not.toHaveBeenCalled();
    expect(h.onDone).toHaveBeenCalledWith([]);
  });

  it("stops following when the run is gone", async () => {
    const { ports, streams, timers } = fakePorts(["gone"]);
    const h = handlers();
    followDurableRun({ runId: "run", ports, notices: NOTICES, bindings: new Map(), handlers: { ...h, onCheckpoint: vi.fn() } });
    timers[0]!();
    await flush();
    expect(streams[0]!.closed).toBe(true);
    expect(timers).toHaveLength(1);
    expect(h.onDone).not.toHaveBeenCalled();
  });

  it("ignores a read that lands after the caller stopped", async () => {
    let answer!: (message: ChatMessage) => void;
    const fake = fakePorts([]);
    const { streams, timers } = fake;
    const ports: DurableSubscriptionPorts = { ...fake.ports, read: () => new Promise(resolve => { answer = resolve; }) };
    const onCheckpoint = vi.fn();
    const stop = followDurableRun({ runId: "run", ports, notices: NOTICES, bindings: new Map(), handlers: { ...handlers(), onCheckpoint } });
    timers[0]!();
    stop();
    answer(saved({ runStatus: "running" }));
    await flush();
    expect(onCheckpoint).not.toHaveBeenCalled();
    expect(streams[0]!.closed).toBe(true);
  });
});

describe("followDurableRun and the caller's abort signal", () => {
  it("never opens a stream for an already aborted signal", () => {
    const { ports, streams, timers } = fakePorts([]);
    const controller = new AbortController();
    controller.abort();
    const stop = followDurableRun({ runId: "run", ports, signal: controller.signal, notices: NOTICES, bindings: new Map(), handlers: handlers() });
    expect(streams).toHaveLength(0);
    expect(timers).toHaveLength(0);
    expect(typeof stop).toBe("function");
  });

  it("stops the stream when the signal aborts later", () => {
    const { ports, streams } = fakePorts([]);
    const controller = new AbortController();
    followDurableRun({ runId: "run", ports, signal: controller.signal, notices: NOTICES, bindings: new Map(), handlers: handlers() });
    controller.abort();
    expect(streams[0]!.closed).toBe(true);
  });
});
