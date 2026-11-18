import { sql } from "kysely";

import type { KyselyKernel } from "../port.js";

/**
 * @file SQLite-only primitives with no portable equivalent, spelled once at the kernel boundary.
 *
 * Why these are not `listColumns`/`tableExists` (`dialect.ts`): their callers need SQLite's OWN
 * answer, byte for byte. A peer that ships a table's `PRAGMA table_info` shape to another peer,
 * which compares it to its own and hashes it into a row's content hash, needs the declared type to
 * keep its case and `pk` to keep its key ordinal. `listColumns` lower-cases the type and folds `pk`
 * to a boolean, which would make an upgraded peer disagree with an older one about the same table.
 * The deferred foreign-key check is SQLite's `defer_foreign_keys` + `foreign_key_check` pair;
 * Postgres has no statement-level equivalent.
 */

/** One `PRAGMA table_info` row, as the SQLite catalog reports it. */
export interface SqliteTableColumn {
  readonly name: string;
  /** The declared type, case preserved. */
  readonly type: string;
  /** 0 for a non-key column, else the column's 1-based position in the primary key. */
  readonly pk: number;
  readonly notnull: number;
}

/** Exact table_xinfo metadata; generated and virtual-table columns must not disappear in archive validation. */
export interface SqliteExtendedTableColumn extends SqliteTableColumn {
  readonly cid: number;
  readonly dflt_value: string | null;
  readonly hidden: number;
}

/** One `PRAGMA foreign_key_check` row. */
export interface SqliteForeignKeyViolation {
  readonly table: string;
  readonly rowid: number;
  readonly parent: string;
}

/** Exact native schema entry, including SQLite's internal indexes and original DDL bytes. */
export interface SqliteSchemaObject {
  type: string;
  name: string;
  tbl_name: string;
  sql: string | null;
}

function requireSqlite<DB>({ kernel, operation }: { kernel: KyselyKernel<DB>; operation: string }, _optional = {}): void {
  if (kernel.dialect !== "sqlite") {
    throw new Error(`${operation} is SQLite-only; this kernel is ${kernel.dialect}`);
  }
}

/** Read exact archive column metadata through the existing SQLite boundary, including hidden columns.
 * @throws {Error} On another dialect or a failed read. No writes; table names are bound values.
 * @complexity O(columns) time and space.
 */
export async function sqliteTableExtendedInfo<DB>(
  { kernel, table }: { kernel: KyselyKernel<DB>; table: string }, _options = {},
): Promise<SqliteExtendedTableColumn[]> {
  requireSqlite({ kernel, operation: "sqliteTableExtendedInfo" });
  return kernel.query<SqliteExtendedTableColumn>(sql`SELECT * FROM pragma_table_xinfo(${table}) ORDER BY cid`);
}

/**
 * Read every native schema object without normalizing its SQL. Unlike readSchemaShape, this
 * preserves internal objects and exact DDL for callers that must reject untrusted substitutions.
 * @throws {Error} On a non-SQLite kernel or a failed catalog read. No writes.
 * @complexity O(s log s) database ordering and O(s + DDL bytes) memory for s schema objects.
 */
export async function sqliteSchemaObjects<DB>(
  { kernel }: { kernel: KyselyKernel<DB> }, _options = {},
): Promise<SqliteSchemaObject[]> {
  requireSqlite({ kernel, operation: "sqliteSchemaObjects" });
  return kernel.query<SqliteSchemaObject>(sql`SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name`);
}

/**
 * The columns of the ordinary table `table` (views excluded), in declaration order, exactly as
 * `PRAGMA table_info` reports them; `null` when no such table exists. The name is bound, never
 * spliced, so it needs no identifier quoting.
 * @throws {Error} On a non-SQLite kernel.
 */
export async function sqliteTableInfo<DB>(
  required: { kernel: KyselyKernel<DB>; table: string },
  _optional = {},
): Promise<SqliteTableColumn[] | null> {
  const { kernel, table } = required;
  requireSqlite({ kernel, operation: "sqliteTableInfo" });
  const found = await kernel.query<{ name: string }>(sql`SELECT name FROM sqlite_schema WHERE type='table' AND name=${table}`);
  if (found.length === 0) return null;
  const rows = await kernel.query<SqliteTableColumn>(sql`SELECT name, type, pk, "notnull" FROM pragma_table_info(${table}) ORDER BY cid`);
  return rows.map(({ name, type, pk, notnull }) => ({ name, type, pk, notnull }));
}

/**
 * Runs `work` in one kernel transaction with foreign keys deferred, then checks every foreign key
 * before commit. A violation throws `onViolation({ violation: first })` INSIDE the transaction, so the
 * whole of `work` rolls back.
 * @throws {Error} On a non-SQLite kernel.
 */
export async function sqliteForeignKeyCheckedTransaction<DB, T>(
  required: { kernel: KyselyKernel<DB>; work: () => Promise<T>; onViolation: (required: { violation: SqliteForeignKeyViolation }, optional?: Record<string, never>) => Error },
  _optional = {},
): Promise<T> {
  const { kernel, work, onViolation } = required;
  requireSqlite({ kernel, operation: "sqliteForeignKeyCheckedTransaction" });
  return kernel.transaction(async () => {
    await kernel.execute(sql`PRAGMA defer_foreign_keys = ON`);
    const result = await work();
    const [first] = await kernel.query<SqliteForeignKeyViolation>(sql`PRAGMA foreign_key_check`);
    if (first) throw onViolation({ violation: first });
    return result;
  });
}
