import { createConsoleLogger, type Logger } from "@jini-ai/core/primitives";
import { Kysely, PostgresDialect } from "kysely";

import { PG_PARSERS } from "../../core/index.js";
import { buildKernel, postgresLockKey, type KyselyKernel } from "../index.js";
import { type PgModule, pgTypesFor } from "../../core/pg-types.js";

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
  optional: { max?: number; report?: Pick<Logger, "warn"> } = {}
): KyselyKernel<DB> {
  const logger = optional.report ?? createConsoleLogger({ prefix: "[postgres]" });
  const pool = new required.pg.Pool({
    connectionString: required.connectionString,
    max: optional.max ?? 10,
    types: pgTypesFor(required.pg, PG_PARSERS),
  });
  // An idle connection dropped by the server (restart, failover, pg_terminate_backend, a pooler's
  // idle cut) is evicted by the pool and reopened on next use; without a listener it would crash the
  // process.
  pool.on("error", (err) => logger.warn({ message: "Idle pool connection dropped." }, { error: err }));
  // Pool error listeners cover idle clients only. Session-owned workers hold a client for
  // longer, so absorb its error event while the next query rejects and stops that owner.
  const connected = new WeakSet<object>();
  const connect = pool.connect.bind(pool);
  pool.connect = async () => {
    const client = await connect();
    if (!connected.has(client)) {
      connected.add(client);
      client.on?.("error", (error) => logger.warn({ message: "Active pool connection dropped; its operation will stop." }, { error }));
    }
    return client;
  };
  const base = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  return buildKernel<DB>({
    dialect: "postgres",
    transport: "node-postgres",
    capabilities: { interactiveTransactions: true, atomicBatch: true, transactionalDdl: true, backup: false },
    ready: Promise.resolve(),
    base,
    oneConnection: false,
    poolMax: optional.max ?? 10,
    begin: (body) => base.transaction().execute((tx) => body(tx)),
    lockKey: postgresLockKey,
    close: () => base.destroy(),
  });
}
