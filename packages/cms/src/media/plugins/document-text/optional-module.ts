import { DocumentTextExtractionError } from '../../document-text.js';

/** Import only on extraction; missing/broken peers get actionable typed installation guidance.
 * The specifier is dynamic so an absent optional peer does not prevent CMS compilation. */
export async function loadDocumentTextModule<T>({ name, load }: { name: string; load?: () => Promise<T> },
  _optional: Record<string, never> = {}): Promise<T> {
  try { return await (load ? load() : import(name)); }
  catch (cause) {
    throw new DocumentTextExtractionError({ code: 'DOCUMENT_TEXT_UNAVAILABLE', install: name,
      message: `extraction unavailable — install ${name}`, cause });
  }
}
