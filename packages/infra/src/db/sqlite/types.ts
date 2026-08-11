/**
 * @file SQLite driver type surface. Types only — no runtime declarations, so this module erases
 * entirely at compile time.
 */
import type Database from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

/**
 * A Drizzle handle widened with `$client` — the raw `better-sqlite3` `Database` instance that
 * `drizzle()` already returns at runtime. The widening is what lets the ops adapter call the
 * driver's native online-backup API directly instead of re-implementing SQLite's backup
 * protocol. Additive: every caller that only touches the Drizzle query surface is unaffected.
 */
export type SqliteDb<TSchema extends Record<string, unknown>> = BetterSQLite3Database<TSchema> & {
  $client: Database.Database;
};

/**
 * A caller-injected hook run against `filePath` BEFORE this package opens its own connection.
 *
 * Dependency inversion on purpose: recovery policy (replaying a half-applied plugin migration,
 * quarantining a corrupt file) is host knowledge, and a persistence package reaching up into
 * host feature code to fetch it would be a layer-direction violation. Optional, and correctly a
 * no-op for `:memory:` connections and hermetic tests, where there is nothing to recover.
 */
export type SqliteRecoveryHook = (filePath: string) => void;

export interface OpenSqliteDbOptions<TSchema extends Record<string, unknown>> {
  /** Filesystem path, or `':memory:'` for an ephemeral connection. */
  readonly filePath: string;
  /** The host's Drizzle schema object. A parameter, not an import — this package never owns a host's tables. */
  readonly schema: TSchema;
  /**
   * Directory of generated migrations to apply on open. Omit to skip migration entirely, which
   * is what a caller wants when the host runs migrations out-of-band or the connection is a
   * throwaway.
   */
  readonly migrationsDir?: string;
  /**
   * Pragma statements applied immediately after open, replacing (not extending) the defaults.
   * Pass the full list you want; see `DEFAULT_PRAGMAS` for what you are replacing and why each
   * default is there.
   */
  readonly pragmas?: readonly string[];
  readonly recover?: SqliteRecoveryHook;
  /**
   * Runs after migrations, inside the same open call. The seam for host bootstrap invariants —
   * seeding demo content, guaranteeing a singleton row — none of which this package can know
   * about, and all of which must happen before the handle is handed out.
   */
  readonly afterMigrate?: (db: SqliteDb<TSchema>) => void;
}
