/** @file TEST-ONLY PostgreSQL-dialect kernels over node-postgres (`./testing/postgres`). The driver is this package's own copy. Never import from product code. */
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

import { sql } from "kysely";

import { scopeToSchema, type KyselyKernel } from "../index.js";
import { pgTestKernel, type PgTestKernel } from "../testing.js";
import { openPostgresKernel } from "./driver.js";
import { openPgliteSocketKernel } from "./pglite-socket.js";

const loadDriver = createRequire(import.meta.url);

/**
 * A kernel on a real PostgreSQL server, scoped to a fresh disposable schema. The first call for a
 * `schema` creates it and applies `ddl` inside it; later calls with the same `schema` and no `ddl` join
 * it. Closing a kernel that created the schema drops it.
 * @throws Error when `url` does not name a `jini_<package>_test_*` database, so a test can never run against real data.
 */
export async function openPostgresTestKernel<DB>(
  required: { url: string },
  optional: { schema?: string; ddl?: readonly string[] } = {},
): Promise<PgTestKernel<DB>> {
  if (!/^jini_[a-z]+_test_/.test(new URL(required.url).pathname.slice(1))) {
    throw new Error("Postgres test kernels need a disposable jini_<package>_test_* database.");
  }
  const base = openPostgresKernel<DB>({ pg: loadDriver("pg"), connectionString: required.url });
  const schema = optional.schema ?? `testing_${randomUUID().replaceAll("-", "")}`;
  const created = optional.ddl !== undefined;
  try {
    if (created) await createSchema({ kernel: base, schema }, { ddl: optional.ddl ?? [] });
  } catch (error) {
    await base.close();
    throw error;
  }
  const close = async () => {
    try { if (created) await base.execute(sql`DROP SCHEMA ${sql.id(schema)} CASCADE`); } finally { await base.close(); }
  };
  return pgTestKernel({ kernel: scopeToSchema(base, schema), close });
}

async function createSchema<DB>({ kernel, schema }: { kernel: KyselyKernel<DB>; schema: string }, { ddl }: { ddl: readonly string[] }): Promise<void> {
  await kernel.execute(sql`CREATE SCHEMA ${sql.id(schema)}`);
  await kernel.transaction(async () => {
    await kernel.execute(sql`SET LOCAL search_path TO ${sql.id(schema)}`);
    for (const statement of ddl) await kernel.execute(sql.raw(statement));
  });
}

/**
 * A node-postgres client in front of a PGlite owner's socket (the shape a host uses when two processes share
 * one embedded database). Start the owner with `startPgliteTestOwner` from `./testing/pglite-owner`.
 * `close` closes the client only; the owner is the caller's.
 */
export async function openPgliteSocketTestKernel<DB>(required: { socketPath: string }, optional: { ddl?: readonly string[] } = {}): Promise<PgTestKernel<DB>> {
  const kernel = openPgliteSocketKernel<DB>({ pg: loadDriver("pg"), socketPath: required.socketPath });
  try {
    for (const statement of optional.ddl ?? []) await kernel.execute(sql.raw(statement));
    return pgTestKernel({ kernel, close: () => kernel.close() });
  } catch (error) {
    await kernel.close();
    throw error;
  }
}
