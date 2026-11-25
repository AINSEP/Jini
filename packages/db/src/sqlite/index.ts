/** SQLite connection policy and restore operations; inject the consumer's opener. */
export { createCheckedSqliteClient, type CheckedSqliteClient, type IntegerSource, type IntegerStatement } from "./checked-client.js";
export { SqliteClientError } from "./checked-state.js";
export { withSqliteTransaction, type TransactionSession, type Work } from "./transaction.js";
export { openSqliteConnection, DEFAULT_PRAGMAS } from "./open.js";
export { SqliteDbOpsAdapter, type SqliteDbOpsAdapterDeps } from "./db-ops.js";
export { DATABASE_COPY_RETENTION, DatabaseDiskSpaceError, assertDatabaseCopySpace, pruneDatabaseCopies, selectDatabaseCopiesToPrune, type DatabaseCopy } from "./backup-policy.js";

export { COMPACTION_MESSAGES, compactionRecoveryCopyPath, convertToIncrementalVacuum, incrementalVacuumStep } from "./compaction.js";
export { inspectSqliteDatabase, verifySqliteIntegrity } from "./inspect.js";
export { assertSqliteStopped, checkpointStoppedSqliteWal, inspectStoppedSqlite, type StoppedSqliteOpener } from "./stopped.js";
export type { DaemonDbTableInfo, DaemonDbStatusReport, DbIntegrityIssueKind, DbIntegrityIssue, DbIntegrityReport, VerifyDbOptions } from "./inspect.js";
