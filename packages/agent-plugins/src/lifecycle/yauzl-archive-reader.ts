/** Optional yauzl adapter. Pass the peer library explicitly; importing lifecycle never loads it. */
export interface YauzlEntry {
  readonly versionMadeBy: number;
  readonly externalFileAttributes: number;
  readonly fileName: string;
  readonly uncompressedSize: number;
}
export interface YauzlZipFile {
  eachEntry(): AsyncIterable<YauzlEntry>;
  openReadStreamPromise(entry: YauzlEntry): Promise<AsyncIterable<Uint8Array>>;
  close(): void;
}
export interface YauzlPort {
  fromBufferPromise(buffer: Buffer, options: { lazyEntries: boolean; validateEntrySizes: boolean }): Promise<YauzlZipFile>;
}

import type { AgentPluginArchiveEntry, AgentPluginArchiveReaderPort } from "./install.js";

const S_IFMT = 0xf000;
const S_IFLNK = 0xa000;

const UNIX_HOST_SYSTEM = 3;

const EXECUTABLE_MODE_MASK = 0o111;

export function createYauzlAgentPluginArchiveReader({ yauzl }: { readonly yauzl: YauzlPort }): AgentPluginArchiveReaderPort {
return {
  async *entries({ archive }: { readonly archive: Uint8Array }): AsyncIterable<AgentPluginArchiveEntry> {
    const zipfile = await yauzl.fromBufferPromise(Buffer.from(archive), {
      lazyEntries: true,

      validateEntrySizes: true,
    });

    try {
      for await (const entry of zipfile.eachEntry()) {
        const unixMode = readUnixMode(entry);

        if (entry.fileName.endsWith("/")) {
          yield { kind: "directory", entryPath: entry.fileName };
          continue;
        }

        if (unixMode !== null && (unixMode & S_IFMT) === S_IFLNK) {

          yield { kind: "symlink", entryPath: entry.fileName };
          continue;
        }

        yield {
          kind: "file",
          entryPath: entry.fileName,
          declaredSize: entry.uncompressedSize,
          executable: unixMode !== null && (unixMode & EXECUTABLE_MODE_MASK) !== 0,
          openReadStream: () => streamEntry(zipfile, entry),
        };
      }
    } finally {
      zipfile.close();
    }
  },
};
}

function readUnixMode(entry: YauzlEntry): number | null {
  const hostSystem = entry.versionMadeBy >>> 8;
  if (hostSystem !== UNIX_HOST_SYSTEM) return null;
  return (entry.externalFileAttributes >>> 16) & 0xffff;
}

async function* streamEntry(zipfile: YauzlZipFile, entry: YauzlEntry): AsyncIterable<Uint8Array> {
  const readStream = await zipfile.openReadStreamPromise(entry);
  for await (const chunk of readStream as AsyncIterable<Uint8Array>) {
    yield chunk;
  }
}
