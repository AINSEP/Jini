/** Archive and OOXML admission policy for Library documents, driven through a fake archive port. */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { validateDocumentIngress, documentDisplayFilename, type DocumentArchiveReaderPort } from '../document-ingress.js';
import { MediaValidationError } from '../types.js';

interface FakeEntry { path: string; kind?: string; data?: string | Uint8Array; declaredSize?: number | undefined; compressedSize?: number | undefined; stream?: boolean }
const archiveBytes = Buffer.alloc(4096, 1);
function reader(entries: readonly FakeEntry[]): DocumentArchiveReaderPort {
  return { entries: async function* () {
    for (const entry of entries) {
      const data = typeof entry.data === 'string' ? Buffer.from(entry.data) : entry.data ?? new Uint8Array();
      const declaredSize = 'declaredSize' in entry ? entry.declaredSize : data.byteLength;
      const compressedSize = 'compressedSize' in entry ? entry.compressedSize : Math.max(1, data.byteLength);
      yield { kind: entry.kind ?? 'file', entryPath: entry.path, declaredSize, compressedSize,
        ...(entry.stream === false ? {} : { openReadStream: async function* () { if (data.byteLength) yield data; } }) };
    }
  } };
}
const OFFICE = {
  docx: { part: 'word/document.xml', root: 'w:document', family: 'wordprocessingml', mainType: 'wordprocessingml.document' },
  xlsx: { part: 'xl/workbook.xml', root: 'x:workbook', family: 'spreadsheetml', mainType: 'spreadsheetml.sheet' },
  pptx: { part: 'ppt/presentation.xml', root: 'p:presentation', family: 'presentationml', mainType: 'presentationml.presentation' },
} as const;
const TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const RELS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
function office(extension: keyof typeof OFFICE, overrides: { types?: string; rels?: string; main?: string; target?: string; relType?: string; mode?: string; mainNs?: string } = {}): FakeEntry[] {
  const spec = OFFICE[extension];
  const prefix = spec.root.split(':')[0];
  return [
    { path: '[Content_Types].xml', data: overrides.types ?? `<Types xmlns="${TYPES_NS}"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/${spec.part}" ContentType="application/vnd.openxmlformats-officedocument.${spec.mainType}.main+xml"/></Types>` },
    { path: '_rels/', kind: 'directory' },
    { path: '_rels/.rels', data: overrides.rels ?? `<Relationships xmlns="${RELS_NS}"><Relationship Id="r1" Type="${overrides.relType ?? OFFICE_REL}" Target="${overrides.target ?? spec.part}"${overrides.mode ? ` TargetMode="${overrides.mode}"` : ''}/></Relationships>` },
    { path: spec.part, data: overrides.main ?? `<${spec.root} xmlns:${prefix}="${overrides.mainNs ?? `http://schemas.openxmlformats.org/${spec.family}/2006/main`}"/>` },
    { path: 'docProps/app.xml', data: '<Properties/>' },
  ];
}
async function admit(filename: string, entries: readonly FakeEntry[], bytes: Uint8Array = archiveBytes) {
  return validateDocumentIngress({ filename, bytes }, { archiveReader: reader(entries) });
}
async function refuses(filename: string, entries: readonly FakeEntry[], message: string | RegExp, bytes: Uint8Array = archiveBytes) {
  await assert.rejects(admit(filename, entries, bytes), (error: unknown) => {
    assert.ok(error instanceof MediaValidationError);
    if (typeof message === 'string') assert.equal(error.message, message); else assert.match(error.message, message);
    return true;
  });
}

test('admits well-formed Word, Excel and PowerPoint packages, including strict namespaces and absolute targets', async () => {
  for (const extension of ['docx', 'xlsx', 'pptx'] as const) {
    assert.match((await admit(`deck.${extension}`, office(extension))).contentType, /openxmlformats/);
  }
  const spec = OFFICE.docx;
  assert.ok(await admit('strict.docx', office('docx', { target: `/${spec.part}`, relType: 'http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument', mainNs: 'http://purl.oclc.org/ooxml/wordprocessingml/main' })));
  // .bin parts are only refused in Word packages.
  assert.ok(await admit('book.xlsx', [...office('xlsx'), { path: 'xl/printerSettings1.bin', data: 'x' }]));
});

test('admits iWork packages only with an index marker', async () => {
  assert.equal((await admit('doc.pages', [{ path: 'Index/', kind: 'directory' }, { path: 'Index/Document.iwa', data: 'x' }])).contentType, 'application/vnd.apple.pages');
  assert.equal((await admit('show.key', [{ path: 'Index.zip', data: 'x' }])).contentType, 'application/vnd.apple.keynote');
  await refuses('doc.pages', [{ path: 'Data/a.png', data: 'x' }], 'PAGES is missing its required iWork package members');
});

test('requires an archive reader for archive formats', async () => {
  for (const filename of ['README', '.md', 'a.exe']) await assert.rejects(validateDocumentIngress({ filename, bytes: archiveBytes }), /allowed extension|document type must be/);
  await assert.rejects(validateDocumentIngress({ filename: 'a.docx', bytes: archiveBytes }), /DOCX validation requires an archive reader/);
});

test('refuses unsafe, duplicate, macro and special archive entries', async () => {
  for (const path of ['', '/abs.xml', 'a/../b.xml', 'a/./b.xml', 'a//b.xml', 'a\\b.xml', 'c:b.xml', 'a\u0001.xml', '/']) {
    await refuses('a.pages', [{ path, data: 'x' }], 'PAGES contains an unsafe archive path');
  }
  await refuses('a.pages', [{ path: 'Index.zip', data: 'x' }, { path: 'INDEX.ZIP', data: 'x' }], 'PAGES contains duplicate archive paths');
  for (const path of ['vbaProject.bin', 'Macros/a.xml', 'activeX/a.xml', 'word/embeddings/x.xml', 'run.EXE', 'lib.dll', 'word/x.bin']) {
    await refuses('a.docx', [{ path, data: 'x' }], 'DOCX contains a macro or embedded payload');
  }
  await refuses('a.key', [{ path: 'link', kind: 'symlink', data: 'x' }], 'KEY contains a link or special entry');
  await refuses('a.key', [{ path: 'file', stream: false, data: 'x' }], 'KEY contains a link or special entry');
  await refuses('a.key', Array.from({ length: 2049 }, (_, index) => ({ path: `d${index}/`, kind: 'directory' })), 'KEY has too many archive entries');
});

test('refuses invalid declared, compressed and observed sizes', async () => {
  const MiB = 1024 * 1024;
  for (const declaredSize of [undefined, -1, 1.5, 40 * MiB + 1]) {
    await refuses('a.key', [{ path: 'Index.zip', data: 'x', declaredSize }], 'KEY expanded size exceeds its limit');
  }
  // Earlier observed bytes count against a later entry's declared size.
  await refuses('a.key', [{ path: 'a', data: 'x' }, { path: 'b', declaredSize: 40 * MiB, compressedSize: 1 }], 'KEY expanded size exceeds its limit');
  for (const compressedSize of [undefined, -1, archiveBytes.byteLength + 1]) {
    await refuses('a.key', [{ path: 'Index.zip', data: 'x', compressedSize }], 'KEY archive compressed size is invalid');
  }
  await refuses('a.key', [{ path: 'Index.zip', data: 'xx', declaredSize: 1 }], 'KEY expanded size exceeds its limit');
  await refuses('a.key', [{ path: 'Index.zip', data: 'x', declaredSize: 2 }], 'KEY archive entry size is incorrect');
  await refuses('a.key', [{ path: 'Index.zip', data: Buffer.alloc(101), compressedSize: 1 }], 'KEY compression ratio exceeds 100:1');
  // The whole-archive ratio holds even when each entry is within its own ratio.
  const small = Buffer.alloc(10, 1);
  await refuses('a.key', [{ path: 'a', data: Buffer.alloc(600), compressedSize: 10 }, { path: 'b', data: Buffer.alloc(600), compressedSize: 10 }], 'KEY compression ratio exceeds 100:1', small);
});

test('refuses package members that are not UTF-8 and maps reader failures to the application', async () => {
  const [types, ...rest] = office('docx');
  await refuses('a.docx', [{ ...types!, data: Buffer.from([0xc3, 0x28]) }, ...rest], 'document text must be valid UTF-8');
  await refuses('a.xlsx', [{ path: 'x', data: 'x' }, { path: 'x', kind: 'weird' }], 'XLSX contains duplicate archive paths');
  const failing: DocumentArchiveReaderPort = { entries: async function* () { yield* []; throw new Error('zip'); } };
  await assert.rejects(validateDocumentIngress({ filename: 'a.pptx', bytes: archiveBytes }, { archiveReader: failing }), /valid PowerPoint file/);
});

test('refuses Office packages with DTDs, bad XML, wrong roots, macros or missing main parts', async () => {
  const spec = OFFICE.docx;
  await refuses('a.docx', office('docx', { main: '<!DOCTYPE x><w:document/>' }), 'DOCX DTDs, entities and macros are not allowed');
  await refuses('a.docx', office('docx', { main: '<w:document' }), 'DOCX contains invalid package XML');
  await refuses('a.docx', office('docx').filter(entry => entry.path !== spec.part), 'DOCX contains invalid package XML');
  await refuses('a.docx', office('docx', { types: '<Types/>' }), 'DOCX contains invalid package roots');
  await refuses('a.docx', office('docx', { types: `<Other xmlns="${TYPES_NS}"/>` }), 'DOCX contains invalid package roots');
  await refuses('a.docx', office('docx', { rels: '<Relationships/>' }), 'DOCX contains invalid package roots');
  await refuses('a.docx', office('docx', { rels: `<Other xmlns="${RELS_NS}"/>` }), 'DOCX contains invalid package roots');
  await refuses('a.xlsx', office('xlsx', { types: `<Types xmlns="${TYPES_NS}"><Override PartName="/xl/m.xml" ContentType="application/vnd.ms-excel.macrosheet+xml"/><Default/></Types>` }), 'XLSX macros are not allowed');
  const missing = 'DOCX is missing its required Word package members';
  await refuses('a.docx', office('docx', { types: `<Types xmlns="${TYPES_NS}"><Override PartName="/other.xml" ContentType="application/xml"/><x:Override xmlns:x="urn:x" PartName="/${spec.part}"/></Types>` }), missing);
  await refuses('a.docx', office('docx', { mode: 'External' }), missing);
  await refuses('a.docx', office('docx', { target: 'other.xml' }), missing);
  await refuses('a.docx', office('docx', { relType: 'urn:other' }), missing);
  await refuses('a.docx', office('docx', { rels: `<Relationships xmlns="${RELS_NS}"><Relationship Id="r1" Target="${spec.part}"/></Relationships>` }), missing);
  await refuses('a.docx', office('docx', { rels: `<Relationships xmlns="${RELS_NS}"><Relationship Id="r1"/><x:Relationship xmlns:x="urn:x" Type="${OFFICE_REL}" Target="${spec.part}"/></Relationships>` }), missing);
  await refuses('a.docx', office('docx', { main: '<w:body xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>' }), missing);
  await refuses('a.docx', office('docx', { main: '<document/>' }), missing);
  await refuses('a.docx', office('docx', { mainNs: 'urn:other' }), missing);
});

test('display filenames keep the immutable original extension', () => {
  assert.equal(documentDisplayFilename({ title: 'Plan', originalFilename: 'draft.v2.docx' }), 'Plan.docx');
  assert.equal(documentDisplayFilename({ title: 'Plan', originalFilename: 'README' }), 'Plan');
  assert.equal(documentDisplayFilename({ title: 'Plan', originalFilename: null }), 'Plan');
  assert.equal(documentDisplayFilename({ title: 'Plan' }), 'Plan');
});
