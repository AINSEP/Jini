import { expect, it, vi } from "vitest";
import type { ChatTransport, DurableSubscriptionPorts, RunHandlers } from "../../../react/kit.js";
import { createStreamActivity, followDurableRun, subscriptionEnded, trackTransportActivity, type TrackedRunHandlers } from "../stream-activity.js";

it("releases page activity on a gone read and stops before releasing on disposal", async () => {
  const order: string[] = [];
  const handlers: TrackedRunHandlers = { onEvent: vi.fn(), onError: vi.fn(), onDone: vi.fn(),
    [subscriptionEnded]: () => { order.push("release"); } };
  const ports: DurableSubscriptionPorts = { read: vi.fn(async () => "gone" as const), stream: vi.fn(), schedule: vi.fn() };
  let followedPorts = ports;
  const follow = vi.fn((required: Omit<Parameters<typeof followDurableRun>[0], "deps">) => {
    followedPorts = required.ports;
    return () => { order.push("stop"); };
  });
  const stop = followDurableRun({ runId: "run", handlers, ports, deps: { follow } });
  const input = { runId: "run", messageId: "message" };
  expect(await followedPorts.read(input, { recover: false })).toBe("gone");
  expect(ports.read).toHaveBeenCalledWith(input, { recover: false });
  expect(order).toEqual(["release"]);
  expect(handlers.onDone).not.toHaveBeenCalled();
  stop();
  expect(order).toEqual(["release", "stop", "release"]);
});

it("keeps page activity through transient errors and releases it at the last terminal or detached run", async () => {
  const activity = createStreamActivity({});
  const updates: boolean[] = [];
  const dispose = activity.subscribe({ listener: () => updates.push(activity.active({})) });
  const sink: RunHandlers = { onEvent: vi.fn(), onDone: vi.fn(), onError: vi.fn() };
  const startRun = vi.fn<ChatTransport["startRun"]>(async () => ({ runId: "run-started" }));
  const reattachRun = vi.fn<ChatTransport["reattachRun"]>(async () => {});
  const transport = trackTransportActivity({ activity, transport: {
    startRun, reattachRun, stopRun: async () => {}, fetchRunStatus: async () => null,
  } });
  const input = { history: [], signal: new AbortController().signal };
  await expect(transport.startRun(input, sink)).resolves.toEqual({ runId: "run-started" });
  const controller = new AbortController();
  const options = { signal: controller.signal };
  await transport.reattachRun("run-other", sink, options);
  const [sent, started] = startRun.mock.calls[0]!;
  const [id, attached, attachOptions] = reattachRun.mock.calls[0]!;
  expect([sent, id, attachOptions]).toEqual([input, "run-other", options]);
  const offline = new Error("Connection lost, retrying");
  started.onError(offline);
  expect(sink.onError).toHaveBeenCalledExactlyOnceWith(offline);
  expect(updates).toEqual([true, true]);
  const final = [{ kind: "text", text: "Complete" }] as const;
  started.onDone([...final]);
  expect(sink.onDone).toHaveBeenCalledExactlyOnceWith(final);
  expect(activity.active({})).toBe(true);
  controller.abort();
  expect(activity.active({})).toBe(false);
  (attached as TrackedRunHandlers)[subscriptionEnded]?.();
  expect(updates).toEqual([true, true, true, false]);
  dispose();
  const release = activity.retain({});
  release();
  expect(updates).toEqual([true, true, true, false]);
});

it("releases rejected dispatches and avoids pinning an already detached run", async () => {
  const activity = createStreamActivity({});
  const sink: RunHandlers = { onEvent: vi.fn(), onDone: vi.fn(), onError: vi.fn() };
  const transport = trackTransportActivity({ activity, transport: {
    startRun: async () => { throw new Error("Dispatch rejected"); },
    reattachRun: async () => {},
    stopRun: async () => {},
    fetchRunStatus: async () => null,
  } });
  await expect(transport.startRun({ history: [], signal: new AbortController().signal }, sink)).rejects.toThrow("Dispatch rejected");
  expect(activity.active({})).toBe(false);
  const controller = new AbortController();
  controller.abort();
  await transport.reattachRun("already-detached", sink, { signal: controller.signal });
  expect(activity.active({})).toBe(false);
});
