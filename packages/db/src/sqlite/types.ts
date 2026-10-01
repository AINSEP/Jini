/**
 * @file The slice of a better-sqlite3 connection this package uses, written structurally so the
 * package needs neither better-sqlite3 nor its types: a consumer's own `Database` instance satisfies
 * it as-is. Keeping the driver out of the type graph also keeps two installed copies (the consumer's
 * and a linked dev copy of this package's) from becoming two incompatible nominal types.
 */

/** A prepared statement, as much of one as the Kysely binding shim and the ops call. */
export interface SqliteStatement {
  readonly reader: boolean;
  all(...parameters: unknown[]): unknown[];
  run(...parameters: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  iterate(...parameters: unknown[]): IterableIterator<unknown>;
}

/** A better-sqlite3 `Database`. */
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

/** better-sqlite3's constructor options this package passes. */
export interface SqliteOpenOptions {
  readonly?: boolean;
  fileMustExist?: boolean;
}

/** The consumer's way to open a connection with ITS copy of better-sqlite3: `(p, o) => new Database(p, o)`. */
export type SqliteOpener = (filePath: string, options: SqliteOpenOptions) => SqliteClient;
