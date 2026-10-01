import { sql } from "kysely";

import type { StorageKernel } from "./port.js";

/**
 * @file Kysely `Database` types generated from a migrated Postgres reference database — the typed
 * schema every repo query body is checked against (types come from the database, never
 * from hand edits). Postgres is the reference because it keeps what SQLite erases (booleans, JSON,
 * 64-bit integers); a consumer test can then prove a migrated SQLite database has the same
 * tables and columns with compatible storage.
 *
 * Mapping (see `pg-types.ts` for why JSON stays text):
 * text → `string`; integer/bigint/real/double/numeric → `number`; boolean → `Bool` (reads
 * `SqlBool`: `true`/`false` on Postgres, `1`/`0` on SQLite — convert with `toBool`); json/jsonb →
 * `string` (JSON text); bytea → `Uint8Array`. Nullable adds `| null`; a NOT NULL column with a
 * default or an identity column becomes `Generated<…>` (optional on insert).
 */

interface ColumnRow {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
  is_identity: string;
}

const SCALAR: Readonly<Record<string, string>> = {
  text: "string",
  "character varying": "string",
  character: "string",
  integer: "number",
  smallint: "number",
  bigint: "number",
  real: "number",
  "double precision": "number",
  numeric: "number",
  json: "string",
  jsonb: "string",
  bytea: "Uint8Array",
};

function pascal(name: string): string {
  return name
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function columnType(column: ColumnRow): string {
  const nullable = column.is_nullable === "YES";
  const generated = column.column_default !== null || column.is_identity === "YES";
  if (column.data_type === "boolean") return nullable ? "NullableBool" : generated ? "GeneratedBool" : "Bool";
  const scalar = SCALAR[column.data_type];
  if (scalar === undefined) {
    throw new Error(`typegen: no TypeScript type for ${column.table_name}.${column.column_name} (${column.data_type})`);
  }
  if (nullable) return `${scalar} | null`;
  return generated ? `Generated<${scalar}>` : scalar;
}

/**
 * The `.ts` source of a Kysely database interface for every table in the kernel's current schema.
 *
 * @param required.interfaceName e.g. `ContentDatabase`.
 * @param required.source one line naming where the reference database came from (printed in the header).
 */
export async function renderDatabaseTypes(
  kernel: StorageKernel<unknown>,
  required: { interfaceName: string; source: string; regenerate: string }
): Promise<string> {
  if (kernel.dialect !== "postgres") throw new Error("typegen reads a Postgres reference database");
  const rows = await kernel.query<ColumnRow>(
    sql`SELECT table_name, column_name, data_type, is_nullable, column_default, is_identity
        FROM information_schema.columns
        WHERE table_schema = current_schema()
        ORDER BY table_name, ordinal_position`
  );
  const tables = new Map<string, ColumnRow[]>();
  for (const row of rows) tables.set(row.table_name, [...(tables.get(row.table_name) ?? []), row]);
  const names = [...tables.keys()].sort();
  const out: string[] = [
    "/**",
    ` * @file GENERATED — do not edit. Kysely types for ${required.interfaceName}, read from ${required.source}`,
    ` * by \`platform/db/kernel/typegen.ts\`. Regenerate: ${required.regenerate}`,
    " */",
    'import type { ColumnType, Generated, SqlBool } from "kysely";',
    "",
    "/** A boolean column: reads `true`/`false` (Postgres) or `1`/`0` (SQLite); convert with `toBool`. */",
    "export type Bool = ColumnType<SqlBool, boolean, boolean>;",
    "export type GeneratedBool = ColumnType<SqlBool, boolean | undefined, boolean>;",
    "export type NullableBool = ColumnType<SqlBool | null, boolean | null | undefined, boolean | null>;",
    "",
    `export interface ${required.interfaceName} {`,
    ...names.map((name) => `  ${name}: ${pascal(name)}Table;`),
    "}",
  ];
  for (const name of names) {
    out.push("", `export interface ${pascal(name)}Table {`);
    for (const column of tables.get(name)!) out.push(`  ${column.column_name}: ${columnType(column)};`);
    out.push("}");
  }
  return `${out.join("\n")}\n`;
}
