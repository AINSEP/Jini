/**
 * @module compaction-steps
 * The copy and rewrite steps of `convertToIncrementalVacuum` (`./compaction.ts`), on a connection that
 * already holds SQLite's exclusive lock.
 */
import type { SqliteCompactionFs, SqliteDb } from '@jini-ai/core/contracts/storage';
import type { StoppedSqliteOpener } from './stopped.js';

/** A connection admitted under EXCLUSIVE locking mode; nothing else can open the file while it lives. */
export type Admitted = SqliteDb;

/**
 * WAL-consistent copy (`VACUUM INTO`) to `<target>.partial`, checked, then durably renamed into place.
 * A copy that fails its check is removed (it was never published) and the error propagates.
 * @complexity O(database bytes).
 */
export async function copySqliteFile(
  { db, targetPath, io, open }: { db: Admitted; targetPath: string; io: SqliteCompactionFs; open: StoppedSqliteOpener },
): Promise<void> {
  const partial = `${targetPath}.partial`;
  await io.removeOwn(partial);
  try {
    // Same statement as kernel/sqlite/ops.ts `copySqliteInto`, which this connection-only entry must
    // not import (it loads the kernel). Bound, so a quote in a folder name never becomes SQL.
    db.prepare('VACUUM INTO ?').run(partial);
    verifyCopy({ copyPath: partial, open });
  } catch (error) {
    await io.removeOwn(partial);
    throw error;
  }
  await io.publish(partial, targetPath);
}

/** Opens the copy read-only and requires `integrity_check` = ok. @throws when the copy is not whole. */
export function verifyCopy({ copyPath, open }: { copyPath: string; open: StoppedSqliteOpener }): void {
  const copy = open(copyPath, { readonly: true, fileMustExist: true });
  try {
    const [result] = copy.pragma('integrity_check') as Array<{ integrity_check: string }>;
    if (result?.integrity_check !== 'ok') throw new Error('The recovery copy made before compaction did not pass its check; nothing was changed.');
  } finally { copy.close(); }
}

/**
 * The rewrite and its check, in `compactAndVerify`'s order: VACUUM, WAL switch, TRUNCATE checkpoint
 * (busy must be 0), then integrity_check, then `auto_vacuum` must read back as 2.
 * @returns undefined when verified; otherwise the plain reason recorded in the marker.
 */
export function verifyRewrite({ db, alreadyConverted }: { db: Admitted; alreadyConverted: boolean }): string | undefined {
  if (!alreadyConverted) {
    // auto_vacuum only changes through a full VACUUM, and not while the file is in WAL mode.
    db.exec('PRAGMA journal_mode = DELETE; PRAGMA auto_vacuum = INCREMENTAL; VACUUM;');
  }
  // WAL switch and checkpoint BEFORE integrity_check (see kernel/sqlite/ops.ts: the reverse order left a lock).
  db.pragma('journal_mode = WAL');
  const [checkpoint] = db.pragma('wal_checkpoint(TRUNCATE)') as Array<{ busy: number }>;
  if (checkpoint === undefined || checkpoint.busy !== 0) return `final WAL checkpoint reported busy=${checkpoint?.busy}`;
  const [integrity] = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
  if (integrity?.integrity_check !== 'ok') return `integrity_check: ${integrity?.integrity_check ?? 'no answer'}`;
  const mode = db.pragma('auto_vacuum', { simple: true });
  if (mode !== 2) return `auto_vacuum reads ${String(mode)} after the rewrite`;
  return undefined;
}
