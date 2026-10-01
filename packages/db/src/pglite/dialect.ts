import type { PGlite } from "@electric-sql/pglite";
import {
  CompiledQuery,
  type DatabaseConnection,
  type Dialect,
  type Driver,
  type Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type QueryResult,
} from "kysely";

/**
 * @file A Kysely dialect over one PGlite instance: Kysely's own Postgres adapter, compiler and
 * introspector, plus a driver that runs compiled queries through `PGlite#query`.
 *
 * Written here rather than taken from npm (2026-09-28): `kysely-pglite-dialect` 1.3.1 declares
 * `@electric-sql/pglite` peer `^0.2 || ^0.3 || ^0.4` (this package pins 0.5.8), is one maintainer, and is
 * ~11 KB of the same few lines; `kysely-pglite` was last published 2024. This file is that driver,
 * sized to what the kernel needs and nothing else.
 *
 * PGlite is ONE connection. The driver hands it out one holder at a time (a transaction holds it
 * from `BEGIN` to `COMMIT`), so a statement from outside can never land inside someone else's
 * transaction. The kernel's turn lock already orders callers; this keeps the dialect correct on its
 * own too.
 */

class PgliteConnection implements DatabaseConnection {
  constructor(private readonly client: PGlite) {}

  async executeQuery<R>(compiled: CompiledQuery): Promise<QueryResult<R>> {
    const result = await this.client.query<R>(compiled.sql, [...compiled.parameters]);
    return {
      rows: result.rows,
      ...(result.affectedRows !== undefined ? { numAffectedRows: BigInt(result.affectedRows) } : {}),
    };
  }

  // eslint-disable-next-line require-yield -- the interface requires a generator; PGlite has no cursor API here
  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new Error("streaming queries are not supported on PGlite");
  }
}

class PgliteDriver implements Driver {
  private readonly connection: PgliteConnection;
  private holder: Promise<void> = Promise.resolve();
  private releaseHolder: (() => void) | undefined;

  constructor(private readonly client: PGlite) {
    this.connection = new PgliteConnection(client);
  }

  async init(): Promise<void> {
    await this.client.waitReady;
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    const previous = this.holder;
    let release!: () => void;
    this.holder = new Promise((resolve) => (release = resolve));
    await previous;
    this.releaseHolder = release;
    return this.connection;
  }

  async releaseConnection(): Promise<void> {
    const release = this.releaseHolder;
    this.releaseHolder = undefined;
    release?.();
  }

  async beginTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw("BEGIN"));
  }

  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw("COMMIT"));
  }

  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw("ROLLBACK"));
  }

  /** The PGlite instance belongs to whoever opened it (the kernel closes it). */
  async destroy(): Promise<void> {}
}

export class PgliteDialect implements Dialect {
  constructor(private readonly client: PGlite) {}

  createAdapter() {
    return new PostgresAdapter();
  }

  createDriver(): Driver {
    return new PgliteDriver(this.client);
  }

  createQueryCompiler() {
    return new PostgresQueryCompiler();
  }

  createIntrospector(db: Kysely<unknown>) {
    return new PostgresIntrospector(db);
  }
}
