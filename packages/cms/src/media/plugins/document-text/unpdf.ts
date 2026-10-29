import { DOCUMENT_CONTENT_TYPES, MAX_DOCUMENT_BYTES } from '../../document-ingress.js';
import { boundDocumentText, DocumentTextExtractionError, type DocumentTextExtraction, type DocumentTextExtractorPort } from '../../document-text.js';
import { loadDocumentTextModule } from './optional-module.js';

interface PdfPage {
  getTextContent(): Promise<{ items: readonly { str?: string; hasEOL?: boolean }[] }>;
  cleanup(): void;
}
interface PdfDocument {
  numPages: number;
  getPage(page: number): Promise<PdfPage>;
  // pdf.js 5 moved destroy() off the proxy onto its loading task.
  loadingTask: { destroy(): Promise<void> };
}
interface UnpdfModule {
  getDocumentProxy(bytes: Uint8Array, options: Record<string, unknown>): Promise<PdfDocument>;
}

/** Extract sequential pages; never use unpdf.extractText, which fans out over every page.
 * O(visited page text) work; accumulated output is capped by maxCharacters. */
async function readPages({ pdf, limits }: { pdf: PdfDocument; limits: { maxPages: number; maxCharacters: number } }): Promise<DocumentTextExtraction> {
  let text = '';
  let pagesRead = 0;
  const pages = Math.min(pdf.numPages, limits.maxPages);
  for (let number = 1; number <= pages; number++) {
    const page = await pdf.getPage(number);
    try {
      const content = await page.getTextContent();
      const parts = content.items.flatMap(item => item.str === undefined ? [] : [item.str + (item.hasEOL ? '\n' : '')]);
      const pageText = (number > 1 ? '\n' : '') + parts.join('');
      const bounded = boundDocumentText({ text: pageText, maxCharacters: limits.maxCharacters - text.length });
      text += bounded.text;
      pagesRead++;
      if (bounded.truncated || text.length === limits.maxCharacters) {
        return { text, truncated: bounded.truncated || number < pdf.numPages, pagesRead, totalPages: pdf.numPages };
      }
    } finally { page.cleanup(); }
  }
  return { text, truncated: pagesRead < pdf.numPages, pagesRead, totalPages: pdf.numPages };
}

/** Optional pure-JS PDF adapter; constructing it imports no SDK. Only embedded text, no OCR.
 * @param optional.loadModule Loader port for deterministic adapter tests.
 * @returns The core document-text port; corrupt/encrypted sources throw typed failures.
 * @example createUnpdfDocumentTextExtractor({})
 */
export function createUnpdfDocumentTextExtractor(_required: Record<string, never>,
  { loadModule }: { loadModule?: () => Promise<UnpdfModule> } = {}): DocumentTextExtractorPort {
  return { contentType: DOCUMENT_CONTENT_TYPES.pdf, async extract({ bytes, limits }, _optional: Record<string, never> = {}) {
    const sdk = await loadDocumentTextModule<UnpdfModule>({ name: 'unpdf', ...(loadModule ? { load: loadModule } : {}) });
    try {
      if (bytes.byteLength > MAX_DOCUMENT_BYTES) throw new RangeError('document exceeds the 10 MiB limit');
      // Copy: PDF.js can transfer/detach its input. Disable eval and external font/wasm fetches.
      const pdf = await sdk.getDocumentProxy(Uint8Array.from(bytes), { isEvalSupported: false,
        useSystemFonts: false, disableFontFace: true, useWorkerFetch: false, useWasm: false, maxImageSize: 0 });
      try { return await readPages({ pdf, limits }); }
      finally { await pdf.loadingTask.destroy(); }
    } catch (cause) {
      throw new DocumentTextExtractionError({ code: 'DOCUMENT_TEXT_FAILED', message: 'PDF text extraction failed; the file may be invalid or password-protected.', cause });
    }
  } };
}
