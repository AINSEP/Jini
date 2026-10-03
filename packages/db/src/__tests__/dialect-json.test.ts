import assert from "node:assert/strict";
import { afterAll as after, describe, test } from "vitest";

import Database from "better-sqlite3";
import { type RawBuilder, sql } from "kysely";

import { jsonScalarEquals, jsonSortKey } from "../kernel/index.js";
import { openPgliteKernel } from "../kernel/pglite/index.js";
import { sqliteKernel } from "../kernel/sqlite/index.js";
import type { StorageKernel } from "../kernel/index.js";
import { PGlite } from "@electric-sql/pglite";

/**
 * @file `jsonScalarEquals` and `jsonSortKey` on EVERY embedded dialect by the same assertions:
 * equality on strings, numbers and booleans (a boolean never equals a number), numeric — not
 * lexical — ordering, and NULL (missing key) placement under `nullsFirst()`/`nullsLast()`.
 */

interface ProbeDb {
  json_probe: { id: string; doc: string };
}

interface Case {
  name: string;
  kernel: StorageKernel<ProbeDb>;
  create: RawBuilder<unknown>;
}

const cases: Case[] = [
  {
    name: "sqlite",
    kernel: sqliteKernel<ProbeDb>(new Database(":memory:")),
    create: sql`CREATE TABLE json_probe (id text PRIMARY KEY NOT NULL, doc text NOT NULL)`,
  },
  {
    name: "pglite",
    kernel: openPgliteKernel<ProbeDb>({ PGlite }),
    create: sql`CREATE TABLE json_probe (id text PRIMARY KEY NOT NULL, doc text NOT NULL)`,
  },
];

after(async () => {
  for (const each of cases) await each.kernel.close();
});

const DOCS: Record<string, unknown> = {
  a: { ext: { site: { chef: "Ada", n: 10, ok: true } } },
  b: { ext: { site: { chef: "Bo", n: 9, ok: false } } },
  c: { ext: { site: { chef: "Cy", n: 2, ok: true } } },
  d: { ext: { site: { chef: "Di" } } },
  e: { ext: { site: { chef: "1", n: 1 } } },
};
const PATH = (field: string) => ["ext", "site", field];

for (const each of cases) {
  describe(`json dialect helpers [${each.name}]`, () => {
    const { kernel } = each;

    test("setup", async () => {
      await kernel.execute(each.create);
      for (const [id, doc] of Object.entries(DOCS)) {
        await kernel.execute(sql`INSERT INTO json_probe (id, doc) VALUES (${id}, ${JSON.stringify(doc)})`);
      }
    });

    const matching = async (field: string, value: string | number | boolean): Promise<string[]> => {
      const rows = await kernel.run((db) =>
        db.selectFrom("json_probe").select("id").where(jsonScalarEquals(kernel.dialect, sql.ref("doc"), PATH(field), value)).orderBy("id").execute()
      );
      return rows.map((row) => row.id);
    };

    const sorted = async (field: string, dir: "asc" | "desc"): Promise<string[]> => {
      const key = jsonSortKey(kernel.dialect, sql.ref("doc"), PATH(field));
      const rows = await kernel.run((db) =>
        db
          .selectFrom("json_probe")
          .select("id")
          .orderBy(key, (ob) => (dir === "asc" ? ob.asc().nullsFirst() : ob.desc().nullsLast()))
          .orderBy("id")
          .execute()
      );
      return rows.map((row) => row.id);
    };

    test("jsonScalarEquals matches strings, numbers and booleans by value and type", async () => {
      assert.deepEqual(await matching("chef", "Ada"), ["a"]);
      assert.deepEqual(await matching("n", 9), ["b"]);
      assert.deepEqual(await matching("ok", true), ["a", "c"]);
      assert.deepEqual(await matching("ok", false), ["b"]);
    });

    test("jsonScalarEquals: a missing key matches nothing, a string does not match a number", async () => {
      assert.deepEqual(await matching("nope", "x"), []);
      assert.deepEqual(await matching("chef", 1), []);
      assert.deepEqual(await matching("n", "1"), []);
    });

    test("jsonScalarEquals binds the value: an apostrophe is data, not SQL", async () => {
      assert.deepEqual(await matching("chef", "O'Brien"), []);
    });

    test("jsonSortKey orders numbers numerically (2 < 9 < 10), NULLs first asc / last desc", async () => {
      assert.deepEqual(await sorted("n", "asc"), ["d", "e", "c", "b", "a"]);
      assert.deepEqual(await sorted("n", "desc"), ["a", "b", "c", "e", "d"]);
    });

    test("jsonSortKey orders booleans false before true, missing key first asc", async () => {
      assert.deepEqual(await sorted("ok", "asc"), ["d", "e", "b", "a", "c"]);
      assert.deepEqual(await sorted("ok", "desc"), ["a", "c", "b", "d", "e"]);
    });

    test("jsonSortKey orders strings", async () => {
      assert.deepEqual(await sorted("chef", "asc"), ["e", "a", "b", "c", "d"]);
    });

    test("both helpers refuse a path key that is not a plain identifier", () => {
      assert.throws(() => jsonScalarEquals(kernel.dialect, sql.ref("doc"), ["a'b"], 1), /not a plain identifier/);
      assert.throws(() => jsonSortKey(kernel.dialect, sql.ref("doc"), ["a b"]), /not a plain identifier/);
    });
  });
}
