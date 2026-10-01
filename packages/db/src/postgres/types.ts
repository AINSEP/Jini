import type { PostgresPool } from "kysely";

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

/** A `pg.Pool`: Kysely's pool contract plus the idle-error event. */
export type PgPool = PostgresPool & {
  on(event: "error", listener: (err: Error) => void): unknown;
};

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
