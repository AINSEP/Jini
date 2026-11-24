import { PGlite } from "@electric-sql/pglite";
import Database from "better-sqlite3";
import { sql } from "kysely";
import { afterAll } from "vitest";
import { openPgliteKernel, type PgKernel } from "@jini-ai/db/kernel/pglite";
import { sqliteKernel } from "@jini-ai/db/kernel/sqlite";
import type { KyselyKernel } from "@jini-ai/db/kernel";

/**
 * @file The two embedded dialects (SQLite, PGlite) behind one kernel factory, so one suite proves the
 * store's single Kysely body on both. The DDL is the host's portable table definition, supplied by
 * the test; this package ships no migrations. PGlite is one in-memory instance per test file with the
 * tables truncated before each `make()`; SQLite opens a fresh in-memory database per `make()`.
 */

export const TABLES = {
  state: "search_index_state",
  watermarks: "search_index_watermarks",
  targets: "search_index_targets",
  retired: "search_index_retired",
} as const;

export const DDL = [
  "CREATE TABLE search_index_state (site_id text NOT NULL, provider_id text NOT NULL, generation integer NOT NULL, doc_key text NOT NULL, workspace_id text NOT NULL, collection text NOT NULL, document_id text NOT NULL, revision bigint NOT NULL, deleted integer NOT NULL CHECK (deleted IN (0, 1)), status text NOT NULL CHECK (status IN ('pending', 'indexed', 'unknown', 'failed')), attempts integer NOT NULL DEFAULT 0, task_id text, last_error text, updated_at_ms bigint NOT NULL, PRIMARY KEY (site_id, provider_id, generation, doc_key))",
  "CREATE INDEX ix_search_index_state_status ON search_index_state (site_id, provider_id, generation, status)",
  "CREATE TABLE search_index_watermarks (site_id text NOT NULL, provider_id text NOT NULL, generation integer NOT NULL, collection text NOT NULL, cursor text, done integer NOT NULL CHECK (done IN (0, 1)), PRIMARY KEY (site_id, provider_id, generation, collection))",
  "CREATE TABLE search_index_targets (site_id text PRIMARY KEY NOT NULL, active_provider_id text, active_generation integer, building_provider_id text, building_generation integer, updated_at_ms bigint NOT NULL, CHECK ((active_provider_id IS NULL) = (active_generation IS NULL)), CHECK ((building_provider_id IS NULL) = (building_generation IS NULL)))",
  "CREATE TABLE search_index_retired (site_id text NOT NULL, provider_id text NOT NULL, generation integer NOT NULL, retired_at_ms bigint NOT NULL, PRIMARY KEY (site_id, provider_id, generation))",
] as const;

async function createTables(kernel: KyselyKernel<unknown>): Promise<void> {
  for (const statement of DDL) await kernel.execute(sql.raw(statement));
}

/** A kernel whose calls wait for `pending`, so a synchronous `make()` can hide async setup. */
function heldUntil(kernel: KyselyKernel<unknown>, pending: Promise<void>): KyselyKernel<unknown> {
  pending.catch(() => {});
  return {
    ...kernel,
    ready: pending,
    run: async (fn) => (await pending, kernel.run(fn)),
    transaction: async (fn) => (await pending, kernel.transaction(fn)),
    query: async (statement) => (await pending, kernel.query(statement)),
  };
}

export interface DialectCase { name: string; make: () => KyselyKernel<unknown> }

/** Both dialects, each `make()` yielding an empty, schema-ready kernel. Registers file-level cleanup. */
export function embeddedDialects(): DialectCase[] {
  const sqliteConnections: Database.Database[] = [];
  let shared: { kernel: PgKernel<unknown>; schema: Promise<void> } | undefined;
  // Registered at import (file level): an `after` registered inside a test would run after THAT test.
  afterAll(async () => {
    for (const connection of sqliteConnections) connection.close();
    await shared?.kernel.close();
  });
  return [
    {
      name: "sqlite",
      make: () => {
        const db = new Database(":memory:");
        sqliteConnections.push(db);
        const base = sqliteKernel<unknown>({ source: db });
        return heldUntil(base, base.ready.then(() => createTables(base)));
      },
    },
    {
      name: "pglite",
      make: () => {
        if (shared === undefined) {
          const kernel = openPgliteKernel<unknown>({ PGlite }, {});
          shared = { kernel, schema: kernel.ready.then(() => createTables(kernel)) };
        }
        const { kernel, schema } = shared;
        const emptied = schema.then(() => kernel.execute(sql`TRUNCATE ${sql.join(Object.values(TABLES).map((table) => sql.table(table)))}`));
        return heldUntil(kernel, emptied.then(() => undefined));
      },
    },
  ];
}
