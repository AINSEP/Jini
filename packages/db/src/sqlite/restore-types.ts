/**
 * @file SQLite driver type surface. Types only — no runtime declarations, so this module erases
 * entirely at compile time.
 *
 * Nothing here references an ORM. That is the point: a type on this package's public surface must
 * be a plain structural shape, which crosses a
 * package boundary cleanly. See `open.ts`'s module doc for the measured failure that made this a
 * rule rather than a preference.
 */
import type { SqliteClient, SqliteOpener } from './types.js';

/**
 * A caller-injected hook run against `filePath` BEFORE the connection is opened.
 *
 * Dependency inversion on purpose: recovery policy (replaying a half-applied migration,
 * quarantining a corrupt file) is host knowledge, and a persistence package reaching up into host
 * feature code to fetch it would be a layer-direction violation. The hook is optional, but when
 * supplied it runs for every path, including `:memory:`. A host with file-only recovery must make
 * its hook a no-op for ephemeral connections and hermetic tests, where there is nothing to recover.
 */
export type SqliteRecoveryHook = (filePath: string) => void;

export interface OpenSqliteConnectionOptions<Connection extends SqliteClient = SqliteClient> {
  /** The consumer opens with its own driver copy. */
  readonly open: SqliteOpener<Connection>;
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
export type SqliteBackupSource = { backup(destination: string): Promise<unknown> };
