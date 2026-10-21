import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll as after, describe, test } from "vitest";

import Database from "better-sqlite3";
import { sql } from "kysely";
import { PGlite } from "@electric-sql/pglite";

import {
  autoIdColumnSql,
  checkpointWal,
  columnTypeSql,
  isUniqueViolation,
  jsonText,
  listColumns,
  listIndexes,
  type StorageKernel,
} from "../kernel/index.js";
import { openPgliteKernel } from "../kernel/pglite/index.js";
import { sqliteKernel } from "../kernel/sqlite/index.js";

/**
 * @file The portable-DDL helpers (`columnTypeSql`, `autoIdColumnSql`), index introspection,
 * unique-violation detection and the WAL checkpoint, proven on both embedded drivers: a table
 * declared through the helpers reads back with the declared types and generated ids, and the
 * introspection sees exactly the indexes a `CREATE INDEX` declared.
 */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jini-db-kernel-ddl-"));

interface Case {
  name: "sqlite" | "pglite";
  kernel: StorageKernel<unknown>;
}

const cases: Case[] = [
  { name: "sqlite", kernel: sqliteKernel<unknown>(new Database(":memory:")) },
  { name: "pglite", kernel: openPgliteKernel<unknown>({ PGlite }) },
];

after(async () => {
  for (const each of cases) await each.kernel.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

for (const { name, kernel } of cases) {
  describe(`portable DDL and introspection [${name}]`, () => {
    const d = kernel.dialect;

    test("a table declared with columnTypeSql/autoIdColumnSql generates ids and reads back its declared types", async () => {
      await kernel.execute(
        sql.raw(
          `CREATE TABLE ddl_probe (id ${autoIdColumnSql(d)}, label ${columnTypeSql(d, "TEXT")} NOT NULL, ` +
            `n ${columnTypeSql(d, "INTEGER")}, r ${columnTypeSql(d, "REAL")}, b ${columnTypeSql(d, "BLOB")})`
        )
      );
      await kernel.execute(sql`INSERT INTO ddl_probe (label, n) VALUES ('a', ${Date.now()}), ('b', 2)`);
      const ids = await kernel.query<{ id: number | string }>(sql`SELECT id FROM ddl_probe ORDER BY id`);
      assert.deepEqual(ids.map((row) => Number(row.id)), [1, 2]);
      const columns = await listColumns(kernel, "ddl_probe");
      assert.deepEqual(
        columns.map((c) => [c.name, c.type, c.notNull, c.primaryKey]),
        [
          ["id", d === "sqlite" ? "integer" : "bigint", d !== "sqlite", true],
          ["label", columnTypeSql(d, "TEXT").toLowerCase(), true, false],
          ["n", columnTypeSql(d, "INTEGER").toLowerCase(), false, false],
          ["r", columnTypeSql(d, "REAL").toLowerCase(), false, false],
          ["b", columnTypeSql(d, "BLOB").toLowerCase(), false, false],
        ]
      );
    });

    test("listIndexes reports only CREATE INDEX indexes, with key order and uniqueness", async () => {
      await kernel.execute(sql`CREATE TABLE idx_probe (id text PRIMARY KEY, a text, b text, c text UNIQUE)`);
      await kernel.execute(sql`CREATE INDEX idx_probe_ba ON idx_probe (b, a)`);
      await kernel.execute(sql`CREATE UNIQUE INDEX idx_probe_a ON idx_probe (a)`);
      const indexes = await listIndexes(kernel, "idx_probe");
      assert.deepEqual(
        [...indexes.values()],
        [
          { name: "idx_probe_a", columns: ["a"], unique: true },
          { name: "idx_probe_ba", columns: ["b", "a"], unique: false },
        ]
      );
      assert.equal((await listIndexes(kernel, "no_such_table")).size, 0);
    });

    test("isUniqueViolation recognises this driver's own unique error and nothing else", async () => {
      await kernel.execute(sql`CREATE TABLE uniq_probe (id text PRIMARY KEY, must text NOT NULL)`);
      await kernel.execute(sql`INSERT INTO uniq_probe VALUES ('x', 'y')`);
      const duplicate = await kernel.execute(sql`INSERT INTO uniq_probe VALUES ('x', 'z')`).then(() => null, (err: unknown) => err);
      assert.ok(duplicate instanceof Error, "the duplicate insert must fail");
      assert.equal(isUniqueViolation(duplicate), true);
      const notNull = await kernel.execute(sql`INSERT INTO uniq_probe VALUES ('w', NULL)`).then(() => null, (err: unknown) => err);
      assert.ok(notNull instanceof Error, "the NULL insert must fail");
      assert.equal(isUniqueViolation(notNull), false);
    });
  });
}

test("isUniqueViolation: in-memory doubles with SQLite's wording count; non-errors never do", () => {
  assert.equal(isUniqueViolation(new Error("UNIQUE constraint failed: users.email")), true);
  assert.equal(isUniqueViolation(Object.assign(new Error("duplicate key"), { code: "23505" })), true);
  assert.equal(isUniqueViolation(Object.assign(new Error("dup"), { code: "SQLITE_CONSTRAINT_UNIQUE" })), true);
  assert.equal(isUniqueViolation({ code: "23505", message: "UNIQUE constraint failed" }), false);
  assert.equal(isUniqueViolation("UNIQUE constraint failed"), false);
  assert.equal(isUniqueViolation(new Error("some other failure")), false);
});

test("a JSON path must name at least one key", () => {
  assert.throws(() => jsonText("sqlite", sql.ref("doc"), []), /at least one key/);
  assert.throws(() => jsonText("postgres", sql.ref("doc"), []), /at least one key/);
});

test("checkpointWal on SQLite moves committed WAL frames into the main database file", async () => {
  const file = path.join(tmp, "checkpoint.db");
  const client = new Database(file);
  client.pragma("journal_mode = WAL");
  client.pragma("wal_autocheckpoint = 0");
  const kernel = sqliteKernel<unknown>(client);
  await kernel.execute(sql`CREATE TABLE t (id text)`);
  await kernel.execute(sql`INSERT INTO t VALUES ('a'), ('b')`);
  /** Copies the main file ALONE (no -wal) and reads it, so only checkpointed rows are visible. */
  const mainFileRows = (name: string): number | undefined => {
    const copy = path.join(tmp, name);
    fs.copyFileSync(file, copy);
    const reader = new Database(copy);
    try {
      const table = reader.prepare("SELECT name FROM sqlite_schema WHERE name = 't'").get();
      return table === undefined ? undefined : (reader.prepare("SELECT count(*) AS n FROM t").get() as { n: number }).n;
    } finally {
      reader.close();
    }
  };
  try {
    assert.equal(mainFileRows("before.db"), undefined, "nothing is in the main file before the checkpoint");
    await checkpointWal(kernel);
    assert.equal(mainFileRows("after.db"), 2);
  } finally {
    client.close();
  }
});

test("checkpointWal on Postgres-family kernels is a no-op, even inside a transaction", async () => {
  const kernel = openPgliteKernel<unknown>({ PGlite });
  try {
    await kernel.execute(sql`CREATE TABLE t (id text)`);
    await kernel.transaction(async () => {
      await kernel.execute(sql`INSERT INTO t VALUES ('a')`);
      await checkpointWal(kernel);
    });
    assert.deepEqual(await kernel.query(sql`SELECT id FROM t`), [{ id: "a" }]);
  } finally {
    await kernel.close();
  }
});
