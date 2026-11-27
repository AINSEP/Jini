import { describe, expect, it, vi } from "vitest";
import { followDurableRun, type DurableRunBinding, type DurableSubscriptionPorts } from "../assistant-client/durable-run-subscription.js";
import type { ChatMessage } from "../messages.js";
import { createAgUiRunClient } from "../assistant-client/ag-ui-transport.js";

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

  it("P26: rejects and forgets an empty AG-UI start, then settles a durable run that is gone", async () => {
    const agUiHandlers = handlers();
    const controller = new AbortController();
    const abortRun = vi.fn(() => controller.abort());
    const client = createAgUiRunClient({ ports: {
      endpoint: "/ag-ui", runIdPrefix: "ag:", mintId: () => "empty",
      customEventNames: { usage: "usage", status: "status", extensionPrefix: "ext:" },
      createAgent: () => ({ abortController: controller, abortRun,
        run: () => ({ subscribe: observer => { observer.complete(); } }),
      }),
    } });
    const started = client.startAgUiRun({ input: {
      history: [{ id: "u", role: "user", content: "hi" }], conversationId: "c", signal: new AbortController().signal,
    }, handlers: agUiHandlers });
    await expect(started).rejects.toThrow(/^The assistant stopped before replying\. Send your message again\.$/);
    await client.stopAgUiRun({ runId: "ag:empty" });
    expect(abortRun).not.toHaveBeenCalled();
    expect(agUiHandlers.onDone).not.toHaveBeenCalled();
    expect(agUiHandlers.onError).not.toHaveBeenCalled();

    const { ports, streams, timers } = fakePorts(["gone"]);
    const h = handlers();
    const stop = followDurableRun({ runId: "run", ports, notices: NOTICES, bindings: new Map(), handlers: { ...h, onCheckpoint: vi.fn() } });
    try {
      timers[0]!();
      await flush();
      expect(streams[0]!.closed).toBe(true);
      expect(timers).toHaveLength(1);
      // Either terminal callback releases useRunStream's streaming state; silent stop does not.
      expect([h.onDone.mock.calls.length, h.onError.mock.calls.length]).not.toEqual([0, 0]);
    } finally {
      stop();
    }
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

describe("followDurableRun behind an accepted AG-UI start", () => {
  it("an accepted AG-UI start follows the canonical run checkpoint without duplicate deltas", async () => {
    const binding: DurableRunBinding = { messageId: "a-1", conversationId: "c1" };
    const bindings = new Map<string, DurableRunBinding>();
    const running = saved({ id: "a-1", runId: "run-canon", runStatus: "running", content: "Hi", events: [{ kind: "text", text: "Hi" }] });
    const finished = saved({ id: "a-1", runId: "run-canon", runStatus: "succeeded", content: "Hi there", events: [{ kind: "text", text: "Hi there" }], usage: { inputTokens: 3, outputTokens: 2 } } as Partial<ChatMessage>);
    const { ports, reads, streams, timers } = fakePorts([running, finished]);
    const h = handlers();
    const onCheckpoint = vi.fn();
    const controller = new AbortController();
    let observer: { next: (event: unknown) => void; complete: () => void } | undefined;
    const runInputs: { runId: string }[] = [];
    const client = createAgUiRunClient({ ports: {
      endpoint: "/ag-ui", runIdPrefix: "ag:", mintId: () => "segment",
      customEventNames: { usage: "usage", status: "status", extensionPrefix: "ext:" },
      createAgent: () => ({ abortController: controller, abortRun: () => controller.abort(),
        run: (input) => { runInputs.push(input); return { subscribe: next => { observer = next; } }; },
      }),
      durableLocalCli: {
        prepareRunInput: ({ wire }) => wire,
        readAcceptedRun: ({ event }) => ({ runId: event.runId, messageId: "a-1", conversationId: "c1" }),
        // Saved projections replace replay: the host follows the canonical row, never the segment.
        followAcceptedRun: ({ runId, messageId, conversationId, handlers: follow, signal }) => {
          bindings.set(runId, { messageId, conversationId });
          followDurableRun({ runId, signal, binding: { messageId, conversationId }, ports, notices: NOTICES, bindings, handlers: { ...follow, onCheckpoint } });
        },
        cancelAcceptedRun: async () => {},
        cancelPendingRun: async () => {},
      },
    } });
    const started = client.startAgUiRun({ input: { history: [{ id: "u", role: "user", content: "hi" }], conversationId: "c1", signal: new AbortController().signal },
      handlers: h, durable: { launch: { contextRef: {}, messageId: "a-1", conversationId: "c1" }, bindRun: () => {} } });
    observer!.next({ type: "RUN_STARTED", threadId: "c1", runId: "run-canon" });
    await expect(started).resolves.toEqual({ runId: "run-canon" });
    expect(runInputs[0]!.runId).toBe("ag:segment");
    // The segment keeps streaming the same answer the durable row will project: drop both views.
    observer!.next({ type: "TEXT_MESSAGE_CONTENT", messageId: "m", delta: "Hi" });
    streams[0]!.frame("agent", '{"payload":{"type":"text_delta","delta":"Hi"}}', "1");
    expect(streams[0]!.runId).toBe("run-canon");
    timers[0]!();
    await flush();
    timers[1]!();
    await flush();
    observer!.next({ type: "RUN_FINISHED", threadId: "c1", runId: "ag:segment" });
    observer!.complete();
    expect(reads.map(read => read.runId)).toEqual(["run-canon", "run-canon"]);
    expect(reads[0]!.messageId).toBe("a-1");
    expect(bindings.has("ag:segment")).toBe(false);
    expect(h.onEvent).not.toHaveBeenCalled();
    expect(onCheckpoint.mock.calls.map(([message]) => message.content)).toEqual(["Hi", "Hi there"]);
    expect(h.onDone).toHaveBeenCalledTimes(1);
    expect(h.onDone).toHaveBeenCalledWith([{ kind: "text", text: "Hi there" }]);
    expect(h.onError).not.toHaveBeenCalled();
  });
});
