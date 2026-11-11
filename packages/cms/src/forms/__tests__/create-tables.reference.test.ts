import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "vitest";
import { sql } from "kysely";
import { PGlite } from "@electric-sql/pglite";
import type BetterSqlite3 from "better-sqlite3";
import { sqliteKernel } from "@jini-ai/db/kernel/sqlite";
import { openPgliteKernel } from "@jini-ai/db/kernel/pglite";
import type { StorageKernel } from "@jini-ai/db/kernel";
import { createFormsTables } from "../sql/index.js";
import { createReferenceTables, referenceTables as tables } from "./support/forms-tables.reference.js";

/**
 * @file `createFormsTables` builds the same schema as the independent Tovu DDL copy in
 * `support/forms-tables.reference.ts`: tables, columns (order, type, nullability, default),
 * indexes (name, uniqueness, columns, partial predicate) and constraints (primary and foreign
 * keys with their actions, and NOT NULL where the catalog records it), on SQLite and on PGlite (Postgres). Each side is built on its own
 * fresh database and read back from the catalog, so neither side's SQL text is compared.
 */

const require = createRequire(new URL("../../../package.json", import.meta.url));
const Database = require("better-sqlite3") as typeof BetterSqlite3;

type Db = BetterSqlite3.Database;

/** SQLite catalog for the forms tables, as plain data. */
function sqliteSchema(db: Db) {
  const norm = (text: string | null) => (text ?? "").replace(/[`"\s]+/g, " ").trim().toLowerCase();
  return [tables.definitions, tables.submissions].map((table) => ({
    table,
    columns: db.prepare(`PRAGMA table_info("${table}")`).all(),
    indexes: (db.prepare(`PRAGMA index_list("${table}")`).all() as { name: string; unique: number; origin: string; partial: number }[])
      .map((index) => {
        const ddl = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?").get(index.name) as { sql: string | null } | undefined;
        const where = norm(ddl?.sql ?? null).split(" where ")[1] ?? null;
        return { ...index, columns: db.prepare(`PRAGMA index_info("${index.name}")`).all(), where };
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
    foreignKeys: db.prepare(`PRAGMA foreign_key_list("${table}")`).all(),
  }));
}

/** Postgres catalog for the forms tables, as plain data. */
async function postgresSchema<DB>(kernel: StorageKernel<DB>) {
  const names = [tables.definitions, tables.submissions];
  const columns = await kernel.query(sql`SELECT table_name, ordinal_position, column_name, data_type, is_nullable, column_default
    FROM information_schema.columns WHERE table_schema = current_schema() AND table_name IN (${sql.join(names)})
    ORDER BY table_name, ordinal_position`);
  const indexes = await kernel.query(sql`SELECT tablename, indexname, indexdef FROM pg_indexes
    WHERE schemaname = current_schema() AND tablename IN (${sql.join(names)}) ORDER BY tablename, indexname`);
  const constraints = await kernel.query(sql`SELECT c.conrelid::regclass::text AS table_name, c.conname, c.contype, pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = current_schema() AND c.conrelid::regclass::text IN (${sql.join(names)}) ORDER BY 1, 2`);
  return { columns, indexes, constraints };
}

test("sqlite: createFormsTables matches the reference DDL's catalog", async () => {
  const reference = new Database(":memory:");
  const created = new Database(":memory:");
  try {
    await createReferenceTables(sqliteKernel(reference), "sqlite");
    await createFormsTables({ kernel: sqliteKernel(created), tables });
    const expected = sqliteSchema(reference);
    assert.equal(expected.flatMap((t) => t.indexes).length, 7, "reference has 5 named indexes and 2 primary-key autoindexes");
    assert.deepEqual(sqliteSchema(created), expected);
  } finally {
    reference.close();
    created.close();
  }
});

test("pglite: createFormsTables matches the reference DDL's catalog", async () => {
  const reference = openPgliteKernel({ PGlite }, {});
  const created = openPgliteKernel({ PGlite }, {});
  try {
    await createReferenceTables(reference, "postgres");
    await createFormsTables({ kernel: created, tables });
    const expected = await postgresSchema(reference);
    assert.equal(expected.indexes.length, 7, "reference has 5 named indexes and 2 primary-key indexes");
    const keys = expected.constraints.filter((row) => ["p", "f"].includes((row as { contype: string }).contype));
    assert.equal(keys.length, 3, "reference has 2 primary keys and 1 foreign key");
    assert.deepEqual(await postgresSchema(created), expected);
  } finally {
    await reference.close();
    await created.close();
  }
});
