import { AsyncLocalStorage } from "node:async_hooks";
import Database from "better-sqlite3";
import { Kysely, SqliteDialect, sql } from "kysely";
import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import type { IdentityTransactionPort } from "../../../../core/ports.js";

/**
 * @file Test kernel for the SQL identity stores: a real in-memory SQLite database behind kysely, with a
 * query log (one entry per executed statement) and an event log for transaction/lock ordering. `transaction`
 * is a real SQL transaction and a nested call joins it, like the host kernels.
 */
export interface TestSqliteKernel {
  kernel: StorageKernel<Kysely<unknown>, unknown>;
  transactions: IdentityTransactionPort;
  queries: string[];
  events: string[];
  exec(statement: string): Promise<void>;
  close(): Promise<void>;
}

export function sqliteTestKernel(): TestSqliteKernel {
  const queries: string[] = [];
  const events: string[] = [];
  const db = new Kysely<unknown>({
    dialect: new SqliteDialect({ database: new Database(":memory:") }),
    log: event => { if (event.level === "query" && !/^(begin|commit|rollback)/i.test(event.query.sql)) queries.push(event.query.sql); },
  });
  const active = new AsyncLocalStorage<Kysely<unknown>>();
  const kernel: StorageKernel<Kysely<unknown>, unknown> = {
    dialect: "sqlite",
    transport: "test-sqlite",
    capabilities: { interactiveTransactions: true, atomicBatch: true, transactionalDdl: true, backup: false },
    ready: Promise.resolve(),
    run: async fn => fn(active.getStore() ?? db),
    transaction: async fn => {
      if (active.getStore()) return fn();
      events.push("begin");
      try {
        const result = await db.transaction().execute(trx => active.run(trx, fn));
        events.push("commit");
        return result;
      } catch (error) { events.push("rollback"); throw error; }
    },
    lockKey: async key => { events.push(`lock:${key}`); },
    inTransaction: () => active.getStore() !== undefined,
    require: () => undefined,
    backupTo: async () => undefined,
    close: async () => { await db.destroy(); },
  };
  const transactions: IdentityTransactionPort = {
    run: ({ workspaceId, execute }) => kernel.transaction(async () => { await kernel.lockKey(`identity:${workspaceId}`); return execute(); }),
  };
  return {
    kernel, transactions, queries, events,
    exec: async statement => { await sql.raw(statement).execute(db); queries.length = 0; events.length = 0; },
    close: () => kernel.close(),
  };
}
