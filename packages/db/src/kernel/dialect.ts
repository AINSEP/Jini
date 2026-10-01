import { type Expression, type RawBuilder, sql } from "kysely";

import type { StorageDialect, StorageKernel } from "./port.js";

/**
 * @file Dialect helpers: the few places SQLite and Postgres spell the same thing differently, as
 * Kysely `sql` fragments or kernel queries. A repo that needs one of these calls the helper with
 * `kernel.dialect`; it never writes the dialect's own spelling (the raw-SQLite guard enforces the
 * SQLite side). Idea from EmDash's `dialect-helpers.ts`, re-implemented here.
 *
 * Upserts need no helper: Kysely's `onConflict(oc => oc.column(…).doUpdateSet(…))` compiles to the
 * same `ON CONFLICT … DO UPDATE` on both; "the value being inserted" is `eb.ref("excluded.col")`.
 */

const JSON_KEY = /^[A-Za-z0-9_]+$/;

function checkedPath(path: readonly string[]): readonly string[] {
  if (path.length === 0) throw new Error("JSON path must name at least one key");
  for (const key of path) {
    if (!JSON_KEY.test(key)) throw new Error(`JSON path key '${key}' is not a plain identifier`);
  }
  return path;
}

const sqlitePath = (path: readonly string[]) => `$.${checkedPath(path).join(".")}`;
const pgPath = (path: readonly string[]) => `{${checkedPath(path).join(",")}}`;

/**
 * A SCALAR at `path` inside a JSON text/jsonb column, as TEXT with the same spelling on both
 * dialects: strings as themselves, integers in decimal, booleans as `'true'`/`'false'`, and SQL NULL
 * for JSON `null` or a missing key. Compare numbers through an explicit cast of this text.
 *
 * Not for objects or arrays (each dialect prints those differently), nor for fractional numbers
 * whose spelling matters (`1.50` reads `1.50` on Postgres, `1.5` on SQLite).
 */
export function jsonText(dialect: StorageDialect, column: Expression<unknown>, path: readonly string[]): RawBuilder<string | null> {
  if (dialect === "postgres") return sql<string | null>`(${column}::jsonb #>> ${pgPath(path)})`;
  const at = sqlitePath(path);
  // json_extract hands back SQLite values (1/0 for booleans, typed numbers); spell them as JSON does.
  return sql<string | null>`(CASE json_type(${column}, ${at})
    WHEN 'true' THEN 'true' WHEN 'false' THEN 'false'
    ELSE CAST(json_extract(${column}, ${at}) AS TEXT) END)`;
}

/**
 * `column` at `path` equals the JSON scalar `value` (string, number or boolean), as a boolean
 * expression. SQLite has no JSON boolean type — `json_extract` reads `true`/`false` as `1`/`0` — so
 * a boolean is bound as `1`/`0` there; Postgres compares the two `jsonb` values, so `10` matches
 * `10.0` and a string never matches a number.
 */
export function jsonScalarEquals(
  dialect: StorageDialect,
  column: Expression<unknown>,
  path: readonly string[],
  value: string | number | boolean
): RawBuilder<boolean> {
  if (dialect === "postgres") return sql<boolean>`((${column}::jsonb #> ${pgPath(path)}) = ${JSON.stringify(value)}::jsonb)`;
  const bound = typeof value === "boolean" ? (value ? 1 : 0) : value;
  return sql<boolean>`(json_extract(${column}, ${sqlitePath(path)}) = ${bound})`;
}

/**
 * A sort key for the value at `path`: SQLite's typed `json_extract`, Postgres' `jsonb` value, so
 * numbers sort as numbers (`9` before `10`) — unlike {@link jsonText}, whose text sorts `'10'` first.
 * A missing key is SQL NULL on both; pair with `nullsFirst()` (asc) / `nullsLast()` (desc) so NULLs
 * land where SQLite puts them by default.
 */
export function jsonSortKey(dialect: StorageDialect, column: Expression<unknown>, path: readonly string[]): RawBuilder<unknown> {
  return dialect === "postgres"
    ? sql`(${column}::jsonb #> ${pgPath(path)})`
    : sql`json_extract(${column}, ${sqlitePath(path)})`;
}

/**
 * The column's JSON with `path` set to `value` (any JSON-serialisable value), creating the last key
 * if it is missing. A NULL column counts as `{}`. The parent object must already exist.
 */
export function jsonSet(dialect: StorageDialect, column: Expression<unknown>, path: readonly string[], value: unknown): RawBuilder<string> {
  const encoded = JSON.stringify(value);
  return dialect === "sqlite"
    ? sql<string>`json_set(coalesce(${column}, '{}'), ${sqlitePath(path)}, json(${encoded}))`
    : sql<string>`jsonb_set(coalesce(${column}::jsonb, '{}'::jsonb), ${pgPath(path)}, ${encoded}::jsonb, true)`;
}

/** The statement's current time as `Date#toISOString()` text (UTC, milliseconds, `Z`). */
export function nowIso(dialect: StorageDialect): RawBuilder<string> {
  return dialect === "sqlite"
    ? sql<string>`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
    : sql<string>`to_char(statement_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
}

/** A boolean column as read: `true`/`false` on Postgres, `1`/`0` on SQLite. NULL stays null. */
export function toBool(value: boolean | number | null | undefined): boolean | null {
  if (value === null || value === undefined) return null;
  return value === true || value === 1;
}

/**
 * True iff `err` is a UNIQUE violation, from any driver: SQLite's `SQLITE_CONSTRAINT_UNIQUE` /
 * "UNIQUE constraint failed", Postgres SQLSTATE `23505` (node-postgres and PGlite both set `code`).
 * The message check also covers the in-memory test doubles, which throw SQLite's wording.
 */
export function isUniqueViolation(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: unknown }).code;
  return code === "SQLITE_CONSTRAINT_UNIQUE" || code === "23505" || err.message.includes("UNIQUE constraint failed");
}

/** A blob/bytea value as bytes, whichever shape the driver returned (Buffer, Uint8Array). */
export function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new Error(`expected a binary column value, got ${typeof value}`);
}

// ---- Introspection ------------------------------------------------------------------------------

export interface ColumnInfo {
  name: string;
  /** The declared type, lower-case, in the dialect's own spelling (`text`, `integer`, `bigint`…). */
  type: string;
  notNull: boolean;
  primaryKey: boolean;
}

/** User tables in the connection's current schema, sorted by name. Internal tables excluded. */
export async function listTables<DB>(kernel: StorageKernel<DB>): Promise<string[]> {
  const rows = await kernel.query<{ name: string }>(
    kernel.dialect === "sqlite"
      ? sql`SELECT name FROM sqlite_schema WHERE type = 'table' AND substr(name, 1, 7) <> 'sqlite_' ORDER BY name`
      : sql`SELECT table_name AS name FROM information_schema.tables
            WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' ORDER BY table_name`
  );
  return rows.map((row) => row.name);
}

export async function tableExists<DB>(kernel: StorageKernel<DB>, table: string): Promise<boolean> {
  return (await listColumns(kernel, table)).length > 0;
}

/** Columns in declaration order; empty when the table does not exist. */
export async function listColumns<DB>(kernel: StorageKernel<DB>, table: string): Promise<ColumnInfo[]> {
  const rows = await kernel.query<{ name: string; type: string; not_null: unknown; pk: unknown }>(
    kernel.dialect === "sqlite"
      ? sql`SELECT name, type, "notnull" AS not_null, pk FROM pragma_table_info(${table}) ORDER BY cid`
      : sql`SELECT c.column_name AS name, c.data_type AS type, (c.is_nullable = 'NO') AS not_null,
              EXISTS (
                SELECT 1 FROM information_schema.table_constraints t
                JOIN information_schema.key_column_usage k
                  ON k.constraint_name = t.constraint_name AND k.table_schema = t.table_schema
                WHERE t.constraint_type = 'PRIMARY KEY' AND t.table_schema = c.table_schema
                  AND t.table_name = c.table_name AND k.column_name = c.column_name
              ) AS pk
            FROM information_schema.columns c
            WHERE c.table_schema = current_schema() AND c.table_name = ${table}
            ORDER BY c.ordinal_position`
  );
  return rows.map((row) => ({
    name: row.name,
    type: row.type.toLowerCase(),
    notNull: row.not_null === true || Number(row.not_null) === 1,
    primaryKey: row.pk === true || Number(row.pk) > 0,
  }));
}

// ---- Portable DDL -------------------------------------------------------------------------------

/** The four SQLite storage classes a portable column declares (plugin data modules use these). */
export type ColumnAffinity = "TEXT" | "INTEGER" | "REAL" | "BLOB";

const PG_COLUMN_TYPES: Readonly<Record<ColumnAffinity, string>> = {
  TEXT: "text",
  // SQLite INTEGER is 64-bit (it holds `Date.now()` stamps); Postgres `integer` is 32-bit.
  INTEGER: "bigint",
  REAL: "double precision",
  BLOB: "bytea",
};

/**
 * The column type to write in DDL for `affinity`. SQLite keeps the affinity name itself, so a
 * table created here reads back exactly as before; Postgres gets the same mapping as the frozen
 * Postgres baseline. Lower-cased, it is also what {@link listColumns} reports for that column.
 */
export function columnTypeSql(dialect: StorageDialect, affinity: ColumnAffinity): string {
  return dialect === "sqlite" ? affinity : PG_COLUMN_TYPES[affinity];
}

/** A generated integer primary key column's type and constraints (write the column name before it). */
export function autoIdColumnSql(dialect: StorageDialect): string {
  return dialect === "sqlite" ? "INTEGER PRIMARY KEY AUTOINCREMENT" : "bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY";
}

/**
 * Makes everything committed so far durable in the main database file. SQLite: a full WAL
 * checkpoint (must run outside a write transaction on this connection: SQLite refuses it with
 * "database table is locked"). Postgres: nothing to do, a commit is already durable.
 */
export async function checkpointWal<DB>(kernel: StorageKernel<DB>): Promise<void> {
  if (kernel.dialect === "sqlite") await kernel.query(sql`PRAGMA wal_checkpoint(FULL)`);
}

export interface IndexInfo {
  name: string;
  /** Indexed columns in key order. */
  columns: string[];
  unique: boolean;
}

/**
 * The indexes created with `CREATE INDEX` on `table`, by name. Excluded: the ones a PRIMARY KEY or
 * UNIQUE constraint makes on its own (SQLite origin `pk`/`u`, Postgres constraint-backed), which no
 * `CREATE INDEX` declared. Empty when the table does not exist.
 */
export async function listIndexes<DB>(kernel: StorageKernel<DB>, table: string): Promise<Map<string, IndexInfo>> {
  const rows = await kernel.query<{ name: string; is_unique: unknown; column_name: string }>(
    kernel.dialect === "sqlite"
      ? sql`SELECT il.name AS name, il."unique" AS is_unique, ii.name AS column_name
            FROM pragma_index_list(${table}) il JOIN pragma_index_info(il.name) ii
            WHERE il.origin = 'c' ORDER BY il.name, ii.seqno`
      : sql`SELECT ic.relname AS name, ix.indisunique AS is_unique, a.attname AS column_name
            FROM pg_index ix
            JOIN pg_class t ON t.oid = ix.indrelid
            JOIN pg_class ic ON ic.oid = ix.indexrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            CROSS JOIN LATERAL unnest(ix.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
            JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
            WHERE n.nspname = current_schema() AND t.relname = ${table} AND NOT ix.indisprimary
              AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = ix.indexrelid)
            ORDER BY ic.relname, k.ord`
  );
  const indexes = new Map<string, IndexInfo>();
  for (const row of rows) {
    const index = indexes.get(row.name) ?? { name: row.name, columns: [], unique: row.is_unique === true || Number(row.is_unique) === 1 };
    index.columns.push(row.column_name);
    indexes.set(row.name, index);
  }
  return indexes;
}
