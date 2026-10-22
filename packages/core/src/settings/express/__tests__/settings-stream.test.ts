/**
 * Direct tests for `openSettingsChangeStream`. `settings-feed.test.ts` drives it through the HTTP
 * route with default options; this file reaches the remaining decisions: option validation before
 * any effect, the default console reporter, HTTP/2 headers, close races at every await, keepalive
 * write failure, schedules created after close, and opening failures before/after headers.
 */
import { EventEmitter } from "node:events";
import type { Request } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openSettingsChangeStream } from "../stream.js";
import type { SettingsChangeFeed, SettingsHttpOptions } from "../contracts.js";
import { createCapturingResponse, settle } from "./settings-fixture.js";

const POLL = 10, KEEPALIVE = 20, REAUTH = 30;
const timings: SettingsHttpOptions = { pollIntervalMs: POLL, keepaliveIntervalMs: KEEPALIVE, reauthorizeIntervalMs: REAUTH };

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function harness({ headers = {}, httpVersionMajor = 1 }: { headers?: Record<string, string>; httpVersionMajor?: number } = {}) {
  const request = Object.assign(new EventEmitter(), { headers, httpVersionMajor }) as unknown as Request;
  const { res: response, capture } = createCapturingResponse();
  const scheduled = new Map<number, () => void>();
  const cancelled: number[] = [];
  const scheduler = { every: ({ intervalMs, callback }: { intervalMs: number; callback: () => void }) => {
    scheduled.set(intervalMs, callback);
    return () => { cancelled.push(intervalMs); scheduled.delete(intervalMs); };
  } };
  const feed = {
    head: vi.fn<SettingsChangeFeed["head"]>(async () => 0),
    collect: vi.fn<SettingsChangeFeed["collect"]>(async () => ({ cursor: 0, namespaces: [], examinedCount: 0 })),
  };
  const authorize = vi.fn(async () => ({ allowed: true, reason: "ok" }));
  const closes: Array<() => void> = [];
  let disposed = false;
  const errors: Array<{ operation: string; error: unknown }> = [];
  const open = (optional: SettingsHttpOptions = { ...timings, onError: (e) => { errors.push(e); } }) => openSettingsChangeStream({
    request, response, workspaceId: "w1", principalId: "p1", changeFeed: feed, authorize, permission: "prefs.read", scheduler,
    onClose: ({ close }) => { closes.push(close); }, isDisposed: () => disposed,
  }, optional);
  return { request, response, capture, scheduled, cancelled, feed, authorize, closes, errors, open, dispose: () => { disposed = true; } };
}

afterEach(() => { vi.restoreAllMocks(); });

describe("option validation", () => {
  it.each([
    [{ revisionPageSize: 0 }], [{ revisionPageSize: 1.5 }], [{ revisionPageSize: -3 }],
    [{ pollIntervalMs: 0 }], [{ keepaliveIntervalMs: Number.NaN }], [{ reauthorizeIntervalMs: Number.POSITIVE_INFINITY }], [{ pollIntervalMs: -1 }],
  ])("throws RangeError for %j before reading the feed or attaching listeners", async (bad) => {
    const h = harness();
    await expect(h.open(bad)).rejects.toThrow(new RangeError("settings feed page size and intervals must be positive"));
    expect(h.feed.head).not.toHaveBeenCalled();
    expect((h.request as unknown as EventEmitter).listenerCount("close")).toBe(0);
    expect(h.scheduled.size).toBe(0);
  });
});

describe("opening", () => {
  it("uses the default intervals and page size when none are given", async () => {
    const h = harness();
    vi.spyOn(console, "error").mockImplementation(() => {});
    await h.open({});
    expect([...h.scheduled.keys()]).toEqual([1_000, 25_000, 30_000]);
    h.scheduled.get(1_000)!(); await settle();
    expect(h.feed.collect).toHaveBeenCalledWith({ sinceSeq: 0, limit: 200, viewer: { workspaceId: "w1", principalId: "p1" } });
  });

  it("writes SSE headers with keep-alive on HTTP/1 and without Connection on HTTP/2", async () => {
    const one = harness();
    await one.open();
    expect(one.capture.statusCode).toBe(200);
    expect(one.capture.headers).toEqual({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    expect(one.capture.frames).toBe(": connected\n\n");
    const two = harness({ httpVersionMajor: 2 });
    await two.open();
    expect(two.capture.headers).toEqual({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" });
  });

  it.each([
    ["the request closed during the head read", (h: ReturnType<typeof harness>) => (h.request as unknown as EventEmitter).emit("close")],
    ["the route was disposed", (h: ReturnType<typeof harness>) => h.dispose()],
    ["the response was destroyed", (h: ReturnType<typeof harness>) => { (h.response as unknown as { destroyed: boolean }).destroyed = true; }],
    ["the response already ended", (h: ReturnType<typeof harness>) => { (h.response as unknown as { writableEnded: boolean }).writableEnded = true; }],
  ])("returns a closed stream without headers or schedules when %s", async (_label, interrupt) => {
    const h = harness();
    const head = deferred<number>();
    h.feed.head.mockReturnValueOnce(head.promise);
    const opening = h.open();
    interrupt(h);
    head.resolve(4);
    const close = await opening;
    expect(h.capture.headers).toEqual({});
    expect(h.capture.frames).toBe("");
    expect(h.scheduled.size).toBe(0);
    expect(h.closes).toEqual([close]);
  });

  it("propagates an initial head failure, detaching listeners without ending an unopened response", async () => {
    const h = harness();
    h.feed.head.mockRejectedValueOnce(new Error("ledger offline"));
    await expect(h.open()).rejects.toThrow("ledger offline");
    expect((h.request as unknown as EventEmitter).listenerCount("close")).toBe(0);
    expect((h.response as unknown as EventEmitter).listenerCount("close")).toBe(0);
    expect(h.response.end).not.toHaveBeenCalled();
    expect(h.closes).toEqual([]);
  });

  it("closes (ending the response and cancelling schedules) when opening fails after headers were sent", async () => {
    const h = harness();
    const writes: string[] = [];
    let n = 0;
    (h.response as unknown as { write: (frame: string) => boolean }).write = (frame: string) => { if (++n === 1) throw new Error("socket gone"); writes.push(frame); return true; };
    await expect(h.open()).rejects.toThrow("socket gone");
    expect(h.response.end).toHaveBeenCalledTimes(1);
    expect(h.cancelled.sort()).toEqual([POLL, KEEPALIVE, REAUTH]);
    expect(h.closes).toHaveLength(1);
  });
});

describe("polling", () => {
  it("emits the batch cursor as the event id and skips the tick while one is in flight", async () => {
    const h = harness();
    await h.open();
    const page = deferred<{ cursor: number; namespaces: string[]; examinedCount: number }>();
    h.feed.head.mockResolvedValue(40);
    h.feed.collect.mockReturnValueOnce(page.promise);
    h.scheduled.get(POLL)!(); await settle();
    h.scheduled.get(POLL)!(); await settle();
    expect(h.feed.collect).toHaveBeenCalledTimes(1);
    page.resolve({ cursor: 12, namespaces: ["prefs", "theme"], examinedCount: 3 });
    await settle();
    expect(h.capture.frames).toBe(': connected\n\nid: 12\nevent: settings-changed\ndata: {"namespaces":["prefs","theme"]}\n\n');
  });

  it("never writes a frame when the stream closes during the head or page read", async () => {
    for (const stage of ["head", "page"] as const) {
      const h = harness();
      await h.open();
      const head = deferred<number>();
      const page = deferred<{ cursor: number; namespaces: string[]; examinedCount: number }>();
      if (stage === "head") h.feed.head.mockReturnValueOnce(head.promise);
      else h.feed.collect.mockReturnValueOnce(page.promise);
      h.scheduled.get(POLL)!(); await settle();
      (h.response as unknown as EventEmitter).emit("close");
      head.resolve(5);
      page.resolve({ cursor: 9, namespaces: ["late"], examinedCount: 1 });
      await settle();
      expect(h.capture.frames).toBe(": connected\n\n");
      expect(h.feed.collect).toHaveBeenCalledTimes(stage === "head" ? 0 : 1);
    }
  });

  it("reports a poll failure while open, and stays silent about one that lands after close", async () => {
    const h = harness();
    await h.open();
    h.feed.collect.mockRejectedValueOnce(new Error("page failed"));
    h.scheduled.get(POLL)!(); await settle();
    expect(h.errors).toEqual([{ operation: "poll", error: new Error("page failed") }]);
    const gate = deferred<never>();
    h.feed.collect.mockReturnValueOnce(gate.promise);
    h.scheduled.get(POLL)!(); await settle();
    (h.request as unknown as EventEmitter).emit("close");
    gate.reject(new Error("late failure"));
    await settle();
    expect(h.errors).toHaveLength(1);
  });

  it("falls back to console.error when the host gives no onError, and survives a throwing onError", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const h = harness();
    await h.open(timings);
    h.feed.collect.mockRejectedValueOnce(new Error("boom"));
    h.scheduled.get(POLL)!(); await settle();
    expect(spy).toHaveBeenCalledWith("[settings] change feed poll failed", new Error("boom"));

    const t = harness();
    await t.open({ ...timings, onError: () => { throw new Error("reporter broke"); } });
    t.feed.collect.mockRejectedValueOnce(new Error("boom"));
    t.scheduled.get(POLL)!(); await settle();
    t.feed.collect.mockResolvedValueOnce({ cursor: 3, namespaces: ["after"], examinedCount: 1 });
    t.scheduled.get(POLL)!(); await settle();
    expect(t.capture.frames).toContain("id: 3\n");
  });
});

describe("keepalive and re-authorization", () => {
  it("writes a keepalive comment, and closes the stream when that write throws", async () => {
    const h = harness();
    await h.open();
    h.scheduled.get(KEEPALIVE)!();
    expect(h.capture.frames).toBe(": connected\n\n: keepalive\n\n");
    const keepalive = h.scheduled.get(KEEPALIVE)!;
    (h.response as unknown as { write: () => never }).write = () => { throw new Error("EPIPE"); };
    keepalive();
    expect(h.errors).toEqual([{ operation: "keepalive", error: new Error("EPIPE") }]);
    expect(h.response.end).toHaveBeenCalledTimes(1);
    expect(h.closes).toHaveLength(1);
    keepalive();
    expect(h.errors).toHaveLength(1);
  });

  it("closes when re-authorization is denied, with the exact permission check", async () => {
    const h = harness();
    await h.open();
    h.authorize.mockResolvedValueOnce({ allowed: false, reason: "revoked" });
    h.scheduled.get(REAUTH)!(); await settle();
    expect(h.authorize).toHaveBeenCalledWith({ principalId: "p1", workspaceId: "w1", permission: "prefs.read", entityType: "setting-value" });
    expect(h.closes).toHaveLength(1);
    expect(h.cancelled.sort()).toEqual([POLL, KEEPALIVE, REAUTH]);
  });

  it("keeps the stream open when re-authorization allows, skips overlapping checks, and reports failures", async () => {
    const h = harness();
    await h.open();
    const pending = deferred<{ allowed: boolean; reason: string }>();
    h.authorize.mockReturnValueOnce(pending.promise);
    const reauth = h.scheduled.get(REAUTH)!;
    reauth(); reauth(); await settle();
    expect(h.authorize).toHaveBeenCalledTimes(1);
    pending.resolve({ allowed: true, reason: "ok" }); await settle();
    expect(h.closes).toEqual([]);
    h.authorize.mockRejectedValueOnce(new Error("authz offline"));
    reauth(); await settle();
    expect(h.errors).toEqual([{ operation: "re-authorization", error: new Error("authz offline") }]);
    expect(h.closes).toEqual([]);
  });

  it("ignores a denial or failure that settles after the stream already closed", async () => {
    const h = harness();
    await h.open();
    const pending = deferred<{ allowed: boolean; reason: string }>();
    h.authorize.mockReturnValueOnce(pending.promise);
    const reauth = h.scheduled.get(REAUTH)!;
    reauth(); await settle();
    (h.request as unknown as EventEmitter).emit("close");
    pending.reject(new Error("late"));
    await settle();
    expect(h.errors).toEqual([]);
    reauth(); await settle();
    expect(h.authorize).toHaveBeenCalledTimes(1);
  });
});

describe("closing", () => {
  it("is idempotent, ends the response once and recovers from failing cancellations and onClose", async () => {
    const h = harness();
    const scheduler = { every: () => () => { throw new Error("cancel failed"); } };
    const close = await openSettingsChangeStream({
      request: h.request, response: h.response, workspaceId: "w1", principalId: "p1", changeFeed: h.feed, authorize: h.authorize,
      permission: "prefs.read", scheduler, onClose: () => { throw new Error("onClose failed"); }, isDisposed: () => false,
    }, { ...timings, onError: (e) => { h.errors.push(e); } });
    close(); close();
    expect(h.response.end).toHaveBeenCalledTimes(1);
    expect(h.errors.map((e) => e.operation)).toEqual(["cancel", "cancel", "cancel", "close"]);
  });

  it("does not end a response that is already destroyed", async () => {
    const h = harness();
    const close = await h.open();
    (h.response as unknown as { destroyed: boolean }).destroyed = true;
    close();
    expect(h.response.end).not.toHaveBeenCalled();
  });

  it("cancels a schedule immediately when the stream closed while it was being created", async () => {
    const h = harness();
    const cancelled: number[] = [];
    const scheduler = { every: ({ intervalMs }: { intervalMs: number }) => {
      if (intervalMs === KEEPALIVE) (h.request as unknown as EventEmitter).emit("close");
      return () => { cancelled.push(intervalMs); };
    } };
    const opened = await openSettingsChangeStream({
      request: h.request, response: h.response, workspaceId: "w1", principalId: "p1", changeFeed: h.feed, authorize: h.authorize,
      permission: "prefs.read", scheduler, onClose: () => {}, isDisposed: () => false,
    }, timings);
    expect(typeof opened).toBe("function");
    expect(cancelled).toEqual([POLL, KEEPALIVE, REAUTH]);
    expect(h.capture.frames).toBe("");
  });
});
