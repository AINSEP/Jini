/**
 * Historical lifecycle rationale, carried with the implementation during consumer adoption.
 * @file The real `AgentPluginArchiveReaderPort` adapter, backed by `yauzl`.
 *
 * Library choice (owner-decided, recorded so it is not re-litigated): `yauzl` — streaming,
 * memory-efficient, built for a backend service parsing an untrusted uploaded archive; it enforces
 * no policy of its own, which is exactly the shape this codebase's port+adapter discipline wants —
 * `install.ts` owns every containment/size/entry-kind rule, this file only turns zip bytes into the
 * `AgentPluginArchiveEntry` shape `install.ts` already knows how to harden against. Rejected:
 * `extract-zip` (bundles its own path sanitization and writes to disk itself — it would extract
 * past the caps `install.ts` enforces mid-stream, fighting this module's own hardening rather than
 * feeding it); `adm-zip` (loads the whole archive into memory and blocks the event loop — the
 * opposite of what a 32MB-capped but still untrusted upload should do); `node-unzip-2` (deprecated,
 * known vulnerabilities). If the choice changes later, only this file and its own tests should need
 * to move — `AgentPluginArchiveReaderPort` is the seam precisely so a library swap never touches
 * `install.ts`'s hardening logic.
 *
 * ---------------------------------------------------------------------------
 * Symlink detection — the one thing this file has to get right that yauzl doesn't do for you
 * ---------------------------------------------------------------------------
 * The base ZIP spec has no first-class symlink concept. The de facto convention (Info-ZIP, Python's
 * `zipfile`, and this module's own `yazl`-based test fixtures all follow it) is: when an entry's
 * "version made by" upper byte names a Unix host (`3`), the upper 16 bits of `externalFileAttributes`
 * are the Unix `st_mode`, and a symlink is `(mode & S_IFMT) === S_IFLNK` — the entry's own content
 * (its "file data") is the link target text. This module never reads that content: `install.ts`
 * rejects every symlink-kind entry outright before any content read would matter, so decoding the
 * target string would be pure waste against bytes that are about to be refused anyway.
 *
 * A zip with NO Unix "version made by" (host byte != 3, e.g. an archiver that only sets the MS-DOS
 * convention) reports `externalFileAttributes`' upper bits as meaningless — this module only
 * consults them when the host byte says Unix, so an ordinary non-Unix-authored zip is never
 * misclassified as containing a symlink it doesn't have.
 *
 * Architectural role:
 * Adapter only — no policy. Every hardening rule this module's header cites lives in `install.ts`
 * and is exercised against BOTH the scripted double (`install.unit.test.ts`) and this real reader
 * (`__tests__/unit/yauzl-archive-reader.unit.test.ts`), per the team directive that the adversarial
 * suite is the acceptance criteria for a real archive library, not just for the double.
 */
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

/**
 * Unix `st_mode` file-type mask and the symlink bit pattern within it (`S_IFMT` / `S_IFLNK`).
 */
const S_IFMT = 0xf000;
const S_IFLNK = 0xa000;

/**
 * "Version made by" host-system byte for Unix, per the ZIP spec's APPNOTE.TXT §4.4.2.2.
 */
const UNIX_HOST_SYSTEM = 3;

/**
 * Any bit in the standard rwx-for-owner/group/other executable mask.
 */
const EXECUTABLE_MODE_MASK = 0o111;

export function createYauzlAgentPluginArchiveReader({ yauzl }: { readonly yauzl: YauzlPort }): AgentPluginArchiveReaderPort {
return {
  async *entries({ archive }: { readonly archive: Uint8Array }): AsyncIterable<AgentPluginArchiveEntry> {
    /**
     * Matches install.ts's own "bytes actually observed, not declared" discipline one layer
     * down: yauzl itself refuses to hand back a stream whose actual decompressed byte count
     * disagrees with the entry's own declared uncompressedSize.
     */
    const zipfile = await yauzl.fromBufferPromise(Buffer.from(archive), {
      lazyEntries: true,

      validateEntrySizes: true,
    });

    try {
      for await (const entry of zipfile.eachEntry()) {
        /**
         * The entry's content (the link target text) is deliberately never read — see this
         * module's header. `install.ts` rejects every symlink entry unconditionally.
         */
        const unixMode = readUnixMode(entry);

        if (unixMode !== null && (unixMode & S_IFMT) === S_IFLNK) {

          yield { kind: "symlink", entryPath: entry.fileName };
          continue;
        }

        // File mode defines links even when a hostile filename masquerades as a directory.
        if (entry.fileName.endsWith("/")) {
          yield { kind: "directory", entryPath: entry.fileName };
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

/**
 * Returns the entry's Unix `st_mode`, or `null` when the archive's "version made by" does not
 * name a Unix host — in which case `externalFileAttributes`' upper bits carry no Unix meaning and
 * must not be interpreted as one.
 */
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
