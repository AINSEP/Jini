/**
 * @file `BlobStorePort` as a view over the one `ObjectStore` contract (`@jini-ai/core/object-store`).
 *
 * Media keeps its content-addressed port; the bytes go to whichever object-store provider the host
 * selected (local filesystem by default, S3-compatible via a plugin). Storage keys are unchanged —
 * `computeBlobStorageKey` still derives `ws/{workspaceId}/blobs/{sha256[0..1]}/{sha256}` — so
 * switching a site's adapter to this view addresses exactly the keys `asset_blobs.storage_key`
 * already records.
 *
 * `get()` of an absent key throws the same `blob '<key>' was not found` text `InMemoryBlobStore`
 * and the former `S3BlobStore` threw; callers branch on `exists()` first or treat any throw as
 * "unreadable".
 */
import type { ObjectStore } from "@jini-ai/core/object-store";

import { computeBlobStorageKey } from "./blob-key.js";
import type { BlobStorePort } from "./ports.js";

/**
 * Wraps `store` as a `BlobStorePort`.
 * @complexity Each call delegates to exactly one object-store call.
 */
export function blobStoreFromObjectStore(required: { readonly store: ObjectStore }, _optional: Record<string, never> = {}): BlobStorePort {
  const { store } = required;
  return {
    async put(input) {
      const storageKey = computeBlobStorageKey(input);
      await store.put({ key: storageKey, bytes: input.bytes });
      return { storageKey };
    },
    // Content-addressed, so whichever concurrent writer's identical bytes land is correct; the
    // store's `ifAbsent` is the atomic create-only write `BlobStorePort.putIfAbsent` requires.
    async putIfAbsent(input) {
      const storageKey = computeBlobStorageKey(input);
      const { written } = await store.put({ key: storageKey, bytes: input.bytes }, { ifAbsent: true });
      return { storageKey, written };
    },
    async get({ storageKey }) {
      const bytes = await store.get({ key: storageKey });
      if (bytes === null) throw new Error(`blob '${storageKey}' was not found`);
      return bytes;
    },
    async sizeOf({ storageKey }) {
      return (await store.head({ key: storageKey }))?.size ?? null;
    },
    async exists({ storageKey }) {
      return (await store.head({ key: storageKey })) !== null;
    },
    remove({ storageKey }) {
      return store.delete({ key: storageKey });
    },
  };
}
