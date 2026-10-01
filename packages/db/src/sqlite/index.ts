/**
 * @file `@jini-ai/db/sqlite`: the better-sqlite3 driver. Never imports better-sqlite3 — pass your own
 * client to {@link sqliteKernel}, or your own opener to {@link openSqliteFileKernel}.
 */
export {
  closeSqliteConnection,
  openMemorySqliteKernel,
  openSqliteFileKernel,
  sqliteClientOf,
  type SqliteConnectionSource,
  sqliteConnectionOf,
  sqliteKernel,
  type SqliteKernel,
} from "./driver.js";
export { sqliteOps } from "./ops.js";
export type { SqliteClient, SqliteOpener, SqliteOpenOptions, SqliteStatement } from "./types.js";
