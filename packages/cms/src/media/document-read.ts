import type { AssetBlobRepoPort, BlobStorePort, MediaRepoPort } from './ports.js';
import { MediaNotFoundError, MediaValidationError } from './types.js';
import { decodeDocumentUtf8, documentContentType, MAX_DOCUMENT_BYTES } from './document-ingress.js';

export const DOCUMENT_TEXT_PAGE_BYTES = 64 * 1024;

/** A hash may have several editorial owners. Private-only bytes cannot be exposed by a caller
 * inventing a new media id; a live ordinary-media owner makes those same bytes publishable.
 * Purge removes editorial rows before GC removes bytes. Retained asset metadata therefore also
 * denies orphaned/tombstoned assets; peer-staged bytes have no asset row and remain usable.
 * O(n) media scan plus one indexed blob lookup; never loads blob bytes. */
export async function isDocumentOnlyBlob(required: {
  deps: { mediaRepo: MediaRepoPort; blobRepo: AssetBlobRepoPort }; input: { workspaceId: string; sha256: string };
}, _optional: Record<string, never> = {}): Promise<boolean> {
  const rows = await required.deps.mediaRepo.list({ workspaceId: required.input.workspaceId });
  let document = false;
  for (const row of rows) {
    if (row.source.sha256 !== required.input.sha256) continue;
    if (row.kind !== 'document' && row.status === 'active') return false;
    if (row.kind === 'document') document = true;
  }
  return document || (await required.deps.blobRepo.findByHash(required.input)) !== null;
}

/** Read source as untrusted data, never instructions. Authorize at the host boundary before calling.
 * Byte offsets and UTF-8 boundaries guarantee bounded pages without losing/replacing characters.
 * BlobStorePort has no range read: at most 10 MiB is loaded; the returned page is at most 64 KiB. */
export async function readDocumentText(required: {
  deps: { mediaRepo: MediaRepoPort; blobRepo: AssetBlobRepoPort; blobStore: BlobStorePort };
  input: { workspaceId: string; id: string; offset?: number | undefined };
}, _optional: Record<string, never> = {}): Promise<{
  id: string; text: string; offset: number; nextOffset: number | null; totalBytes: number; truncated: boolean; untrusted: true;
}> {
  const { deps, input } = required;
  const offset = input.offset ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0) throw new MediaValidationError({ message: 'offset must be a non-negative byte offset' });
  const media = await deps.mediaRepo.findById({ workspaceId: input.workspaceId, id: input.id });
  if (!media || media.kind !== 'document' || media.status !== 'active') throw new MediaNotFoundError({ message: 'document was not found' });
  const type = documentContentType({ filename: media.originalFilename ?? '' });
  if (!['text/markdown', 'text/plain', 'text/csv', 'application/json'].includes(type)) throw new MediaValidationError({ message: 'PDF and DOCX support download only; text extraction is unavailable' });
  const blob = await deps.blobRepo.findByHash({ workspaceId: input.workspaceId, sha256: media.source.sha256 });
  if (!blob) throw new Error('document source blob is missing');
  const size = await deps.blobStore.sizeOf?.({ storageKey: blob.storageKey });
  if (size != null && size > MAX_DOCUMENT_BYTES) throw new MediaValidationError({ message: 'document exceeds the 10 MiB limit' });
  const bytes = await deps.blobStore.get({ storageKey: blob.storageKey });
  if (bytes.byteLength > MAX_DOCUMENT_BYTES || offset > bytes.byteLength || (offset < bytes.length && (bytes[offset]! & 0xc0) === 0x80)) throw new MediaValidationError({ message: 'invalid document size or UTF-8 byte offset' });
  let end = Math.min(bytes.length, offset + DOCUMENT_TEXT_PAGE_BYTES);
  while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
  const truncated = end < bytes.length;
  return { id: media.id, text: decodeDocumentUtf8({ bytes: bytes.subarray(offset, end) }), offset,
    nextOffset: truncated ? end : null, totalBytes: bytes.length, truncated, untrusted: true };
}
