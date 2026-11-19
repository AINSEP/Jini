import { inheritKernelSessionDatabase } from "./session-lock.js";
import type { KyselyKernel } from "./port.js";
import { inheritOwnedTransaction } from "./owned-transaction.js";

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
export function scopeToSchema<DB>({ kernel, schema }: { kernel: KyselyKernel<DB>; schema: string }, _optional: Record<string, never> = {}): KyselyKernel<DB> {
  if (kernel.dialect !== "postgres") throw new Error(`schema '${schema}' needs a Postgres kernel, not ${kernel.dialect}`);
  const scoped: KyselyKernel<DB> = {
    ...kernel,
    run: (fn) => kernel.run((db) => fn(db.withSchema(schema))),
  };
  inheritOwnedTransaction({ from: kernel as KyselyKernel<unknown>, to: scoped as KyselyKernel<unknown> });
  inheritKernelSessionDatabase({ from: kernel as KyselyKernel<unknown>, to: scoped as KyselyKernel<unknown> });
  return scoped;
}
