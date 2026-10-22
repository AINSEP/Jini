import type { ArchiveReaderPort } from "./ports.js";
interface ZipEntry { fileName: string; uncompressedSize: number; externalFileAttributes: number }
interface ZipFile { eachEntry(): AsyncIterable<ZipEntry>; openReadStreamPromise(entry: ZipEntry): Promise<AsyncIterable<Uint8Array> & { destroy(): void }>; close(): void }
export interface SkillZipSdkPort { fromBufferPromise(bytes: Buffer, options: { lazyEntries: boolean; strictFileNames: boolean; validateEntrySizes: boolean }): Promise<ZipFile> }
/** Bind the installed ZIP library, preserving strict filenames and regular-file-only semantics.
 * Unlike executable plugin archives, skill scripts are inert data and every non-regular mode is
 * refused regardless of the ZIP producer's platform marker.
 */
export function createYauzlSkillArchiveReader({ yauzl }: { yauzl: SkillZipSdkPort }, _optional = {}): ArchiveReaderPort {
  return { async open({ bytes }) {
    const zip = await yauzl.fromBufferPromise(Buffer.from(bytes), { lazyEntries: true, strictFileNames: true, validateEntrySizes: true });
    return {
      entries: (async function* () {
        for await (const entry of zip.eachEntry()) {
          const type = (entry.externalFileAttributes >>> 16) & 0xf000;
          const kind = type && type !== 0x8000 && type !== 0x4000 ? "other" : entry.fileName.endsWith("/") ? "directory" : "file";
          yield { path: entry.fileName, size: entry.uncompressedSize, kind,
            async *read() {
              const stream = await zip.openReadStreamPromise(entry);
              try { for await (const chunk of stream) yield chunk; }
              finally { stream.destroy(); }
            },
          };
        }
      })(),
      close: () => zip.close(),
    };
  } };
}
