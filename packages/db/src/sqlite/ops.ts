import { outsideTransactionOf, StorageOpError, type StorageKernel, type StorageOps } from "../kernel/index.js";
import { sqliteConnectionOf } from "./driver.js";

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
      // Bound parameter: VACUUM INTO takes an expression, so the path is never spliced into SQL.
      client.prepare("VACUUM INTO ?").run(targetPath);
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
