import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Online backup (includes WAL writes) of an open SQLite handle, read back as bytes; the temp copy is always removed.
 * Driver-free: the handle is structural (`backupTo`), so the consumer owns its driver installation.
 *
 * @param required.source an open SQLite handle that can write an online backup to a path.
 * @param required.tempDirPrefix the host's `mkdtemp` prefix for the short-lived backup directory.
 * @complexity O(database size) — one backup write and one read.
 */
export async function captureSqliteBackupBytes(required: { source: { backupTo(destPath: string): Promise<void> }; tempDirPrefix: string }, _optional = {}): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), required.tempDirPrefix));
  try {
    const snapshotPath = join(dir, "chat.db");
    await required.source.backupTo(snapshotPath);
    return await readFile(snapshotPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
