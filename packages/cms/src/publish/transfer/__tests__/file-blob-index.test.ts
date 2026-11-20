/**
 * @file `publish-files-plan-2026-09-24.md` §3 — {@link createFileBlobIndex}'s round-trip, overwrite,
 * eviction and read-bumps-recency contracts.
 */
import assert from "node:assert/strict";
import { test } from "vitest";

import { createFileBlobIndex, FILE_BLOB_INDEX_MAX_ENTRIES } from "../file-blob-index.js";

test("set/get round-trips an entry", () => {
  const index = createFileBlobIndex();
  index.set({ sha256: "sha-a", entry: { absPath: "/a", size: 10 } });
  assert.deepEqual(index.get({ sha256: "sha-a" }), { absPath: "/a", size: 10 });
  assert.equal(index.size, 1);
});

test("get returns undefined for a sha that was never recorded", () => {
  const index = createFileBlobIndex();
  assert.equal(index.get({ sha256: "missing" }), undefined);
});

test("set overwrites an existing key without growing size", () => {
  const index = createFileBlobIndex();
  index.set({ sha256: "sha-a", entry: { absPath: "/a", size: 10 } });
  index.set({ sha256: "sha-a", entry: { absPath: "/a-moved", size: 20 } });
  assert.equal(index.size, 1);
  assert.deepEqual(index.get({ sha256: "sha-a" }), { absPath: "/a-moved", size: 20 });
});

test("exports the documented default cap", () => {
  assert.equal(FILE_BLOB_INDEX_MAX_ENTRIES, 20_000);
});

test("createFileBlobIndex refuses a non-positive cap", () => {
  assert.throws(() => createFileBlobIndex({ maxEntries: 0 }), RangeError);
  assert.throws(() => createFileBlobIndex({ maxEntries: -1 }), RangeError);
  assert.throws(() => createFileBlobIndex({ maxEntries: 1.5 }), RangeError);
});

test("evicts the least-recently-touched entry once the cap is exceeded", () => {
  const index = createFileBlobIndex({ maxEntries: 3 });
  index.set({ sha256: "sha-1", entry: { absPath: "/1", size: 1 } });
  index.set({ sha256: "sha-2", entry: { absPath: "/2", size: 2 } });
  index.set({ sha256: "sha-3", entry: { absPath: "/3", size: 3 } });
  index.set({ sha256: "sha-4", entry: { absPath: "/4", size: 4 } }); // over the cap — evicts sha-1, the oldest untouched entry
  assert.equal(index.size, 3);
  assert.equal(index.get({ sha256: "sha-1" }), undefined);
  assert.deepEqual(index.get({ sha256: "sha-2" }), { absPath: "/2", size: 2 });
  assert.deepEqual(index.get({ sha256: "sha-3" }), { absPath: "/3", size: 3 });
  assert.deepEqual(index.get({ sha256: "sha-4" }), { absPath: "/4", size: 4 });
});

test("a read bumps recency, protecting an entry from an eviction that would otherwise take it", () => {
  const index = createFileBlobIndex({ maxEntries: 3 });
  index.set({ sha256: "sha-1", entry: { absPath: "/1", size: 1 } });
  index.set({ sha256: "sha-2", entry: { absPath: "/2", size: 2 } });
  index.set({ sha256: "sha-3", entry: { absPath: "/3", size: 3 } });
  // Touch sha-1 so it is now the MOST recently used, not the least.
  assert.deepEqual(index.get({ sha256: "sha-1" }), { absPath: "/1", size: 1 });
  index.set({ sha256: "sha-4", entry: { absPath: "/4", size: 4 } }); // should evict sha-2 (now the oldest), not sha-1
  assert.deepEqual(index.get({ sha256: "sha-1" }), { absPath: "/1", size: 1 });
  assert.equal(index.get({ sha256: "sha-2" }), undefined);
  assert.deepEqual(index.get({ sha256: "sha-3" }), { absPath: "/3", size: 3 });
  assert.deepEqual(index.get({ sha256: "sha-4" }), { absPath: "/4", size: 4 });
});

test("re-setting an existing key also bumps its recency", () => {
  const index = createFileBlobIndex({ maxEntries: 3 });
  index.set({ sha256: "sha-1", entry: { absPath: "/1", size: 1 } });
  index.set({ sha256: "sha-2", entry: { absPath: "/2", size: 2 } });
  index.set({ sha256: "sha-3", entry: { absPath: "/3", size: 3 } });
  index.set({ sha256: "sha-1", entry: { absPath: "/1-again", size: 11 } }); // re-touch sha-1 via set, not get
  index.set({ sha256: "sha-4", entry: { absPath: "/4", size: 4 } }); // should evict sha-2, not sha-1
  assert.deepEqual(index.get({ sha256: "sha-1" }), { absPath: "/1-again", size: 11 });
  assert.equal(index.get({ sha256: "sha-2" }), undefined);
});
