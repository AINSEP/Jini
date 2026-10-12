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
    expect(methods).toEqual(["POST", ...Array(10).fill("GET"), "POST"]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(methods.at(-1)).toBe("GET"); expect(methods.filter(method => method === "POST")).toHaveLength(2);
  } finally { stop(); vi.useRealTimers(); }
});
