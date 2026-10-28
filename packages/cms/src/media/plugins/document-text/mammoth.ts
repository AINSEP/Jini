import { DOCUMENT_CONTENT_TYPES, validateDocumentIngress, type DocumentArchiveReaderPort } from '../../document-ingress.js';
import { boundDocumentText, DocumentTextExtractionError, type DocumentTextExtractorPort } from '../../document-text.js';
import { loadDocumentTextModule } from './optional-module.js';

interface MammothModule {
  extractRawText(input: { buffer: Buffer }): Promise<{ value: string }>;
}
type MammothImport = MammothModule | { default: MammothModule };

/** Optional DOCX adapter. Reuses ingress's 40 MiB expansion/entry/ratio/XML guards before parsing.
 * Mammoth parses the validated archive in memory; DOCX has no stable rendered page count.
 * @param required.archiveReader Existing bounded archive reader supplied by the host.
 * @returns Plain text capped by maxCharacters; library failures become typed errors.
 * @complexity O(expanded archive bytes + text), bounded by ingress and output policy.
 * @example createMammothDocumentTextExtractor({ archiveReader })
 */
export function createMammothDocumentTextExtractor({ archiveReader }: { archiveReader: DocumentArchiveReaderPort },
  { loadModule }: { loadModule?: () => Promise<MammothImport> } = {}): DocumentTextExtractorPort {
  return { contentType: DOCUMENT_CONTENT_TYPES.docx, async extract({ bytes, limits }, _optional: Record<string, never> = {}) {
    const loaded = await loadDocumentTextModule<MammothImport>({ name: 'mammoth', ...(loadModule ? { load: loadModule } : {}) });
    const sdk = 'default' in loaded ? loaded.default : loaded;
    // Keep admission failures intact; do not let an archive bomb reach the optional parser.
    await validateDocumentIngress({ filename: 'document.docx', bytes }, { archiveReader });
    try {
      // Raw-text mode accepts bytes only; Mammoth keeps external file access disabled by default.
      const { value } = await sdk.extractRawText({ buffer: Buffer.from(bytes) });
      return boundDocumentText({ text: value, maxCharacters: limits.maxCharacters });
    } catch (cause) {
      throw new DocumentTextExtractionError({ code: 'DOCUMENT_TEXT_FAILED', message: 'Word text extraction failed; the file may be invalid or password-protected.', cause });
    }
  } };
}
