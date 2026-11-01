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

/** Check the destination filesystem before allocating a full copy. Source/statfs errors propagate.
 * The reserve leaves room for the live DB's WAL and journal during the operation.
 * @complexity O(1), two metadata reads; no database bytes are read.
 * @example await assertDatabaseCopySpace({ sourcePath: '/site/content.db', destinationPath: '/site/copy.db' }); */
export async function assertDatabaseCopySpace(
  { sourcePath, destinationPath }: { sourcePath: string; destinationPath: string },
  _options: Record<string, never> = {},
): Promise<void> {
  const sourceBytes = sourcePath === ':memory:' ? 0 : (await fs.stat(sourcePath)).size;
  const space = await fs.statfs(path.dirname(path.resolve(destinationPath)));
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
  const directory = path.dirname(path.resolve(justWritten));
  const local = copies.filter(copy => path.dirname(path.resolve(copy.filePath)) === directory);
  local.sort((a, b) => b.createdAt - a.createdAt || b.filePath.localeCompare(a.filePath));
  const retained = new Set(local.slice(0, DATABASE_COPY_RETENTION).map(copy => copy.filePath));
  for (const copy of local) {
    if (copy.filePath === justWritten || retained.has(copy.filePath) || protectedPaths.has(copy.filePath)) continue;
    await remove(copy);
  }
}
