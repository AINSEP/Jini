import { closeSync, copyFileSync, mkdirSync, openSync, readSync } from "node:fs";
import { dirname } from "node:path";
import { writeFileAtomically, type ThemeFileWritePorts } from "./atomic-write.node.js";

export interface ThemeOriginalFilePorts extends ThemeFileWritePorts { readonly isPathError: (required: { error: unknown }, optional?: {}) => boolean }


/** Read size for {@link filesHaveSameBytes}: its memory is two buffers of this size, however large
 *  the files being compared are. */
const COMPARE_CHUNK_BYTES = 64 * 1024;

/** Fills `buffer` from `fd` starting at `position`, looping over short reads. Returns the byte count
 *  that landed, which is below `buffer.length` only at end of file. */
function readFullChunk({ fd, buffer, position }: { fd: number; buffer: Buffer; position: number }, _optional = {}): number {
  let filled = 0;
  while (filled < buffer.length) {
    const bytesRead = readSync(fd, buffer, filled, buffer.length - filled, position + filled);
    if (bytesRead === 0) break;
    filled += bytesRead;
  }
  return filled;
}

/**
 * Whether the files at `pathA` and `pathB` hold identical bytes, compared chunk by chunk until the
 * first mismatch or end of file. `pathA` is opened first, so an open failure on it is the one thrown.
 *
 * @complexity O(s) time in the file size, O(1) space (two {@link COMPARE_CHUNK_BYTES} buffers).
 */
function filesHaveSameBytes({ pathA, pathB }: { pathA: string; pathB: string }, _optional = {}): boolean {
  const fdA = openSync(pathA, "r");
  try {
    const fdB = openSync(pathB, "r");
    try {
      return compareOpenThemeFiles({ fdA, fdB });
    } finally {
      closeSync(fdB);
    }
  } finally {
    closeSync(fdA);
  }
}

function compareOpenThemeFiles({ fdA, fdB }: { fdA: number; fdB: number }, _options = {}): boolean {
  const chunkA = Buffer.allocUnsafe(COMPARE_CHUNK_BYTES);
  const chunkB = Buffer.allocUnsafe(COMPARE_CHUNK_BYTES);
  // A short chunk (readA < COMPARE_CHUNK_BYTES) means end of file: once it compared equal, so are
  // the files. A do/while rather than `for (;;)` with a return inside, so no unreachable
  // fall-through follows the loop.
  let position = 0;
  let readA: number;
  do {
    readA = readFullChunk({ fd: fdA, buffer: chunkA, position });
    const readB = readFullChunk({ fd: fdB, buffer: chunkB, position });
    if (readA !== readB || !chunkA.subarray(0, readA).equals(chunkB.subarray(0, readB))) return false;
    position += COMPARE_CHUNK_BYTES;
  } while (readA === COMPARE_CHUNK_BYTES);
  return true;
}

/**
 * The catalog original's absolute path and size for `relativePath`, or `null` when there is no
 * regular file there to compare against: missing, a directory, or a path that fails containment
 * against the catalog folder. Any containment failure maps to `null` rather than throwing: from the
 * caller's side it means "no original for this path", which callers report as an absent original.
 */
function originalRegularFile(required: {
  originalDir: string;
  originalsRoot: string;
  relativePath: string;
  ports: ThemeOriginalFilePorts;
}): { path: string; size: number } | null {
  try {
    const path = required.ports.resolvePath({
      themeDir: required.originalDir,
      themesRoot: required.originalsRoot,
      relativePath: required.relativePath,
    });
    const stat = required.ports.statPath({ target: path, relativePath: required.relativePath });
    return stat?.isFile() ? { path, size: stat.size } : null;
  } catch (err) {
    if (required.ports.isPathError({ error: err })) return null;
    throw err;
  }
}

/**
 * Whether one file in a theme's live folder differs from its catalog original, byte for byte.
 *
 * Decided from content only, never from mtime. Different sizes answer `true` from the two stats
 * without opening either file; equal sizes always go to a full byte comparison. No line-ending or
 * whitespace normalization: a CRLF-vs-LF difference is a difference.
 *
 * @param required.themeDir - The live theme's own folder.
 * @param required.themesRoot - The configured themes root, for the live side's recognized-root check.
 * @param required.originalDir - The theme's catalog folder (`<themesRoot>/__original-themes__/<tier>/<id>`).
 * @param required.originalsRoot - The catalog root (`<themesRoot>/__original-themes__`).
 * @param required.relativePath - The file, relative to both folders.
 * @returns `null` when the catalog has no regular file at `relativePath` (so there is nothing to
 * compare against, and nothing to reset to). Otherwise `true` when the live file is missing, is not
 * a regular file, or its bytes differ; `false` when the bytes are identical.
 * @throws the host path error When `relativePath` fails containment against the LIVE folder or names
 * a circular symlink.
 * @throws Filesystem failures from either side's stat or byte comparison (e.g. `EIO` or `EACCES`).
 * @complexity O(1) stats when there is no original or the sizes differ; otherwise O(s) time in the
 * file size and O(1) space.
 */
export function themeFileDiffersFromOriginal(
  required: { themeDir: string; themesRoot: string; originalDir: string; originalsRoot: string; relativePath: string; ports: ThemeOriginalFilePorts },
  _optional: Record<string, never> = {}
): boolean | null {
  const { themeDir, themesRoot, relativePath, ports } = required;
  const livePath = ports.resolvePath({ themeDir, themesRoot, relativePath });
  const original = originalRegularFile(required);
  if (!original) return null;
  const live = ports.statPath({ target: livePath, relativePath });
  if (!live?.isFile() || live.size !== original.size) return true;
  return !filesHaveSameBytes({ pathA: livePath, pathB: original.path });
}

/**
 * Restore one file in a theme's live folder to its catalog original, byte for byte.
 *
 * Never decodes either file. The original is copied with `copyFileSync` into a temp file that
 * {@link writeFileAtomically} renames over the live path, so a binary asset (an image, a font) comes
 * back exactly and then compares unmodified in {@link themeFileDiffersFromOriginal}. Going through
 * text file reads and writes instead would decode via UTF-8 and turn every invalid
 * byte into U+FFFD. There is no text read limit here for the same reason: that
 * limit bounds text a caller reads or writes, and a reset carries no text.
 *
 * A live file whose bytes already match is not written at all. A missing live file is recreated,
 * along with any missing parent folders, and takes the original's mode (`copyFileSync` copies it).
 * An existing live file keeps its own mode.
 *
 * @param required.themeDir - The live theme's own folder.
 * @param required.themesRoot - The configured themes root, for the live side's recognized-root check.
 * @param required.originalDir - The theme's catalog folder (`<themesRoot>/__original-themes__/<tier>/<id>`).
 * @param required.originalsRoot - The catalog root (`<themesRoot>/__original-themes__`).
 * @param required.relativePath - The file, relative to both folders.
 * @returns `null` when the catalog has no regular file at `relativePath`. That is checked before the
 * live side is resolved, so nothing is touched. Otherwise `bytes` is the original's size, and
 * `wasModified` is `false` when the live bytes already matched (nothing written) or `true` after the
 * copy.
 * @throws the host path error When `relativePath` fails containment against the LIVE folder, or the live
 * path exists and is not a regular file.
 * @throws Whatever `openSync`/`readSync`/`accessSync`/`copyFileSync`/`chmodSync`/`renameSync` throw,
 * e.g. `EACCES` for an unreadable original or a read-only live file. A failed copy leaves no temp
 * file behind.
 * @complexity O(s) time in the file size, for the comparison and the copy; O(1) space in this process.
 */
export function resetThemeFileToOriginal(
  required: { themeDir: string; themesRoot: string; originalDir: string; originalsRoot: string; relativePath: string; ports: ThemeOriginalFilePorts },
  _optional: Record<string, never> = {}
): { wasModified: boolean; bytes: number } | null {
  const { themeDir, themesRoot, relativePath, ports } = required;
  const original = originalRegularFile(required);
  if (!original) return null;
  const target = ports.resolvePath({ themeDir, themesRoot, relativePath });
  const live = ports.statPath({ target, relativePath });
  if (live && !live.isFile()) {
    throw ports.pathError({ reason: "not-regular-file", relativePath });
  }
  if (live?.size === original.size && filesHaveSameBytes({ pathA: target, pathB: original.path })) {
    return { wasModified: false, bytes: original.size };
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileAtomically({ ports, target, relativePathForError: relativePath, fillTemp: (tempPath) => copyFileSync(original.path, tempPath) }, { stat: undefined, revisionFile: { themeDir, themesRoot, relativePath } });
  return { wasModified: true, bytes: original.size };
}
