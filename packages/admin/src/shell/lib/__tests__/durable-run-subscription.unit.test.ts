import { expect, it, vi } from "vitest";
import type { DurableSubscriptionPorts } from "../../../react/kit.js";
import { followDurableRun, subscriptionEnded, type TrackedRunHandlers } from "../stream-activity.js";

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
