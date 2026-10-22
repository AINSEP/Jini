/** SQLite connection policy and restore operations; inject the consumer's opener. */
export type { SqliteClient, SqliteOpener, SqliteOpenOptions, SqliteStatement } from "./types.js";
export { openSqliteConnection, DEFAULT_PRAGMAS } from "./open.js";
export { SqliteDbOpsAdapter, type SqliteDbOpsAdapterDeps } from "./db-ops.js";
export type { SqliteBackupSource, SqliteRecoveryHook, OpenSqliteConnectionOptions } from "./restore-types.js";

export type { SqliteSyncClient, SqliteSyncStatement, SqliteSyncTransaction, SqliteSyncOpener, SqliteDb } from "./sync-types.js";
export { inspectSqliteDatabase, verifySqliteIntegrity } from "./inspect.js";
export type { DaemonDbTableInfo, DaemonDbStatusReport, DbIntegrityIssueKind, DbIntegrityIssue, DbIntegrityReport, VerifyDbOptions } from "./inspect.js";
