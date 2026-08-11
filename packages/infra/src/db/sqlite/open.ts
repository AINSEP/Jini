/**
 * @file Opens a SQLite-backed database: connect, apply pragmas, migrate, hand back a typed
 * Drizzle handle.
 *
 * What this generalizes: a host's own bootstrap typically hardcodes its schema import, its
 * migrations directory, and its post-migrate invariants. All three are parameters here, because
 * a persistence package that imports a host's `schema.ts` is not reusable by any second host —
 * and because "infra reaching up into server code to fetch seed data" is precisely the
 * layer-direction violation dependency inversion exists to prevent.
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import type { OpenSqliteDbOptions, SqliteDb } from './types.js';

/**
 * Applied when a caller passes no `pragmas`.
 *
 * Measured baseline (better-sqlite3 11.x, opened with no pragmas at all): `foreign_keys=1`,
 * `busy_timeout=5000`, `journal_mode='delete'` for a file db and `'memory'` for `:memory:`.
 * So of the three below, **only `journal_mode = WAL` changes behaviour** — the other two restate
 * a default the driver already applies.
 *
 * - `journal_mode = WAL` — the load-bearing one. Readers stop blocking the writer, which is what
 *   makes a single-file database viable under a web server's concurrent request load.
 * - `foreign_keys = ON` — raw SQLite defaults this OFF for backwards compatibility and
 *   better-sqlite3 turns it back on. Restated here so the guarantee survives a driver swap or a
 *   change to that driver default, rather than being silently inherited.
 * - `busy_timeout = 5000` — same reasoning. Any second connection (a plugin holding its own
 *   handle, a migration runner) can transiently hold a write lock, and retrying inside the driver
 *   beats surfacing SQLITE_BUSY to a request handler with no better recourse than to retry anyway.
 *
 * The consequence worth knowing when writing tests: neither `foreign_keys` nor `busy_timeout` can
 * tell you whether this list ran, because both read the same value if it did not. `journal_mode`
 * on a file-backed db is the only usable probe.
 */
export const DEFAULT_PRAGMAS: readonly string[] = [
  'journal_mode = WAL',
  'foreign_keys = ON',
  'busy_timeout = 5000',
];

export function openSqliteDb<TSchema extends Record<string, unknown>>(
  options: OpenSqliteDbOptions<TSchema>,
): SqliteDb<TSchema> {
  options.recover?.(options.filePath);

  const sqlite = new Database(options.filePath);
  for (const pragma of options.pragmas ?? DEFAULT_PRAGMAS) {
    sqlite.pragma(pragma);
  }

  const db = drizzle(sqlite, { schema: options.schema }) as unknown as SqliteDb<TSchema>;

  if (options.migrationsDir !== undefined) {
    migrate(db, { migrationsFolder: options.migrationsDir });
  }
  options.afterMigrate?.(db);

  return db;
}
