/**
 * @file ADR-023 §2 — boot-time crash recovery for the dataModule engine, on the storage kernel.
 * The site opener calls {@link recoverIncompleteDataModuleMigrations} right after it opens the
 * content database and before anything else reads it — before the SQLite migrations run.
 *
 * Any journal entry not in a terminal phase (`COMMITTED`/`ROLLED_BACK`) is a crash-interrupted
 * attempt — mandatory, blocking:
 * - SQLite: the caller's `restoreSnapshots` closes its connection and restores each entry's
 *   snapshot file ({@link restoreSqliteSnapshots}); the caller then reopens. No restore ever runs
 *   against a file a connection still holds open (T2/T8's corruption vector).
 * - Postgres/PGlite: DDL and the journal commit in one transaction, so an incomplete entry can only
 *   be an attempt whose transaction rolled back. Nothing to restore; the entry is marked
 *   `ROLLED_BACK`.
 */
import { tableExists } from "../kernel/index.js";
import { advanceJournalPhase, findIncompleteJournalEntries, type JournalEntry } from "./migration-journal.js";
import { type PluginStore, pluginKernel } from "./plugin-store.js";
import { restoreFromSnapshot } from "./restore.js";

export interface RecoveryResult {
  recovered: number;
  entries: Array<{ pluginId: string; snapshotPath: string }>;
}

const JOURNAL_TABLE = "_plugin_migration_journal";

/**
 * Finds and settles every crash-interrupted dataModule attempt in `store`'s database. A database
 * with no journal table yet has none.
 *
 * NOTE (SQLite): the journal entry itself is NOT marked `ROLLED_BACK` post-restore. The journal row
 * was inserted AFTER the snapshot it references was taken (§2's phase sequence starts at
 * `PREPARED_SNAPSHOT`, meaning "the snapshot already exists"), so the snapshot never contains that
 * row — restoring from it reverts the live file to a state that has no record of the interrupted
 * attempt at all, which is correct (the attempt is fully undone). The returned `entries` list IS the
 * audit record for this boot's recovery action; the caller must log it.
 *
 * @param required.restoreSnapshots SQLite only: close the connection under `store`, then restore
 *   the entries' snapshots (normally {@link restoreSqliteSnapshots}). `store` is unusable after it.
 */
export async function recoverIncompleteDataModuleMigrations(required: {
  store: PluginStore;
  restoreSnapshots: (entries: readonly JournalEntry[]) => void | Promise<void>;
}, _optional: Record<string, never> = {}): Promise<RecoveryResult> {
  const kernel = pluginKernel({ store: required.store });
  if (!(await tableExists(kernel, JOURNAL_TABLE))) return { recovered: 0, entries: [] };
  const incomplete = await findIncompleteJournalEntries({ store: kernel });
  if (incomplete.length === 0) return { recovered: 0, entries: [] };

  if (kernel.dialect === "sqlite") {
    await required.restoreSnapshots(incomplete);
  } else {
    for (const entry of incomplete) await advanceJournalPhase({ db: kernel, id: entry.id, phase: "ROLLED_BACK" });
  }
  return { recovered: incomplete.length, entries: incomplete.map((e) => ({ pluginId: e.pluginId, snapshotPath: e.snapshotPath })) };
}

/** Restores each entry's snapshot over the SQLite file at `dbPath`. No connection may hold it open. */
export function restoreSqliteSnapshots(
  { dbPath, entries }: { dbPath: string; entries: readonly JournalEntry[] },
  _optional: Record<string, never> = {}
): void {
  // The journal scan returns oldest first. Newer whole-file snapshots may contain older pending
  // journal rows, so unwind newest first or the final copy revives an attempt already restored.
  for (const entry of [...entries].reverse()) {
    restoreFromSnapshot({ dbPath, snapshotPath: entry.snapshotPath });
  }
}
