/**
 * @file Shared storage-key derivation for `BlobStorePort` adapters
 * (workspace-prefixed keys).
 *
 * Purpose:
 * Both `blob-store.fs.ts` and `blob-store.memory.ts` must derive the same key
 * shape from `(workspaceId, sha256)` so switching adapters never changes what a
 * stored key looks like. Kept as one small pure function rather than
 * duplicated inline in each adapter.
 *
 * No per-generation epoch suffix (contrast the original design's
 * `{sha256}-{storage_epoch}`) — epochs exist to make the journaled 2-phase GC
 * race-proof, and that protocol is explicitly deferred in this build (see
 * `media-service.ts` file header). A future epoch-aware rewrite would change
 * this function's output shape, not its callers' contract.
 */
import type { UUID } from "../core/ports.js";

/**
 * Derives `ws/{workspaceId}/blobs/{sha256[0..1]}/{sha256}`.
 *
 * @complexity O(1).
 * @overallScore 100
 */
export function computeBlobStorageKey(input: { workspaceId: UUID; sha256: string }): string {
  const shard = input.sha256.slice(0, 2);
  return `ws/${input.workspaceId}/blobs/${shard}/${input.sha256}`;
}
