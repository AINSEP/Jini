import { ToolInputError } from "@jini-ai/core";
import type { AssetBlobRepoPort, BlobStorePort, MediaRecord } from "../index.js";

function refusal({ message }: { message: string }, _optional: Record<string, never> = {}): ToolInputError {
  return new ToolInputError({ message: `media_view_image: ${message}` });
}

/** Read an original through the media owner, optionally capped before fetching the blob.
 * @returns Original bytes. @throws ToolInputError for missing/oversized/unknown-size capped blobs.
 * @complexity O(bytes) storage read; capped callers require the blob store's size port.
 * @example await readStoredBytes({ deps, asset }, { maxBytes: 25 * 1024 * 1024 });
 */
export async function readStoredBytes({ deps, asset }: { deps: { workspaceId: string; assetBlobRepo: AssetBlobRepoPort; blobStore: BlobStorePort }; asset: MediaRecord }, { maxBytes }: { maxBytes?: number } = {}): Promise<Uint8Array> {
  const blob = await deps.assetBlobRepo.findByHash({ workspaceId: deps.workspaceId, sha256: asset.source.sha256 });
  if (!blob) throw refusal({ message: `media asset '${asset.id}' has no stored file, so there is nothing to show.` });
  if (maxBytes !== undefined) {
    const size = await deps.blobStore.sizeOf?.({ storageKey: blob.storageKey });
    if (size == null || size > maxBytes) throw refusal({ message: `media asset '${asset.id}' has unknown size or exceeds ${maxBytes} bytes` });
  }
  const bytes = await deps.blobStore.get({ storageKey: blob.storageKey });
  if (maxBytes !== undefined && bytes.byteLength > maxBytes) throw refusal({ message: `media asset '${asset.id}' exceeds ${maxBytes} bytes` });
  return bytes;
}
