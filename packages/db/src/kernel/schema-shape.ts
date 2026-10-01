import { sql } from "kysely";

import type { StorageKernel } from "./port.js";

/**
 * @file The physical schema of a database as comparable text, per table: columns (type, NOT NULL,
 * default, key position), indexes (uniqueness, columns, partial predicate), foreign keys and — on
 * SQLite — the table's own `CREATE` text (the only place SQLite keeps CHECK constraints). Used by the
 * migration runner to verify an adopted database against a freshly built one, and by tests that
 * hold a migration history to a declared schema. Two shapes are equal when the databases
 * would accept and reject the same writes; object names SQLite generates itself are left out.
 */

export interface TableShape {
  columns: string[];
  indexes: string[];
  constraints: string[];
}

export interface SchemaShape {
  tables: Record<string, TableShape>;
  /** Views and triggers: `kind name: definition`. */
  others: string[];
}

const squash = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, " ").trim();

/** Every user table's shape (internal and `sqlite_`/`pg_` tables excluded), keyed by table name. */
export async function readSchemaShape(kernel: StorageKernel<unknown>, optional: { exclude?: readonly string[] } = {}): Promise<SchemaShape> {
  const exclude = new Set(optional.exclude ?? []);
  const shape = kernel.dialect === "sqlite" ? await sqliteShape(kernel) : await postgresShape(kernel);
  for (const name of exclude) delete shape.tables[name];
  return shape;
}

async function sqliteShape(kernel: StorageKernel<unknown>): Promise<SchemaShape> {
  const objects = await kernel.query<{ type: string; name: string; tbl_name: string; sql: string | null }>(
    sql`SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE substr(name, 1, 7) <> 'sqlite_' ORDER BY type, name`
  );
  const tables: Record<string, TableShape> = {};
  const others: string[] = [];
  for (const object of objects) {
    if (object.type === "view" || object.type === "trigger") others.push(`${object.type} ${object.name}: ${squash(object.sql)}`);
    if (object.type !== "table") continue;
    const columns = await kernel.query<{ name: string; type: string; notnull: number; dflt_value: string | null; pk: number }>(
      sql`SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info(${object.name}) ORDER BY cid`
    );
    const indexes = await kernel.query<{ name: string; unique: number; origin: string; partial: number }>(
      sql`SELECT name, "unique", origin, partial FROM pragma_index_list(${object.name}) ORDER BY name`
    );
    const indexTexts: string[] = [];
    for (const index of indexes) {
      const cols = await kernel.query<{ name: string | null }>(sql`SELECT name FROM pragma_index_info(${index.name}) ORDER BY seqno`);
      const definition = objects.find((o) => o.type === "index" && o.name === index.name)?.sql;
      const where = index.partial ? ` WHERE ${squash(definition).replace(/^.*? WHERE /i, "")}` : "";
      // Auto-named indexes (UNIQUE/PRIMARY KEY in the table text) are identified by what they cover.
      const label = index.origin === "c" ? index.name : `(${index.origin})`;
      indexTexts.push(`${label} ${index.unique ? "UNIQUE " : ""}(${cols.map((c) => c.name).join(", ")})${where}`);
    }
    const fks = await kernel.query<{ id: number; table: string; from: string; to: string | null; on_update: string; on_delete: string }>(
      sql`SELECT id, "table", "from", "to", on_update, on_delete FROM pragma_foreign_key_list(${object.name}) ORDER BY id, seq`
    );
    const byId = new Map<number, typeof fks>();
    for (const fk of fks) byId.set(fk.id, [...(byId.get(fk.id) ?? []), fk]);
    const constraints = [...byId.values()].map(
      (parts) => {
        // Every group has at least one part: it was created by pushing one.
        const first = parts[0] as (typeof parts)[number];
        return `FOREIGN KEY (${parts.map((p) => p.from).join(", ")}) REFERENCES ${first.table} (${parts.map((p) => p.to ?? "").join(", ")}) ON DELETE ${first.on_delete} ON UPDATE ${first.on_update}`;
      }
    );
    constraints.push(`DEFINITION ${squash(object.sql)}`);
    tables[object.name] = {
      columns: columns.map((c) => `${c.name} ${c.type.toLowerCase()}${c.notnull ? " NOT NULL" : ""}${c.dflt_value === null ? "" : ` DEFAULT ${c.dflt_value}`}${c.pk ? ` PK${c.pk}` : ""}`),
      indexes: indexTexts.sort(),
      constraints: constraints.sort(),
    };
  }
  return { tables, others: others.sort() };
}

async function postgresShape(kernel: StorageKernel<unknown>): Promise<SchemaShape> {
  const columns = await kernel.query<{ table_name: string; column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
    sql`SELECT c.table_name, c.column_name, c.data_type, c.is_nullable, c.column_default
        FROM information_schema.columns c
        JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema = current_schema() AND t.table_type = 'BASE TABLE'
        ORDER BY c.table_name, c.ordinal_position`
  );
  const indexes = await kernel.query<{ tablename: string; indexname: string; indexdef: string }>(
    sql`SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = current_schema() ORDER BY tablename, indexname`
  );
  const constraints = await kernel.query<{ table_name: string; conname: string; definition: string }>(
    sql`SELECT cl.relname AS table_name, co.conname, pg_get_constraintdef(co.oid) AS definition
        FROM pg_constraint co JOIN pg_class cl ON cl.oid = co.conrelid
        JOIN pg_namespace ns ON ns.oid = cl.relnamespace
        WHERE ns.nspname = current_schema() ORDER BY cl.relname, co.conname`
  );
  const tables: Record<string, TableShape> = {};
  const table = (name: string) => (tables[name] ??= { columns: [], indexes: [], constraints: [] });
  for (const c of columns) {
    table(c.table_name).columns.push(
      `${c.column_name} ${c.data_type.toLowerCase()}${c.is_nullable === "NO" ? " NOT NULL" : ""}${c.column_default === null ? "" : ` DEFAULT ${c.column_default}`}`
    );
  }
  for (const i of indexes) table(i.tablename).indexes.push(`${i.indexname} ${squash(i.indexdef).replace(/ ON \S+\./, " ON ")}`);
  for (const c of constraints) table(c.table_name).constraints.push(`${c.conname} ${squash(c.definition)}`);
  for (const shape of Object.values(tables)) {
    shape.indexes.sort();
    shape.constraints.sort();
  }
  const views = await kernel.query<{ name: string; definition: string }>(
    sql`SELECT viewname AS name, definition FROM pg_views WHERE schemaname = current_schema() ORDER BY viewname`
  );
  return { tables, others: views.map((v) => `view ${v.name}: ${squash(v.definition)}`) };
}

/** The main database file of a SQLite kernel; null for an in-memory database or a Postgres kernel. */
export async function databaseFile(kernel: StorageKernel<unknown>): Promise<string | null> {
  if (kernel.dialect !== "sqlite") return null;
  const rows = await kernel.query<{ file: string }>(sql`SELECT file FROM pragma_database_list WHERE name = 'main'`);
  return rows[0]?.file ? rows[0].file : null;
}
