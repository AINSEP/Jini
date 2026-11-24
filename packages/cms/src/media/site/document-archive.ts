import type { DocumentArchiveReaderPort } from '../document-ingress.js';

/** Minimal structural slice of a promise-style yauzl SDK; the host injects the real module. */
export interface DocumentZipEntry {
  readonly versionMadeBy: number;
  readonly externalFileAttributes: number;
  readonly fileName: string;
  readonly uncompressedSize: number;
}
export interface DocumentZipFile {
  eachEntry(): AsyncIterable<DocumentZipEntry>;
  openReadStreamPromise(entry: DocumentZipEntry): Promise<AsyncIterable<Uint8Array>>;
  close(): void;
}
export interface DocumentZipSdk {
  fromBufferPromise(buffer: Buffer, options: { lazyEntries: boolean; validateEntrySizes: boolean }): Promise<DocumentZipFile>;
}
/** The installed streaming ZIP owner (e.g. the agent-plugins yauzl reader), injected by the host. */
export type DocumentZipArchiveReaderFactory = (required: { readonly yauzl: DocumentZipSdk }) => DocumentArchiveReaderPort;

/** Reuse the installed streaming ZIP owner. The guard exposes no encrypted/special entries to
 * document validation; media owns package policy and aggregate bounds, the reader owns streams. */
export function createDocumentArchiveReader(required: { yauzl: DocumentZipSdk; createArchiveReader: DocumentZipArchiveReaderFactory },
  _optional: Record<string, never> = {}): DocumentArchiveReaderPort {
  const sdk = required.yauzl;
  const createArchiveReader = required.createArchiveReader;
  return { async *entries(entriesRequired) {
    // Preserve ZIP metadata without duplicating the shared reader's streaming/cleanup lifecycle.
    const compressedSizes = new Map<string, number>();
    const reader = createArchiveReader({ yauzl: {
      async fromBufferPromise(buffer, options) {
        const zip = await sdk.fromBufferPromise(buffer, { ...options, strictFileNames: true } as typeof options);
        return {
          async *eachEntry() {
            for await (const entry of zip.eachEntry()) {
              const flags = (entry as typeof entry & { generalPurposeBitFlag: number }).generalPurposeBitFlag;
              const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
              if ((flags & 0x41) !== 0 || ((entry.versionMadeBy >>> 8) === 3 && mode !== 0 && ![0x8000, 0x4000].includes(mode))) {
                throw new Error('encrypted or special ZIP entry');
              }
              compressedSizes.set(entry.fileName, (entry as typeof entry & { compressedSize: number }).compressedSize);
              yield entry;
            }
          },
          openReadStreamPromise: entry => zip.openReadStreamPromise(entry),
          close: () => zip.close(),
        };
      },
    } });
    for await (const entry of reader.entries(entriesRequired)) {
      yield { ...entry, compressedSize: compressedSizes.get(entry.entryPath) };
    }
  } };
}
