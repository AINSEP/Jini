/**
 * @file Opens a SQLite connection: connect, apply pragmas, hand back the raw driver handle.
 *
 * Deliberately ORM-free. An earlier version of this function took a Drizzle schema, ran Drizzle's
 * migrator, and returned a Drizzle handle — which made `drizzle-orm` a peer dependency of this
 * package and put an ORM's types on its public surface. Two things were wrong with that:
 *
 * 1. **It coupled every consumer of this package to one ORM.** A host using Kysely, raw SQL, or a
 *    future replacement for Drizzle could not use the connection helper at all, even though
 *    opening a file and setting pragmas has nothing to do with how you then query it.
 * 2. **It did not actually work across the package boundary.** Drizzle's classes carry
 *    `protected config` and `private shouldInlineParams`, so TypeScript compares them nominally.
 *    A consumer resolving a second physical copy of `drizzle-orm` (which a `file:`-linked checkout
 *    does, through the symlink's real path) cannot pass its own tables into a signature typed
 *    against this package's copy — measured at 604 errors across 34 files in one real host.
 *
 * So the ORM, the schema, and the migrations all stay with the host. What is genuinely reusable —
 * and what this package keeps — is the connection lifecycle: where the file is, which pragmas make
 * a single-file database viable under concurrent load, and the pre-open recovery seam.
 *
 * Migration running moved out with the ORM. A host wraps this handle in whatever it uses
 * (`drizzle(conn, { schema })`) and runs its own migrator; migrations are product schema, and this
 * package has no business knowing a host's tables.
 */
import Database from 'better-sqlite3';

import type { OpenSqliteConnectionOptions } from './types.js';

/**
 * Applied when a caller passes no `pragmas`.
 *
 * Measured baseline (better-sqlite3 11.x opened with no pragmas at all): `foreign_keys=1`,
 * `busy_timeout=5000`, `journal_mode='delete'` for a file db and `'memory'` for `:memory:`.
 * So of the three below, **only `journal_mode = WAL` changes behaviour** — the other two restate a
 * default the driver already applies.
 *
 * - `journal_mode = WAL` — the load-bearing one. Readers stop blocking the writer, which is what
 *   makes a single-file database viable under a web server's concurrent request load.
 * - `foreign_keys = ON` — raw SQLite defaults this OFF for backwards compatibility and
 *   better-sqlite3 turns it back on. Restated so the guarantee survives a driver change rather
 *   than being silently inherited.
 * - `busy_timeout = 5000` — a second connection (a plugin's own handle, a migration runner) can
 *   transiently hold a write lock; retrying inside the driver beats surfacing SQLITE_BUSY to a
 *   request handler with no better recourse than to retry anyway.
 *
 * Consequence worth knowing when writing tests: neither `foreign_keys` nor `busy_timeout` can tell
 * you whether this list ran, because both read the same value if it did not. `journal_mode` on a
 * file-backed database is the only usable probe.
 */
export const DEFAULT_PRAGMAS: readonly string[] = [
  'journal_mode = WAL',
  'foreign_keys = ON',
  'busy_timeout = 5000',
];

/**
 * Opens (or creates) a SQLite database and applies pragmas.
 *
 * Returns the raw `better-sqlite3` handle. `Database` is declared as an `interface` with no
 * private or protected members, so it compares structurally and crosses a package boundary
 * cleanly even when the consumer resolves its own copy of `better-sqlite3` — the property the
 * Drizzle-typed predecessor lacked.
 */
export function openSqliteConnection(options: OpenSqliteConnectionOptions): Database.Database {
  options.recover?.(options.filePath);

  const connection = new Database(options.filePath);
  for (const pragma of options.pragmas ?? DEFAULT_PRAGMAS) {
    connection.pragma(pragma);
  }
  return connection;
}
