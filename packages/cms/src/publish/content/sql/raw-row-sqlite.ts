import { sql, type RawBuilder } from "kysely";
import type { RawColumn, RawValue } from "../../transfer/backstop-audit.js";
import type { RawRowPort } from "../../transfer/backstop-ports.js";
import { BackstopRefusal } from "../backstop-refusal.js";

function identifier({ name }: { name: string }, _optional = {}): string {
  if (!/^[A-Za-z_]\w*$/.test(name)) throw new BackstopRefusal({ message: "Invalid raw database identifier." });
  return `"${name}"`;
}
function allowed({ table, columns, checkTable }: Pick<SqliteRowContext, "checkTable"> & { table: string; columns: readonly string[] }, _optional = {}): void {
  const denied = checkTable({ table, columns });
  // Only policy refusals may become public skip reasons; driver failures keep their type.
  if (denied) throw new BackstopRefusal({ message: denied });
}
function encode({ value }: { value: unknown }, _optional = {}): RawValue {
  if (value instanceof Uint8Array) return { blobBase64: Buffer.from(value).toString("base64") };
  // The default SQLite driver reads INTEGER as number; refuse values that JSON would round.
  if (value === null || typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))) return value;
  throw new BackstopRefusal({ message: "This row contains a database value that cannot be sent safely." });
}
function decode(value: RawValue): string | number | null | Buffer {
  return typeof value === "object" && value !== null ? Buffer.from(value.blobBase64, "base64") : value;
}

type Empty = Record<string, never>;
type SqliteRowContext = {
  kernel: {
    readonly dialect: string;
    inTransaction(): boolean;
    query<Row>(required: { statement: RawBuilder<unknown> }): Promise<readonly Row[]>;
    execute(required: { statement: RawBuilder<unknown> }): Promise<unknown>;
  };
  tableInfo: (required: { table: string }) => Promise<readonly RawColumn[] | null>;
  checkTable: (required: { table: string; columns: readonly string[] }) => string | undefined;
};
type RawPk = Readonly<Record<string, RawValue>>;

async function listRawColumns(required: SqliteRowContext & { table: string }, _optional = {}): Promise<readonly RawColumn[] | null> {
  const { table } = required;
  allowed({ ...required, table, columns: [] });
  // SQLite's own table_info shape, not listColumns': both peers compare and hash it (see sqlite-only.ts in `@jini-ai/db/kernel/sqlite`).
  const info = await required.tableInfo({ table });
  if (!info) return null;
  identifier({ name: table }); // a live table whose name later SQL could not quote is refused here, as before
  allowed({ ...required, table, columns: info.map((c) => c.name) });
  return info.map(({ name, type, pk, notnull }) => ({ name, type, pk, notnull })).sort((a, b) => a.name.localeCompare(b.name));
}

/** Callers run verifyRawPk() first, which already refuses an empty or partial primary key. */
function wherePk(pk: RawPk) {
  return sql.join(Object.entries(pk).map(([name, value]) => sql`${sql.raw(identifier({ name }))} = ${decode(value)}`), sql` AND `);
}

async function verifyRawPk(required: SqliteRowContext & { table: string; pk: RawPk }, _optional = {}): Promise<readonly RawColumn[]> {
  const { table, pk } = required;
  const info = await listRawColumns(required);
  if (!info) throw new BackstopRefusal({ message: `Table '${table}' does not exist.` });
  const names = info.filter((c) => c.pk > 0).map((c) => c.name).sort();
  if (names.length === 0 || JSON.stringify(names) !== JSON.stringify(Object.keys(pk).sort()) ||
    Object.values(pk).some((value) => value === null || !["string", "number"].includes(typeof value))) throw new BackstopRefusal({ message: "Choose a row by its complete primary key." });
  return info;
}

async function readRawRow(required: SqliteRowContext & { table: string; pk: RawPk }, _optional = {}) {
  const { kernel, table, pk } = required;
  const info = await verifyRawPk(required);
  const [row] = await kernel.query<Record<string, unknown>>({ statement: sql`SELECT * FROM ${sql.raw(identifier({ name: table }))} WHERE ${wherePk(pk)}` });
  return row ? { table, pk, columns: info, values: Object.fromEntries(Object.entries(row).map(([name, value]) => [name, encode({ value })])) } : null;
}

async function upsertRawRow(required: SqliteRowContext & { table: string; pk: RawPk; values: Readonly<Record<string, RawValue>> }, _optional = {}): Promise<void> {
  const { kernel, table, pk, values } = required;
  allowed({ ...required, table, columns: Object.keys(values) });
  const info = await verifyRawPk(required);
  if (JSON.stringify(Object.keys(values).sort()) !== JSON.stringify(info.map((c) => c.name).sort()) ||
    Object.keys(pk).some((name) => values[name] !== pk[name])) throw new Error("The raw row does not contain every column or its primary key.");
  const names = Object.keys(values).sort();
  const nonPk = names.filter((name) => !Object.hasOwn(pk, name));
  const assignments = nonPk.map((name) => sql`${sql.raw(identifier({ name }))} = excluded.${sql.raw(identifier({ name }))}`);
  const updates = nonPk.length > 0 ? sql`DO UPDATE SET ${sql.join(assignments)}` : sql`DO NOTHING`;
  await kernel.execute({ statement: sql`INSERT INTO ${sql.raw(identifier({ name: table }))} (${sql.join(names.map((name) => sql.raw(identifier({ name }))))})
    VALUES (${sql.join(names.map((name) => {
      const value = values[name];
      if (value === undefined) throw new Error(`Raw row has no value for column ${name}`);
      return sql`${decode(value)}`;
    }))})
    ON CONFLICT (${sql.join(Object.keys(pk).map((name) => sql.raw(identifier({ name }))))}) ${updates}` });
}

/** Site content.db adapter, using Jini's storage kernel for transaction serialization (including
 * nested command gateways). It never opens a second connection and does no schema installation. */
export function createRawRowSqlitePort({ kernel, tableInfo, checkedTransaction, checkTable, copy }: SqliteRowContext & {
  checkedTransaction: <T>(required: { work: () => Promise<T>; onViolation: (required: { violation: { table: string; rowid: unknown; parent: string } }) => Error }) => Promise<T>;
  copy: { notSqlite: string; foreignKeyViolation: (required: { table: string; rowid: unknown; parent: string }, optional?: Empty) => string };
}, _optional: Empty = {}): RawRowPort {
  if (kernel.dialect !== "sqlite") throw new Error(copy.notSqlite);
  const context = { kernel, tableInfo, checkTable };
  return {
    columns: ({ table }) => listRawColumns({ ...context, table }),
    read: ({ table, pk }) => readRawRow({ ...context, table, pk }),
    upsert: ({ table, pk, values }) => upsertRawRow({ ...context, table, pk, values }),
    removeCreated: async ({ table, pk }) => {
      await verifyRawPk({ ...context, table, pk });
      await kernel.execute({ statement: sql`DELETE FROM ${sql.raw(identifier({ name: table }))} WHERE ${wherePk(pk)}` });
    },
    transaction: async ({ work }) => {
      // A per-row gateway may join the push's outer transaction; only that outer call checks FKs.
      if (kernel.inTransaction()) return work();
      return checkedTransaction({ work, onViolation: ({ violation: first }) =>
        new Error(copy.foreignKeyViolation(first)) });
    },
  };
}
