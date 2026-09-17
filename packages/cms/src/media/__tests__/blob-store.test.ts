import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import type { BlobStorePort } from "../ports.js";
import { InMemoryBlobStore } from "../blob-store.memory.js";
import { LocalFsBlobStore } from "../blob-store.fs.js";
import { computeBlobStorageKey } from "../blob-key.js";

/**
 * One contract exercised against both `BlobStorePort` adapters (port/adapter
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

/**
 * `putIfAbsent`'s create-only contract, exercised against both adapters — the property
 * `hydrateBlobStoreFromSeed()` (host-side) depends on to close its check-then-overwrite race: a second
 * `putIfAbsent` for an already-occupied key must report `written: false` AND must leave the
 * FIRST writer's bytes untouched, never silently replace them with the second caller's bytes.
 */
async function exercisePutIfAbsentContract(store: BlobStorePort, label: string) {
  const workspaceId = "workspace-put-if-absent";
  const sha256 = "b".repeat(64);
  const storageKey = computeBlobStorageKey({ workspaceId, sha256 });
  const firstBytes = new TextEncoder().encode(`${label}-first-writer`);
  const secondBytes = new TextEncoder().encode(`${label}-second-writer`);

  const first = await store.putIfAbsent({ workspaceId, sha256, bytes: firstBytes });
  assert.equal(first.written, true, `${label}: first putIfAbsent for a fresh key must write`);
  assert.equal(first.storageKey, storageKey, `${label}: putIfAbsent storage key shape`);

  const second = await store.putIfAbsent({ workspaceId, sha256, bytes: secondBytes });
  assert.equal(second.written, false, `${label}: putIfAbsent for an occupied key must report written: false`);

  const stored = await store.get({ storageKey });
  assert.deepEqual(
    new Uint8Array(stored),
    firstBytes,
    `${label}: the first writer's bytes must survive a second putIfAbsent untouched`
  );

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

test("InMemoryBlobStore.putIfAbsent satisfies the create-only contract", async () => {
  await exercisePutIfAbsentContract(new InMemoryBlobStore(), "memory");
});

test("LocalFsBlobStore.putIfAbsent satisfies the create-only contract", async (t) => {
  const rootDir = await mkdtemp(join(tmpdir(), "media-blobstore-put-if-absent-"));
  t.onTestFinished(() => rm(rootDir, { recursive: true, force: true }));

  await exercisePutIfAbsentContract(new LocalFsBlobStore({ rootDir }), "fs");
});

test("LocalFsBlobStore.exists() surfaces a non-ENOENT stat failure instead of collapsing it into false", async (t) => {
  const rootDir = await mkdtemp(join(tmpdir(), "media-blobstore-exists-error-"));
  t.onTestFinished(() => rm(rootDir, { recursive: true, force: true }));

  // Make the "ws" path segment a plain FILE, not a directory, so stat() on any storage key
  // beneath it fails with ENOTDIR — a real, deterministic filesystem error distinct from "the
  // object is missing" (ENOENT), without depending on OS permission enforcement (unreliable when
  // tests run as root).
  await writeFile(join(rootDir, "ws"), "not a directory");

  const store = new LocalFsBlobStore({ rootDir });
  await assert.rejects(() => store.exists({ storageKey: "ws/ws-1/blobs/ab/abcd1234" }), (err: unknown) => {
    assert.ok(err instanceof Error);
    assert.equal((err as NodeJS.ErrnoException).code, "ENOTDIR");
    return true;
  });
});

test("computeBlobStorageKey shards by the first two hex chars of the hash", () => {
  const key = computeBlobStorageKey({ workspaceId: "ws-1", sha256: "abcd1234" });
  assert.equal(key, "ws/ws-1/blobs/ab/abcd1234");
});
