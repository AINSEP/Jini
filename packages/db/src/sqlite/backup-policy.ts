/** Shared disk budget and retention for host-owned SQLite recovery copies. */
import fs from 'node:fs/promises';
import path from 'node:path';

export const DATABASE_COPY_RETENTION = 5;
const MB = 1024 * 1024;
const DISK_RESERVE_BYTES = 50 * MB;

/** Safe operator-facing refusal; callers can map it without exposing driver errors or paths. */
export class DatabaseDiskSpaceError extends Error {
  readonly code = 'INSUFFICIENT_STORAGE';
  readonly status = 507;
  constructor({ freeBytes, requiredBytes }: { freeBytes: number; requiredBytes: number }) {
    super(`The server's disk is almost full (${Math.floor(freeBytes / MB)} MB free, needs ${Math.ceil(requiredBytes / MB)} MB) — free space or grow the disk.`);
    this.name = 'DatabaseDiskSpaceError';
  }
}

/** Check the destination filesystem before allocating a full copy. Missing destination directories
 * get the backup API's clear error; source errors and other statfs errors propagate unchanged.
 * The reserve leaves room for the live DB's WAL and journal during the operation.
 * @complexity O(1), two metadata reads; no database bytes are read.
 * @example await assertDatabaseCopySpace({ sourcePath: '/site/content.db', destinationPath: '/site/copy.db' }); */
export async function assertDatabaseCopySpace(
  { sourcePath, destinationPath }: { sourcePath: string; destinationPath: string },
  _options: Record<string, never> = {},
): Promise<void> {
  const sourceBytes = sourcePath === ':memory:' ? 0 : (await fs.stat(sourcePath)).size;
  const directory = path.dirname(path.resolve(destinationPath));
  const space = await fs.statfs(directory).catch((error: unknown) => {
    // Preserve the backup API's diagnostic now that preflight reaches the filesystem first.
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new TypeError(`Cannot save backup because the directory does not exist: ${directory}`, { cause: error });
    }
    throw error;
  });
  const freeBytes = space.bavail * space.bsize;
  const requiredBytes = Math.ceil(sourceBytes * 1.2) + DISK_RESERVE_BYTES;
  if (freeBytes < requiredBytes) throw new DatabaseDiskSpaceError({ freeBytes, requiredBytes });
}

export interface DatabaseCopy { readonly filePath: string; readonly createdAt: number }

/** Prune only caller-owned candidates beside the successful new copy. Hosts select exact naming
 * patterns and supply repository deletion when files have rows; protected copies exceed the cap.
 * Never prune before a new copy succeeds: an I/O failure must not consume the recovery window.
 * @complexity O(n log n) time, O(n) space; deletion is sequential to bound filesystem/DB work.
 * @example await pruneDatabaseCopies({ copies, justWritten }, { protectedPaths: activeArtifacts }); */
export async function pruneDatabaseCopies(
  { copies, justWritten }: { copies: readonly DatabaseCopy[]; justWritten: string },
  { protectedPaths = new Set<string>(), remove = async ({ filePath }: DatabaseCopy) => fs.rm(filePath, { force: true }) }: {
    protectedPaths?: ReadonlySet<string>;
    remove?: (copy: DatabaseCopy) => Promise<void>;
  } = {},
): Promise<void> {
  const local = localCopiesNewestFirst({ copies, anchorPath: justWritten });
  const retained = new Set(local.slice(0, DATABASE_COPY_RETENTION).map(copy => copy.filePath));
  for (const copy of local) {
    if (copy.filePath === justWritten || retained.has(copy.filePath) || protectedPaths.has(copy.filePath)) continue;
    await remove(copy);
  }
}

/** The one ordering and folder rule both the live pruner and the selection pass use, so a pass can
 * never disagree with boot about which copies are "the newest five".
 * @complexity O(n log n) time, O(n) space. */
function localCopiesNewestFirst(
  { copies, anchorPath }: { copies: readonly DatabaseCopy[]; anchorPath: string },
  _optional: Record<string, never> = {},
): DatabaseCopy[] {
  const directory = path.dirname(path.resolve(anchorPath));
  const local = copies.filter(copy => path.dirname(path.resolve(copy.filePath)) === directory);
  return local.sort((a, b) => b.createdAt - a.createdAt || b.filePath.localeCompare(a.filePath));
}

/** Pure selection for a scheduled retention pass: which caller-owned copies a pass MAY remove.
 * Nothing is selected unless `verifiedNewest` names the newest local copy, because pruning against an
 * unverified (possibly torn) copy would spend the only good recovery window. Protected copies are
 * kept beyond `keep`, and copies outside the anchor's folder are never candidates. Selection only:
 * the caller removes files, under whatever lock its backup publication and recovery readers share.
 * @complexity O(n log n) time, O(n) space; no filesystem access.
 * @example selectDatabaseCopiesToPrune({ copies, verifiedNewest: newest.filePath }, { protectedPaths }); */
export function selectDatabaseCopiesToPrune(
  { copies, verifiedNewest }: { copies: readonly DatabaseCopy[]; verifiedNewest: string | null | undefined },
  { keep = DATABASE_COPY_RETENTION, protectedPaths = new Set<string>() }: {
    keep?: number;
    protectedPaths?: ReadonlySet<string>;
  } = {},
): DatabaseCopy[] {
  if (!Number.isInteger(keep) || keep < 1) {
    throw new RangeError(`Copy retention keep must be a whole number of at least 1 (got ${keep}).`);
  }
  if (!verifiedNewest) return [];
  const local = localCopiesNewestFirst({ copies, anchorPath: verifiedNewest });
  // The anchor has to be the newest listed copy: a newer copy written after verification is unproven.
  if (local.length === 0 || path.resolve(local[0]!.filePath) !== path.resolve(verifiedNewest)) return [];
  const isProtected = (filePath: string) => protectedPaths.has(filePath) || protectedPaths.has(path.resolve(filePath));
  return local.slice(keep).filter(copy => !isProtected(copy.filePath));
}
