import { sql } from "kysely";

import type { StorageKernel, StorageTransport } from "./port.js";

/**
 * @file The storage ops port: whole-database FILE operations, which every dialect spells
 * differently and which are not queries (copying a database, compacting and sealing it). Queries go
 * through `StorageKernel.run`; a whole-database backup is `StorageKernel.backupTo`.
 *
 * Each driver subpath implements it (`sqliteOps`, `pgliteOps`, `postgresOps`); this file holds only
 * the contract and the pieces they share, so it reaches no driver.
 */

export interface StorageOps {
  /**
   * Writes a physically consistent copy of the whole database to `targetPath` (which must not
   * exist), read through this connection — so anything still parked in a write-ahead log is
   * included — without writing the source (works on a read-only open).
   * @throws the driver's own error (target exists, directory not writable, source locked).
   */
  copyTo(targetPath: string): Promise<void>;
  /**
   * Reclaims free pages, leaves the database with no pending journal (a sealed file with no
   * sidecars, in WAL mode on SQLite), then verifies its integrity.
   * @throws {StorageOpError} a busy final checkpoint or a failed integrity check.
   */
  compactAndVerify(): Promise<void>;
}

/** An op this driver has no implementation of. `reason` says what to do instead, when there is something. */
export class StorageOpNotSupportedError extends Error {
  constructor(
    readonly op: keyof StorageOps,
    readonly transport: StorageTransport,
    reason?: string
  ) {
    super(reason === undefined ? `storage op ${op} is not supported on the ${transport} driver` : `storage op ${op} is not supported on the ${transport} driver: ${reason}`);
    this.name = "StorageOpNotSupportedError";
  }
}

/** An op that ran but found the database in a state it must not hand back. */
export class StorageOpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageOpError";
  }
}

/**
 * A guard each op calls first: neither SQLite nor Postgres can `VACUUM` inside a transaction.
 * @throws {Error} when `kernel` is inside a transaction.
 */
export function outsideTransactionOf(kernel: StorageKernel<unknown>): (op: keyof StorageOps) => void {
  return (op) => {
    if (kernel.inTransaction()) throw new Error(`storage op ${op} must be called outside a transaction`);
  };
}

/**
 * The read-back that ends a Postgres-family compaction: the migration ledger the consumer names must
 * still be readable and non-empty. The ledger name is the consumer's (no default), because this
 * package ships no tables.
 *
 * @throws {StorageOpError} the ledger cannot be read, or holds no rows.
 */
export async function verifyLedgerReadBack(kernel: StorageKernel<unknown>, ledgerTable: string): Promise<void> {
  let steps: number;
  try {
    const [row] = await kernel.query<{ n: number }>(sql`SELECT count(*)::int AS n FROM ${sql.table(ledgerTable)}`);
    steps = row?.n ?? 0;
  } catch (err) {
    throw new StorageOpError(`the migration ledger ${ledgerTable} cannot be read back: ${(err as Error).message}`);
  }
  if (steps === 0) throw new StorageOpError(`the migration ledger ${ledgerTable} is empty after compacting`);
}
