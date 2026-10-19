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

type ArchiveEntry = DocumentArchiveReaderPort['entries'] extends (...args: never[]) => AsyncIterable<infer Entry> ? Entry : never;
const MAX_ARCHIVE_ENTRIES = 2048;
const MAX_EXPANDED_BYTES = 40 * 1024 * 1024;
const isArchiveExtension = (extension: string): extension is ArchiveExtension => extension in OFFICE_PACKAGES || extension === 'pages' || extension === 'key';

/** Running state for one archive walk: names seen, captured OOXML members and observed totals. */
interface ArchiveScan {
  readonly label: string;
  readonly extension: ArchiveExtension;
  readonly office: (typeof OFFICE_PACKAGES)[OfficeExtension] | undefined;
  readonly archiveBytes: number;
  readonly names: Set<string>;
  readonly members: Map<string, string>;
  count: number;
  total: number;
  iworkMarker: boolean;
}

const isUnsafeArchivePath = (path: string) => !path || /[\\:\u0000-\u001f\u007f]/u.test(path) || path.startsWith('/') ||
  path.split('/').some(part => !part || part === '.' || part === '..');
const isMacroPayload = (path: string, extension: ArchiveExtension) =>
  /vba|macro|activex|(^|\/)embeddings\//i.test(path) || /\.(exe|dll)$/i.test(path) || (extension === 'docx' && /\.bin$/i.test(path));

/** Path policy applies to directories too; a case-folded duplicate could shadow a checked member. */
function assertArchivePath(scan: ArchiveScan, path: string): void {
  if (isUnsafeArchivePath(path)) invalid(`${scan.label} contains an unsafe archive path`);
  const folded = path.toLowerCase();
  if (scan.names.has(folded)) invalid(`${scan.label} contains duplicate archive paths`);
  scan.names.add(folded);
  if (isMacroPayload(path, scan.extension)) invalid(`${scan.label} contains a macro or embedded payload`);
}

/** Header sizes are checked before any byte is read; observed bytes are checked again while streaming. */
function assertDeclaredSizes(scan: ArchiveScan, entry: ArchiveEntry): asserts entry is ArchiveEntry & { declaredSize: number; compressedSize: number; openReadStream: NonNullable<ArchiveEntry['openReadStream']> } {
  if (entry.kind !== 'file' || !entry.openReadStream) invalid(`${scan.label} contains a link or special entry`);
  if (!Number.isSafeInteger(entry.declaredSize) || entry.declaredSize! < 0 || scan.total + entry.declaredSize! > MAX_EXPANDED_BYTES) invalid(`${scan.label} expanded size exceeds its limit`);
  if (!Number.isSafeInteger(entry.compressedSize) || entry.compressedSize! < 0 || entry.compressedSize! > scan.archiveBytes) invalid(`${scan.label} archive compressed size is invalid`);
}

/** Streams one file entry, enforcing size and ratio limits per chunk; buffers only captured members. */
async function readArchiveFile(scan: ArchiveScan, entry: ArchiveEntry & { declaredSize: number; compressedSize: number; openReadStream: NonNullable<ArchiveEntry['openReadStream']> },
  { capture }: { capture: boolean }): Promise<Uint8Array[]> {
  let size = 0;
  const chunks: Uint8Array[] = [];
  for await (const chunk of entry.openReadStream({})) {
    scan.total += chunk.byteLength; size += chunk.byteLength;
    if (scan.total > MAX_EXPANDED_BYTES || size > entry.declaredSize) invalid(`${scan.label} expanded size exceeds its limit`);
    // 100:1 permits ordinary Office XML but cuts off cheap decompression bombs even below
    // the absolute cap. Check observed bytes before buffering; entry limits resist ZIP padding.
    if (size > entry.compressedSize * MAX_DOCUMENT_COMPRESSION_RATIO ||
      scan.total > scan.archiveBytes * MAX_DOCUMENT_COMPRESSION_RATIO) invalid(`${scan.label} compression ratio exceeds 100:1`);
    if (capture) chunks.push(chunk);
  }
  if (size !== entry.declaredSize) invalid(`${scan.label} archive entry size is incorrect`);
  return chunks;
}

/** Reader failures (corrupt or encrypted ZIPs) are reported by application, never as ZIP jargon. */
function archiveApplication({ office, extension }: ArchiveScan): string {
  if (office) return office.label;
  return extension === 'pages' ? 'Pages' : 'Keynote';
}

async function scanArchiveEntry(scan: ArchiveScan, entry: ArchiveEntry): Promise<void> {
  if (++scan.count > MAX_ARCHIVE_ENTRIES) invalid(`${scan.label} has too many archive entries`);
  const name = entry.entryPath;
  const path = name.endsWith('/') ? name.slice(0, -1) : name;
  assertArchivePath(scan, path);
  if (entry.kind === 'directory') return;
  assertDeclaredSizes(scan, entry);
  const capture = !!scan.office && ['[Content_Types].xml', '_rels/.rels', scan.office.part].includes(path);
  const chunks = await readArchiveFile(scan, entry, { capture });
  if (path === 'Index/Document.iwa' || path === 'Index.zip') scan.iworkMarker = true;
  if (capture) scan.members.set(path, decodeDocumentUtf8({ bytes: Buffer.concat(chunks) }));
}

/** Validate every entry, not just required members: hidden payloads and combined expansion matter.
 * 2048 entries / 40 MiB expanded bound both metadata work and decompression, before any persistence.
 * O(expanded bytes + entries) work/space, bounded independently of compressed upload size. */
async function validateDocumentArchive(required: { bytes: Uint8Array; extension: ArchiveExtension; archiveReader?: DocumentArchiveReaderPort | undefined },
  _optional: Record<string, never> = {}): Promise<void> {
  const label = required.extension.toUpperCase();
  const office = required.extension in OFFICE_PACKAGES ? OFFICE_PACKAGES[required.extension as OfficeExtension] : undefined;
  if (!required.archiveReader) invalid(`${label} validation requires an archive reader`);
  const scan: ArchiveScan = { label, extension: required.extension, office, archiveBytes: required.bytes.byteLength,
    names: new Set(), members: new Map(), count: 0, total: 0, iworkMarker: false };
  try {
    for await (const entry of required.archiveReader.entries({ archive: required.bytes })) await scanArchiveEntry(scan, entry);
  } catch (error) {
    if (error instanceof MediaValidationError) throw error;
    invalid(`This file isn't a valid ${archiveApplication(scan)} file (or it's password-protected).`);
  }
  if (office) await validateOfficePackage({ members: scan.members, extension: required.extension as OfficeExtension });
  else if (!scan.iworkMarker) invalid(`${label} is missing its required iWork package members`);
}

const CONTENT_TYPES_NAMESPACE = 'http://schemas.openxmlformats.org/package/2006/content-types';
const RELATIONSHIPS_NAMESPACE = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_DOCUMENT_RELATIONSHIPS = ['http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument', 'http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument'];
type OfficeSpec = (typeof OFFICE_PACKAGES)[OfficeExtension];

/** The content-types Override must name the main part with this format's main content type. */
const hasMainOverride = (typesRoot: Element, spec: OfficeSpec) => [...typesRoot.children].some(node => node.localName === 'Override' && node.namespaceURI === CONTENT_TYPES_NAMESPACE &&
  node.getAttribute('PartName') === '/' + spec.part && node.getAttribute('ContentType') === `application/vnd.openxmlformats-officedocument.${spec.mainType}.main+xml`);
/** The package relationship must point at the internal main part as the office document. */
const hasOfficeDocumentRelationship = (relsRoot: Element, spec: OfficeSpec) => [...relsRoot.children].some(node => node.localName === 'Relationship' && node.namespaceURI === RELATIONSHIPS_NAMESPACE &&
  [spec.part, '/' + spec.part].includes(node.getAttribute('Target') ?? '') && node.getAttribute('TargetMode') !== 'External' &&
  OFFICE_DOCUMENT_RELATIONSHIPS.includes(node.getAttribute('Type') ?? ''));
const isOfficeMainRoot = (root: Element, spec: OfficeSpec) => root.localName === spec.root &&
  [`http://schemas.openxmlformats.org/${spec.family}/2006/main`, `http://purl.oclc.org/ooxml/${spec.family}/main`].includes(root.namespaceURI ?? '');

function assertOfficeXml({ documents: [types, rels, document], spec, label }: { documents: readonly Document[]; spec: OfficeSpec; label: string }): void {
  if ([types!, rels!, document!].some(xml => xml.querySelector('parsererror'))) invalid(`${label} contains invalid package XML`);
  const typesRoot = types!.documentElement;
  const relsRoot = rels!.documentElement;
  // Package markers count only as direct children of the real OPC roots, never nested decoys.
  if (typesRoot.localName !== 'Types' || typesRoot.namespaceURI !== CONTENT_TYPES_NAMESPACE ||
    relsRoot.localName !== 'Relationships' || relsRoot.namespaceURI !== RELATIONSHIPS_NAMESPACE) invalid(`${label} contains invalid package roots`);
  // Inspect decoded MIME values: XLM macro sheets need not have macro-looking part names.
  if ([...typesRoot.children].some(node => /macroEnabled|vbaProject|vbaData|(?:intl)?macrosheet\+xml/i.test(node.getAttribute('ContentType') ?? ''))) invalid(`${label} macros are not allowed`);
  if (!hasMainOverride(typesRoot, spec) || !hasOfficeDocumentRelationship(relsRoot, spec) || !isOfficeMainRoot(document!.documentElement, spec)) invalid(`${label} is missing its required ${spec.label} package members`);
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
    assertOfficeXml({ documents: sources.map(source => new window.DOMParser().parseFromString(source, 'application/xml')), spec, label });
  } finally { window.close(); }
}

const OLE_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
/** Byte-signature policies for download-only and PDF formats, keyed by extension. */
const SIGNATURE_CHECKS: Partial<Record<keyof typeof DOCUMENT_CONTENT_TYPES, (required: { bytes: Uint8Array }) => void>> = {
  doc: ({ bytes }) => { if (!Buffer.from(bytes.subarray(0, 8)).equals(OLE_SIGNATURE)) invalid("This file isn't a valid Word file."); },
  xls: ({ bytes }) => { if (!Buffer.from(bytes.subarray(0, 8)).equals(OLE_SIGNATURE)) invalid("This file isn't a valid Excel file."); },
  rtf: ({ bytes }) => { if (Buffer.from(bytes.subarray(0, 5)).toString('latin1') !== '{\\rtf') invalid("This file isn't a valid RTF file."); },
  pdf: ({ bytes }) => {
    // latin1 preserves high bits: ASCII decoding would turn counterfeit bytes into a valid header.
    const header = Buffer.from(bytes.subarray(0, 8)).toString('latin1');
    if (!/^%PDF-(?:1\.[0-7]|2\.0)/u.test(header)) invalid('document bytes do not have a PDF signature');
  },
};

function assertDocumentText({ bytes, contentType }: { bytes: Uint8Array; contentType: string }): void {
  const text = decodeDocumentUtf8({ bytes });
  if (contentType !== DOCUMENT_CONTENT_TYPES.json) return;
  try { JSON.parse(text.replace(/^\uFEFF/u, '')); } catch { invalid('document JSON is invalid'); }
}

/** Extension selects a policy; actual bytes must satisfy it. Client MIME never grants admission.
 * Throws MediaValidationError before persistence; O(bytes) work/space, capped at 10 MiB input
 * and 40 MiB expanded archive data. Legacy OLE/RTF checks identify formats, not malware. */
export async function validateDocumentIngress(required: { filename: string; bytes: Uint8Array },
  optional: { archiveReader?: DocumentArchiveReaderPort | undefined } = {}): Promise<{ contentType: string }> {
  if (!required.bytes.byteLength || required.bytes.byteLength > MAX_DOCUMENT_BYTES) invalid('document must be non-empty and at most 10 MiB');
  const contentType = documentContentType({ filename: required.filename });
  const extension = required.filename.slice(required.filename.lastIndexOf('.') + 1).toLowerCase();
  const signatureCheck = SIGNATURE_CHECKS[extension as keyof typeof DOCUMENT_CONTENT_TYPES];
  if (isArchiveExtension(extension)) await validateDocumentArchive({ bytes: required.bytes, extension, ...optional });
  else if (signatureCheck) signatureCheck({ bytes: required.bytes });
  else assertDocumentText({ bytes: required.bytes, contentType });
  return { contentType };
}

/** Preserve the immutable extension while the editable title supplies the display-name stem. */
export function documentDisplayFilename(required: { title: string; originalFilename?: string | null | undefined },
  _optional: Record<string, never> = {}): string {
  const original = required.originalFilename ?? '';
  return required.title + (original.includes('.') ? original.slice(original.lastIndexOf('.')) : '');
}
