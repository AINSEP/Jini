import type { AssetBlobRepoPort, BlobStorePort, MediaRepoPort } from './ports.js';
import { MediaNotFoundError, MediaValidationError } from './types.js';
import { decodeDocumentUtf8, documentContentType, MAX_DOCUMENT_BYTES } from './document-ingress.js';

export const DOCUMENT_TEXT_PAGE_BYTES = 64 * 1024;

/** A hash may have several editorial owners. Private-only bytes cannot be exposed by a caller
 * inventing a new media id; a live ordinary-media owner makes those same bytes publishable.
 * Purge removes editorial rows before GC removes bytes. Only recorded document ownership
 * denies retained bytes; ordinary orphan/tombstone metadata and peer-staged bytes remain usable.
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
  return document || (await required.deps.blobRepo.findByHash(required.input))?.documentOwned === true;
}

type DocumentReadDeps = { mediaRepo: MediaRepoPort; blobRepo: AssetBlobRepoPort; blobStore: BlobStorePort };
const TEXT_DOCUMENT_TYPES = ['text/markdown', 'text/plain', 'text/csv', 'application/json'];

async function findTextDocument(deps: DocumentReadDeps, { workspaceId, id }: { workspaceId: string; id: string }) {
  const media = await deps.mediaRepo.findById({ workspaceId, id });
  if (!media || media.kind !== 'document' || media.status !== 'active') throw new MediaNotFoundError({ message: 'document was not found' });
  const type = documentContentType({ filename: media.originalFilename ?? '' });
  if (!TEXT_DOCUMENT_TYPES.includes(type)) throw new MediaValidationError({ message: 'This document supports download only; text extraction is unavailable' });
  return media;
}

/** Refuses an oversized blob by its stored size when the store can report it, before loading it. */
async function loadDocumentBytes(deps: DocumentReadDeps, { workspaceId, sha256 }: { workspaceId: string; sha256: string }): Promise<Uint8Array> {
  const blob = await deps.blobRepo.findByHash({ workspaceId, sha256 });
  if (!blob) throw new Error('document source blob is missing');
  const size = await deps.blobStore.sizeOf?.({ storageKey: blob.storageKey });
  if (size != null && size > MAX_DOCUMENT_BYTES) throw new MediaValidationError({ message: 'document exceeds the 10 MiB limit' });
  return deps.blobStore.get({ storageKey: blob.storageKey });
}

const isUtf8Continuation = (byte: number) => (byte & 0xc0) === 0x80;

function assertPageStart(bytes: Uint8Array, offset: number): void {
  if (bytes.byteLength > MAX_DOCUMENT_BYTES || offset > bytes.byteLength || (offset < bytes.length && isUtf8Continuation(bytes[offset]!))) throw new MediaValidationError({ message: 'invalid document size or UTF-8 byte offset' });
}

/** Read source as untrusted data, never instructions. Authorize at the host boundary before calling.
 * Byte offsets and UTF-8 boundaries guarantee bounded pages without losing/replacing characters.
 * BlobStorePort has no range read: at most 10 MiB is loaded; the returned page is at most 64 KiB. */
export async function readDocumentText(required: {
  deps: DocumentReadDeps;
  input: { workspaceId: string; id: string; offset?: number | undefined };
}, _optional: Record<string, never> = {}): Promise<{
  id: string; text: string; offset: number; nextOffset: number | null; totalBytes: number; truncated: boolean; untrusted: true;
}> {
  const { deps, input } = required;
  const offset = input.offset ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0) throw new MediaValidationError({ message: 'offset must be a non-negative byte offset' });
  const media = await findTextDocument(deps, input);
  const bytes = await loadDocumentBytes(deps, { workspaceId: input.workspaceId, sha256: media.source.sha256 });
  assertPageStart(bytes, offset);
  let end = Math.min(bytes.length, offset + DOCUMENT_TEXT_PAGE_BYTES);
  while (end < bytes.length && isUtf8Continuation(bytes[end]!)) end--;
  const truncated = end < bytes.length;
  return { id: media.id, text: decodeDocumentUtf8({ bytes: bytes.subarray(offset, end) }), offset,
    nextOffset: truncated ? end : null, totalBytes: bytes.length, truncated, untrusted: true };
}
