import assert from "node:assert/strict";
import { test } from "vitest";

import Database from "better-sqlite3";
import { Kysely, sql, SqliteDialect } from "kysely";
import { PGlite } from "@electric-sql/pglite";

import { buildKernel, UnsupportedCapabilityError } from "../kernel/index.js";
import { openPgliteKernel } from "../kernel/pglite/index.js";
import { sqliteKernel } from "../kernel/sqlite/index.js";

/**
 * @file Driver seams Kysely reaches on its own: the SQLite binding shim's `close` (a Kysely
 * `destroy()` must never close the consumer's connection), the PGlite dialect's introspector, and
 * the kernel core refusing a backup capability with no backup behind it.
 */

test("destroying the Kysely handle inside a SQLite run() leaves the consumer's connection open", async () => {
  const client = new Database(":memory:");
  const kernel = sqliteKernel<unknown>(client);
  await kernel.execute(sql`CREATE TABLE t (id text)`);
  await kernel.run((db) => db.destroy());
  assert.equal(client.open, true);
  assert.deepEqual(client.prepare("SELECT count(*) AS n FROM t").get(), { n: 0 });
  client.close();
});

test("Kysely introspection works through the PGlite dialect", async () => {
  const kernel = openPgliteKernel<{ probe: { id: string; n: number | null } }>({ PGlite });
  try {
    await kernel.execute(sql`CREATE TABLE probe (id text PRIMARY KEY, n integer)`);
    const tables = await kernel.run((db) => db.introspection.getTables());
    assert.deepEqual(
      tables.map((table) => ({ name: table.name, schema: table.schema, columns: table.columns.map((c) => [c.name, c.dataType, c.isNullable]) })),
      [{ name: "probe", schema: "public", columns: [["id", "text", false], ["n", "int4", true]] }]
    );
  } finally {
    await kernel.close();
  }
});

test("a driver that claims backup but supplies none is refused explicitly, never silently skipped", async () => {
  const base = new Kysely<unknown>({ dialect: new SqliteDialect({ database: new Database(":memory:") }) });
  const kernel = buildKernel<unknown>({
    dialect: "sqlite",
    transport: "better-sqlite3",
    capabilities: { interactiveTransactions: true, atomicBatch: true, transactionalDdl: true, backup: true },
    ready: Promise.resolve(),
    base,
    oneConnection: false,
    begin: (body) => base.transaction().execute((tx) => body(tx)),
    lockKey: async () => {},
    close: () => base.destroy(),
  });
  try {
    await assert.rejects(kernel.backupTo("/never/written.db"), (err: unknown) => {
      assert.ok(err instanceof UnsupportedCapabilityError);
      assert.equal(err.capability, "backup");
      assert.equal(err.transport, "better-sqlite3");
      return true;
    });
  } finally {
    await kernel.close();
  }
});
