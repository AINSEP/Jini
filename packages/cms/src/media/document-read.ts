import type { AssetBlobRepoPort, BlobStorePort, MediaRepoPort } from './ports.js';
import { MediaNotFoundError, MediaValidationError } from './types.js';
import { decodeDocumentUtf8, documentContentType, DOCUMENT_CONTENT_TYPES, MAX_DOCUMENT_BYTES } from './document-ingress.js';

import { DOCUMENT_EXTRACTION_LIMITS, DocumentTextExtractionError, type DocumentTextExtractorPort } from './document-text.js';

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

type DocumentReadDeps = { mediaRepo: MediaRepoPort; blobRepo: AssetBlobRepoPort; blobStore: BlobStorePort; documentTextExtractors?: readonly DocumentTextExtractorPort[] | undefined };
const TEXT_DOCUMENT_TYPES = ['text/markdown', 'text/plain', 'text/csv', 'application/json'];

/** Text formats retain their decoder; binary formats require a host-selected adapter. */
function findDocumentExtractor({ deps, type }: { deps: DocumentReadDeps; type: string },
  _optional: Record<string, never> = {}): DocumentTextExtractorPort | undefined {
  if (TEXT_DOCUMENT_TYPES.includes(type)) return undefined;
  const extractor = deps.documentTextExtractors?.find(candidate => candidate.contentType === type);
  if (extractor) return extractor;
  if (type === DOCUMENT_CONTENT_TYPES.pdf || type === DOCUMENT_CONTENT_TYPES.docx) {
    throw new DocumentTextExtractionError({ code: 'DOCUMENT_TEXT_UNAVAILABLE', message: 'extraction unavailable — configure a document-text adapter for this format' });
  }
  throw new MediaValidationError({ message: 'This document supports download only; text extraction is unavailable' });
}

/** Resolve an active private document within its workspace before selecting extraction. */
async function findTextDocument(deps: DocumentReadDeps, { workspaceId, id }: { workspaceId: string; id: string }) {
  const media = await deps.mediaRepo.findById({ workspaceId, id });
  if (!media || media.kind !== 'document' || media.status !== 'active') throw new MediaNotFoundError({ message: 'document was not found' });
  const type = documentContentType({ filename: media.originalFilename ?? '' });
  return { media, extractor: findDocumentExtractor({ deps, type }) };
}

/** Refuses an oversized blob by its stored size when the store can report it, before loading it. */
async function loadDocumentBytes(deps: DocumentReadDeps, { workspaceId, sha256 }: { workspaceId: string; sha256: string }): Promise<Uint8Array> {
  const blob = await deps.blobRepo.findByHash({ workspaceId, sha256 });
  if (!blob) throw new Error('document source blob is missing');
  const size = await deps.blobStore.sizeOf?.({ storageKey: blob.storageKey });
  if (size != null && size > MAX_DOCUMENT_BYTES) throw new MediaValidationError({ message: 'document exceeds the 10 MiB limit' });
  const bytes = await deps.blobStore.get({ storageKey: blob.storageKey });
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) throw new MediaValidationError({ message: 'document exceeds the 10 MiB limit' });
  return bytes;
}

const isUtf8Continuation = (byte: number) => (byte & 0xc0) === 0x80;

function assertPageStart(bytes: Uint8Array, offset: number): void {
  if (bytes.byteLength > MAX_DOCUMENT_BYTES || offset > bytes.byteLength || (offset < bytes.length && isUtf8Continuation(bytes[offset]!))) throw new MediaValidationError({ message: 'invalid document size or UTF-8 byte offset' });
}

/** Enforce the shared port's output bounds before allocating UTF-8 bytes for response paging. */
async function extractDocumentBytes({ extractor, source }: { extractor: DocumentTextExtractorPort; source: Uint8Array }) {
  const extraction = await extractor.extract({ bytes: source, limits: DOCUMENT_EXTRACTION_LIMITS });
  if (extraction.text.length > DOCUMENT_EXTRACTION_LIMITS.maxCharacters ||
      (extraction.pagesRead ?? 0) > DOCUMENT_EXTRACTION_LIMITS.maxPages) {
    throw new MediaValidationError({ message: 'document extractor exceeded its output limits' });
  }
  const { text, truncated, ...pageCounts } = extraction;
  return { bytes: new TextEncoder().encode(text), metadata: { extractionTruncated: truncated, ...pageCounts } };
}

export interface DocumentTextPage {
  id: string; text: string; offset: number; nextOffset: number | null; totalBytes: number; truncated: boolean; untrusted: true;
  /** Extraction cutoff differs from response paging: nextOffset never promises omitted source. */
  extractionTruncated?: boolean;
  pagesRead?: number;
  totalPages?: number;
}

/** Read source as untrusted data, never instructions. Authorize at the host boundary before calling.
 * Byte offsets and UTF-8 boundaries guarantee bounded pages without losing/replacing characters.
 * BlobStorePort has no range read: at most 10 MiB is loaded; the returned page is at most 64 KiB.
 * Extracted documents are capped by DOCUMENT_EXTRACTION_LIMITS and re-extracted per offset.
 * @throws DocumentTextExtractionError when extraction is unavailable or a parser fails. */
export async function readDocumentText(required: {
  deps: DocumentReadDeps;
  input: { workspaceId: string; id: string; offset?: number | undefined };
}, _optional: Record<string, never> = {}): Promise<DocumentTextPage> {
  const { deps, input } = required;
  const offset = input.offset ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0) throw new MediaValidationError({ message: 'offset must be a non-negative byte offset' });
  const { media, extractor } = await findTextDocument(deps, input);
  const source = await loadDocumentBytes(deps, { workspaceId: input.workspaceId, sha256: media.source.sha256 });
  let bytes = source;
  let metadata: Pick<DocumentTextPage, 'extractionTruncated' | 'pagesRead' | 'totalPages'> = {};
  if (extractor) ({ bytes, metadata } = await extractDocumentBytes({ extractor, source }));
  assertPageStart(bytes, offset);
  let end = Math.min(bytes.length, offset + DOCUMENT_TEXT_PAGE_BYTES);
  while (end < bytes.length && isUtf8Continuation(bytes[end]!)) end--;
  const truncated = end < bytes.length;
  return { id: media.id, text: decodeDocumentUtf8({ bytes: bytes.subarray(offset, end) }), offset,
    nextOffset: truncated ? end : null, totalBytes: bytes.length, truncated, untrusted: true,
    ...metadata };
}
