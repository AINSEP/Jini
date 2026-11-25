import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A host-supplied scope that hands `work` a private, already-created folder and removes it afterwards. */
export type SqliteBackupTempRoot = <T>(required: { work: (scope: { root: string }) => Promise<T> }) => Promise<T>;

type BackupSource = { backupTo(destPath: string): Promise<void> };

async function backupAndRead(source: BackupSource, root: string): Promise<Buffer> {
  const snapshotPath = join(root, "chat.db");
  await source.backupTo(snapshotPath);
  return await readFile(snapshotPath);
}

/**
 * Online backup (includes WAL writes) of an open SQLite handle, read back as bytes; the temp copy is always removed.
 * Driver-free: the handle is structural (`backupTo`), so the consumer owns its driver installation.
 *
 * @param required.source an open SQLite handle that can write an online backup to a path.
 * @param required.tempDirPrefix the host's `mkdtemp` prefix for the short-lived backup directory.
 * @param optional.withTempRoot a host scope (e.g. an owned temporary root) to run the backup and read in;
 *   when given, no nested temp directory is allocated and the scope owns removal.
 * @complexity O(database size) — one backup write and one read.
 */
export async function captureSqliteBackupBytes(required: { source: BackupSource; tempDirPrefix: string }, optional: { withTempRoot?: SqliteBackupTempRoot } = {}): Promise<Buffer> {
  // The host's scope is an injected effect, so this package never imports a platform implementation.
  if (optional.withTempRoot) return optional.withTempRoot({ work: ({ root }) => backupAndRead(required.source, root) });
  const dir = await mkdtemp(join(tmpdir(), required.tempDirPrefix));
  try {
    return await backupAndRead(required.source, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
