import assert from "node:assert/strict";
import { test } from "vitest";
import { DEFAULT_GC_GRACE_MS, runBlobGcDeletePass, runBlobGcUnlinkPass } from "../blob-gc.js";
import { InMemoryAssetBlobRepo, InMemoryBlobGcJournalRepo, InMemoryMediaRepo } from "../repo.memory.js";
import { InMemoryBlobStore } from "../blob-store.memory.js";

async function fixture() {
  const blobRepo = new InMemoryAssetBlobRepo({});
  const blobStore = new InMemoryBlobStore();
  const input = { workspaceId: "ws-1", sha256: "abcd" };
  const { storageKey } = await blobStore.put({ ...input, bytes: new TextEncoder().encode("bytes") });
  const row = { ...input, id: "blob-1", storageKey, createdByPrincipal: "actor",
    createdAt: "2026-01-01T00:00:00.000Z", status: "tombstoned" as const, tombstonedAt: "2026-01-01T00:00:00.000Z" };
  await blobRepo.save(row);
  let n = 0;
  const deps = { blobRepo, blobStore, journalRepo: new InMemoryBlobGcJournalRepo({}),
    mediaRepo: new InMemoryMediaRepo({}), clock: { nowMs: () => Date.parse(new Date(Date.parse(row.tombstonedAt) + DEFAULT_GC_GRACE_MS + 1).toISOString())},
    idGen: { newId: () => `journal-${++n}` } };
  return { deps, input, row, storageKey };
}

test("failed journal save leaves the row and bytes intact", async () => {
  const f = await fixture();
  f.deps.journalRepo.save = async () => { throw new Error("journal offline"); };
  await assert.rejects(runBlobGcDeletePass(f), /journal offline/);
  assert.deepEqual(await f.deps.blobRepo.findByHash(f.input), f.row);
  assert.equal(await f.deps.blobStore.exists({ storageKey: f.storageKey }), true);
  assert.deepEqual(await f.deps.journalRepo.list({ workspaceId: "ws-1" }), []);
});

test("failed row deletion leaves a journal that unlink drains without removing owned bytes; deletion can retry", async () => {
  const f = await fixture();
  const remove = f.deps.blobRepo.remove.bind(f.deps.blobRepo);
  f.deps.blobRepo.remove = async () => { throw new Error("delete offline"); };
  await assert.rejects(runBlobGcDeletePass(f), /delete offline/);
  assert.equal((await f.deps.journalRepo.list({ workspaceId: "ws-1" })).length, 1);
  assert.deepEqual(await runBlobGcUnlinkPass({ deps: f.deps, input: { workspaceId: "ws-1" } }),
    { unlinked: [], skipped: ["abcd"] });
  assert.equal(await f.deps.blobStore.exists({ storageKey: f.storageKey }), true);
  assert.deepEqual(await f.deps.blobRepo.findByHash(f.input), f.row);
  assert.deepEqual(await f.deps.journalRepo.list({ workspaceId: "ws-1" }), []);
  f.deps.blobRepo.remove = remove;
  assert.deepEqual(await runBlobGcDeletePass(f), { deleted: true, reason: "deleted" });
  assert.equal(await f.deps.blobRepo.findByHash(f.input), null);
  assert.deepEqual(await runBlobGcUnlinkPass({ deps: f.deps, input: { workspaceId: "ws-1" } }),
    { unlinked: ["abcd"], skipped: [] });
  assert.equal(await f.deps.blobStore.exists({ storageKey: f.storageKey }), false);
});

test("failed unlink preserves the pending journal for replay", async () => {
  const f = await fixture();
  await runBlobGcDeletePass(f);
  const remove = f.deps.blobStore.remove.bind(f.deps.blobStore);
  f.deps.blobStore.remove = async () => { throw new Error("unlink offline"); };
  await assert.rejects(runBlobGcUnlinkPass({ deps: f.deps, input: { workspaceId: "ws-1" } }), /unlink offline/);
  assert.equal((await f.deps.journalRepo.list({ workspaceId: "ws-1" })).length, 1);
  assert.equal(await f.deps.blobStore.exists({ storageKey: f.storageKey }), true);
  f.deps.blobStore.remove = remove;
  await runBlobGcUnlinkPass({ deps: f.deps, input: { workspaceId: "ws-1" } });
  assert.equal(await f.deps.blobStore.exists({ storageKey: f.storageKey }), false);
  assert.deepEqual(await f.deps.journalRepo.list({ workspaceId: "ws-1" }), []);
});

test("interruption after bytes are removed can replay the still-pending journal safely", async () => {
  const f = await fixture();
  await runBlobGcDeletePass(f);
  const remove = f.deps.journalRepo.remove.bind(f.deps.journalRepo);
  f.deps.journalRepo.remove = async () => { throw new Error("journal drain offline"); };
  await assert.rejects(runBlobGcUnlinkPass({ deps: f.deps, input: { workspaceId: "ws-1" } }), /journal drain offline/);
  assert.equal(await f.deps.blobStore.exists({ storageKey: f.storageKey }), false);
  assert.equal((await f.deps.journalRepo.list({ workspaceId: "ws-1" })).length, 1);
  f.deps.journalRepo.remove = remove;
  assert.deepEqual(await runBlobGcUnlinkPass({ deps: f.deps, input: { workspaceId: "ws-1" } }),
    { unlinked: ["abcd"], skipped: [] });
  assert.deepEqual(await f.deps.journalRepo.list({ workspaceId: "ws-1" }), []);
});
