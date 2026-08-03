import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import type { BlobStorePort } from "../ports.js";
import { InMemoryBlobStore } from "../blob-store.memory.js";
import { LocalFsBlobStore } from "../blob-store.fs.js";
import { computeBlobStorageKey } from "../blob-key.js";

/**
 * One contract exercised against both `BlobStorePort` adapters (ADR-006
 * rule-of-two: the two adapters must be interchangeable from a caller's point
 * of view). Mirrors the "same test, two adapters" shape used to demonstrate
 * real rule-of-two swappability elsewhere in this repo (e.g. repo ports).
 */
async function exerciseContract(store: BlobStorePort, label: string) {
  const workspaceId = "workspace-contract";
  const sha256 = "a".repeat(64);
  const bytes = new TextEncoder().encode(`${label}-content`);

  const before = await store.exists({ storageKey: computeBlobStorageKey({ workspaceId, sha256 }) });
  assert.equal(before, false, `${label}: should not exist before put`);

  const { storageKey } = await store.put({ workspaceId, sha256, bytes });
  assert.equal(storageKey, computeBlobStorageKey({ workspaceId, sha256 }), `${label}: storage key shape`);

  const exists = await store.exists({ storageKey });
  assert.equal(exists, true, `${label}: should exist after put`);

  const read = await store.get({ storageKey });
  assert.deepEqual(new Uint8Array(read), bytes, `${label}: round-tripped bytes match`);

  await store.remove({ storageKey });
  const afterRemove = await store.exists({ storageKey });
  assert.equal(afterRemove, false, `${label}: should not exist after remove`);

  // Removing an already-absent key is idempotent, not an error.
  await store.remove({ storageKey });
}

test("InMemoryBlobStore satisfies the BlobStorePort contract", async () => {
  await exerciseContract(new InMemoryBlobStore(), "memory");
});

test("LocalFsBlobStore satisfies the BlobStorePort contract", async (t) => {
  const rootDir = await mkdtemp(join(tmpdir(), "media-blobstore-"));
  t.onTestFinished(() => rm(rootDir, { recursive: true, force: true }));

  await exerciseContract(new LocalFsBlobStore({ rootDir }), "fs");
});

test("computeBlobStorageKey shards by the first two hex chars of the hash", () => {
  const key = computeBlobStorageKey({ workspaceId: "ws-1", sha256: "abcd1234" });
  assert.equal(key, "ws/ws-1/blobs/ab/abcd1234");
});
