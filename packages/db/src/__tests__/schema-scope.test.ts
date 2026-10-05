import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import Database from "better-sqlite3";
import { sql } from "kysely";
import { test } from "vitest";

import { openPgliteKernel } from "../kernel/pglite/driver.js";
import { scopeToSchema } from "../kernel/schema-scope.js";
import { openMemorySqliteKernel } from "../kernel/sqlite/index.js";

type Probe = { records: { id: string; payload: string } };

// F4.3: public and both schemas hold different values under the same key.
// Removing withSchema, using a constant schema, or SET search_path leaks the wrong row.
test("scoped builders isolate schemas while raw SQL, transactions, locks and close use the underlying kernel", async () => {
  const kernel = openPgliteKernel<Probe>({ PGlite });
  const one = scopeToSchema(kernel, "tenant_one");
  const two = scopeToSchema(kernel, "tenant_two");
  try {
    await kernel.execute(sql`CREATE SCHEMA tenant_one`);
    await kernel.execute(sql`CREATE SCHEMA tenant_two`);
    for (const name of ["public", "tenant_one", "tenant_two"]) {
      await kernel.execute(sql.raw(`CREATE TABLE ${name}.records (id text PRIMARY KEY, payload text NOT NULL)`));
    }
    await kernel.execute(sql`INSERT INTO public.records VALUES ('same', 'public value')`);
    await one.run(db => db.insertInto("records").values({ id: "same", payload: "one value" }).execute());
    await two.run(db => db.insertInto("records").values({ id: "same", payload: "two value" }).execute());
    const read = (scoped: typeof kernel) => scoped.run(db => db.selectFrom("records").selectAll().execute());
    assert.deepEqual(await read(one), [{ id: "same", payload: "one value" }]);
    assert.deepEqual(await read(two), [{ id: "same", payload: "two value" }]);
    assert.deepEqual(await read(kernel), [{ id: "same", payload: "public value" }]);
    assert.deepEqual(await one.query(sql`SELECT * FROM records`), [{ id: "same", payload: "public value" }]);
    await one.execute(sql`UPDATE public.records SET payload = 'raw update' WHERE id = 'same'`);
    assert.deepEqual(await read(kernel), [{ id: "same", payload: "raw update" }]);
    await assert.rejects(one.transaction(async () => {
      await one.lockKey("scope:one");
      assert.equal(one.inTransaction(), true);
      await one.run(db => db.updateTable("records").set({ payload: "discarded" }).where("id", "=", "same").execute());
      throw new Error("abort scoped write");
    }), { message: "abort scoped write" });
    assert.deepEqual(await read(one), [{ id: "same", payload: "one value" }]);
    await one.transaction(async () => {
      await one.run(db => db.updateTable("records").set({ payload: "committed" }).where("id", "=", "same").execute());
    });
    assert.deepEqual(await read(one), [{ id: "same", payload: "committed" }]);
    await assert.rejects(scopeToSchema(kernel, "missing_schema").run(db => db.selectFrom("records").selectAll().execute()),
      { code: "42P01" });
    for (const method of ["transaction", "lockKey", "query", "execute", "close", "backupTo", "require", "inTransaction"] as const) {
      assert.equal(one[method], kernel[method]);
    }
    assert.equal(one.ready, kernel.ready);
  } finally {
    await one.close();
  }
});

// F6.2: dropping the dialect guard would return a kernel that fails much later.
test("SQLite scope is rejected immediately with the requested schema and dialect", async () => {
  const kernel = openMemorySqliteKernel<Probe>({ open: (file, options) => new Database(file, options) });
  try {
    assert.throws(() => scopeToSchema(kernel, "tenant_one"),
      { message: "schema 'tenant_one' needs a Postgres kernel, not sqlite" });
    assert.deepEqual(await kernel.query(sql`SELECT 17 AS n`), [{ n: 17 }]);
  } finally {
    await kernel.close();
  }
});
