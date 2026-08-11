/**
 * @module @jini-ai/infra/db/sqlite
 *
 * The `better-sqlite3` driver. Importing this entry point requires both `better-sqlite3` and
 * `drizzle-orm` to be installed — they are optional peer dependencies, so a host that never
 * imports this subpath never compiles the native module.
 *
 * This module may import from `db/core`; `db/core` may never import from here. `pnpm guard`'s
 * R12 check enforces that direction, which is what keeps a second driver a purely additive
 * change rather than a restructure.
 */
export { DEFAULT_PRAGMAS, openSqliteDb } from './open.js';
export { findOneBy } from './find-one-by.js';
export { SqliteDbOpsAdapter, type SqliteDbOpsAdapterDeps } from './db-ops.js';
export type { OpenSqliteDbOptions, SqliteDb, SqliteRecoveryHook } from './types.js';
