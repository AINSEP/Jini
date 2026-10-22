import assert from "node:assert/strict";
import { test } from "vitest";

import type { ObjectStore, ObjectStorePutOptions } from "@jini-ai/core/object-store";

import { computeBlobStorageKey } from "../blob-key.js";
import { blobStoreFromObjectStore } from "../blob-store.object-store.js";

/** A fake ObjectStore recording each call, keyed exactly as given. */
function fakeObjectStore() {
  const objects = new Map<string, Uint8Array>();
  const calls: Array<{ op: string; key: string; options?: ObjectStorePutOptions }> = [];
  const store: ObjectStore = {
    async put({ key, bytes }, options = {}) {
      calls.push({ op: "put", key, options });
      if (options.ifAbsent && objects.has(key)) return { written: false };
      objects.set(key, bytes);
      return { written: true };
    },
    async get({ key }) { calls.push({ op: "get", key }); return objects.get(key) ?? null; },
    async head({ key }) { calls.push({ op: "head", key }); const bytes = objects.get(key); return bytes ? { size: bytes.byteLength } : null; },
    async delete({ key }) { calls.push({ op: "delete", key }); objects.delete(key); },
  };
  return { store, objects, calls };
}

const workspaceId = "11111111-1111-4111-8111-111111111111";
const sha256 = "ab".padEnd(64, "c");
const bytes = new Uint8Array([1, 2, 3]);

test("keys are computeBlobStorageKey verbatim (no data migration)", async () => {
  const { store, objects } = fakeObjectStore();
  const blobs = blobStoreFromObjectStore({ store });
  const { storageKey } = await blobs.put({ workspaceId, sha256, bytes });
  assert.equal(storageKey, computeBlobStorageKey({ workspaceId, sha256 }));
  assert.equal(storageKey, `ws/${workspaceId}/blobs/ab/${sha256}`);
  assert.deepEqual([...objects.keys()], [storageKey]);
});

test("putIfAbsent maps to the store's atomic ifAbsent write", async () => {
  const { store, calls } = fakeObjectStore();
  const blobs = blobStoreFromObjectStore({ store });
  assert.deepEqual(await blobs.putIfAbsent({ workspaceId, sha256, bytes }), { storageKey: computeBlobStorageKey({ workspaceId, sha256 }), written: true });
  assert.equal((await blobs.putIfAbsent({ workspaceId, sha256, bytes: new Uint8Array([9]) })).written, false);
  assert.deepEqual(calls.filter((c) => c.op === "put").map((c) => c.options), [{ ifAbsent: true }, { ifAbsent: true }]);
});

test("get/sizeOf/exists/remove, with absence mapped to the port's contract", async () => {
  const { store } = fakeObjectStore();
  const blobs = blobStoreFromObjectStore({ store });
  const { storageKey } = await blobs.put({ workspaceId, sha256, bytes });
  assert.deepEqual(await blobs.get({ storageKey }), bytes);
  assert.equal(await blobs.sizeOf!({ storageKey }), 3);
  assert.equal(await blobs.exists({ storageKey }), true);
  await blobs.remove({ storageKey });
  await blobs.remove({ storageKey });
  assert.equal(await blobs.exists({ storageKey }), false);
  assert.equal(await blobs.sizeOf!({ storageKey }), null);
  await assert.rejects(blobs.get({ storageKey }), new Error(`blob '${storageKey}' was not found`));
});

test("store faults propagate (never read as absence)", async () => {
  const { store } = fakeObjectStore();
  const failing: ObjectStore = { ...store, head: async () => { throw new Error("HTTP 503"); } };
  const blobs = blobStoreFromObjectStore({ store: failing });
  await assert.rejects(blobs.exists({ storageKey: "k" }), /HTTP 503/);
  await assert.rejects(blobs.sizeOf!({ storageKey: "k" }), /HTTP 503/);
});
