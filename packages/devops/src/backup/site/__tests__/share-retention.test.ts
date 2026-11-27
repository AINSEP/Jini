import { expect, it, vi } from "vitest";
import type { SiteShareRecord } from "../share-registry.js";
import { createShareMutex, createShareRetention } from "../share-retention.js";

it("expires only proven local links and writes the tombstone before unlink under the same lock", async () => {
  const calls: string[] = [];
  const rows = [
    { shareId: "expired", expiresAt: "2026-01-01", storage: { provider: "own", key: "zip" } },
    { shareId: "missing", storage: { provider: "own", key: "zip" } },
    { shareId: "invalid", expiresAt: "invalid", storage: { provider: "own", key: "zip" } },
    { shareId: "remote", expiresAt: "2026-01-01", storage: { provider: "remote", key: "zip" } },
  ].map(row => ({ ...row, status: "active" })) as SiteShareRecord[];
  const mutex = createShareMutex({});
  const retention = createShareRetention({ registry: { list: async () => rows, artifactPath: ({ shareId }) => shareId,
    get: async ({ shareId }) => { calls.push("reread"); return rows.find(row => row.shareId === shareId) ?? null; },
    markExpired: async ({ shareId }) => { calls.push("tombstone"); const row = rows.find(row => row.shareId === shareId)!; Object.assign(row, { status: "expired" }); } },
    shareMutex: input => { calls.push(input.key); return mutex(input); },
    fs: { stat: async () => ({ size: 10 }), unlink: async file => { expect(rows.find(row => row.shareId === file)?.status).toBe("expired"); calls.push("unlink:" + file); } },
    clock: { now: () => Date.parse("2026-02-01") }, reportError: () => {}, signal: new AbortController().signal, isOwnShareFolder: ({ storage }) => storage.provider === "own" });
  expect(retention.showExpired).toBe(true);
  expect(await retention.sweep({ now: Date.parse("2026-02-01") })).toEqual({ removed: 1, freedBytes: 10 });
  expect(calls).toEqual(["shares:expired", "reread", "tombstone", "unlink:expired"]);
  expect(rows.slice(1).map(row => row.status)).toEqual(["active", "active", "active"]);
});

it("measures only ZIPs still on disk and reclaims them after transient or reported unlink failures", async () => {
  const now = Date.parse("2026-03-01");
  const rows = ["gone", "busy", "broken"].map(shareId => ({ shareId, status: "revoked" as const })) as SiteShareRecord[];
  const artifacts = new Map([["busy", 12], ["broken", 31]]);
  const denied = Object.assign(new Error("I/O failed"), { code: "EIO" });
  let fail = true;
  const reportError = vi.fn();
  const retention = createShareRetention({
    registry: { list: async () => rows, get: async ({ shareId }) => rows.find(row => row.shareId === shareId) ?? null,
      markExpired: async () => { throw new Error("Revoked rows do not need an expiry marker"); }, artifactPath: ({ shareId }) => shareId },
    fs: {
      stat: async file => { const size = artifacts.get(file); if (size === undefined) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return { size }; },
      unlink: async file => {
        if (!artifacts.has(file)) throw new Error("Unexpected unlink of missing ZIP");
        if (fail) throw file === "busy" ? Object.assign(new Error("still open"), { code: "EBUSY" }) : denied;
        artifacts.delete(file);
      },
    }, clock: { now: () => now }, signal: new AbortController().signal, shareMutex: createShareMutex({}),
    isOwnShareFolder: () => false, reportError,
  }, { showExpired: false });
  expect(retention.showExpired).toBe(false);
  expect(await retention.measure()).toEqual({ bytes: 43, items: 2 });
  expect(await retention.sweep({ now })).toEqual({ removed: 0, freedBytes: 0 });
  expect(reportError.mock.calls).toEqual([[{ error: denied, shareId: "broken" }, {}]]);
  expect(artifacts).toEqual(new Map([["busy", 12], ["broken", 31]]));
  fail = false;
  expect(await retention.sweep({ now })).toEqual({ removed: 2, freedBytes: 43 });
  expect(await retention.measure()).toEqual({ bytes: 0, items: 0 });
});

it("propagates an unexpected stat failure without revoking or unlinking anything", async () => {
  const now = Date.parse("2026-03-01");
  const row = { shareId: "revoked", status: "revoked" } as SiteShareRecord;
  const statFailure = Object.assign(new Error("cannot inspect ZIP"), { code: "EIO" });
  const unlink = vi.fn(async () => {});
  const retention = createShareRetention({
    registry: { list: async () => [row], get: async () => row, markExpired: async () => {}, artifactPath: ({ shareId }) => shareId },
    fs: { stat: async () => { throw statFailure; }, unlink }, clock: { now: () => now },
    signal: new AbortController().signal, shareMutex: createShareMutex({}), isOwnShareFolder: () => false, reportError: () => {},
  });
  await expect(retention.measure()).rejects.toBe(statFailure);
  await expect(retention.sweep({ now })).rejects.toBe(statFailure);
  expect(unlink).not.toHaveBeenCalled();
});

it("does not delete a renewed share or count a ZIP another sweep already removed", async () => {
  const now = Date.parse("2026-03-01");
  const listed = [
    { shareId: "renewed", status: "active", expiresAt: "2026-02-01", storage: { provider: "own", key: "old" } },
    { shareId: "removed", status: "revoked" },
  ] as SiteShareRecord[];
  const current = { ...listed[0]!, expiresAt: "2026-04-01" };
  const artifacts = new Map([["renewed", 20], ["removed", 40]]);
  const get = vi.fn(async ({ shareId }: { shareId: string }) => {
    if (shareId === "renewed") return current;
    if (shareId === "removed") { artifacts.delete(shareId); return listed[1]!; }
    throw new Error("Unknown share");
  });
  const unlink = vi.fn(async (file: string) => {
    if (!artifacts.delete(file)) throw Object.assign(new Error("Already gone"), { code: "ENOENT" });
  });
  const markExpired = vi.fn(async () => {});
  const retention = createShareRetention({
    registry: { list: async () => listed, artifactPath: ({ shareId }) => shareId, get, markExpired },
    fs: { stat: async file => {
      const size = artifacts.get(file);
      if (size === undefined) throw Object.assign(new Error("Already gone"), { code: "ENOENT" });
      return { size };
    }, unlink }, clock: { now: () => now }, shareMutex: createShareMutex({}),
    signal: new AbortController().signal, isOwnShareFolder: ({ storage }) => storage.provider === "own", reportError: vi.fn(),
  });
  expect(await retention.measure()).toEqual({ bytes: 60, items: 2 });
  expect(await retention.sweep({ now })).toEqual({ removed: 0, freedBytes: 0 });
  expect(get.mock.calls).toEqual([[{ shareId: "renewed" }], [{ shareId: "removed" }]]);
  expect(artifacts).toEqual(new Map([["renewed", 20]]));
  expect(markExpired).not.toHaveBeenCalled();
  expect(unlink).not.toHaveBeenCalled();
});
