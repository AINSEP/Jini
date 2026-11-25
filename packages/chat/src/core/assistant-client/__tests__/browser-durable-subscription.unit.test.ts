import { expect, test, vi } from "vitest";
import { browserDurableSubscriptionPorts } from "../browser-durable-subscription.js";

test("checkpoint ETags never suppress explicit recovery and reset after it", async () => {
  const request = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify({ message: { id: "m" } }), { headers: { ETag: "checkpoint" } }))
    .mockResolvedValueOnce(new Response(null, { status: 304 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ message: { id: "m" } })))
    .mockResolvedValueOnce(new Response(null, { status: 404 }));
  const ports = browserDurableSubscriptionPorts({ request, open: vi.fn(), schedule: () => () => {}, runPath: ({ runId }) => `/runs/${encodeURIComponent(runId)}` }, {});
  await ports.read({ runId: "r /", messageId: "m" }, { recover: false });
  expect(await ports.read({ runId: "r /", messageId: "m" }, { recover: false })).toBeNull();
  expect(request).toHaveBeenLastCalledWith("/runs/r%20%2F/checkpoint?messageId=m", { method: "GET", credentials: "same-origin", headers: { "If-None-Match": "checkpoint" } });
  await ports.read({ runId: "r /", messageId: "m" }, {});
  expect(request).toHaveBeenLastCalledWith("/runs/r%20%2F/recover", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messageId: "m" }) });
  expect(await ports.read({ runId: "r /", messageId: "m" }, { recover: false })).toBe("gone");
  expect(request).toHaveBeenLastCalledWith("/runs/r%20%2F/checkpoint?messageId=m", { method: "GET", credentials: "same-origin" });
});

test("named error frames differ from native stream drops", () => {
  const listeners = new Map<string, EventListenerOrEventListenerObject>();
  const close = vi.fn();
  const open = vi.fn((_url: string) => ({ readyState: 1, close, addEventListener: (kind: string, listener: EventListenerOrEventListenerObject) => { listeners.set(kind, listener); } }) as unknown as Pick<EventSource, "close" | "addEventListener" | "readyState">);
  const ports = browserDurableSubscriptionPorts({ request: vi.fn(), open, schedule: () => () => {}, runPath: () => "/runs/r" });
  const frame = vi.fn();
  const dropped = vi.fn();
  ports.stream({ runId: "r", cursor: "c /", frame, dropped }, {});
  expect(open).toHaveBeenCalledWith("/runs/r/events?afterCursor=c%20%2F");
  const error = listeners.get("error");
  if (typeof error !== "function") throw new Error("missing listener");
  error(new MessageEvent("error", { data: "failure", lastEventId: "next" }));
  expect(frame).toHaveBeenCalledWith("error", "failure", "next");
  expect(dropped).not.toHaveBeenCalled();
  error(new Event("error"));
  expect(close).toHaveBeenCalledTimes(1);
  expect(dropped).toHaveBeenCalledTimes(1);
});
