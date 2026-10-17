import { createHash } from 'node:crypto';
import { nowIso, type Clock, type IdGenerator } from '@jini-ai/core/primitives';
import type { AssetBlobRepoPort, BlobStorePort, MediaRepoPort } from './ports.js';
import type { AssetRenditionRecord, MediaRecord } from './types.js';
import { withSha256Lock } from './blob-gc-lock.js';
import { sanitizeSvg } from './sanitize-svg.js';
import { MediaValidationError } from './types.js';
import { DEFAULT_MAX_UPLOAD_BYTES } from './media-service.js';

/** Atomic source switch supplied by the host's versioned persistence adapter. */
export interface MediaFileReplacementRepoPort extends MediaRepoPort {
  /** Explicit replacement is separate from metadata/import's write-once source rule. The source
   * compare-and-set and rendition invalidation MUST commit atomically. Hosts without that
   * transaction capability omit this method and callers refuse the command. Old shared blobs
   * are retained; replacing a file is never a purge. */
  replaceFileIfVersion?(required: {
    workspaceId: string; id: string; ifVersion: number; sha256: string; storageKey: string;
    originalRenditionId: string; updatedAt: string;
  }, optional?: Record<string, never>): Promise<{ applied: boolean }>;
  /** A transform begun against an old source must not resurrect its invalidated preview. */
  saveRenditionIfSource?(required: { record: AssetRenditionRecord; sourceSha256: string },
    optional?: Record<string, never>): Promise<{ applied: boolean }>;
}

export interface ReplaceMediaFileDeps {
  workspaceId: string;
  clock: Clock;
  idGen: IdGenerator;
  mediaRepo: MediaFileReplacementRepoPort;
  assetBlobRepo: AssetBlobRepoPort;
  blobStore: BlobStorePort;
  mediaContentTypeStore: { set(input: { workspaceId: string; sha256: string; contentType: string }): Promise<void> };
}

/** Stage verified bytes before the atomic source switch, under the existing GC/dedup lock.
 * No temporary media identity is created. If the CAS fails, an unreferenced staged blob may
 * remain for the normal orphan sweep; deleting it here could destroy another upload's bytes.
 * Callers authorize and validate/sniff bounded bytes before invoking this operation.
 * @returns The updated asset, preserving its identity and metadata, or null on a version conflict.
 * @throws Storage failures propagate; callers must check replacement capabilities first.
 * @complexity O(bytes.length) hashing; constant indexed blob reads/writes under the shared GC lock. */
export async function replaceMediaFile({ deps, media, bytes, contentType, principalId }: {
  deps: ReplaceMediaFileDeps; media: MediaRecord; bytes: Uint8Array; contentType: string; principalId: string;
}, { maxUploadBytes = DEFAULT_MAX_UPLOAD_BYTES }: { maxUploadBytes?: number } = {}): Promise<MediaRecord | null> {
  if (bytes.byteLength === 0 || bytes.byteLength > maxUploadBytes) {
    throw new MediaValidationError({ message: 'replacement file is empty or exceeds the upload size cap' });
  }
  // Replacement bypasses uploadMedia, so it must call the same SVG sanitizer before hashing.
  const safeBytes = contentType === 'image/svg+xml' ? await sanitizeSvg({ bytes }) : bytes;
  if (safeBytes.byteLength > maxUploadBytes) throw new MediaValidationError({ message: 'sanitized file exceeds the upload size cap' });
  const sha256 = createHash('sha256').update(safeBytes).digest('hex');
  const updatedAt = nowIso({ clock: deps.clock });
  return withSha256Lock({ key: sha256, criticalSection: async () => {
    let blob = await deps.assetBlobRepo.findByHash({ workspaceId: deps.workspaceId, sha256 });
    if (!blob) {
      const { storageKey } = await deps.blobStore.put({ workspaceId: deps.workspaceId, sha256, bytes: safeBytes });
      blob = { id: deps.idGen.newId(), workspaceId: deps.workspaceId, sha256, storageKey,
        status: 'active', createdAt: updatedAt, createdByPrincipal: principalId };
      await deps.assetBlobRepo.save(blob);
    } else if (blob.status === 'tombstoned') {
      blob = { ...blob, status: 'active', tombstonedAt: undefined };
      await deps.assetBlobRepo.save(blob);
    }
    await deps.mediaContentTypeStore.set({ workspaceId: deps.workspaceId, sha256, contentType });
    const { applied } = await deps.mediaRepo.replaceFileIfVersion!({ workspaceId: deps.workspaceId,
      id: media.id, ifVersion: media.version, sha256, storageKey: blob.storageKey,
      originalRenditionId: deps.idGen.newId(), updatedAt });
    return applied ? { ...media, source: { sha256 }, updatedAt, version: media.version + 1 } : null;
  } });
}
