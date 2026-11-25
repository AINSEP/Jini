import assert from "node:assert/strict";
import { test } from "vitest";
import { withSha256Lock } from "../blob-gc-lock.js";
import { allClearProbes, createGate, createSharedWorld, DAY, KEY, SHA, WS, seedTombstone } from "./support/blob-fence-harness.js";

const BYTES = new Uint8Array([1, 2, 3]);

async function journalAfterGrace(world: ReturnType<typeof createSharedWorld>, reason: "owner-purge" | "trash-ttl" = "owner-purge") {
  await seedTombstone(world, reason);
  world.advance(31 * DAY);
  return world.gc().deletePass({ signal: new AbortController().signal, workspaceId: WS });
}

test("crash between claim and unlink resumes", async () => {
  const world = createSharedWorld();
  await journalAfterGrace(world);
  assert.equal(await world.blobRepo.findByHash({ workspaceId: WS, sha256: SHA }), null);
  const originalRemove = world.blobStore.remove.bind(world.blobStore);
  world.blobStore.remove = async () => { throw Object.assign(new Error("process died"), { code: "EIO" }); };
  const crashed = await world.gc().unlinkPass({ signal: new AbortController().signal });
  assert.equal(crashed[0]?.status, "deferred");
  assert.equal((await world.journal.get({ workspaceId: WS, storageKey: KEY }))?.attempts, 1);
  world.blobStore.remove = originalRemove;
  world.advance(2 * 60 * 60 * 1000);
  const resumed = await world.gc().unlinkPass({ signal: new AbortController().signal });
  assert.deepEqual(resumed.map((o) => o.status), ["unlinked"]);
  assert.equal(await world.blobStore.exists({ storageKey: KEY }), false);
  assert.equal(world.journal.rows.size, 0);
});

test("cross-process same-hash re-upload keeps the file", async () => {
  const world = createSharedWorld();
  await journalAfterGrace(world);
  const gate = createGate();
  const unlinker = world.gc(allClearProbes({ pendingJobOwners: async () => { await gate.wait(); return []; } }));
  const uploader = world.gc();
  const unlinking = unlinker.unlinkPass({ signal: new AbortController().signal });
  await gate.reached;
  const uploading = uploader.claimWrite({ workspaceId: WS, storageKey: KEY, sha256: SHA, kind: "original", work: async ({ existing }) => {
    const { storageKey } = await world.blobStore.putIfAbsent({ workspaceId: WS, sha256: SHA, bytes: BYTES });
    if (!existing) await world.blobRepo.save({ id: "blob-2", workspaceId: WS, sha256: SHA, storageKey, createdByPrincipal: "user:b", createdAt: "2026-02-01T00:00:00.000Z", status: "active" });
    return storageKey;
  } });
  await new Promise((resolve) => setTimeout(resolve, 5));
  gate.open();
  await Promise.all([unlinking, uploading]);
  assert.equal(await world.blobStore.exists({ storageKey: KEY }), true);
  assert.equal((await world.blobRepo.findByHash({ workspaceId: WS, sha256: SHA }))?.status, "active");
});

test("rendition sharing bytes kept", async () => {
  const world = createSharedWorld();
  await journalAfterGrace(world);
  await world.renditionRepo.save({ id: "r1", workspaceId: WS, assetId: "m1", transformName: "original", version: 1, storageKey: KEY, createdAt: "2026-01-01T00:00:00.000Z" });
  const [outcome] = await world.gc().unlinkPass({ signal: new AbortController().signal });
  assert.equal(outcome?.status, "kept");
  assert.equal(await world.blobStore.exists({ storageKey: KEY }), true);
});

test("absent snapshot probe fails closed", async () => {
  const world = createSharedWorld();
  await journalAfterGrace(world);
  const { oldestRetainedRecoveryAgeMs: _omitted, ...withoutSnapshot } = allClearProbes();
  const gc = world.gc(withoutSnapshot as never);
  const [outcome] = await gc.unlinkPass({ signal: new AbortController().signal });
  assert.equal(outcome?.status, "deferred");
  assert.equal(await world.blobStore.exists({ storageKey: KEY }), true);
  const throwing = world.gc(allClearProbes({ oldestRetainedRecoveryAgeMs: async () => { throw new Error("snapshot index offline"); } }));
  world.advance(DAY);
  assert.equal((await throwing.unlinkIfUnowned({ workspaceId: WS, storageKey: KEY })).status, "deferred");
  assert.equal(await world.blobStore.exists({ storageKey: KEY }), true);
});

test("grace extends to the oldest retained copy", async () => {
  const world = createSharedWorld();
  await seedTombstone(world, "owner-purge");
  world.advance(31 * DAY);
  const retained = world.gc(allClearProbes({ oldestRetainedRecoveryAgeMs: async () => 45 * DAY }));
  const early = await retained.deletePass({ signal: new AbortController().signal, workspaceId: WS });
  assert.deepEqual(early.map((r) => r.reason), ["grace-period-not-elapsed"]);
  world.advance(15 * DAY);
  const late = await retained.deletePass({ signal: new AbortController().signal, workspaceId: WS });
  assert.deepEqual(late.map((r) => r.reason), ["journaled"]);
});

test("legacy tombstone without reason is never unlinked", async () => {
  const world = createSharedWorld();
  await seedTombstone(world);
  world.advance(400 * DAY);
  const results = await world.gc().deletePass({ signal: new AbortController().signal, workspaceId: WS });
  assert.deepEqual(results.map((r) => r.reason), ["legacy-tombstone"]);
  assert.equal(world.journal.rows.size, 0);
  assert.equal(await world.blobStore.exists({ storageKey: KEY }), true);
});

test("trash-ttl eligible only if OWNER-Q-11a says so", async () => {
  const world = createSharedWorld();
  const byDefault = await journalAfterGrace(world, "trash-ttl");
  assert.deepEqual(byDefault.map((r) => r.reason), ["trash-ttl-not-authorized"]);
  const optedIn = await world.gc(allClearProbes(), { allowTrashTtl: true }).deletePass({ signal: new AbortController().signal, workspaceId: WS });
  assert.deepEqual(optedIn.map((r) => r.reason), ["journaled"]);
});

test("forms job pending keeps the bytes", async () => {
  const world = createSharedWorld();
  await journalAfterGrace(world);
  const gc = world.gc(allClearProbes({ pendingJobOwners: async () => ["job-forms-1"] }));
  assert.equal((await gc.unlinkIfUnowned({ workspaceId: WS, storageKey: KEY })).status, "kept");
  assert.equal(await world.blobStore.exists({ storageKey: KEY }), true);
  await world.journal.upsert({ workspaceId: WS, storageKey: KEY, sha256: SHA, kind: "original", reason: "owner-purge", tombstonedAt: "2025-01-01T00:00:00.000Z", journaledAt: "2025-01-01T00:00:00.000Z", attempts: 0 });
  const self = await gc.unlinkIfUnowned({ workspaceId: WS, storageKey: KEY, consumingJobId: "job-forms-1" });
  assert.equal(self.status, "unlinked");
});

test("no deadlock with an upload holding the hash", async () => {
  const world = createSharedWorld();
  await journalAfterGrace(world);
  const gate = createGate();
  const gc = world.gc(allClearProbes({ hasLiveEntryRefs: async () => { await gate.wait(); return false; } }));
  const unlinking = gc.unlinkPass({ signal: new AbortController().signal });
  await gate.reached;
  const upload = withSha256Lock({ key: SHA, criticalSection: () => world.gc().claimWrite({ workspaceId: WS, storageKey: KEY, sha256: SHA, kind: "original", work: async () => {
    await world.blobStore.putIfAbsent({ workspaceId: WS, sha256: SHA, bytes: BYTES });
    return true;
  } }) });
  gate.open();
  const settled = await Promise.race([Promise.all([unlinking, upload]).then(() => "done"), new Promise((resolve) => setTimeout(() => resolve("deadlock"), 500))]);
  assert.equal(settled, "done");
  assert.equal(await world.blobStore.exists({ storageKey: KEY }), true);
});

test("claimWrite resurrects a tombstone under the fence and clears its pending unlink", async () => {
  const world = createSharedWorld();
  await seedTombstone(world, "owner-purge");
  await world.journal.upsert({ workspaceId: WS, storageKey: KEY, sha256: SHA, kind: "original", reason: "owner-purge", tombstonedAt: "2026-01-01T00:00:00.000Z", journaledAt: "2026-01-01T00:00:00.000Z", attempts: 0 });
  const seen = await world.gc().claimWrite({ workspaceId: WS, storageKey: KEY, sha256: SHA, kind: "import", work: async ({ existing }) => existing?.status });
  assert.equal(seen, "active");
  const row = await world.blobRepo.findByHash({ workspaceId: WS, sha256: SHA });
  assert.equal(row?.status, "active");
  assert.equal(row?.purgeReason, undefined);
  assert.equal(world.journal.rows.size, 0);
  assert.deepEqual(world.kernel.locked.slice(-1), [`blob:${WS}:${KEY}`]);
});
