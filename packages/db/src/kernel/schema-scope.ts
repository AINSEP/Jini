import type { StorageKernel } from "./port.js";

/**
 * @file A kernel whose query-builder statements address one Postgres schema: every `run()` body gets
 * `db.withSchema(schema)` (Kysely's own plugin prefixes each table it names). Used when one
 * database holds several histories, each in its own schema.
 *
 * Not `SET search_path`: that is session state, which a shared PGlite connection (and a pooled
 * node-postgres one) must never carry. `query`/`execute` take raw SQL, which no plugin rewrites:
 * raw statements through a scoped kernel name their schema themselves.
 *
 * Transactions, locks and `close` are the underlying kernel's: one database, one connection pool.
 */
export function scopeToSchema<DB>(kernel: StorageKernel<DB>, schema: string): StorageKernel<DB> {
  if (kernel.dialect !== "postgres") throw new Error(`schema '${schema}' needs a Postgres kernel, not ${kernel.dialect}`);
  return {
    ...kernel,
    run: (fn) => kernel.run((db) => fn(db.withSchema(schema))),
  };
}
