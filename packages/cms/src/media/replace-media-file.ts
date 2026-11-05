import { createHash } from 'node:crypto';
import { nowIso, type Clock, type IdGenerator } from '@jini-ai/core/primitives';
import type { AssetBlobRepoPort, BlobStorePort, MediaRepoPort } from './ports.js';
import type { AssetRenditionRecord, MediaProvenance, MediaRecord } from './types.js';
import { withSha256Lock } from './blob-gc-lock.js';
import { sanitizeSvg } from './sanitize-svg.js';
import { MediaValidationError } from './types.js';
import { DEFAULT_MAX_UPLOAD_BYTES } from './media-service.js';
import { safeMediaProvenance } from './provenance.js';
import { sniffContentType } from './content-type-sniffer.js';

/** Editorial fields that may travel with a replacement; identity and creation stay local. */
export type MediaReplacementMetadata = Pick<MediaRecord,
  'title' | 'slug' | 'alt' | 'caption' | 'credit' | 'width' | 'height' | 'cssClass' | 'htmlAttributes' | 'status'>;

/** Copy only replacement editorial fields; even structurally typed records cannot replace identity.
 * @returns A fresh metadata object. @complexity O(1), fixed field count; no effects. */
export function mediaReplacementMetadata({ media }: { media: MediaReplacementMetadata }, _options = {}): MediaReplacementMetadata {
  const { title, slug, alt, caption, credit, width, height, cssClass, htmlAttributes, status } = media;
  return { title, slug, alt, caption, credit, width, height, cssClass, htmlAttributes, status };
}

/** Compare-and-set source switch, also used to compensate a failed command record. */
export type MediaFileReplacementInput = {
  workspaceId: string; id: string; ifVersion: number; sha256: string; storageKey: string;
  originalRenditionId: string; updatedAt: string;
  metadata?: MediaReplacementMetadata;
} & ({ restore?: undefined; contentType: string; provenance: MediaProvenance } | {
  /** Internal compensation restores bookkeeping/source verbatim, only while the applied version holds. */
  restore: { version: number; updatedAt: string; source: MediaRecord['source'] };
  contentType?: never; provenance?: never;
});

/** Build a replacement or compensation row without copying caller identity fields.
 * @returns A fresh record. @complexity O(1), fixed metadata fields; no effects. */
export function mediaFileReplacementRecord({ media, input }: { media: MediaRecord; input: Pick<MediaFileReplacementInput,
  'metadata' | 'restore' | 'sha256' | 'contentType' | 'provenance' | 'ifVersion' | 'updatedAt'> }, _options = {}): MediaRecord {
  const metadata = input.metadata ? mediaReplacementMetadata({ media: input.metadata }) : {};
  return { ...media, ...metadata, source: input.restore?.source ?? { sha256: input.sha256,
    contentType: input.contentType, provenance: input.provenance },
    version: input.restore?.version ?? input.ifVersion + 1, updatedAt: input.restore?.updatedAt ?? input.updatedAt };
}

/** Atomic source switch supplied by the host's versioned persistence adapter. */
export interface MediaFileReplacementRepoPort extends MediaRepoPort {
  /** Explicit replacement is separate from metadata/import's write-once source rule. The source
   * compare-and-set, editorial fields, sniffed blob type and rendition invalidation MUST commit atomically. Hosts without that
   * transaction capability omit this method and callers refuse the command. Old shared blobs
   * are retained; replacing a file is never a purge. */
  replaceFileIfVersion?(required: MediaFileReplacementInput, optional?: Record<string, never>): Promise<{ applied: boolean }>;
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
}

/** Bound replacement work and apply the upload sanitizer before hashing or staging.
 * @returns Sanitized bytes. @throws MediaValidationError for empty/oversized input or output.
 * @complexity O(B) time/space for B bytes capped by maxUploadBytes; no store I/O. */
async function validatedReplacementBytes({ bytes, contentType, maxUploadBytes }: {
  bytes: Uint8Array; contentType: string; maxUploadBytes: number;
}, _options = {}): Promise<Uint8Array> {
  if (bytes.byteLength === 0 || bytes.byteLength > maxUploadBytes) {
    throw new MediaValidationError({ message: 'replacement file is empty or exceeds the upload size cap' });
  }
  // Replacement bypasses uploadMedia, so it must call the same SVG sanitizer before hashing.
  const safeBytes = contentType === 'image/svg+xml' ? await sanitizeSvg({ bytes }) : bytes;
  if (safeBytes.byteLength > maxUploadBytes) throw new MediaValidationError({ message: 'sanitized file exceeds the upload size cap' });
  return safeBytes;
}

/** Stage verified bytes before the atomic source switch, under the existing GC/dedup lock.
 * No temporary media identity is created. If the CAS fails, an unreferenced staged blob may
 * remain for the normal orphan sweep; deleting it here could destroy another upload's bytes.
 * Callers authorize and validate/sniff bounded bytes before invoking this operation.
 * @returns The updated asset, retaining identity/creation and applying optional editorial metadata,
 * or null on a version conflict. The adapter owns atomic blob-type/rendition updates.
 * @throws MediaValidationError for missing capability, invalid size or reviewed-hash mismatch;
 * storage failures propagate.
 * @example await replaceMediaFile({ deps, media, bytes, contentType, principalId,
 *   expectedSha256: reviewedHash, metadata: publishedRecord });
 * @complexity O(bytes.length) hashing; constant indexed blob reads/writes under the shared GC lock. */
export async function replaceMediaFile({ deps, media, bytes, contentType, principalId, provenance, metadata, expectedSha256 }: {
  deps: ReplaceMediaFileDeps; media: MediaRecord; bytes: Uint8Array; contentType: string; principalId: string;
  provenance?: MediaProvenance | undefined;
  metadata?: MediaReplacementMetadata;
  expectedSha256?: string;
}, { maxUploadBytes = DEFAULT_MAX_UPLOAD_BYTES }: { maxUploadBytes?: number } = {}): Promise<MediaRecord | null> {
  if (!deps.mediaRepo.replaceFileIfVersion) throw new MediaValidationError({ message: 'Atomic file replacement is unavailable. Update the destination before replacing this file.' });
  // Library v1 supports metadata rename, never byte replacement under an immutable document name.
  if (media.kind === 'document') throw new MediaValidationError({ message: 'document file replacement is unavailable' });
  if (media.source.private) throw new MediaValidationError({ message: 'Private submitted file replacement is unavailable. Keep the original submission file and upload a separate public media item if needed.' });
  const safeBytes = await validatedReplacementBytes({ bytes, contentType, maxUploadBytes });
  const sha256 = createHash('sha256').update(safeBytes).digest('hex');
  if (expectedSha256 !== undefined && expectedSha256 !== sha256) {
    throw new MediaValidationError({ message: 'Replacement bytes do not match the reviewed sha256 after sanitizing. Re-import the file and plan publishing again.' });
  }
  const source = { sha256, contentType: sniffContentType({ bytes: safeBytes }), provenance: safeMediaProvenance({ source: provenance }) };
  const updatedAt = nowIso({ clock: deps.clock });
  return withSha256Lock({
    key: sha256, criticalSection: async () => {
      let blob = await deps.assetBlobRepo.findByHash({ workspaceId: deps.workspaceId, sha256 });
      if (!blob) {
        const { storageKey } = await deps.blobStore.put({ workspaceId: deps.workspaceId, sha256, bytes: safeBytes });
        blob = {
          id: deps.idGen.newId(), workspaceId: deps.workspaceId, sha256, storageKey,
          status: 'active', createdAt: updatedAt, createdByPrincipal: principalId
        };
        await deps.assetBlobRepo.save(blob);
      } else if (blob.status === 'tombstoned') {
        blob = { ...blob, status: 'active', tombstonedAt: undefined };
        await deps.assetBlobRepo.save(blob);
      } else {
        // An already-active content-addressed blob is reused without another write.
      }
      // The adapter records type in the same transaction as CAS; a losing replace cannot change it.
      const replacement: MediaFileReplacementInput = {
        workspaceId: deps.workspaceId,
        id: media.id, ifVersion: media.version, sha256, storageKey: blob.storageKey,
        originalRenditionId: deps.idGen.newId(), updatedAt, contentType: source.contentType, provenance: source.provenance,
        ...(metadata ? { metadata } : {})
      };
      const { applied } = await deps.mediaRepo.replaceFileIfVersion!(replacement);
      return applied ? mediaFileReplacementRecord({ media, input: replacement }) : null;
    }
  });
}
