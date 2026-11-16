/**
 * @file The slice of an embedded SQLite driver connection this package uses, written structurally so the
 * package needs neither that driver nor its types: a consumer's own `Database` instance satisfies
 * it as-is. Keeping the driver out of the type graph also keeps two installed copies (the consumer's
 * and a linked dev copy of this package's) from becoming two incompatible nominal types.
 */

/** A prepared statement, as much of one as the query-builder binding shim and the ops call. */
export interface SqliteStatement {
  readonly reader: boolean;
  all(...parameters: unknown[]): unknown[];
  run(...parameters: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  iterate(...parameters: unknown[]): IterableIterator<unknown>;
}

/** An embedded SQLite driver `Database`. */
export interface SqliteClient {
  /** True for `:memory:` and other private in-memory databases. */
  readonly memory: boolean;
  /** The path it was opened with. */
  readonly name: string;
  readonly inTransaction: boolean;
  exec(source: string): unknown;
  prepare(source: string): SqliteStatement;
  pragma(source: string): unknown;
  backup(destinationFile: string): Promise<unknown>;
  close(): unknown;
}

/** embedded SQLite driver's constructor options this package passes. */
export interface SqliteOpenOptions {
  readonly?: boolean;
  fileMustExist?: boolean;
}

/** The consumer's way to open a connection with ITS copy of embedded SQLite driver: `(p, o) => new Database(p, o)`. */
export type SqliteOpener<Connection extends SqliteClient = SqliteClient> = (filePath: string, options: SqliteOpenOptions) => Connection;

/** Structural synchronous SQLite contract for legacy CRUD; the host owns the driver. */

/** Prepared query preserving typed positional bindings and rows. */
export interface SqliteSyncStatement<Parameters extends unknown[] = unknown[], Result = unknown> {
  readonly reader: boolean;
  run(...parameters: Parameters): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...parameters: Parameters): Result | undefined;
  all(...parameters: Parameters): Result[];
  iterate(...parameters: Parameters): IterableIterator<Result>;
}
/** Callable transaction with the driver's explicit lock modes. */
export interface SqliteSyncTransaction<Args extends unknown[], Result> {
  (...args: Args): Result;
  deferred(...args: Args): Result;
  immediate(...args: Args): Result;
  exclusive(...args: Args): Result;
}
/** Separate sync API; the kernel's minimal SqliteClient remains unchanged. */
export interface SqliteSyncClient extends SqliteClient {
  readonly open: boolean;
  prepare<Parameters extends unknown[] | object = unknown[], Result = unknown>(source: string):
    Parameters extends unknown[] ? SqliteSyncStatement<Parameters, Result> : SqliteSyncStatement<[Parameters], Result>;
  pragma(source: string, options?: { simple?: boolean }): unknown;
  transaction<Args extends unknown[], Result>(body: (...args: Args) => Result): SqliteSyncTransaction<Args, Result>;
}
/** Published 0.3.x alias, now structural rather than tied to a driver installation. */
export type SqliteDb = SqliteSyncClient;
/** Host acquisition seam, also preserving an actual driver's richer handle type. */
export type SqliteSyncOpener<Connection extends SqliteSyncClient = SqliteSyncClient> = (file: string, options: SqliteOpenOptions) => Connection;

/**
 * @file SQLite driver type surface. Types only — no runtime declarations, so this module erases
 * entirely at compile time.
 *
 * Nothing here references an ORM. That is the point: a type on this package's public surface must
 * be a plain structural shape, which crosses a
 * package boundary cleanly. See `@jini-ai/db/sqlite` `open.ts`'s module doc for the measured failure that made this a
 * rule rather than a preference.
 */

/**
 * A caller-injected hook run against `filePath` BEFORE the connection is opened.
 *
 * Dependency inversion on purpose: recovery policy (replaying a half-applied migration,
 * quarantining a corrupt file) is host knowledge, and a persistence package reaching up into host
 * feature code to fetch it would be a layer-direction violation. The hook is optional, but when
 * supplied it runs for every path, including `:memory:`. A host with file-only recovery must make
 * its hook a no-op for ephemeral connections and hermetic tests, where there is nothing to recover.
 */
export type SqliteRecoveryHook = (required: { filePath: string }, options?: Record<string, never>) => void;

export interface OpenSqliteConnectionOptions<Connection extends SqliteClient = SqliteClient> {
  /** The consumer opens with its own driver copy. */
  readonly open: (required: { filePath: string }, options: Record<string, never>) => Connection;
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
