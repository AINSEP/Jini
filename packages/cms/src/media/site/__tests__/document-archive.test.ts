import { describe, expect, it } from 'vitest';
import {
  createDocumentArchiveReader,
  type DocumentZipArchiveReaderFactory,
  type DocumentZipEntry,
  type DocumentZipFile,
  type DocumentZipSdk,
} from '../document-archive.js';

type Raw = DocumentZipEntry & { generalPurposeBitFlag: number; compressedSize: number };

const REGULAR = 0x8000;
const DIR = 0x4000;
const SYMLINK = 0xa000;
const BLOCK_DEVICE = 0x6000;

/** Unix zip entry: `versionMadeBy` high byte 3, mode in the top half of the external attributes. */
function unixEntry(fileName: string, mode: number, extra: Partial<Raw> = {}): Raw {
  return { fileName, versionMadeBy: 3 << 8, externalFileAttributes: (mode << 16) >>> 0, uncompressedSize: 10, generalPurposeBitFlag: 0, compressedSize: 5, ...extra };
}

/** A recording yauzl stand-in: `entries` are served lazily, streams and closes are tracked. */
function fakeSdk(entries: Raw[]) {
  const log = { fromBuffer: [] as Array<{ buffer: Buffer; options: Record<string, unknown> }>, streams: [] as string[], closed: 0, yielded: 0 };
  const sdk: DocumentZipSdk = {
    async fromBufferPromise(buffer, options) {
      log.fromBuffer.push({ buffer, options: options as unknown as Record<string, unknown> });
      const zip: DocumentZipFile = {
        async *eachEntry() { for (const entry of entries) { log.yielded++; yield entry; } },
        openReadStreamPromise: async (entry) => { log.streams.push(entry.fileName); return (async function* () { yield new TextEncoder().encode(entry.fileName); })(); },
        close: () => { log.closed++; },
      };
      return zip;
    },
  };
  return { sdk, log };
}

/** The injected shared reader: drives the wrapped sdk the way the real streaming reader does. */
const driveReader: DocumentZipArchiveReaderFactory = ({ yauzl }) => ({
  async *entries({ archive }) {
    const zip = await yauzl.fromBufferPromise(Buffer.from(archive), { lazyEntries: true, validateEntrySizes: true });
    try {
      for await (const entry of zip.eachEntry()) {
        const chunks: Uint8Array[] = [];
        for await (const chunk of await zip.openReadStreamPromise(entry)) chunks.push(chunk);
        yield { kind: entry.fileName.endsWith('/') ? 'directory' : 'file', entryPath: entry.fileName, declaredSize: entry.uncompressedSize,
          openReadStream: async function* () { yield* chunks; } };
      }
    } finally { zip.close(); }
  },
});

async function collect(entries: Raw[], archive = new Uint8Array([1, 2, 3])) {
  const { sdk, log } = fakeSdk(entries);
  const reader = createDocumentArchiveReader({ yauzl: sdk, createArchiveReader: driveReader });
  const out = [];
  for await (const entry of reader.entries({ archive })) out.push(entry);
  return { out, log };
}

describe('createDocumentArchiveReader', () => {
  it('attaches each entry\'s ZIP compressed size, keyed by path, without dropping the shared reader\'s fields', async () => {
    const { out } = await collect([unixEntry('word/document.xml', REGULAR, { compressedSize: 7, uncompressedSize: 70 }), unixEntry('word/', DIR, { compressedSize: 0, uncompressedSize: 0 }), unixEntry('_rels/.rels', REGULAR, { compressedSize: 3 })]);
    expect(out.map(({ kind, entryPath, declaredSize, compressedSize }) => ({ kind, entryPath, declaredSize, compressedSize }))).toEqual([
      { kind: 'file', entryPath: 'word/document.xml', declaredSize: 70, compressedSize: 7 },
      { kind: 'directory', entryPath: 'word/', declaredSize: 0, compressedSize: 0 },
      { kind: 'file', entryPath: '_rels/.rels', declaredSize: 10, compressedSize: 3 },
    ]);
    expect(await Array.fromAsync(out[0]!.openReadStream!({}))).toEqual([new TextEncoder().encode('word/document.xml')]);
  });

  it('opens the archive with strict file names on top of the caller\'s options and closes the zip afterwards', async () => {
    const archive = new Uint8Array([9, 8, 7]);
    const { log } = await collect([unixEntry('a.xml', REGULAR)], archive);
    expect(log.fromBuffer).toHaveLength(1);
    expect(log.fromBuffer[0]!.options).toEqual({ lazyEntries: true, validateEntrySizes: true, strictFileNames: true });
    expect([...log.fromBuffer[0]!.buffer]).toEqual([9, 8, 7]);
    expect(log.streams).toEqual(['a.xml']);
    expect(log.closed).toBe(1);
  });

  it.each([
    ['encryption bit (0x1)', { generalPurposeBitFlag: 0x1 }],
    ['strong-encryption bit (0x40)', { generalPurposeBitFlag: 0x40 }],
    ['both bits set', { generalPurposeBitFlag: 0x41 }],
    ['unix symlink', { externalFileAttributes: (SYMLINK << 16) >>> 0 }],
    ['unix block device', { externalFileAttributes: (BLOCK_DEVICE << 16) >>> 0 }],
  ] as Array<[string, Partial<Raw>]>)('refuses %s before its stream is opened', async (_name, patch) => {
    const { sdk, log } = fakeSdk([unixEntry('ok.xml', REGULAR), unixEntry('bad.xml', REGULAR, patch)]);
    const reader = createDocumentArchiveReader({ yauzl: sdk, createArchiveReader: driveReader });
    const seen: string[] = [];
    await expect((async () => { for await (const entry of reader.entries({ archive: new Uint8Array(1) })) seen.push(entry.entryPath); })()).rejects.toThrow('encrypted or special ZIP entry');
    expect(seen, 'the entry before the bad one is still delivered').toEqual(['ok.xml']);
    expect(log.streams, 'the guard runs before the shared reader opens the bad entry').toEqual(['ok.xml']);
    expect(log.closed).toBe(1);
  });

  it('accepts regular files and directories, an entry with no mode, and non-unix hosts regardless of the mode bits', async () => {
    const { out } = await collect([
      unixEntry('file.xml', REGULAR),
      unixEntry('dir/', DIR),
      unixEntry('nomode.xml', 0),
      // MS-DOS (host 0) archives put attribute bits, not a unix mode, in the same field.
      unixEntry('dos.xml', SYMLINK, { versionMadeBy: 0 }),
      unixEntry('ntfs.xml', BLOCK_DEVICE, { versionMadeBy: 10 << 8 }),
    ]);
    expect(out.map((entry) => entry.entryPath)).toEqual(['file.xml', 'dir/', 'nomode.xml', 'dos.xml', 'ntfs.xml']);
  });
});
