import { expect, test, vi } from "vitest";
import { followDurableRun, type DurableSubscriptionPorts } from "../assistant-client/durable-run-subscription.js";
import type { ChatMessage } from "../messages.js";

test("running polls recover once, then read checkpoints; pending faults latch one recovery", async () => {
  vi.useFakeTimers();
  const methods: string[] = [];
  const checkpoints: string[] = [];
  const streams: Parameters<DurableSubscriptionPorts["stream"]>[0][] = [];
  let release!: (message: ChatMessage) => void;
  const message: ChatMessage = { id: "answer", role: "assistant", content: "Saved work", runId: "run", runStatus: "running" };
  const ports: DurableSubscriptionPorts = {
    read: async (_input, { recover = true }) => {
      methods.push(recover ? "POST" : "GET");
      return methods.length === 11 ? new Promise<ChatMessage>(resolve => { release = resolve; }) : { ...message, content: `Saved ${methods.length}` };
    },
    stream: input => { streams.push(input); return () => {}; },
    schedule: ({ work, delayMs }) => { const timer = setTimeout(work, delayMs); return () => clearTimeout(timer); },
  };
  const stop = followDurableRun({ runId: "run", ports, bindings: new Map(), notices: {
    toolStepLimit: { kind: "status", label: "Limit" }, interrupted: { kind: "status", label: "Interrupted" },
    neverStarted: { kind: "status", label: "Never started" }, canceledLabel: "Canceled", failedLabel: "Failed", terminalDetail: () => "Ended",
  }, handlers: { onEvent: () => {}, onDone: () => {}, onError: () => {}, onCheckpoint: value => { checkpoints.push(value.content); } } }, {});
  try {
    await vi.advanceTimersByTimeAsync(10_000);
    expect(methods).toEqual(["POST", ...Array(9).fill("GET")]);
    expect(checkpoints.at(-1)).toBe("Saved 10");
    await vi.advanceTimersByTimeAsync(1_000);
    streams[0]!.dropped(); streams[0]!.dropped();
    streams[0]!.frame("end", '{"payload":{"status":"failed","code":1}}', "9");
    streams[0]!.frame("error", '{"payload":{"message":"Connection lost"}}', "10");
    expect(methods).toHaveLength(11);
    release(message); await vi.advanceTimersByTimeAsync(0);
    // Faults latched during read are scheduled, never recursively recovered in the same tick.
    expect(methods).toHaveLength(11);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(methods).toEqual(["POST", ...Array(10).fill("GET"), "POST"]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(methods.at(-1)).toBe("GET"); expect(methods.filter(method => method === "POST")).toHaveLength(2);
  } finally { stop(); vi.useRealTimers(); }
});


test("repeated_stream_failures_back_off_and_abort_clears_retry", async () => {
  vi.useFakeTimers();
  const streams: Parameters<DurableSubscriptionPorts["stream"]>[0][] = [];
  const delays: number[] = [];
  const closed = vi.fn();
  const info = vi.fn();
  const controller = new AbortController();
  const ports: DurableSubscriptionPorts = {
    read: async () => ({ id: "answer", role: "assistant", content: "", runId: "run", runStatus: "running" }),
    stream: input => { streams.push(input); return closed; },
    schedule: ({ work, delayMs }) => { delays.push(delayMs); const timer = setTimeout(work, delayMs); return () => clearTimeout(timer); },
  };
  const stop = followDurableRun({ runId: "run", ports, bindings: new Map(), signal: controller.signal,
    notices: { toolStepLimit: { kind: "status", label: "Limit" }, interrupted: { kind: "status", label: "Interrupted" },
      neverStarted: { kind: "status", label: "Never started" }, canceledLabel: "Canceled", failedLabel: "Failed", terminalDetail: () => "Ended" },
    handlers: { onEvent: () => {}, onDone: () => {}, onError: () => {} },
  }, { report: { info } });
  try {
    streams[0]!.frame("agent", '{"payload":{"type":"text_delta","delta":"saved"}}', "42");
    for (const delay of [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]) {
      const count = streams.length;
      streams.at(-1)!.dropped("connection-error");
      expect(delays.at(-1)).toBe(delay);
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(streams).toHaveLength(count);
      await vi.advanceTimersByTimeAsync(1);
      expect(streams).toHaveLength(count + 1);
      expect(streams.at(-1)!.cursor).toBe("42");
    }
    expect(info.mock.calls[0]![1].meta).toEqual({ runId: "run", cursor: "42", retryDelayMs: 1_000 });
    // A new cursor proves progress and resets the backoff. An old stream cannot move it.
    streams[0]!.frame("agent", '{"payload":{"type":"text_delta","delta":"stale"}}', "99");
    streams.at(-1)!.frame("agent", '{"payload":{"type":"text_delta","delta":"new"}}', "43");
    streams.at(-1)!.dropped();
    expect(delays.at(-1)).toBe(1_000);
    expect(info.mock.calls.at(-1)![1].meta.cursor).toBe("43");
    controller.abort();
    const count = streams.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(streams).toHaveLength(count);
    expect(vi.getTimerCount()).toBe(0);
    expect(closed).toHaveBeenCalled();
  } finally { stop(); vi.useRealTimers(); }
});

for (const failure of ["null", "throw"] as const) {
  test(`a dropped quiet stream retries a ${failure} recovery before conditional polling resumes`, async () => {
    const methods: boolean[] = [];
    const streams: Parameters<DurableSubscriptionPorts["stream"]>[0][] = [];
    const timers = new Map<object, { work: () => void; delayMs: number }>();
    const checkpoints: ChatMessage[] = [];
    const message: ChatMessage = { id: "answer", role: "assistant", content: "saved", runId: "run", runStatus: "running" };
    const ports: DurableSubscriptionPorts = {
      read: async (_input, { recover = true }) => {
        methods.push(recover);
        if (methods.length === 1) return message;
        if (methods.length === 2) {
          if (failure === "throw") throw new Error("recovery unavailable");
          return null;
        }
        // An unchanged conditional response cannot reopen a stream; recovery returns a body.
        return recover ? message : null;
      },
      stream: input => { streams.push(input); return () => {}; },
      schedule: timer => { const key = {}; timers.set(key, timer); return () => { timers.delete(key); }; },
    };
    const stop = followDurableRun({ runId: "run", ports, bindings: new Map(), notices: {
      toolStepLimit: { kind: "status", label: "Limit" }, interrupted: { kind: "status", label: "Interrupted" },
      neverStarted: { kind: "status", label: "Never started" }, canceledLabel: "Canceled", failedLabel: "Failed", terminalDetail: () => "Ended",
    }, handlers: { onEvent: () => {}, onDone: () => {}, onError: () => {}, onCheckpoint: value => { checkpoints.push(value); } } }, { report: { info: () => {} } });
    const tick = async () => {
      expect(timers.size).toBe(1);
      const [key, timer] = [...timers][0]!;
      expect(timer.delayMs).toBe(1_000);
      timers.delete(key); timer.work();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    };
    try {
      await tick(); // Initial recovery succeeds and establishes the saved projection.
      streams[0]!.dropped();
      await tick(); // Recovery fails while the row stays unchanged.
      expect(streams).toHaveLength(1);
      expect(timers.size, "failure retains a single backed-off timer").toBe(1);
      await tick();
      expect(methods).toEqual([true, true, true]);
      expect(streams).toHaveLength(2);
      expect(checkpoints).toEqual([message, message]);
      await tick();
      expect(methods).toEqual([true, true, true, false]);
    } finally { stop(); }
    expect(timers.size).toBe(0);
  });
}

test("disconnect then replay-from-cursor then caller abort: ordered, no duplicate events, one teardown per stream", async () => {
  vi.useFakeTimers();
  const log: string[] = [];
  const streams: Parameters<DurableSubscriptionPorts["stream"]>[0][] = [];
  const controller = new AbortController();
  const ports: DurableSubscriptionPorts = {
    read: async () => ({ id: "answer", role: "assistant", content: "", runId: "run", runStatus: "running" }),
    stream: input => { streams.push(input); const index = streams.length; log.push(`open#${index}@${JSON.stringify(input.cursor)}`); return () => { log.push(`close#${index}`); }; },
    schedule: ({ work, delayMs }) => { const timer = setTimeout(work, delayMs); return () => clearTimeout(timer); },
  };
  const delta = (text: string) => `{"payload":{"type":"text_delta","delta":"${text}"}}`;
  const stop = followDurableRun({ runId: "run", ports, bindings: new Map(), signal: controller.signal,
    notices: { toolStepLimit: { kind: "status", label: "Limit" }, interrupted: { kind: "status", label: "Interrupted" },
      neverStarted: { kind: "status", label: "Never started" }, canceledLabel: "Canceled", failedLabel: "Failed", terminalDetail: () => "Ended" },
    handlers: { onEvent: event => { log.push(`event:${JSON.stringify(event)}`); }, onDone: () => { log.push("done"); }, onError: () => {} },
  }, { report: { info: () => {} } });
  try {
    streams[0]!.frame("agent", delta("a"), "1");
    streams[0]!.frame("agent", delta("b"), "2");
    streams[0]!.dropped("connection-error");
    // The dead stream is torn down once, and a late frame from it is ignored (no duplicate).
    streams[0]!.frame("agent", delta("late"), "99");
    await vi.advanceTimersByTimeAsync(1_000);
    // Replay resumes from the stored cursor, never from the start.
    expect(streams).toHaveLength(2);
    expect(streams[1]!.cursor).toBe("2");
    streams[1]!.frame("agent", delta("c"), "3");
    controller.abort();
    controller.abort();
    stop();
    streams[1]!.frame("agent", delta("after-abort"), "4");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(log.filter(entry => entry.startsWith("event:")).map(entry => /"delta":"(\w+)"|"text":"(\w+)"/.exec(entry)?.slice(1).find(Boolean) ?? entry)).toEqual(["a", "b", "c"]);
    expect(log.filter(entry => entry.startsWith("event:"))).toHaveLength(3);
    expect(log.filter(entry => entry.startsWith("open") || entry.startsWith("close") || entry === "done")).toEqual(['open#1@""', "close#1", 'open#2@"2"', "close#2"]);
    expect(streams).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

// Before the G01 split, `disconnected()` called the stream teardown without forgetting it, so a later
// `stop()` (or reopen) called the same teardown again. With an idempotent port (EventSource.close,
// AbortController.abort) that second call was a silent no-op, but a port whose teardown releases a
// counted resource released it twice. The chosen semantics: every stream teardown runs exactly once,
// and repeated stop()/abort() are idempotent.
test("a dropped stream stopped before reconnect is released exactly once, and repeated stop/abort release nothing more", async () => {
  vi.useFakeTimers();
  let held = 0;
  const releases: number[] = [];
  const streams: Parameters<DurableSubscriptionPorts["stream"]>[0][] = [];
  const controller = new AbortController();
  const ports: DurableSubscriptionPorts = {
    read: async () => ({ id: "answer", role: "assistant", content: "", runId: "run", runStatus: "running" }),
    stream: input => {
      streams.push(input);
      held += 1;
      const index = streams.length;
      return () => {
        if (held === 0) throw new Error(`stream ${index} released twice`);
        held -= 1;
        releases.push(index);
      };
    },
    schedule: ({ work, delayMs }) => { const timer = setTimeout(work, delayMs); return () => clearTimeout(timer); },
  };
  const stop = followDurableRun({ runId: "run", ports, bindings: new Map(), signal: controller.signal,
    notices: { toolStepLimit: { kind: "status", label: "Limit" }, interrupted: { kind: "status", label: "Interrupted" },
      neverStarted: { kind: "status", label: "Never started" }, canceledLabel: "Canceled", failedLabel: "Failed", terminalDetail: () => "Ended" },
    handlers: { onEvent: () => {}, onDone: () => {}, onError: () => {} },
  }, { report: { info: () => {} } });
  try {
    expect(streams).toHaveLength(1);
    streams[0]!.dropped("connection-error");
    expect(releases).toEqual([1]);
    expect(() => { stop(); stop(); controller.abort(); }).not.toThrow();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(releases).toEqual([1]);
    expect(held).toBe(0);
    expect(streams).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});
