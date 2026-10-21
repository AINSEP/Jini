import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll as after, test } from "vitest";

import Database from "better-sqlite3";
import { sql } from "kysely";
import { PGlite } from "@electric-sql/pglite";

import { databaseFile, readSchemaShape, renderDatabaseTypes } from "../kernel/index.js";
import { openPgliteKernel } from "../kernel/pglite/index.js";
import { openSqliteFileKernel, sqliteKernel } from "../kernel/sqlite/index.js";
import { openSqlite } from "./helpers.js";

/**
 * @file Reading a Postgres-family database back as text: `renderDatabaseTypes` (the generated Kysely
 * interface) and `readSchemaShape`'s Postgres branch, both on an in-process PGlite reference
 * database; plus `databaseFile` on each kind of kernel.
 */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jini-db-typegen-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("renderDatabaseTypes maps every supported column type, nullability and generation", async () => {
  const kernel = openPgliteKernel<unknown>({ PGlite });
  try {
    await kernel.execute(sql`CREATE TABLE user_profile (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      handle character varying(40) NOT NULL,
      code character(2),
      bio text,
      age smallint NOT NULL DEFAULT 0,
      score integer,
      ratio real,
      precise double precision,
      amount numeric,
      prefs json,
      doc jsonb NOT NULL DEFAULT '{}',
      avatar bytea,
      active boolean NOT NULL,
      verified boolean NOT NULL DEFAULT false,
      banned boolean
    )`);
    await kernel.execute(sql`CREATE TABLE audit (at text NOT NULL)`);
    const source = await renderDatabaseTypes(kernel, { interfaceName: "AppDatabase", source: "a test PGlite", regenerate: "pnpm gen" });
    assert.equal(
      source,
      [
        "/**",
        " * @file GENERATED — do not edit. Kysely types for AppDatabase, read from a test PGlite",
        " * by `platform/db/kernel/typegen.ts`. Regenerate: pnpm gen",
        " */",
        'import type { ColumnType, Generated, SqlBool } from "kysely";',
        "",
        "/** A boolean column: reads `true`/`false` (Postgres) or `1`/`0` (SQLite); convert with `toBool`. */",
        "export type Bool = ColumnType<SqlBool, boolean, boolean>;",
        "export type GeneratedBool = ColumnType<SqlBool, boolean | undefined, boolean>;",
        "export type NullableBool = ColumnType<SqlBool | null, boolean | null | undefined, boolean | null>;",
        "",
        "export interface AppDatabase {",
        "  audit: AuditTable;",
        "  user_profile: UserProfileTable;",
        "}",
        "",
        "export interface AuditTable {",
        "  at: string;",
        "}",
        "",
        "export interface UserProfileTable {",
        "  id: Generated<number>;",
        "  handle: string;",
        "  code: string | null;",
        "  bio: string | null;",
        "  age: Generated<number>;",
        "  score: number | null;",
        "  ratio: number | null;",
        "  precise: number | null;",
        "  amount: number | null;",
        "  prefs: string | null;",
        "  doc: Generated<string>;",
        "  avatar: Uint8Array | null;",
        "  active: Bool;",
        "  verified: GeneratedBool;",
        "  banned: NullableBool;",
        "}",
        "",
      ].join("\n")
    );

    await kernel.execute(sql`CREATE TABLE stamped (at timestamptz)`);
    await assert.rejects(
      renderDatabaseTypes(kernel, { interfaceName: "AppDatabase", source: "x", regenerate: "y" }),
      new Error("typegen: no TypeScript type for stamped.at (timestamp with time zone)")
    );
  } finally {
    await kernel.close();
  }
});

test("renderDatabaseTypes refuses a SQLite kernel: types are read from a Postgres reference", async () => {
  const kernel = sqliteKernel<unknown>(new Database(":memory:"));
  await assert.rejects(
    renderDatabaseTypes(kernel, { interfaceName: "AppDatabase", source: "x", regenerate: "y" }),
    new Error("typegen reads a Postgres reference database")
  );
});

test("readSchemaShape on Postgres: columns, indexes, constraints and views of the current schema", async () => {
  const kernel = openPgliteKernel<unknown>({ PGlite });
  try {
    await kernel.execute(sql`CREATE TABLE parent (id text PRIMARY KEY, n integer NOT NULL DEFAULT 1 CHECK (n > 0))`);
    await kernel.execute(sql`CREATE TABLE child (id text PRIMARY KEY, parent_id text REFERENCES parent(id) ON DELETE CASCADE, note text)`);
    await kernel.execute(sql`CREATE INDEX child_note ON child (note) WHERE note IS NOT NULL`);
    await kernel.execute(sql`CREATE VIEW parent_ids AS SELECT id FROM parent`);
    await kernel.execute(sql`CREATE SCHEMA other`);
    await kernel.execute(sql`CREATE TABLE other.ignored (id text)`);

    const shape = await readSchemaShape(kernel);
    // PGlite runs Postgres 18, which catalogs each NOT NULL as a named constraint.
    assert.deepEqual(shape, {
      tables: {
        child: {
          columns: ["id text NOT NULL", "parent_id text", "note text"],
          indexes: [
            "child_note CREATE INDEX child_note ON child USING btree (note) WHERE (note IS NOT NULL)",
            "child_pkey CREATE UNIQUE INDEX child_pkey ON child USING btree (id)",
          ],
          constraints: [
            "child_id_not_null NOT NULL id",
            "child_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES parent(id) ON DELETE CASCADE", "child_pkey PRIMARY KEY (id)"],
        },
        parent: {
          columns: ["id text NOT NULL", "n integer NOT NULL DEFAULT 1"],
          indexes: ["parent_pkey CREATE UNIQUE INDEX parent_pkey ON parent USING btree (id)"],
          constraints: ["parent_id_not_null NOT NULL id", "parent_n_check CHECK ((n > 0))", "parent_n_not_null NOT NULL n", "parent_pkey PRIMARY KEY (id)"],
        },
      },
      others: ["view parent_ids: SELECT id FROM parent;"],
    });
    assert.deepEqual(Object.keys((await readSchemaShape(kernel, { exclude: ["child"] })).tables), ["parent"]);
  } finally {
    await kernel.close();
  }
});

test("readSchemaShape on SQLite keeps an implicit-key foreign key's empty target column", async () => {
  const kernel = sqliteKernel<unknown>(new Database(":memory:"));
  await kernel.execute(sql`CREATE TABLE parent (id text PRIMARY KEY)`);
  // `REFERENCES parent` with no column: SQLite records the target column as NULL (the parent's key).
  await kernel.execute(sql`CREATE TABLE child (id text PRIMARY KEY, parent_id text REFERENCES parent)`);
  const shape = await readSchemaShape(kernel);
  assert.deepEqual(shape.tables.child?.constraints, [
    "DEFINITION CREATE TABLE child (id text PRIMARY KEY, parent_id text REFERENCES parent)",
    "FOREIGN KEY (parent_id) REFERENCES parent () ON DELETE NO ACTION ON UPDATE NO ACTION",
  ]);
});

test("databaseFile names a SQLite file kernel's main file, and null for in-memory or Postgres", async () => {
  const file = path.join(tmp, "main.db");
  const onFile = openSqliteFileKernel<unknown>({ filePath: file, open: openSqlite });
  const inMemory = sqliteKernel<unknown>(new Database(":memory:"));
  const postgres = openPgliteKernel<unknown>({ PGlite });
  try {
    assert.equal(await databaseFile(onFile), fs.realpathSync(file));
    assert.equal(await databaseFile(inMemory), null);
    assert.equal(await databaseFile(postgres), null);
  } finally {
    await onFile.close();
    await postgres.close();
  }
});
