import type { BlobFence, BlobStorageKeyFor } from "@jini-ai/core/contracts/blob-gc";
import { computeBlobStorageKey, withSha256Lock, type BlobStorePort } from "../index.js";
import { bytesMatchSha256 } from "../../publish/transfer/blob-staging.js";

/**
 * @file The host's bindings for `@jini-ai/cms`'s fenced blob writes (`importMediaEntity`, the blob PUT
 * route, seed hydration): the key fence, the canonical storage key, and stored-object verification.
 *
 * The fence is PROCESS-LOCAL: it serializes on `withSha256Lock`'s shared in-process lock map under a
 * `blob-fence:` key namespace, so every caller in this process contends on the same keys without a
 * new singleton. It is not a cross-process (durable) fence; a multi-process deployment needs a
 * storage-backed fence bound here instead.
 */

/** The three bindings every fenced CMS blob write requires. */
export type HostBlobWriteBindings = {
  readonly blobFence: BlobFence;
  readonly storageKeyFor: BlobStorageKeyFor;
  readonly verifyStoredBlob: (required: { storageKey: string; sha256: string; byteLength: number }, _optional?: Record<string, never>) => Promise<void>;
};

/** Takes each lock in order (already sorted + deduplicated), then runs `work` under all of them. */
function withLockChain<T>({ keys, work }: { keys: readonly string[]; work: () => Promise<T> }, _optional: Record<string, never> = {}): Promise<T> {
  const [head, ...rest] = keys;
  if (head === undefined) return work();
  return withSha256Lock({ key: head, criticalSection: () => withLockChain({ keys: rest, work }) });
}

/** A process-local `BlobFence`: keys sorted and deduplicated, asset and key locks in separate namespaces. */
export function createProcessBlobFence(_optional: Record<string, never> = {}): BlobFence {
  return {
    withKeys<T>({ workspaceId, storageKeys, work }: { workspaceId: string; storageKeys: readonly string[]; work: () => Promise<T> }): Promise<T> {
      const keys = [...new Set(storageKeys)].sort().map((storageKey) => `blob-fence:key:${workspaceId}:${storageKey}`);
      return withLockChain({ keys, work });
    },
    withAsset<T>({ workspaceId, assetId, work }: { workspaceId: string; assetId: string; work: () => Promise<T> }): Promise<T> {
      return withSha256Lock({ key: `blob-fence:asset:${workspaceId}:${assetId}`, criticalSection: work });
    },
  };
}

/** Builds the fence, key and verification bindings over one blob store. */
export function createHostBlobWriteBindings(
  { blobStore }: { blobStore: Pick<BlobStorePort, "get"> },
  { blobFence = createProcessBlobFence() }: { blobFence?: BlobFence } = {},
): HostBlobWriteBindings {
  return {
    blobFence,
    storageKeyFor: ({ workspaceId, sha256 }, _o = {}) => computeBlobStorageKey({ workspaceId, sha256 }),
    verifyStoredBlob: async ({ storageKey, sha256, byteLength }, _o = {}) => {
      const stored = await blobStore.get({ storageKey });
      if (stored.byteLength !== byteLength || !bytesMatchSha256({ bytes: stored, claimedSha256: sha256 })) {
        throw new Error(`Stored blob '${storageKey}' failed verification`);
      }
    },
  };
}
