import { sql } from "kysely";

import {
  outsideTransactionOf,
  type StorageKernel,
  StorageOpNotSupportedError,
  type StorageOps,
  verifyLedgerReadBack,
} from "../index.js";

/**
 * @file The storage ops for a node-postgres kernel: a Postgres server (`openPostgresKernel`) or a
 * PGlite socket client (`openPgliteSocketKernel`) with no owner in this process. Neither can copy
 * the database as a file; compacting is `VACUUM` (plus `CHECKPOINT` on PGlite) and a read-back of the
 * consumer's migration ledger. A socket client whose owner runs in this process uses
 * `@jini-ai/db/kernel/pglite`'s `pgliteOps` instead, which can copy through the owner.
 */

/** Why a Postgres server's database is never file-copied. */
const POSTGRES_COPY_REASON = "a Postgres database is backed up by its provider; use a transfer tool to copy it";
/** Why a PGlite socket client cannot copy on its own. */
const SOCKET_COPY_REASON = "a PGlite socket client copies through its owner's exclusive window (use pgliteOps with pgliteOwner)";

/**
 * The ops for a node-postgres kernel. Must be used outside a transaction.
 *
 * @param required.ledgerTable the migration ledger the compaction reads back (no default).
 * @throws {Error} a kernel of another transport.
 * @complexity `compactAndVerify` is one full `VACUUM` pass, O(size).
 */
export function postgresOps<DB>(kernel: StorageKernel<DB>, required: { ledgerTable: string }): StorageOps {
  if (kernel.transport !== "node-postgres" && kernel.transport !== "pglite-socket") {
    throw new Error(`postgresOps: a ${kernel.transport} kernel is not a node-postgres connection`);
  }
  const outsideTransaction = outsideTransactionOf(kernel as StorageKernel<unknown>);
  return {
    async copyTo() {
      outsideTransaction("copyTo");
      const reason = kernel.transport === "pglite-socket" ? SOCKET_COPY_REASON : POSTGRES_COPY_REASON;
      throw new StorageOpNotSupportedError("copyTo", kernel.transport, reason);
    },
    async compactAndVerify() {
      outsideTransaction("compactAndVerify");
      if (kernel.transport === "pglite-socket") {
        await kernel.execute(sql`VACUUM`);
        await kernel.execute(sql`CHECKPOINT`);
      } else {
        // A hosted server rarely lets an app's role CHECKPOINT; a commit is durable anyway.
        await kernel.execute(sql`VACUUM (ANALYZE)`);
      }
      await verifyLedgerReadBack(kernel as StorageKernel<unknown>, required.ledgerTable);
    },
  };
}
