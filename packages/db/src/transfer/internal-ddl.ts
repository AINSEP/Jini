import { createHash } from "node:crypto";

import type { TransferForeignKey, TransferTable } from "./types.js";

/**
 * @file The Postgres DDL a copy writes around the rows, in the order that keeps a bulk load fast and
 * never lets one bad source row sink the copy:
 * 1. {@link createTableSql} — columns, NOT NULL, defaults, identity, primary key (before the rows);
 * 2. {@link reseedIdentitySql} — after the rows, each identity counter moves past the copied numbers,
 *    so the next new row gets max + 1 (a table with none starts at 1);
 * 3. {@link indexSql} — every index and unique constraint;
 * 4. {@link constraintSql} — CHECKs and foreign keys added NOT VALID (still enforced for every new
 *    row), then validated one by one; one whose existing rows break it (a row whose parent is gone,
 *    which SQLite allows with foreign keys off) stays NOT VALID and is recorded in
 *    {@link UNVALIDATED_TABLE}, instead of aborting the copy.
 *
 * A foreign key is left out when its parent table is not copied (logins, saved keys) or its parent
 * columns are neither that table's primary key nor a unique index (Postgres requires one; SQLite does
 * not).
 */

/** Postgres truncates identifiers past 63 bytes (NAMEDATALEN - 1). */
const MAX_IDENTIFIER_BYTES = 63;

/** A session-local table listing constraints left unvalidated; dropped at commit. */
// The host supplies the session-local table name; never rename an existing copy marker.

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function qualified(schema: string, table: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(table)}`;
}

/**
 * The name itself when it fits in 63 bytes; otherwise its first bytes plus 8 hex characters of its
 * SHA-256, so two long names never collapse into one (Postgres would silently cut both to the same
 * prefix).
 */
export function fitIdentifier(name: string): string {
  if (Buffer.byteLength(name) <= MAX_IDENTIFIER_BYTES) return name;
  const hash = createHash("sha256").update(name).digest("hex").slice(0, 8);
  let kept = name.slice(0, MAX_IDENTIFIER_BYTES - 9);
  while (Buffer.byteLength(kept) > MAX_IDENTIFIER_BYTES - 9) kept = kept.slice(0, -1);
  return `${kept}_${hash}`;
}

function columnSql(column: TransferTable["columns"][number]): string {
  const identity = column.identity === undefined ? "" : ` GENERATED ${column.identity} AS IDENTITY`;
  const fallback = column.default === undefined ? "" : ` DEFAULT ${column.default}`;
  return `${quoteIdent(column.name)} ${column.sqlType}${identity}${fallback}${column.notNull ? " NOT NULL" : ""}`;
}

export function createTableSql(schema: string, table: TransferTable): string {
  const columns = table.columns.map(columnSql);
  if (table.primaryKey.length > 0) columns.push(`PRIMARY KEY (${table.primaryKey.map(quoteIdent).join(", ")})`);
  return `CREATE TABLE ${qualified(schema, table.name)} (${columns.join(", ")});\n`;
}

/** Same rule as `manifest.ts`'s `reseedSequenceSql`, schema-qualified: empty -> next is 1, else max + 1. */
export function reseedIdentitySql(schema: string, table: TransferTable, sqlTag = "transfer"): string {
  return table.columns
    .filter((column) => column.identity !== undefined)
    .map((column) => {
      const top = `COALESCE((SELECT max(${quoteIdent(column.name)}) FROM ${qualified(schema, table.name)}), 0)`;
      return `DO $${sqlTag}$ BEGIN PERFORM setval(pg_get_serial_sequence(${quoteLiteral(qualified(schema, table.name))}, ${quoteLiteral(column.name)}), GREATEST(${top}, 1), ${top} >= 1); END $${sqlTag}$;\n`;
    })
    .join("");
}

/** Writes declared indexes, retaining trusted host predicates and their uniqueness scope.
 * @complexity O(index columns plus predicate bytes); emits SQL without executing it.
 */
export function indexSql(schema: string, table: TransferTable): string {
  return table.indexes
    .map((index) => `CREATE ${index.unique ? "UNIQUE " : ""}INDEX ${quoteIdent(fitIdentifier(index.name))} ON ${qualified(schema, table.name)} (${index.columns.map(quoteIdent).join(", ")})${index.where === undefined ? "" : ` WHERE ${index.where}`};\n`)
    .join("");
}

const REFERENTIAL_ACTIONS = new Set(["NO ACTION", "RESTRICT", "CASCADE", "SET NULL", "SET DEFAULT"]);

function action(value: string): string {
  const upper = value.toUpperCase();
  return REFERENTIAL_ACTIONS.has(upper) ? upper : "NO ACTION";
}

function sameColumns(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().join("\u0000") === [...b].sort().join("\u0000");
}

/** The parent columns this key points at, when Postgres will accept it; `null` = leave the key out. */
function parentColumns(fk: TransferForeignKey, byName: ReadonlyMap<string, TransferTable>): readonly string[] | null {
  const parent = byName.get(fk.foreignTable);
  if (parent === undefined) return null;
  const columns = fk.foreignColumns ?? parent.primaryKey;
  if (columns.length !== fk.columns.length) return null;
  // A partial unique index covers only some rows; Postgres cannot use it as an FK target.
  const unique = sameColumns(columns, parent.primaryKey) || parent.indexes.some((index) => index.unique && index.where === undefined && sameColumns(index.columns, columns));
  return unique ? columns : null;
}

interface PendingConstraint {
  readonly table: string;
  readonly name: string;
  readonly add: string;
}

function constraintsOf(schema: string, table: TransferTable, byName: ReadonlyMap<string, TransferTable>): PendingConstraint[] {
  const checks = table.checks.map((check) => ({ table: table.name, name: fitIdentifier(check.name), add: `CHECK (${check.sql})` }));
  const keys = table.foreignKeys.flatMap((fk) => {
    const parent = parentColumns(fk, byName);
    if (parent === null) return [];
    const columns = fk.columns.map(quoteIdent).join(", ");
    const references = `${qualified(schema, fk.foreignTable)} (${parent.map(quoteIdent).join(", ")})`;
    return [{ table: table.name, name: fitIdentifier(fk.name), add: `FOREIGN KEY (${columns}) REFERENCES ${references} ON DELETE ${action(fk.onDelete)} ON UPDATE ${action(fk.onUpdate)}` }];
  });
  return [...checks, ...keys];
}

/**
 * Every CHECK and foreign key, added NOT VALID and then validated; a failed validation is recorded
 * in {@link UNVALIDATED_TABLE} as `table.constraint` and the constraint stays in place, unvalidated.
 *
 * @complexity O(constraints) statements.
 */
export function constraintSql(schema: string, tables: readonly TransferTable[], unvalidatedTable: string, sqlTag = "transfer"): string {
  const UNVALIDATED_TABLE = unvalidatedTable.split(".").map(quoteIdent).join(".");
  const byName = new Map(tables.map((table) => [table.name, table]));
  const pending = tables.flatMap((table) => constraintsOf(schema, table, byName));
  const adds = pending.map(({ table, name, add }) => `ALTER TABLE ${qualified(schema, table)} ADD CONSTRAINT ${quoteIdent(name)} ${add} NOT VALID;\n`);
  const validations = pending.map(
    ({ table, name }) =>
      `  BEGIN ALTER TABLE ${qualified(schema, table)} VALIDATE CONSTRAINT ${quoteIdent(name)};\n` +
      `  EXCEPTION WHEN foreign_key_violation OR check_violation THEN INSERT INTO ${UNVALIDATED_TABLE} VALUES (${quoteLiteral(`${table}.${name}`)}); END;\n`
  );
  return (
    `CREATE TEMP TABLE ${quoteIdent(unvalidatedTable.split(".").at(-1)!)} (name text NOT NULL) ON COMMIT DROP;\n` +
    adds.join("") +
    (validations.length === 0 ? "" : `DO $${sqlTag}$ BEGIN\n${validations.join("")}END $${sqlTag}$;\n`)
  );
}
