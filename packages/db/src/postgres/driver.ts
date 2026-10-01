import { Kysely, PostgresDialect } from "kysely";

import { buildKernel, PG_PARSERS, postgresLockKey, type StorageKernel } from "../kernel/index.js";
import { type PgModule, pgTypesFor } from "./types.js";

/**
 * @file The node-postgres driver: a connection POOL to any Postgres server (local, Supabase, Neon).
 * Kysely's own Postgres dialect; each transaction checks out its own connection, so unrelated
 * requests run concurrently (no turn lock) and `lockKey` is what serializes the sequences that
 * must not interleave.
 *
 * This package never imports `pg`: the consumer passes its own module (`import pg from "pg"`).
 */

/**
 * Opens a pooled kernel on the server at `connectionString`.
 *
 * @param required.pg the consumer's node-postgres module.
 * @param optional.max pool size, default 10.
 */
export function openPostgresKernel<DB>(
  required: { pg: PgModule; connectionString: string },
  optional: { max?: number } = {}
): StorageKernel<DB> {
  const pool = new required.pg.Pool({
    connectionString: required.connectionString,
    max: optional.max ?? 10,
    types: pgTypesFor(required.pg, PG_PARSERS),
  });
  // An idle connection dropped by the server (restart, failover, pg_terminate_backend, a pooler's
  // idle cut) is evicted by the pool and reopened on next use; without a listener it would crash the
  // process.
  pool.on("error", (err) => console.warn(`[postgres] idle pool connection dropped: ${err.message}`));
  const base = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  return buildKernel<DB>({
    dialect: "postgres",
    transport: "node-postgres",
    capabilities: { interactiveTransactions: true, atomicBatch: true, transactionalDdl: true, backup: false },
    ready: Promise.resolve(),
    base,
    oneConnection: false,
    begin: (body) => base.transaction().execute((tx) => body(tx)),
    lockKey: postgresLockKey,
    close: () => base.destroy(),
  });
}
