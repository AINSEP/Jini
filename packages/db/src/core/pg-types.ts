/**
 * @file How every Postgres transport turns column text into JS values where the defaults differ
 * from what the repos (and SQLite) expect. One table, used by the PGlite and node-postgres drivers,
 * so a row reads the same on both.
 *
 * - `json`/`jsonb` stay JSON TEXT: the repos store and parse JSON themselves (SQLite has no JSON
 *   type), so a `string` column type holds on every dialect. The text is re-serialised compactly
 *   (`{"a":1}`, as `JSON.stringify` writes it) instead of Postgres's own spelling (`{"a": 1}`), so a
 *   value written compactly reads back byte-identical.
 *   Key order is jsonb's (it does not keep insertion order); compare parsed values, not text.
 * - `int8` (`bigint`) is a `number` when it fits in a double exactly, else a `bigint` — PGlite's own
 *   rule, which node-postgres (default: string) is aligned to.
 */

export const PG_OID = { int8: 20, json: 114, jsonb: 3802 } as const;

export function parseInt8(text: string): number | bigint {
  const value = BigInt(text);
  return value < BigInt(Number.MIN_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER) ? value : Number(value);
}

const compactJson = (text: string) => JSON.stringify(JSON.parse(text));

/** Parser overrides by type oid. */
export const PG_PARSERS: Readonly<Record<number, (text: string) => unknown>> = {
  [PG_OID.int8]: parseInt8,
  [PG_OID.json]: compactJson,
  [PG_OID.jsonb]: compactJson,
};

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
