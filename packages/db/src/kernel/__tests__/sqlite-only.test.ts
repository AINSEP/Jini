import { PGlite } from "@electric-sql/pglite";
import { sql } from "kysely";
import { expect, onTestFinished, test, vi } from "vitest";
import { openSqlite } from "../../__tests__/helpers.js";
import { openPgliteKernel } from "../pglite/index.js";
import {
  openMemorySqliteKernel, sqliteForeignKeyCheckedTransaction, sqliteSchemaObjects,
  sqliteTableExtendedInfo, sqliteTableInfo,
} from "../sqlite/index.js";

function sqlite() {
  const kernel = openMemorySqliteKernel<unknown>({ open: openSqlite });
  onTestFinished(() => kernel.close());
  return kernel;
}

test("native catalog distinguishes views and preserves declared types, composite key ordinals, and generated columns", async () => {
  const kernel = sqlite();
  await kernel.execute(sql`CREATE TABLE "record's data" (left_key MiXeD_TEXT NOT NULL, right_key INTEGER, display TEXT DEFAULT 'unset', computed TEXT GENERATED ALWAYS AS (left_key || display) STORED, PRIMARY KEY (right_key, left_key))`);
  await kernel.execute(sql`CREATE VIEW record_view AS SELECT display FROM "record's data"`);
  expect(await sqliteTableInfo({ kernel, table: "record_view" })).toBeNull();
  expect(await sqliteTableInfo({ kernel, table: "missing" })).toBeNull();
  expect(await sqliteTableInfo({ kernel, table: "record's data" })).toEqual([
    { name: "left_key", type: "MiXeD_TEXT", pk: 2, notnull: 1 },
    { name: "right_key", type: "INTEGER", pk: 1, notnull: 0 },
    { name: "display", type: "TEXT", pk: 0, notnull: 0 },
  ]);
  expect(await sqliteTableExtendedInfo({ kernel, table: "record's data" })).toEqual([
    { cid: 0, name: "left_key", type: "MiXeD_TEXT", pk: 2, notnull: 1, dflt_value: null, hidden: 0 },
    { cid: 1, name: "right_key", type: "INTEGER", pk: 1, notnull: 0, dflt_value: null, hidden: 0 },
    { cid: 2, name: "display", type: "TEXT", pk: 0, notnull: 0, dflt_value: "'unset'", hidden: 0 },
    { cid: 3, name: "computed", type: "TEXT", pk: 0, notnull: 0, dflt_value: null, hidden: 3 },
  ]);
});

test("native schema returns original DDL, including the implicit unique index", async () => {
  const kernel = sqlite();
  await kernel.execute(sql`CREATE TABLE zeta (slug TEXT UNIQUE)`);
  await kernel.execute(sql`CREATE TABLE alpha (value INTEGER)`);
  await kernel.execute(sql`CREATE INDEX zeta_slug ON zeta (slug)`);
  expect(await sqliteSchemaObjects({ kernel })).toEqual([
    { type: "index", name: "sqlite_autoindex_zeta_1", tbl_name: "zeta", sql: null },
    { type: "index", name: "zeta_slug", tbl_name: "zeta", sql: "CREATE INDEX zeta_slug ON zeta (slug)" },
    { type: "table", name: "alpha", tbl_name: "alpha", sql: "CREATE TABLE alpha (value INTEGER)" },
    { type: "table", name: "zeta", tbl_name: "zeta", sql: "CREATE TABLE zeta (slug TEXT UNIQUE)" },
  ]);
});

test("a checked transaction can insert the parent later but rolls back all writes for a remaining violation", async () => {
  const kernel = sqlite();
  await kernel.execute(sql`CREATE TABLE parent (id INTEGER PRIMARY KEY)`);
  await kernel.execute(sql`CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parent(id))`);
  const saved = () => kernel.query(sql`SELECT id, parent_id FROM child ORDER BY id`);
  const violation = new Error("unresolved child reference");
  const onViolation = vi.fn(() => violation);
  const work = async () => {
    await kernel.execute(sql`INSERT INTO child VALUES (3, 10)`);
    await kernel.execute(sql`INSERT INTO parent VALUES (10)`);
    return "committed";
  };
  expect(await sqliteForeignKeyCheckedTransaction({ kernel, work, onViolation })).toBe("committed");
  expect(await saved()).toEqual([{ id: 3, parent_id: 10 }]);
  expect(onViolation.mock.calls).toEqual([]);

  await expect(sqliteForeignKeyCheckedTransaction({ kernel, onViolation, work: async () => {
    await kernel.execute(sql`INSERT INTO child VALUES (6, 10), (7, 20)`);
  } })).rejects.toBe(violation);
  expect(onViolation).toHaveBeenCalledTimes(1);
  expect(onViolation).toHaveBeenCalledWith({ violation: { table: "child", rowid: 7, parent: "parent", fkid: 0 } });
  expect(await saved()).toEqual([{ id: 3, parent_id: 10 }]);
});

test("SQLite native catalog and transaction operations reject a Postgres kernel before any SQL or work", async () => {
  const kernel = openPgliteKernel<unknown>({ PGlite });
  onTestFinished(() => kernel.close());
  const work = vi.fn(async () => "should not run");
  const onViolation = vi.fn(() => new Error("should not run"));
  for (const [operation, call] of [
    ["sqliteTableInfo", () => sqliteTableInfo({ kernel, table: "unused" })],
    ["sqliteTableExtendedInfo", () => sqliteTableExtendedInfo({ kernel, table: "unused" })],
    ["sqliteSchemaObjects", () => sqliteSchemaObjects({ kernel })],
    ["sqliteForeignKeyCheckedTransaction", () => sqliteForeignKeyCheckedTransaction({ kernel, work, onViolation })],
  ] as const) {
    await expect(call()).rejects.toThrow(`${operation} is SQLite-only; this kernel is postgres`);
  }
  expect(work.mock.calls).toEqual([]);
  expect(onViolation.mock.calls).toEqual([]);
});
