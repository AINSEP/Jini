/**
 * @module @jini-ai/infra/db/sqlite
 *
 * The `better-sqlite3` driver: connection lifecycle, pragma policy, and the SQLite implementation
 * of `DbOpsPort` (online backup, atomic-rename restore, WAL sidecar cleanup).
 *
 * **No ORM appears anywhere on this surface**, by rule rather than by accident. An earlier version
 * exported Drizzle-typed helpers, which made `drizzle-orm` a peer dependency of this package and —
 * measurably — could not be consumed by a host resolving its own copy of Drizzle. Schemas,
 * migrations, and query building belong to the host; a host wraps the connection this module
 * returns in whatever it uses. See `open.ts` for the full reasoning and the measurement.
 *
 * `better-sqlite3` remains an optional peer dependency, so a host on a different backend never
 * compiles the native module. This module may import from `db/core`; `db/core` may never import
 * from here, and `pnpm guard`'s R12 check enforces that direction.
 */
export { DEFAULT_PRAGMAS, openSqliteConnection } from './open.js';
export { SqliteDbOpsAdapter, type SqliteDbOpsAdapterDeps } from './db-ops.js';
export type { OpenSqliteConnectionOptions, SqliteBackupSource, SqliteRecoveryHook } from './types.js';
