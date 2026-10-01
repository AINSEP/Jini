import { dirname } from "node:path";

import { Kysely, PostgresDialect } from "kysely";

import { buildKernel, PG_PARSERS, PGLITE_SOCKET_FILE, postgresLockKey, type StorageKernel } from "../kernel/index.js";
import { type PgModule, pgTypesFor } from "./types.js";

/**
 * @file A storage kernel that reaches a PGlite data dir through its owner's Unix socket
 * (`@jini-ai/db/pglite`'s `startPgliteOwner`): node-postgres with ONE connection and the kernel's turn lock, because PGlite
 * is one backend session — a second connection gives no parallelism, and every client's transaction
 * blocks every other client anyway. Every process sharing the data dir uses this.
 *
 * Kernel rules this transport makes hard: no `SET` (only `SET LOCAL`), no temp tables, no named
 * prepared statements, no session advisory locks — all clients share one session, so any of those
 * leaks into the other process. Backup is not offered here; it goes through the owner.
 */

/**
 * Opens a one-connection kernel on the PGlite owner socket at `socketPath`.
 *
 * @param required.pg the consumer's node-postgres module (`import pg from "pg"`).
 * @throws {Error} a path that does not end in the Postgres socket file name.
 */
export function openPgliteSocketKernel<DB>(required: { pg: PgModule; socketPath: string }): StorageKernel<DB> {
  if (!required.socketPath.endsWith(`/${PGLITE_SOCKET_FILE}`)) {
    throw new Error(`a PGlite socket path ends in /${PGLITE_SOCKET_FILE}: ${required.socketPath}`);
  }
  const pool = new required.pg.Pool({
    host: dirname(required.socketPath),
    port: 5432,
    user: "postgres",
    database: "postgres",
    max: 1,
    // Keep the one connection: every new one's startup waits behind any open transaction.
    idleTimeoutMillis: 0,
    types: pgTypesFor(required.pg, PG_PARSERS),
  });
  // An idle connection dropped by the owner (restart, idle-in-transaction timeout) is evicted by the
  // pool and reopened on next use; without a listener it would crash the process.
  pool.on("error", () => {});
  const base = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  return buildKernel<DB>({
    dialect: "postgres",
    transport: "pglite-socket",
    capabilities: { interactiveTransactions: true, atomicBatch: true, transactionalDdl: true, backup: false },
    ready: Promise.resolve(),
    base,
    oneConnection: true,
    begin: (body) => base.transaction().execute((tx) => body(tx)),
    lockKey: postgresLockKey,
    close: () => base.destroy(),
  });
}
