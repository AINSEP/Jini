import { AsyncLocalStorage } from "node:async_hooks";
import { expect, test } from "vitest";
import Database from "better-sqlite3";
import { sql } from "kysely";
import { sqliteKernel } from "@jini-ai/db/kernel/sqlite";
import { MAX_REVOCATIONS } from "../revocations.js";
import { SqlPublishTrustRevocationStore, publishTrustRevocationStoreFor, type PublishTrustRevocationDatabase } from "../revocations.sql.js";

test("two different revokes at the cap cannot both land", async () => {
  const database = new Database(":memory:");
  const base = sqliteKernel<PublishTrustRevocationDatabase>({ source: database });
  await base.execute(sql`CREATE TABLE publish_trust_revocations (source_installation_id TEXT PRIMARY KEY, revoked_at TEXT NOT NULL, note TEXT)`);
  const rows = Array.from({ length: MAX_REVOCATIONS - 1 }, (_, i) => ({ source_installation_id: `source-${i}`, revoked_at: "2026-11-25T00:00:00Z", note: null }));
  await base.run(db => db.insertInto("publish_trust_revocations").values(rows).execute());
  const context = new AsyncLocalStorage<{ release?: () => void; locked?: boolean }>();
  let tail = Promise.resolve();
  const store = new SqlPublishTrustRevocationStore({ kernel: {
    ...base,
    run: fn => {
      const state = context.getStore();
      if (state && !state.locked) throw new Error("read before lock");
      return base.run(fn);
    },
    transaction: run => context.run({}, async () => {
      try { return await run(); }
      finally { context.getStore()?.release?.(); }
    }),
    lockKey: async key => {
      expect(key).toBe("publish_trust_revocations");
      const previous = tail;
      const state = context.getStore();
      if (!state) throw new Error("lock outside transaction");
      tail = new Promise<void>(resolve => { state.release = resolve; });
      await previous;
      state.locked = true;
    },
  } });
  try {
    const results = await Promise.all([
      store.revoke({ sourceInstallationId: "one", nowIso: "2026-11-25T00:00:00Z" }),
      store.revoke({ sourceInstallationId: "two", nowIso: "2026-11-25T00:00:00Z" }),
    ]);
    expect(results.filter(result => result.ok)).toHaveLength(1);
    const result = await store.list();
    expect(result.ok && result.revocations.length).toBe(MAX_REVOCATIONS);
    const winner = results.find(result => result.ok);
    if (!winner?.ok) throw new Error("no revoke landed");
    const sourceInstallationId = winner.revocations.find(row => row.sourceInstallationId === "one" || row.sourceInstallationId === "two")?.sourceInstallationId;
    if (!sourceInstallationId) throw new Error("winner missing");
    expect(await store.restore({ sourceInstallationId })).toMatchObject({ ok: true, changed: true });
  } finally { await base.close(); }
});

test("failed health read does not open an empty deny list", async () => {
  const base = sqliteKernel<PublishTrustRevocationDatabase>({ source: new Database(":memory:") });
  try {
    await expect(publishTrustRevocationStoreFor({ kernel: base })).rejects.toThrow("publish trust revocation store is unavailable at boot:");
  } finally { await base.close(); }
});

test("an unreadable store makes list return ok:false, never an empty ok:true", async () => {
  const base = sqliteKernel<PublishTrustRevocationDatabase>({ source: new Database(":memory:") });
  try {
    expect(await new SqlPublishTrustRevocationStore({ kernel: base }).list()).toMatchObject({ ok: false, reason: expect.stringContaining("could not be read") });
  } finally { await base.close(); }
});
