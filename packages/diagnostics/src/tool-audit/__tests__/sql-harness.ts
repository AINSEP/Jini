import { DummyDriver, Kysely, SqliteAdapter, SqliteIntrospector, SqliteQueryCompiler, type KyselyPlugin } from "kysely";
import type { StorageKernel } from "@jini-ai/core/contracts/storage";

/**
 * @file A storage kernel over Kysely's no-op driver: every statement's compiled SQL and
 * parameters are recorded, and each `execute` answers with the next queued row set (default: no
 * rows). Lets the SQL adapters be pinned without a database driver in this package.
 */
export interface SqlHarness {
  kernel: StorageKernel<Kysely<unknown>, unknown>;
  statements: Array<{ sql: string; parameters: readonly unknown[] }>;
  /** Row sets returned to the next executions, in order. */
  queue: Array<Array<Record<string, unknown>>>;
}

export function createSqlHarness(_required = {}, _optional = {}): SqlHarness {
  const statements: SqlHarness["statements"] = [];
  const queue: SqlHarness["queue"] = [];
  const answer: KyselyPlugin = {
    transformQuery: (args) => args.node,
    transformResult: async () => ({ rows: queue.shift() ?? [] }),
  };
  const db = new Kysely<unknown>({
    dialect: {
      createAdapter: () => new SqliteAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (handle) => new SqliteIntrospector(handle),
      createQueryCompiler: () => new SqliteQueryCompiler(),
    },
    plugins: [answer],
    log: (event) => { statements.push({ sql: event.query.sql, parameters: event.query.parameters }); },
  });
  const kernel = {
    dialect: "sqlite",
    ready: Promise.resolve(),
    run: async <T>(fn: (handle: Kysely<unknown>) => T | Promise<T>) => fn(db),
  } as unknown as StorageKernel<Kysely<unknown>, unknown>;
  return { kernel, statements, queue };
}
