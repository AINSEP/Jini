import { constants, type BigIntStats, type Stats } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";

/** Metadata captured when a caller reviews a file, before its later read. */
export interface ReviewedFile {
  readonly root: string;
  readonly absPath: string;
  readonly bytes: number;
  readonly mtimeMs: number;
  readonly identity: string | null;
  readonly nlink: number;
}

/** Metadata and bytes must come from the same open descriptor. */
export interface ReviewedFileHandle {
  stat(): Promise<Pick<Stats, "isFile" | "size" | "mtimeMs">>;
  stat(options: { bigint: true }): Promise<Pick<BigIntStats, "dev" | "ino">>;
  readFile(): Promise<Buffer>;
  close(): Promise<void>;
}

type PathEntry = Pick<BigIntStats, "dev" | "ino" | "nlink" | "isSymbolicLink" | "isDirectory">;

/** Injectable filesystem boundary for deterministic path-swap probes. */
export interface ReviewedFileSystem {
  open(file: string, flags: number): Promise<ReviewedFileHandle>;
  lstat(file: string): Promise<PathEntry>;
  realpath(file: string): Promise<string>;
}

const FILE_SYSTEM: ReviewedFileSystem = { open, lstat: file => lstat(file, { bigint: true }), realpath };

/** Bigint preserves 64-bit file IDs; inode zero means the filesystem supplies no identity. */
export function reviewedFileIdentity({ info }: { info: Pick<BigIntStats, "dev" | "ino"> }, _options = {}): string | null {
  return info.ino === 0n ? null : `${info.dev}:${info.ino}`;
}

// NOFOLLOW guards the leaf only. NONBLOCK prevents a swapped FIFO hanging the read; NOCTTY prevents
// a swapped terminal becoming the server's controlling terminal. Windows lacks these flags.
const READ_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0) | (constants.O_NOCTTY ?? 0);

/**
 * Reads only the reviewed inode, size and mtime through a plain path with no newly added hardlinks.
 * Returns null for stale paths/open failures; descriptor I/O errors propagate after closing it.
 * @complexity O(bytes + path depth), one payload read, two fstats, depth lstats and two realpaths.
 */
export async function readReviewedFile(
  { file }: { file: ReviewedFile },
  { fileSystem = FILE_SYSTEM }: { fileSystem?: ReviewedFileSystem } = {},
): Promise<Buffer | null> {
  let handle;
  try { handle = await fileSystem.open(file.absPath, READ_FLAGS); }
  catch { return null; }
  try {
    if (!(await openedIsReviewed({ file, handle, fileSystem }))) return null;
    const bytes = await handle.readFile();
    return bytes.length === file.bytes ? bytes : null;
  } finally { await handle.close(); }
}

/** Identity closes ancestor/root swap-and-swap-back races that path walks alone cannot prove. */
async function openedIsReviewed({ file, handle, fileSystem }: { file: ReviewedFile; handle: ReviewedFileHandle; fileSystem: ReviewedFileSystem }): Promise<boolean> {
  const info = await handle.stat();
  if (!info.isFile() || info.size !== file.bytes || info.mtimeMs !== file.mtimeMs) return false;
  const opened = reviewedFileIdentity({ info: await handle.stat({ bigint: true }) });
  if (file.identity !== null && opened !== file.identity) return false;
  const reached = await walkReviewedPath({ file, fileSystem });
  // Both null only on inode-zero volumes: the path proof is the remaining protection there.
  // A plan raced onto an outside inode can reach it through real folders only via an extra hardlink.
  return reached !== null && reviewedFileIdentity({ info: reached }) === opened && Number(reached.nlink) <= file.nlink;
}

/** Proves each descendant is unlinked and the resolved leaf stays under the trusted scope root. */
async function walkReviewedPath({ file, fileSystem }: { file: ReviewedFile; fileSystem: ReviewedFileSystem }): Promise<PathEntry | null> {
  const relative = path.relative(file.root, file.absPath);
  const names = relative.split(path.sep);
  if (relative === "" || path.isAbsolute(relative) || names[0] === "..") return null;
  try {
    const leaf = await lstatNames({ root: file.root, names, fileSystem });
    if (leaf === null) return null;
    return await fileSystem.realpath(file.absPath) === path.join(await fileSystem.realpath(file.root), relative) ? leaf : null;
  } catch { return null; }
}

/** O(path depth) metadata reads, without entering links or non-directory ancestors. */
async function lstatNames({ root, names, fileSystem }: { root: string; names: readonly string[]; fileSystem: ReviewedFileSystem }): Promise<PathEntry | null> {
  let current = root;
  let leaf: PathEntry | null = null;
  for (const [index, name] of names.entries()) {
    current = path.join(current, name);
    leaf = await fileSystem.lstat(current);
    if (leaf.isSymbolicLink() || (index < names.length - 1 && !leaf.isDirectory())) return null;
  }
  return leaf;
}
