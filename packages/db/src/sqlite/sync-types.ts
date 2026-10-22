/** Structural synchronous SQLite contract for legacy CRUD; the host owns the driver. */
import type { SqliteClient, SqliteOpenOptions } from './types.js';

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
