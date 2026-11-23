import assert from "node:assert/strict";
import { test } from "vitest";

import { ToolInputError } from "@jini-ai/core";
import type { AssetBlobRepoPort, BlobStorePort, MediaRecord } from "../../index.js";
import { readStoredBytes } from "../original-bytes.js";

/**
 * @file The original-bytes reader over fake blob ports: the host-supplied tool prefix leads every
 * refusal (missing blob, unknown or oversized size, oversized bytes) and an in-cap read returns the bytes.
 */

const asset = { id: "asset-1", source: { sha256: "abc" } } as unknown as MediaRecord;
function deps({ found = true, size, bytes = new Uint8Array([1, 2, 3]) }: { found?: boolean; size?: number | null; bytes?: Uint8Array } = {}) {
  const assetBlobRepo = { findByHash: async () => (found ? { storageKey: "k" } : null) } as unknown as AssetBlobRepoPort;
  const blobStore = { get: async () => bytes, ...(size === undefined ? {} : { sizeOf: async () => size }) } as unknown as BlobStorePort;
  return { workspaceId: "ws", assetBlobRepo, blobStore };
}

test("every refusal carries the host-supplied tool prefix", async () => {
  const refuses = (promise: Promise<unknown>, message: string) => assert.rejects(promise, (error: Error) => error instanceof ToolInputError && error.message === message);
  await refuses(readStoredBytes({ deps: deps({ found: false }), asset, errorPrefix: "asset_transfer" }), "asset_transfer: media asset 'asset-1' has no stored file, so there is nothing to show.");
  await refuses(readStoredBytes({ deps: deps({ size: null }), asset, errorPrefix: "media_view_image" }, { maxBytes: 2 }), "media_view_image: media asset 'asset-1' has unknown size or exceeds 2 bytes");
  await refuses(readStoredBytes({ deps: deps({ size: 9 }), asset, errorPrefix: "x" }, { maxBytes: 2 }), "x: media asset 'asset-1' has unknown size or exceeds 2 bytes");
  await refuses(readStoredBytes({ deps: deps({ size: 1 }), asset, errorPrefix: "x" }, { maxBytes: 2 }), "x: media asset 'asset-1' exceeds 2 bytes");
});

test("an in-cap or uncapped read returns the stored bytes", async () => {
  assert.deepEqual(await readStoredBytes({ deps: deps(), asset, errorPrefix: "x" }), new Uint8Array([1, 2, 3]));
  assert.deepEqual(await readStoredBytes({ deps: deps({ size: 3 }), asset, errorPrefix: "x" }, { maxBytes: 3 }), new Uint8Array([1, 2, 3]));
});
