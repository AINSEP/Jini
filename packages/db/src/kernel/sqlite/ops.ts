import { outsideTransactionOf, StorageOpError, type StorageKernel, type StorageOps } from "../index.js";
import { sqliteConnectionOf } from "./driver.js";

/** Synchronous WAL-safe snapshot for admission code that must commit under a synchronous lock.
 * Accepts either the host's SQLite client or Node's built-in DatabaseSync; the caller owns it.
 * @throws SQLite errors, including an existing destination or an active transaction.
 * @complexity O(database bytes), performed by SQLite without buffering the database in JS.
 */
export function copySqliteInto({ source, targetPath }: {
  source: { prepare(sql: string): { run(targetPath: string): unknown } }; targetPath: string;
}, _options = {}): void {
  // Bind the destination: quotes in a folder name must never become SQL syntax.
  source.prepare("VACUUM INTO ?").run(targetPath);
}

/**
 * The storage ops (`@jini-ai/db/kernel`'s `StorageOps`) for a kernel the sqlite driver built:
 * `VACUUM INTO` for the copy; `VACUUM` + WAL checkpoint + `integrity_check` for compacting. Must be
 * used outside a transaction.
 *
 * @throws {Error} a kernel this driver did not build (no connection to act on); an op called inside
 *   a transaction.
 * @complexity each op is one full pass over the database file, O(size).
 */
export function sqliteOps<DB>(kernel: StorageKernel<DB>): StorageOps {
  const client = sqliteConnectionOf(kernel);
  if (client === undefined) throw new Error("sqliteOps: this SQLite kernel was not built by the sqlite driver");
  const outsideTransaction = outsideTransactionOf(kernel as StorageKernel<unknown>);
  return {
    async copyTo(targetPath) {
      outsideTransaction("copyTo");
      copySqliteInto({ source: client, targetPath });
    },
    async compactAndVerify() {
      outsideTransaction("compactAndVerify");
      client.exec("VACUUM");
      // WAL switch and checkpoint BEFORE integrity_check: running the check first on a just-VACUUMed
      // connection reproducibly left a lock that failed the checkpoint with SQLITE_LOCKED.
      client.pragma("journal_mode = WAL");
      const [checkpoint] = client.pragma("wal_checkpoint(TRUNCATE)") as Array<{ busy: number }>;
      if (checkpoint === undefined || checkpoint.busy !== 0) {
        throw new StorageOpError(`final WAL checkpoint on ${client.name} reported busy=${checkpoint?.busy}`);
      }
      const [integrity] = client.pragma("integrity_check") as Array<{ integrity_check: string }>;
      if (integrity?.integrity_check !== "ok") {
        throw new StorageOpError(`${client.name} failed integrity_check: ${JSON.stringify(integrity)}`);
      }
    },
  };
}
