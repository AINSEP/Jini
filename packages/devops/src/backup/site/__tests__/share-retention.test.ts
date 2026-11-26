import { expect, it } from "vitest";
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
