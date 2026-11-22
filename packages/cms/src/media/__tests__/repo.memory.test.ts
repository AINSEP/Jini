import assert from "node:assert/strict";
import { test } from "vitest";
import { InMemoryAssetBlobRepo, InMemoryAssetRenditionRepo, InMemoryBlobGcJournalRepo } from "../repo.memory.js";
import type { AssetBlobRecord, AssetRenditionRecord, BlobGcJournalEntry } from "../types.js";

/** Both in-memory adapters key their rows by `id`: a save is an upsert, never a duplicate row. */

test("InMemoryAssetRenditionRepo.save replaces the row with the same id instead of appending a second one", async () => {
  const repo = new InMemoryAssetRenditionRepo({});
  const first: AssetRenditionRecord = {
    id: "r-1", workspaceId: "ws", assetId: "a-1", transformName: "thumb", version: 1,
    storageKey: "ws/ws/renditions/old", createdAt: "2026-10-04T00:00:00Z",
  };
  await repo.save(first);
  await repo.save({ ...first, storageKey: "ws/ws/renditions/new" });
  const found = await repo.findOne({ workspaceId: "ws", assetId: "a-1", transformName: "thumb", version: 1 });
  assert.equal(found?.storageKey, "ws/ws/renditions/new");
  await repo.removeByAsset({ workspaceId: "ws", assetId: "a-1" });
  assert.equal(await repo.findOne({ workspaceId: "ws", assetId: "a-1", transformName: "thumb", version: 1 }), null);
});

test("InMemoryBlobGcJournalRepo.save replaces the entry with the same id instead of journaling it twice", async () => {
  const repo = new InMemoryBlobGcJournalRepo({});
  const entry: BlobGcJournalEntry = { id: "j-1", workspaceId: "ws", sha256: "a".repeat(64), storageKey: "k-old", journaledAt: "2026-10-04T00:00:00Z" };
  await repo.save(entry);
  await repo.save({ ...entry, storageKey: "k-new" });
  assert.deepEqual(await repo.list({ workspaceId: "ws" }), [{ ...entry, storageKey: "k-new" }]);
});

test("InMemoryAssetBlobRepo.list returns existing requested hashes only in the named workspace", async () => {
  const first: AssetBlobRecord = {
    id: "b-1", workspaceId: "ws", sha256: "a".repeat(64), storageKey: "k-1",
    createdByPrincipal: "principal", createdAt: "2026-10-04T00:00:00Z", status: "active",
  };
  const second: AssetBlobRecord = { ...first, id: "b-2", sha256: "b".repeat(64), storageKey: "k-2" };
  const repo = new InMemoryAssetBlobRepo({}, { initialRows: [
    first, second,
    { ...first, id: "b-3", sha256: "c".repeat(64), storageKey: "k-3" },
    { ...first, id: "b-4", workspaceId: "other-ws", storageKey: "k-4" },
  ] });
  assert.deepEqual(await repo.list({ workspaceId: "ws" }, { sha256s: [first.sha256, second.sha256, "d".repeat(64)] }), [first, second]);
});

test("InMemoryAssetBlobRepo.list returns no rows for an empty hash filter", async () => {
  const row: AssetBlobRecord = {
    id: "b-1", workspaceId: "ws", sha256: "a".repeat(64), storageKey: "k-1",
    createdByPrincipal: "principal", createdAt: "2026-10-04T00:00:00Z", status: "active",
  };
  const repo = new InMemoryAssetBlobRepo({}, { initialRows: [row] });
  assert.deepEqual(await repo.list({ workspaceId: "ws" }, { sha256s: [] }), []);
});
