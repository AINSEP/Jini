import path from "node:path";

import { Kysely, type SqliteDatabase, SqliteDialect } from "kysely";

import { buildKernel, type StorageKernel, TurnLock } from "../kernel/index.js";
import type { SqliteClient, SqliteOpener } from "./types.js";

/**
 * @file The better-sqlite3 driver: a kernel over an ALREADY OPEN SQLite connection the consumer
 * opened (and migrated) itself. Wrapping instead of opening keeps an existing database exactly as it
 * was: same file, same pragmas, same migrations.
 *
 * This package never imports better-sqlite3: the consumer passes its own client (or, for
 * {@link openSqliteFileKernel}, its own opener). Two copies of the SQLite library in one process
 * would share POSIX locks, a documented way to corrupt a database. Accepts an ORM handle that
 * carries its client as `$client` (Drizzle's shape) and reads the client; the handle itself is not
 * used. ONE kernel per connection ({@link sqliteKernel} memoizes on the
 * client): the transaction scope only protects callers that share it. The turn lock is per FILE:
 * every connection to one database file in this process takes turns on the same lock (see
 * `KernelDriver.turnLock`).
 *
 * Queries go through Kysely's own SQLite dialect over a thin binding shim: SQLite cannot bind a
 * boolean, so `true`/`false` are written as `1`/`0` (the usual SQLite boolean encoding). Reads
 * of those columns come back as `0`/`1` — the generated types say `SqlBool` so a repo converts.
 *
 * Transactions are `BEGIN IMMEDIATE` on the connection, not Kysely's `transaction()` (which issues a
 * deferred `BEGIN`): IMMEDIATE takes the write lock up front, which is what makes `lockKey` a no-op
 * here and keeps read-then-write sequences from failing with SQLITE_BUSY halfway through.
 *
 * The connection's opener closes it; `close()` here does nothing.
 */

export type SqliteKernel<DB> = StorageKernel<DB>;

/** An ORM handle that carries its better-sqlite3 client as `$client`, or the client itself. */
export type SqliteConnectionSource = SqliteClient | { readonly $client: SqliteClient };

const kernels = new WeakMap<SqliteClient, SqliteKernel<unknown>>();

/** The reverse of `kernels`, plus the owning kernels {@link openSqliteFileKernel} hands out. */
const connectionsByKernel = new WeakMap<StorageKernel<unknown>, SqliteClient>();

/** One turn lock per database FILE, shared by every connection to it in this process. */
const fileTurnLocks = new Map<string, TurnLock>();

function turnLockFor(client: SqliteClient): TurnLock | undefined {
  if (client.memory) return undefined;
  const file = path.resolve(client.name);
  let lock = fileTurnLocks.get(file);
  if (lock === undefined) {
    lock = new TurnLock();
    fileTurnLocks.set(file, lock);
  }
  return lock;
}

/** The better-sqlite3 client under `source` (a handle's `$client`, or the client itself). */
export function sqliteClientOf(source: SqliteConnectionSource): SqliteClient {
  return "$client" in source ? source.$client : source;
}

const bindable = (value: unknown) => (typeof value === "boolean" ? (value ? 1 : 0) : value);

/** better-sqlite3 as Kysely's `SqliteDatabase`, with booleans bound as integers. */
function bindingShim(client: SqliteClient): SqliteDatabase {
  return {
    close: () => {},
    prepare(sqlText) {
      const statement = client.prepare(sqlText);
      const bind = (parameters: ReadonlyArray<unknown>) => parameters.map(bindable);
      return {
        reader: statement.reader,
        all: (parameters) => statement.all(bind(parameters)),
        run: (parameters) => statement.run(bind(parameters)),
        iterate: (parameters) => statement.iterate(bind(parameters)),
      };
    },
  };
}

export function sqliteKernel<DB>(source: SqliteConnectionSource): SqliteKernel<DB> {
  const client = sqliteClientOf(source);
  const known = kernels.get(client);
  if (known !== undefined) return known as SqliteKernel<DB>;
  const base = new Kysely<DB>({ dialect: new SqliteDialect({ database: bindingShim(client) }) });
  const kernel = buildKernel<DB>({
    dialect: "sqlite",
    transport: "better-sqlite3",
    capabilities: { interactiveTransactions: true, atomicBatch: true, transactionalDdl: true, backup: true },
    ready: Promise.resolve(),
    base,
    oneConnection: true,
    turnLock: turnLockFor(client),
    async begin(body) {
      client.exec("BEGIN IMMEDIATE");
      try {
        const result = await body(base);
        client.exec("COMMIT");
        return result;
      } catch (error) {
        if (client.inTransaction) client.exec("ROLLBACK");
        throw error;
      }
    },
    // BEGIN IMMEDIATE already holds the database write lock for the whole transaction.
    lockKey: async () => {},
    foreignTransactionOpen: () => client.inTransaction,
    backup: async (destPath) => {
      await client.backup(destPath);
    },
    close: async () => {},
  });
  kernels.set(client, kernel as SqliteKernel<unknown>);
  connectionsByKernel.set(kernel as SqliteKernel<unknown>, client);
  return kernel;
}

/**
 * A kernel over a new private in-memory SQLite database (foreign keys on). `close()` closes the
 * connection. For scratch work, e.g. building a reference schema.
 *
 * @param required.open the consumer's better-sqlite3 opener, e.g. `(p, o) => new Database(p, o)`.
 */
export function openMemorySqliteKernel<DB>(required: { open: SqliteOpener }): SqliteKernel<DB> {
  return openSqliteFileKernel<DB>({ filePath: ":memory:", open: required.open });
}

/**
 * A kernel over its OWN connection to the SQLite file at `filePath`, opened as-is: no migration, no
 * WAL switch, foreign keys on, a 5 s busy timeout. `close()` closes the connection.
 *
 * For ops on a database file that is not the running app's (a duplicate being prepared, a directory
 * being inspected). `readOnly` opens with better-sqlite3's own `readonly` mode, so SQLite itself
 * rejects any write, and requires the file to exist.
 *
 * @param required.open the consumer's better-sqlite3 opener, e.g. `(p, o) => new Database(p, o)`,
 *   so the connection comes from the consumer's own copy of the library.
 * @throws whatever the opener throws opening the file (missing file when `readOnly`, not a
 *   database, locked).
 */
export function openSqliteFileKernel<DB>(
  required: { filePath: string; open: SqliteOpener },
  optional: { readOnly?: boolean } = {}
): SqliteKernel<DB> {
  const readOnly = optional.readOnly === true;
  const client = required.open(required.filePath, readOnly ? { readonly: true, fileMustExist: true } : {});
  // A second connection to a file another may be writing: wait out a transient lock rather than
  // throwing SQLITE_BUSY at once.
  client.pragma("busy_timeout = 5000");
  if (!readOnly) client.pragma("foreign_keys = ON");
  const kernel = sqliteKernel<DB>(client);
  const owned: SqliteKernel<DB> = {
    ...kernel,
    close: async () => closeSqliteConnection(client),
  };
  connectionsByKernel.set(owned as SqliteKernel<unknown>, client);
  return owned;
}

/**
 * Closes the better-sqlite3 connection under `source` (a handle carrying `$client`, or the client)
 * and forgets its kernel. For callers that opened a database themselves and must
 * release it; the kernel's own `close()` never closes a connection it did not open.
 */
export function closeSqliteConnection(source: SqliteConnectionSource): void {
  const client = sqliteClientOf(source);
  kernels.delete(client);
  client.close();
}

/** The connection under a kernel this driver built, for the SQLite `StorageOps` (`./ops.ts`). */
export function sqliteConnectionOf<DB>(kernel: StorageKernel<DB>): SqliteClient | undefined {
  return connectionsByKernel.get(kernel as StorageKernel<unknown>);
}
