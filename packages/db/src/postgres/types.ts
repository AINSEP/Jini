/**
 * @file The slice of node-postgres (`pg`) this package uses, written structurally: the consumer
 * passes its own `pg` module (`import pg from "pg"`), so this package needs neither `pg` nor its
 * types, and the one copy that runs is the consumer's.
 */

/** Pool options this package sets. */
export interface PgPoolOptions {
  connectionString?: string;
  host?: string;
  port?: number;
  user?: string;
  database?: string;
  max?: number;
  idleTimeoutMillis?: number;
  types?: { getTypeParser(oid: number, format?: "text" | "binary"): (value: string) => unknown };
}

/** The result shape used by a Postgres connection; independent of query builders. */
export interface PgQueryResult<Row> {
  command: "UPDATE" | "DELETE" | "INSERT" | "SELECT" | "MERGE";
  rowCount: number;
  rows: Row[];
}

/** A cursor accepted by a Postgres connection. */
export interface PgCursor<Row> {
  read(rowsCount: number): Promise<Row[]>;
  close(): Promise<void>;
}

/** A checked-out pool connection, described structurally rather than through Kysely. */
export interface PgPoolClient {
  processID?: number;
  query<Row>(sql: string, parameters: ReadonlyArray<unknown>): Promise<PgQueryResult<Row>>;
  query<Row>(cursor: PgCursor<Row>): PgCursor<Row>;
  release(): void;
}

/** The pool operations used by the kernel binding plus the idle-error event. */
export interface PgPool {
  connect(): Promise<PgPoolClient>;
  end(): Promise<void>;
  options: object;
  on(event: "error", listener: (err: Error) => void): unknown;
}

/** The `pg` module's default export: `import pg from "pg"`, passed as `{ pg }`. */
export interface PgModule {
  readonly Pool: new (options: PgPoolOptions) => PgPool;
  readonly types: { getTypeParser(oid: number, format?: "text" | "binary"): (value: never) => unknown };
}

/** node-postgres type parsing aligned with PGlite's (`PG_PARSERS`), for one pool only. */
export function pgTypesFor(
  pg: PgModule,
  parsers: Readonly<Record<number, (text: string) => unknown>>
): NonNullable<PgPoolOptions["types"]> {
  return {
    getTypeParser(oid, format) {
      return parsers[oid] ?? (pg.types.getTypeParser(oid, format) as (value: string) => unknown);
    },
  };
}
