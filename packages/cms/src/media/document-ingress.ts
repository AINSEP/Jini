import { MediaValidationError } from './types.js';

/** Private Library documents have a smaller cap than a host's image/video uploads. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const DOCUMENT_CONTENT_TYPES = {
  md: 'text/markdown', txt: 'text/plain', csv: 'text/csv', json: 'application/json',
  doc: 'application/msword', xls: 'application/vnd.ms-excel', rtf: 'application/rtf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pages: 'application/vnd.apple.pages', key: 'application/vnd.apple.keynote',
  pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
} as const;

/** Streaming archive port: the existing host archive adapter supplies entries; never extract to disk.
 * File entries must include their ZIP compressed size for ratio checks.
 * Adapters must reject encryption and report links/special files rather than following them. */
export interface DocumentArchiveReaderPort {
  entries(required: { archive: Uint8Array }, optional?: Record<string, never>): AsyncIterable<{
    kind: string; entryPath: string; declaredSize?: number | undefined; compressedSize?: number | undefined;
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
  if (!Object.hasOwn(DOCUMENT_CONTENT_TYPES, extension)) invalid(`document type must be ${Object.keys(DOCUMENT_CONTENT_TYPES).map(ext => '.' + ext).join(', ')}`);
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

const MAX_DOCUMENT_COMPRESSION_RATIO = 100;

/** OOXML variants share the archive policy; only the main part and XML contract differ. */
const OFFICE_PACKAGES = {
  docx: { part: 'word/document.xml', root: 'document', family: 'wordprocessingml', mainType: 'wordprocessingml.document', label: 'Word' },
  xlsx: { part: 'xl/workbook.xml', root: 'workbook', family: 'spreadsheetml', mainType: 'spreadsheetml.sheet', label: 'Excel' },
  pptx: { part: 'ppt/presentation.xml', root: 'presentation', family: 'presentationml', mainType: 'presentationml.presentation', label: 'PowerPoint' },
} as const;
type OfficeExtension = keyof typeof OFFICE_PACKAGES;
type ArchiveExtension = OfficeExtension | 'pages' | 'key';

/** Validate every entry, not just required members: hidden payloads and combined expansion matter.
 * 2048 entries / 40 MiB expanded bound both metadata work and decompression, before any persistence.
 * O(expanded bytes + entries) work/space, bounded independently of compressed upload size. */
async function validateDocumentArchive(required: { bytes: Uint8Array; extension: ArchiveExtension; archiveReader?: DocumentArchiveReaderPort | undefined },
  _optional: Record<string, never> = {}): Promise<void> {
  const label = required.extension.toUpperCase();
  const office = required.extension in OFFICE_PACKAGES ? OFFICE_PACKAGES[required.extension as OfficeExtension] : undefined;
  if (!required.archiveReader) invalid(`${label} validation requires an archive reader`);
  const names = new Set<string>();
  const requiredMembers = new Map<string, string>();
  let count = 0; let total = 0; let iworkMarker = false;
  try {
    for await (const entry of required.archiveReader.entries({ archive: required.bytes })) {
      if (++count > 2048) invalid(`${label} has too many archive entries`);
      const name = entry.entryPath;
      const path = name.endsWith('/') ? name.slice(0, -1) : name;
      if (!path || /[\\:\u0000-\u001f\u007f]/u.test(path) || path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..')) invalid(`${label} contains an unsafe archive path`);
      const folded = path.toLowerCase();
      if (names.has(folded)) invalid(`${label} contains duplicate archive paths`);
      names.add(folded);
      if (/vba|macro|activex|(^|\/)embeddings\//i.test(path) || /\.(exe|dll)$/i.test(path) || (required.extension === 'docx' && /\.bin$/i.test(path))) invalid(`${label} contains a macro or embedded payload`);
      if (entry.kind === 'directory') continue;
      if (entry.kind !== 'file' || !entry.openReadStream) invalid(`${label} contains a link or special entry`);
      if (!Number.isSafeInteger(entry.declaredSize) || entry.declaredSize! < 0 || total + entry.declaredSize! > 40 * 1024 * 1024) invalid(`${label} expanded size exceeds its limit`);
      if (!Number.isSafeInteger(entry.compressedSize) || entry.compressedSize! < 0 || entry.compressedSize! > required.bytes.byteLength) invalid(`${label} archive compressed size is invalid`);
      let size = 0;
      const chunks: Uint8Array[] = [];
      const capture = !!office && ['[Content_Types].xml', '_rels/.rels', office.part].includes(path);
      for await (const chunk of entry.openReadStream({})) {
        total += chunk.byteLength; size += chunk.byteLength;
        if (total > 40 * 1024 * 1024 || size > entry.declaredSize!) invalid(`${label} expanded size exceeds its limit`);
        // 100:1 permits ordinary Office XML but cuts off cheap decompression bombs even below
        // the absolute cap. Check observed bytes before buffering; entry limits resist ZIP padding.
        if (size > entry.compressedSize! * MAX_DOCUMENT_COMPRESSION_RATIO ||
          total > required.bytes.byteLength * MAX_DOCUMENT_COMPRESSION_RATIO) invalid(`${label} compression ratio exceeds 100:1`);
        if (capture) chunks.push(chunk);
      }
      if (size !== entry.declaredSize) invalid(`${label} archive entry size is incorrect`);
      if (path === 'Index/Document.iwa' || path === 'Index.zip') iworkMarker = true;
      if (capture) requiredMembers.set(path, decodeDocumentUtf8({ bytes: Buffer.concat(chunks) }));
    }
  } catch (error) {
    if (error instanceof MediaValidationError) throw error;
    const application = office?.label ?? (required.extension === 'pages' ? 'Pages' : 'Keynote');
    invalid(`This file isn't a valid ${application} file (or it's password-protected).`);
  }
  if (office) await validateOfficePackage({ members: requiredMembers, extension: required.extension as OfficeExtension });
  else if (!iworkMarker) invalid(`${label} is missing its required iWork package members`);
}

/** Use the installed XML parser rather than treating marker strings inside an arbitrary ZIP as
 * an Office package. Parsing detached XML runs no scripts and performs no network requests. */
async function validateOfficePackage(required: { members: ReadonlyMap<string, string>; extension: OfficeExtension },
  _optional: Record<string, never> = {}): Promise<void> {
  const spec = OFFICE_PACKAGES[required.extension];
  const label = required.extension.toUpperCase();
  const sources = ['[Content_Types].xml', '_rels/.rels', spec.part].map(name => required.members.get(name) ?? '');
  if (sources.some(xml => /<!DOCTYPE|<!ENTITY|macroEnabled|vbaProject/i.test(xml))) invalid(`${label} DTDs, entities and macros are not allowed`);
  const { JSDOM } = await import('jsdom');
  const window = new JSDOM('').window;
  try {
    const [types, rels, document] = sources.map(source => new window.DOMParser().parseFromString(source, 'application/xml'));
    if ([types!, rels!, document!].some(xml => xml.querySelector('parsererror'))) invalid(`${label} contains invalid package XML`);
    const namespaces = [`http://schemas.openxmlformats.org/${spec.family}/2006/main`, `http://purl.oclc.org/ooxml/${spec.family}/main`];
    const contentTypesNamespace = 'http://schemas.openxmlformats.org/package/2006/content-types';
    const relationshipsNamespace = 'http://schemas.openxmlformats.org/package/2006/relationships';
    const mainType = `application/vnd.openxmlformats-officedocument.${spec.mainType}.main+xml`;
    const typesRoot = types!.documentElement;
    const relsRoot = rels!.documentElement;
    // Package markers count only as direct children of the real OPC roots, never nested decoys.
    if (typesRoot.localName !== 'Types' || typesRoot.namespaceURI !== contentTypesNamespace ||
      relsRoot.localName !== 'Relationships' || relsRoot.namespaceURI !== relationshipsNamespace) invalid(`${label} contains invalid package roots`);
    // Inspect decoded MIME values: XLM macro sheets need not have macro-looking part names.
    if ([...typesRoot.children].some(node => /macroEnabled|vbaProject|vbaData|(?:intl)?macrosheet\+xml/i.test(node.getAttribute('ContentType') ?? ''))) invalid(`${label} macros are not allowed`);
    const override = [...typesRoot.children].some(node => node.localName === 'Override' && node.namespaceURI === contentTypesNamespace &&
      node.getAttribute('PartName') === '/' + spec.part && node.getAttribute('ContentType') === mainType);
    const officeDocument = [...relsRoot.children].some(node => node.localName === 'Relationship' && node.namespaceURI === relationshipsNamespace &&
      [spec.part, '/' + spec.part].includes(node.getAttribute('Target') ?? '') && node.getAttribute('TargetMode') !== 'External' &&
      ['http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument', 'http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument'].includes(node.getAttribute('Type') ?? ''));
    const root = document!.documentElement;
    if (!override || !officeDocument || root.localName !== spec.root || !namespaces.includes(root.namespaceURI ?? '')) invalid(`${label} is missing its required ${spec.label} package members`);
  } finally { window.close(); }
}

/** Extension selects a policy; actual bytes must satisfy it. Client MIME never grants admission.
 * Throws MediaValidationError before persistence; O(bytes) work/space, capped at 10 MiB input
 * and 40 MiB expanded archive data. Legacy OLE/RTF checks identify formats, not malware. */
export async function validateDocumentIngress(required: { filename: string; bytes: Uint8Array },
  optional: { archiveReader?: DocumentArchiveReaderPort | undefined } = {}): Promise<{ contentType: string }> {
  if (!required.bytes.byteLength || required.bytes.byteLength > MAX_DOCUMENT_BYTES) invalid('document must be non-empty and at most 10 MiB');
  const contentType = documentContentType({ filename: required.filename });
  const extension = required.filename.slice(required.filename.lastIndexOf('.') + 1).toLowerCase();
  if (extension in OFFICE_PACKAGES || extension === 'pages' || extension === 'key') {
    await validateDocumentArchive({ bytes: required.bytes, extension: extension as ArchiveExtension, ...optional });
  } else if (extension === 'doc' || extension === 'xls') {
    const signature = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    if (!Buffer.from(required.bytes.subarray(0, 8)).equals(signature)) invalid(`This file isn't a valid ${extension === 'doc' ? 'Word' : 'Excel'} file.`);
  } else if (extension === 'rtf') {
    if (Buffer.from(required.bytes.subarray(0, 5)).toString('latin1') !== '{\\rtf') invalid("This file isn't a valid RTF file.");
  } else if (contentType === DOCUMENT_CONTENT_TYPES.pdf) {
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
