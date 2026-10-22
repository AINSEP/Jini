import type { Kysely, RawBuilder } from "kysely";

/**
 * @file The storage kernel port: the ONE async way a repo reaches its database, on every driver.
 * Package: `@jini-ai/db/kernel` (no driver is imported here; each driver lives in its own subpath).
 *
 * A repo is ONE Kysely query body for every dialect. It never holds a raw handle, never runs
 * `BEGIN`, never calls a driver API. It asks the kernel:
 *
 * - {@link StorageKernel.run} — run statements on the right executor: the open transaction when the
 *   caller is inside {@link StorageKernel.transaction}, else the base handle.
 * - {@link StorageKernel.transaction} — one unit of work. A NESTED call joins the outer one (no
 *   savepoint), so a service composing two repos that each wrap themselves still commits or rolls
 *   back as one. Calling it from inside a `run()` body throws: that body holds the handle a
 *   transaction would wait for.
 * - {@link StorageKernel.lockKey} — the explicit concurrency strategy for "nothing else may
 *   interleave here" (read-then-write sequences such as a ledger append). A transaction alone does
 *   not give that on Postgres (READ COMMITTED); this does, on every dialect.
 * - {@link StorageKernel.query} — a portable Kysely `sql` statement returning rows. For dialect
 *   helpers, migrations and introspection (`dialect.ts`), not for repos.
 *
 * Three separate things describe a kernel (never inferred from each other, never cached per process):
 * the SQL {@link StorageDialect}, the connection {@link StorageTransport}, and its
 * {@link StorageCapabilities}. Asking for a capability the kernel lacks throws
 * {@link UnsupportedCapabilityError}; nothing silently downgrades (e.g. a transaction never becomes
 * "run the statements one by one").
 *
 * Drivers live in the `sqlite`, `pglite` and `postgres` subpaths. None of them imports a driver
 * package: the consumer passes its own client, pool or class in.
 */

/** SQL family: decides which dialect helper fragment applies. */
export type StorageDialect = "sqlite" | "postgres";

/** The connection underneath: an embedded engine, a network pool, or a PGlite owner's Unix socket. */
export type StorageTransport = "better-sqlite3" | "pglite" | "node-postgres" | "pglite-socket";

/** What this kernel instance can do. Checked per call; a missing one is an explicit error. */
export interface StorageCapabilities {
  /** `transaction(fn)` with awaits (reads, logic) between statements. D1 and HTTP drivers: no. */
  readonly interactiveTransactions: boolean;
  /** Several statements applied all-or-nothing without an interactive transaction. */
  readonly atomicBatch: boolean;
  /** DDL inside a transaction rolls back with it. */
  readonly transactionalDdl: boolean;
  /** A consistent copy of the whole database can be taken through the driver (restore points). */
  readonly backup: boolean;
}

export type StorageCapability = keyof StorageCapabilities;

export class UnsupportedCapabilityError extends Error {
  constructor(
    readonly capability: StorageCapability,
    readonly transport: StorageTransport
  ) {
    super(`the ${transport} storage driver does not support ${capability}`);
    this.name = "UnsupportedCapabilityError";
  }
}

export interface StorageKernel<DB> {
  readonly dialect: StorageDialect;
  readonly transport: StorageTransport;
  readonly capabilities: StorageCapabilities;
  /** Resolves once the driver is open and its schema is in place. Every call below awaits it. */
  readonly ready: Promise<void>;
  run<T>(fn: (db: Kysely<DB>) => T | Promise<T>): Promise<T>;
  /** Throws {@link UnsupportedCapabilityError} without `interactiveTransactions`. */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  /**
   * Inside a transaction: blocks every other transaction that locks the same `key` until this one
   * ends. Postgres: a transaction-scoped advisory lock. SQLite: nothing to do — the kernel's
   * transactions take the database write lock at `BEGIN IMMEDIATE`, which already serializes them.
   * Throws outside a transaction (a lock with no transaction to end it would never be released).
   */
  lockKey(key: string): Promise<void>;
  query<Row>(statement: RawBuilder<Row>): Promise<Row[]>;
  /** {@link query} for a statement that returns no rows (DDL, a write without `RETURNING`). */
  execute(statement: RawBuilder<unknown>): Promise<void>;
  /** True inside this kernel's own transaction (the caller's async context). */
  inTransaction(): boolean;
  /** Throws {@link UnsupportedCapabilityError} when this kernel lacks `capability`. */
  require(capability: StorageCapability): void;
  /**
   * A consistent copy of the whole database written to `destPath` (SQLite: the online backup API,
   * a normal SQLite file; PGlite: a data-dir tarball). Throws {@link UnsupportedCapabilityError}
   * without `backup`. Call it outside a transaction.
   */
  backupTo(destPath: string): Promise<void>;
  close(): Promise<void>;
}
