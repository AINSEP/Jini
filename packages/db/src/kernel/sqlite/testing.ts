/**
 * @file TEST-ONLY SQLite kernels for packages whose SQL must run on the real dialect (`./testing/sqlite`).
 * A fake `StorageKernel` cannot run Kysely SQL, and a package-local copy of the kernel would make the
 * race and two-connection suites prove the copy instead of this one. The driver is resolved from THIS
 * package's own `better-sqlite3`, the single-copy rule `sqliteKernel` documents. Never import from product code.
 */
import { createRequire } from "node:module";

import type { SqliteSyncClient } from "@jini-ai/core/contracts/storage";
import type { KyselyKernel } from "../index.js";
import { sqliteKernel } from "./driver.js";

const loadDriver = createRequire(import.meta.url);

/** A kernel plus the raw better-sqlite3 connection under it, for tests that count reads or seed host tables. */
export interface SqliteTestKernel<DB> {
  readonly kernel: KyselyKernel<DB>;
  readonly connection: SqliteSyncClient;
  close(): Promise<void>;
}

function openSqlite<DB>({ path }: { path: string }, { ddl = [], busyTimeoutMs }: { ddl?: readonly string[]; busyTimeoutMs?: number }): SqliteTestKernel<DB> {
  const Database = loadDriver("better-sqlite3") as new (file: string) => SqliteSyncClient;
  const connection = new Database(path);
  connection.pragma("foreign_keys = ON");
  if (busyTimeoutMs !== undefined) connection.pragma(`busy_timeout = ${busyTimeoutMs}`);
  for (const statement of ddl) connection.exec(statement);
  return { kernel: sqliteKernel<DB>(connection), connection, close: async () => { connection.close(); } };
}

/**
 * An in-memory SQLite kernel with foreign keys on, running `ddl` (whole scripts) once.
 * @example const { kernel, connection } = openMemorySqliteTestKernel<ChatDatabase>({}, { ddl: [CHAT_HISTORY_DDL] });
 */
export function openMemorySqliteTestKernel<DB>(_required = {}, optional: { ddl?: readonly string[] } = {}): SqliteTestKernel<DB> {
  return openSqlite<DB>({ path: ":memory:" }, optional);
}

/**
 * A kernel over its own connection to the file at `path`, with a 5 s busy timeout so two
 * connections to one file take turns. Reopen tests call it twice on one path, which is a second
 * independent connection, never a shared handle.
 */
export function openFileSqliteTestKernel<DB>(required: { path: string }, optional: { ddl?: readonly string[] } = {}): SqliteTestKernel<DB> {
  return openSqlite<DB>(required, { ...optional, busyTimeoutMs: 5000 });
}
