/**
 * @file The shape every PostgreSQL-dialect test kernel hands back (`./testing/pglite`,
 * `./testing/postgres`). TEST-ONLY: nothing in product code may import it.
 */
import { scopeToSchema, type KyselyKernel } from "./index.js";

/** A PostgreSQL-dialect kernel, plus a way to look at the same database through a schema. */
export interface PgTestKernel<DB> {
  readonly kernel: KyselyKernel<DB>;
  inSchema(required: { schema: string }, optional?: {}): KyselyKernel<DB>;
  close(): Promise<void>;
}

/** Wraps `kernel` with the schema view; `close` is the caller's own teardown. */
export function pgTestKernel<DB>({ kernel, close }: { kernel: KyselyKernel<DB>; close: () => Promise<void> }, _optional = {}): PgTestKernel<DB> {
  return { kernel, inSchema: ({ schema }) => scopeToSchema(kernel, schema), close };
}
