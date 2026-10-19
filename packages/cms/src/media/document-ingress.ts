import { MediaValidationError } from './types.js';

/** Private Library documents have a smaller cap than a host's image/video uploads. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const DOCUMENT_CONTENT_TYPES = {
  md: 'text/markdown', txt: 'text/plain', csv: 'text/csv', json: 'application/json',
  pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
} as const;

/** Streaming archive port: the existing host archive adapter supplies entries; never extract to disk.
 * Adapters must reject encryption and report links/special files rather than following them. */
export interface DocumentArchiveReaderPort {
  entries(required: { archive: Uint8Array }, optional?: Record<string, never>): AsyncIterable<{
    kind: string; entryPath: string; declaredSize?: number | undefined;
    openReadStream?: (required: Record<string, never>, optional?: Record<string, never>) => AsyncIterable<Uint8Array>;
  }>;
}

function invalid(message: string): never { throw new MediaValidationError({ message }); }

/** Names are display metadata only. Refuse path syntax rather than trying to normalize it. */
export function documentContentType(required: { filename: string }, _optional: Record<string, never> = {}): string {
  const name = required.filename;
  if (!name.trim() || name.length > 255 || /[\\/\u0000-\u001f\u007f]/u.test(name)) invalid('document filename must be a plain filename of at most 255 characters');
  const dot = name.lastIndexOf('.');
  if (dot <= 0) invalid('document filename must include an allowed extension');
  const extension = name.slice(dot + 1).toLowerCase();
  if (!Object.hasOwn(DOCUMENT_CONTENT_TYPES, extension)) invalid('document type must be .md, .txt, .pdf, .docx, .csv or .json');
  return DOCUMENT_CONTENT_TYPES[extension as keyof typeof DOCUMENT_CONTENT_TYPES];
}

/** Fatal decoding and control checks reject binary content disguised with a text extension. */
export function decodeDocumentUtf8(required: { bytes: Uint8Array }, _optional: Record<string, never> = {}): string {
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(required.bytes); }
  catch { return invalid('document text must be valid UTF-8'); }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(text)) invalid('document text contains binary controls');
  return text;
}

/** Validate every entry, not just required members: hidden payloads and combined expansion matter.
 * 2048 entries / 40 MiB expanded bound both metadata work and decompression, before any persistence. */
async function validateDocx(required: { bytes: Uint8Array; archiveReader?: DocumentArchiveReaderPort | undefined }): Promise<void> {
  if (!required.archiveReader) invalid('DOCX validation requires an archive reader');
  const names = new Set<string>();
  const requiredMembers = new Map<string, string>();
  let count = 0; let total = 0;
  try {
    for await (const entry of required.archiveReader.entries({ archive: required.bytes })) {
      if (++count > 2048) invalid('DOCX has too many archive entries');
      const name = entry.entryPath;
      const path = name.endsWith('/') ? name.slice(0, -1) : name;
      if (!path || /[\\:\u0000-\u001f\u007f]/u.test(path) || path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..')) invalid('DOCX contains an unsafe archive path');
      const folded = path.toLowerCase();
      if (names.has(folded)) invalid('DOCX contains duplicate archive paths');
      names.add(folded);
      if (/vba|macro|activex|(^|\/)embeddings\//i.test(path) || /\.(bin|exe|dll)$/i.test(path)) invalid('DOCX contains a macro or embedded payload');
      if (entry.kind === 'directory') continue;
      if (entry.kind !== 'file' || !entry.openReadStream) invalid('DOCX contains a link or special entry');
      if (!Number.isSafeInteger(entry.declaredSize) || entry.declaredSize! < 0 || total + entry.declaredSize! > 40 * 1024 * 1024) invalid('DOCX expanded size exceeds its limit');
      let size = 0;
      const chunks: Uint8Array[] = [];
      const capture = ['[Content_Types].xml', '_rels/.rels', 'word/document.xml'].includes(path);
      for await (const chunk of entry.openReadStream({})) {
        total += chunk.byteLength; size += chunk.byteLength;
        if (total > 40 * 1024 * 1024 || size > entry.declaredSize!) invalid('DOCX expanded size exceeds its limit');
        if (capture) chunks.push(chunk);
      }
      if (size !== entry.declaredSize) invalid('DOCX archive entry size is incorrect');
      if (capture) requiredMembers.set(path, decodeDocumentUtf8({ bytes: Buffer.concat(chunks) }));
    }
  } catch (error) {
    if (error instanceof MediaValidationError) throw error;
    invalid('DOCX is not a readable, unencrypted ZIP package');
  }
  await validateWordPackage({ members: requiredMembers });
}

/** Use the installed XML parser rather than treating marker strings inside an arbitrary ZIP as
 * a Word package. Parsing detached XML runs no scripts and performs no network requests. */
async function validateWordPackage(required: { members: ReadonlyMap<string, string> }): Promise<void> {
  const sources = ['[Content_Types].xml', '_rels/.rels', 'word/document.xml'].map(name => required.members.get(name) ?? '');
  if (sources.some(xml => /<!DOCTYPE|<!ENTITY|macroEnabled|vbaProject/i.test(xml))) invalid('DOCX DTDs, entities and macros are not allowed');
  const { JSDOM } = await import('jsdom');
  const window = new JSDOM('').window;
  try {
    const [types, rels, document] = sources.map(source => new window.DOMParser().parseFromString(source, 'application/xml'));
    if ([types!, rels!, document!].some(xml => xml.querySelector('parsererror'))) invalid('DOCX contains invalid package XML');
    const wordNamespaces = ['http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'http://purl.oclc.org/ooxml/wordprocessingml/main'];
    const contentTypesNamespace = 'http://schemas.openxmlformats.org/package/2006/content-types';
    const relationshipsNamespace = 'http://schemas.openxmlformats.org/package/2006/relationships';
    const mainType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
    const typesRoot = types!.documentElement;
    const relsRoot = rels!.documentElement;
    // Package markers count only as direct children of the real OPC roots, never nested decoys.
    if (typesRoot.localName !== 'Types' || typesRoot.namespaceURI !== contentTypesNamespace ||
      relsRoot.localName !== 'Relationships' || relsRoot.namespaceURI !== relationshipsNamespace) invalid('DOCX contains invalid package roots');
    const override = [...typesRoot.children].some(node => node.localName === 'Override' && node.namespaceURI === contentTypesNamespace &&
      node.getAttribute('PartName') === '/word/document.xml' && node.getAttribute('ContentType') === mainType);
    const officeDocument = [...relsRoot.children].some(node => node.localName === 'Relationship' && node.namespaceURI === relationshipsNamespace &&
      ['word/document.xml', '/word/document.xml'].includes(node.getAttribute('Target') ?? '') && node.getAttribute('TargetMode') !== 'External' &&
      ['http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument', 'http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument'].includes(node.getAttribute('Type') ?? ''));
    const root = document!.documentElement;
    if (!override || !officeDocument || root.localName !== 'document' || !wordNamespaces.includes(root.namespaceURI ?? '')) invalid('DOCX is missing its required Word package members');
  } finally { window.close(); }
}

/** Extension selects a policy; actual bytes must satisfy it. Client MIME never grants admission. */
export async function validateDocumentIngress(required: { filename: string; bytes: Uint8Array },
  optional: { archiveReader?: DocumentArchiveReaderPort | undefined } = {}): Promise<{ contentType: string }> {
  if (!required.bytes.byteLength || required.bytes.byteLength > MAX_DOCUMENT_BYTES) invalid('document must be non-empty and at most 10 MiB');
  const contentType = documentContentType({ filename: required.filename });
  if (contentType === DOCUMENT_CONTENT_TYPES.docx) await validateDocx({ bytes: required.bytes, ...optional });
  else if (contentType === DOCUMENT_CONTENT_TYPES.pdf) {
    // latin1 preserves high bits: ASCII decoding would turn counterfeit bytes into a valid header.
    const header = Buffer.from(required.bytes.subarray(0, 8)).toString('latin1');
    if (!/^%PDF-(?:1\.[0-7]|2\.0)/u.test(header)) invalid('document bytes do not have a PDF signature');
  } else {
    const text = decodeDocumentUtf8({ bytes: required.bytes });
    if (contentType === DOCUMENT_CONTENT_TYPES.json) {
      try { JSON.parse(text.replace(/^\uFEFF/u, '')); } catch { invalid('document JSON is invalid'); }
    }
  }
  return { contentType };
}

/** Preserve the immutable extension while the editable title supplies the display-name stem. */
export function documentDisplayFilename(required: { title: string; originalFilename?: string | null | undefined },
  _optional: Record<string, never> = {}): string {
  const original = required.originalFilename ?? '';
  return required.title + (original.includes('.') ? original.slice(original.lastIndexOf('.')) : '');
}
