/**
 * @file SQLite driver type surface. Types only — no runtime declarations, so this module erases
 * entirely at compile time.
 *
 * Nothing here references an ORM. That is the point: a type on this package's public surface must
 * be either a plain structural shape or a `better-sqlite3` interface, both of which cross a
 * package boundary cleanly. See `open.ts`'s module doc for the measured failure that made this a
 * rule rather than a preference.
 */
import type Database from 'better-sqlite3';

/**
 * A caller-injected hook run against `filePath` BEFORE the connection is opened.
 *
 * Dependency inversion on purpose: recovery policy (replaying a half-applied migration,
 * quarantining a corrupt file) is host knowledge, and a persistence package reaching up into host
 * feature code to fetch it would be a layer-direction violation. Optional, and correctly a no-op
 * for `:memory:` connections and hermetic tests, where there is nothing to recover.
 */
export type SqliteRecoveryHook = (filePath: string) => void;

export interface OpenSqliteConnectionOptions {
  /** Filesystem path, or `':memory:'` for an ephemeral connection. */
  readonly filePath: string;
  /**
   * Pragma statements applied immediately after open, **replacing** (not extending) the defaults.
   * Pass the full list you want; see `DEFAULT_PRAGMAS` for what you are replacing and why each
   * default is there.
   */
  readonly pragmas?: readonly string[];
  readonly recover?: SqliteRecoveryHook;
}

/**
 * The minimum a caller must supply for restore-point capture: the raw driver's online-backup
 * method and nothing else. Structurally minimal so a host can pass a real connection or a narrow
 * test double, and so this package never needs to name the host's ORM handle type.
 */
export type SqliteBackupSource = Pick<Database.Database, 'backup'>;
