import { DummyDriver, Kysely, SqliteDialect, type Driver, type KyselyPlugin } from "kysely";
import type { StorageKernel } from "@jini-ai/core/contracts/storage";

/**
 * @file A storage kernel over Kysely's no-op driver: every statement's compiled SQL and
 * parameters are recorded, and each `execute` answers with the next queued row set (default: no
 * rows). Transactions run their body inline and record each lock key. Lets the member SQL
 * adapters be pinned without a database driver in this package.
 */
/** SQLite compilation over the no-op driver; the dialect's database is never opened. */
class CompileOnlySqliteDialect extends SqliteDialect {
  override createDriver(): Driver {
    return new DummyDriver();
  }
}

export interface SqlHarness {
  kernel: StorageKernel<Kysely<unknown>, unknown>;
  statements: Array<{ sql: string; parameters: readonly unknown[] }>;
  /** Row sets returned to the next executions, in order. */
  queue: Array<Array<Record<string, unknown>>>;
  locks: string[];
}

export function createSqlHarness(_required = {}, _optional = {}): SqlHarness {
  const statements: SqlHarness["statements"] = [];
  const queue: SqlHarness["queue"] = [];
  const locks: string[] = [];
  const answer: KyselyPlugin = {
    transformQuery: (args) => args.node,
    transformResult: async () => {
      const rows = queue.shift() ?? [];
      return { rows, numAffectedRows: BigInt(rows.length) };
    },
  };
  const db = new Kysely<unknown>({
    dialect: new CompileOnlySqliteDialect({ database: {} as never }),
    plugins: [answer],
    log: (event) => { statements.push({ sql: event.query.sql, parameters: event.query.parameters }); },
  });
  const kernel = {
    dialect: "sqlite",
    ready: Promise.resolve(),
    run: async <T>(fn: (handle: Kysely<unknown>) => T | Promise<T>) => fn(db),
    transaction: async <T>(fn: () => Promise<T>) => fn(),
    lockKey: async (key: string) => { locks.push(key); },
  } as unknown as StorageKernel<Kysely<unknown>, unknown>;
  return { kernel, statements, queue, locks };
}
