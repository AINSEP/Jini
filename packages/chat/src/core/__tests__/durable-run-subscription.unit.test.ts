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
  }, { logger: { info } });
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
    expect(JSON.parse(info.mock.calls[0]![0].slice("[durable-subscription] ".length))).toEqual({ runId: "run", reason: "connection-error", cursor: "42", retryDelayMs: 1_000 });
    // A new cursor proves progress and resets the backoff. An old stream cannot move it.
    streams[0]!.frame("agent", '{"payload":{"type":"text_delta","delta":"stale"}}', "99");
    streams.at(-1)!.frame("agent", '{"payload":{"type":"text_delta","delta":"new"}}', "43");
    streams.at(-1)!.dropped();
    expect(delays.at(-1)).toBe(1_000);
    expect(JSON.parse(info.mock.calls.at(-1)![0].slice("[durable-subscription] ".length)).cursor).toBe("43");
    controller.abort();
    const count = streams.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(streams).toHaveLength(count);
    expect(vi.getTimerCount()).toBe(0);
    expect(closed).toHaveBeenCalled();
  } finally { stop(); vi.useRealTimers(); }
});
