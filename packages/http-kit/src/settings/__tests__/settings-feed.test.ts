import { expect, test, vi } from "vitest";
import { registerSettingsRoutes, type SettingsHttpOptions } from "../index.js";
import { fixture, settle } from "./settings-fixture.js";

// Generalized from settings-events-id-disclosure: neighbour writes after this workspace,
// making the global head different from the workspace revision. No HTTP listener is needed.
test("emits namespace names and workspace revision id, never the global head", async () => {
  const f = fixture(); registerSettingsRoutes(f.deps);
  const { capture } = await f.invoke("GET", "/prefs/events");
  vi.mocked(f.deps.changeFeed.head).mockResolvedValue(99);
  vi.mocked(f.deps.changeFeed.collect).mockResolvedValue({ cursor: 7, namespaces: ["preferences"], examinedCount: 1 });
  f.scheduled.get(1_000)!(); await settle();
  expect(capture.frames).toBe(': connected\n\nid: 7\nevent: settings-changed\ndata: {"namespaces":["preferences"]}\n\n');
  expect(capture.frames).not.toContain("99");
  f.scheduled.get(1_000)!(); await settle();
  expect(f.deps.changeFeed.collect).toHaveBeenLastCalledWith({ sinceSeq: 99, limit: 200, viewer: { workspaceId: "workspace-a", principalId: "me" } });
});
test.each(["300", "-1", "not-a-number", "Infinity"])("bounds Last-Event-ID %s to the ledger", async (resume) => {
  const f = fixture(); vi.mocked(f.deps.changeFeed.head).mockResolvedValue(9); registerSettingsRoutes(f.deps);
  await f.invoke("GET", "/prefs/events", { headers: { "last-event-id": resume } });
  f.scheduled.get(1_000)!(); await settle();
  expect(f.deps.changeFeed.collect).toHaveBeenCalledWith({ sinceSeq: 9, limit: 200, viewer: { workspaceId: "workspace-a", principalId: "me" } });
});
test("reconnect resumes an earlier cursor and a full page never skips the remaining backlog", async () => {
  const f = fixture(); vi.mocked(f.deps.changeFeed.head).mockResolvedValue(50); registerSettingsRoutes(f.deps, { revisionPageSize: 2 });
  await f.invoke("GET", "/prefs/events", { headers: { "last-event-id": "3" } });
  vi.mocked(f.deps.changeFeed.collect).mockResolvedValue({ cursor: 5, namespaces: [], examinedCount: 2 });
  f.scheduled.get(1_000)!(); await settle(); f.scheduled.get(1_000)!(); await settle();
  expect(vi.mocked(f.deps.changeFeed.collect).mock.calls.map(([r]) => r.sinceSeq)).toEqual([3, 5]);
});
test("snapshots head before querying the page and advances invisible short pages without a frame", async () => {
  const f = fixture(); const order: string[] = []; registerSettingsRoutes(f.deps);
  const { capture } = await f.invoke("GET", "/prefs/events");
  vi.mocked(f.deps.changeFeed.head).mockImplementation(async () => { order.push("head"); return 20; });
  vi.mocked(f.deps.changeFeed.collect).mockImplementation(async () => { order.push("page"); return { cursor: 7, namespaces: [], examinedCount: 1 }; });
  f.scheduled.get(1_000)!(); await settle(); f.scheduled.get(1_000)!(); await settle();
  expect(order).toEqual(["head", "page", "head", "page"]);
  expect(vi.mocked(f.deps.changeFeed.collect).mock.calls.map(([r]) => r.sinceSeq)).toEqual([0, 20]);
  expect(capture.frames).toBe(": connected\n\n");
});
test("a rejected read retries the same cursor and does not end the subscription", async () => {
  const f = fixture(); const onError = vi.fn(); registerSettingsRoutes(f.deps, { onError });
  const { res } = await f.invoke("GET", "/prefs/events");
  vi.mocked(f.deps.changeFeed.collect).mockRejectedValueOnce(new Error("storage unavailable"));
  f.scheduled.get(1_000)!(); await settle(); f.scheduled.get(1_000)!(); await settle();
  expect(vi.mocked(f.deps.changeFeed.collect).mock.calls.map(([r]) => r.sinceSeq)).toEqual([0, 0]);
  expect(onError).toHaveBeenCalledWith({ operation: "poll", error: expect.objectContaining({ message: "storage unavailable" }) });
  expect(res.writableEnded).toBe(false);
});
test("overlapping polls are skipped and closing during an awaited page emits nothing", async () => {
  const f = fixture(); registerSettingsRoutes(f.deps);
  const { res, capture } = await f.invoke("GET", "/prefs/events");
  let finish!: (batch: { cursor: number; namespaces: string[]; examinedCount: number }) => void;
  vi.mocked(f.deps.changeFeed.collect).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const tick = f.scheduled.get(1_000)!; tick(); await settle(); tick(); await settle();
  expect(f.deps.changeFeed.collect).toHaveBeenCalledTimes(1);
  res.emit("close"); finish({ cursor: 7, namespaces: ["preferences"], examinedCount: 1 }); await settle();
  expect(capture.frames).toBe(": connected\n\n"); expect(f.cancelled.sort((a, b) => a - b)).toEqual([1_000, 25_000, 30_000]);
});
test("revocation closes and cancels all timers, while transient authorization errors preserve the stream", async () => {
  const f = fixture(); const onError = vi.fn(); registerSettingsRoutes(f.deps, { onError });
  const { res } = await f.invoke("GET", "/prefs/events");
  const recheck = f.scheduled.get(30_000)!;
  vi.mocked(f.deps.authorize).mockRejectedValueOnce(new Error("transient")); recheck(); await settle();
  expect(res.writableEnded).toBe(false); expect(onError).toHaveBeenCalledWith({ operation: "re-authorization", error: expect.objectContaining({ message: "transient" }) });
  vi.mocked(f.deps.authorize).mockResolvedValue({ allowed: false, reason: "revoked" }); recheck(); await settle();
  expect(res.writableEnded).toBe(true); expect(f.scheduled.size).toBe(0);
  res.emit("close"); expect(f.cancelled.length).toBe(3);
});
test("HTTP/2 omits Connection, keepalive stays a comment and disposal closes active feeds", async () => {
  const f = fixture(); const mounted = registerSettingsRoutes(f.deps);
  const { res, capture } = await f.invoke("GET", "/prefs/events", { httpVersionMajor: 2 });
  expect(capture.headers).toEqual({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" });
  f.scheduled.get(25_000)!(); expect(capture.frames).toBe(": connected\n\n: keepalive\n\n");
  mounted.dispose(); mounted.dispose(); expect(f.cancelled.length).toBe(3); expect(res.writableEnded).toBe(true);
});
test("an initial ledger read failure maps to 500 before headers and leaves no listeners or schedules", async () => {
  const f = fixture(); vi.mocked(f.deps.changeFeed.head).mockRejectedValue(new Error("private storage URI")); registerSettingsRoutes(f.deps);
  const { req, res, capture } = await f.invoke("GET", "/prefs/events");
  expect(capture.statusCode).toBe(500); expect(capture.jsonBody).toEqual({ error: "internal error", code: "INTERNAL_ERROR" });
  expect(req.listenerCount("close")).toBe(0); expect(res.listenerCount("close")).toBe(0); expect(f.scheduled.size).toBe(0);
});
test("disposal during the initial head read prevents opening or scheduling a stream", async () => {
  const f = fixture(); registerSettingsRoutes(f.deps);
  let release!: (head: number) => void;
  vi.mocked(f.deps.changeFeed.head).mockImplementation(() => new Promise((resolve) => { release = resolve; }));
  // Dispose during open; the completion observes the disposal before writing headers.
  const mounted = registerSettingsRoutes({ ...f.deps, routes: { ...f.deps.routes, events: "/other/events" } });
  const pending = f.invoke("GET", "/other/events"); await settle(); mounted.dispose(); release(4);
  const { capture } = await pending;
  expect(capture.frames).toBe(""); expect(f.scheduled.size).toBe(0);
});

// REGRESSION: fails if reportError calls optional.onError without its recovery boundary.
test("a throwing error reporter cannot interrupt keepalive failure cleanup", async () => {
  const f = fixture();
  const onError = vi.fn<NonNullable<SettingsHttpOptions["onError"]>>(() => { throw new Error("reporting failed"); });
  registerSettingsRoutes(f.deps, { onError });
  const { req, res } = await f.invoke("GET", "/prefs/events");
  vi.spyOn(res, "write").mockImplementation(() => { throw new Error("socket write failed"); });
  expect(() => f.scheduled.get(25_000)!()).not.toThrow();
  expect(onError).toHaveBeenCalledWith({ operation: "keepalive", error: expect.objectContaining({ message: "socket write failed" }) });
  expect(f.cancelled.sort((a, b) => a - b)).toEqual([1_000, 25_000, 30_000]);
  expect(f.scheduled.size).toBe(0);
  expect(req.listenerCount("close")).toBe(0);
  expect(res.listenerCount("close")).toBe(0);
  expect(res.end).toHaveBeenCalledOnce();
});

// REGRESSION: fails if reportError calls optional.onError without its recovery boundary.
test("poll and reauthorization recover even when the host reporter throws", async () => {
  const f = fixture();
  const onError = vi.fn<NonNullable<SettingsHttpOptions["onError"]>>(() => { throw new Error("reporting failed"); });
  const mounted = registerSettingsRoutes(f.deps, { onError });
  const { res } = await f.invoke("GET", "/prefs/events");
  vi.mocked(f.deps.changeFeed.collect).mockRejectedValueOnce(new Error("read failed"));
  f.scheduled.get(1_000)!(); await settle();
  vi.mocked(f.deps.authorize).mockRejectedValueOnce(new Error("authorization unavailable"));
  f.scheduled.get(30_000)!(); await settle();
  f.scheduled.get(1_000)!(); await settle();
  expect(f.deps.changeFeed.collect).toHaveBeenCalledTimes(2);
  expect(onError.mock.calls.map(([input]) => input.operation)).toEqual(["poll", "re-authorization"]);
  expect(res.writableEnded).toBe(false);
  mounted.dispose();
  expect(f.scheduled.size).toBe(0);
  expect(res.end).toHaveBeenCalledOnce();
});

// REGRESSION: fails if close directly calls cancellations without per-resource recovery.
test("a failing cancellation cannot prevent the remaining schedules and response from closing", async () => {
  const f = fixture();
  const every = f.deps.scheduler.every;
  f.deps.scheduler.every = (input) => {
    const cancel = every(input);
    return () => { cancel(); if (input.intervalMs === 1_000) throw new Error("cancel failed"); };
  };
  const onError = vi.fn<NonNullable<SettingsHttpOptions["onError"]>>(() => { throw new Error("reporting failed"); });
  const mounted = registerSettingsRoutes(f.deps, { onError });
  const { res } = await f.invoke("GET", "/prefs/events");
  expect(() => mounted.dispose()).not.toThrow();
  expect(f.cancelled.sort((a, b) => a - b)).toEqual([1_000, 25_000, 30_000]);
  expect(res.end).toHaveBeenCalledOnce();
});
