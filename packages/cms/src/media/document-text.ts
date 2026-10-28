/** Document extraction policy and port. SDKs belong in separately imported plugin adapters. */
export const DOCUMENT_EXTRACTION_LIMITS = { maxPages: 100, maxCharacters: 1_000_000 } as const;

export interface DocumentTextExtraction {
  text: string;
  /** Source content was omitted by the extraction limits, independently of response paging. */
  truncated: boolean;
  pagesRead?: number;
  totalPages?: number;
}

/** Extract validated document bytes as DATA. Never execute scripts or fetch linked resources.
 * Deterministic output is required: library_read re-extracts when following byte offsets.
 * @example readDocumentText({ deps: { ...storage, documentTextExtractors: [extractor] }, input })
 */
export interface DocumentTextExtractorPort {
  readonly contentType: string;
  extract(required: { bytes: Uint8Array; limits: { maxPages: number; maxCharacters: number } },
    optional?: Record<string, never>): Promise<DocumentTextExtraction>;
}

/** Typed adapter failure; missing optional peers are recoverable tool results. */
export class DocumentTextExtractionError extends Error {
  readonly code: 'DOCUMENT_TEXT_UNAVAILABLE' | 'DOCUMENT_TEXT_FAILED';
  readonly install: string | undefined;
  constructor(required: { code: DocumentTextExtractionError['code']; message: string; install?: string; cause?: unknown },
    _optional: Record<string, never> = {}) {
    super(required.message, { cause: required.cause });
    this.name = 'DocumentTextExtractionError';
    this.code = required.code;
    this.install = required.install;
  }
}

/** Bound UTF-16 character units without cutting a surrogate pair. O(maxCharacters) space/time. */
export function boundDocumentText({ text, maxCharacters }: { text: string; maxCharacters: number },
  _optional: Record<string, never> = {}): Pick<DocumentTextExtraction, 'text' | 'truncated'> {
  let end = Math.min(text.length, maxCharacters);
  if (end < text.length && /[\uD800-\uDBFF]/u.test(text.charAt(end - 1))) end--;
  return { text: text.slice(0, end), truncated: end < text.length };
}
