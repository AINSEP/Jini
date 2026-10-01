import assert from "node:assert/strict";
import { afterAll as after, beforeEach, describe, test } from "vitest";

import Database from "better-sqlite3";
import { Kysely, type RawBuilder, sql, SqliteDialect } from "kysely";

import { jsonSet, jsonText, listColumns, listTables, nowIso, tableExists, toBool, toBytes } from "../kernel/index.js";
import { openPgliteKernel } from "../pglite/index.js";
import { sqliteKernel } from "../sqlite/index.js";
import { buildKernel } from "../kernel/index.js";
import { type StorageKernel, UnsupportedCapabilityError } from "../kernel/index.js";
import { TurnLock } from "../kernel/index.js";
import { PGlite } from "@electric-sql/pglite";

/**
 * @file The storage kernel's rules, proven on EVERY embedded driver by the same assertions:
 * transactions commit/roll back, nested calls join, `transaction()` inside `run()` is refused, and —
 * the reason the turn lock exists — an unrelated caller's write never lands inside someone else's
 * open transaction on a shared connection. Plus one Kysely query body reading and writing the same
 * values on both (booleans, JSON text), and the dialect helpers agreeing. Real Postgres (two
 * connections) is `kernel.postgres.test.ts`.
 */

interface ProbeDb {
  kernel_probe: { id: string; doc: string | null; n: number | null; flag: boolean | 0 | 1 | null };
}

interface Case {
  name: string;
  kernel: StorageKernel<ProbeDb>;
  /** DDL for the probe table: `doc` is a JSON column and `flag` a boolean, in the dialect's own types. */
  create: RawBuilder<unknown>;
}

function probeCases(): Case[] {
  return [
    {
      name: "sqlite",
      kernel: sqliteKernel<ProbeDb>(new Database(":memory:")),
      create: sql`CREATE TABLE kernel_probe (id text PRIMARY KEY NOT NULL, doc text, n integer, flag integer)`,
    },
    {
      name: "pglite",
      kernel: openPgliteKernel<ProbeDb>({ PGlite }),
      create: sql`CREATE TABLE kernel_probe (id text PRIMARY KEY NOT NULL, doc jsonb, n integer, flag boolean)`,
    },
  ];
}

const cases = probeCases();

after(async () => {
  for (const each of cases) await each.kernel.close();
});

async function ids(kernel: StorageKernel<ProbeDb>): Promise<string[]> {
  const rows = await kernel.run((db) => db.selectFrom("kernel_probe").select("id").orderBy("id").execute());
  return rows.map((row) => row.id);
}

const insert = (kernel: StorageKernel<ProbeDb>, id: string) =>
  kernel.run((db) => db.insertInto("kernel_probe").values({ id, doc: null, n: null, flag: null }).execute());

/** A promise plus the function that resolves it. */
function gate(): { opened: Promise<void>; open: () => void } {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
}

for (const { name, kernel, create } of cases) {
  describe(`storage kernel [${name}]`, () => {
    beforeEach(async () => {
      await kernel.execute(sql`DROP TABLE IF EXISTS kernel_probe`);
      await kernel.execute(create);
    });

    test("a transaction commits on resolve and rolls back on throw", async () => {
      await kernel.transaction(async () => insert(kernel, "kept"));
      await assert.rejects(
        kernel.transaction(async () => {
          await insert(kernel, "dropped");
          throw new Error("boom");
        }),
        /boom/
      );
      assert.deepEqual(await ids(kernel), ["kept"]);
    });

    test("a nested transaction joins the outer one: an outer throw rolls back the inner write", async () => {
      await assert.rejects(
        kernel.transaction(async () => {
          await kernel.transaction(async () => insert(kernel, "inner"));
          assert.equal(kernel.inTransaction(), true);
          throw new Error("outer fails");
        }),
        /outer fails/
      );
      assert.deepEqual(await ids(kernel), []);
    });

    test("transaction() inside a run() body is refused, not deadlocked", async () => {
      await assert.rejects(
        kernel.run(() => kernel.transaction(async () => {})),
        { message: "transaction() was called inside a run() body; start the transaction first and call run() inside it" }
      );
    });

    test("an unrelated caller's write waits for an open transaction instead of landing inside it", async () => {
      const inside = gate();
      const release = gate();
      const tx = kernel.transaction(async () => {
        await insert(kernel, "in-tx");
        inside.open();
        await release.opened;
        throw new Error("roll back");
      });
      await inside.opened;
      // Another request, outside the transaction's async context, writes meanwhile.
      const outside = insert(kernel, "outside");
      release.open();
      await assert.rejects(tx, /roll back/);
      await outside;
      assert.deepEqual(await ids(kernel), ["outside"]);
    });

    test("lockKey works inside a transaction and is refused outside one", async () => {
      await kernel.transaction(async () => {
        await kernel.lockKey("probe:a");
        await insert(kernel, "locked");
      });
      assert.deepEqual(await ids(kernel), ["locked"]);
      await assert.rejects(kernel.lockKey("probe:a"), { message: "lockKey() must be called inside transaction()" });
    });

    test("one query body: booleans, JSON text and an ON CONFLICT upsert read back the same", async () => {
      const doc = JSON.stringify({ title: "Hi" });
      const upsert = (n: number, flag: boolean) =>
        kernel.run((db) =>
          db
            .insertInto("kernel_probe")
            .values({ id: "x", doc, n, flag })
            .onConflict((oc) => oc.column("id").doUpdateSet((eb) => ({ n: eb.ref("excluded.n"), flag: eb.ref("excluded.flag") })))
            .execute()
        );
      await upsert(1, true);
      await upsert(2, false);
      const [row] = await kernel.run((db) => db.selectFrom("kernel_probe").selectAll().where("flag", "=", false).execute());
      assert.equal(row?.n, 2);
      assert.equal(toBool(row!.flag), false);
      // JSON reads back as JSON text on both (Postgres normalises spacing, so compare parsed).
      assert.equal(typeof row?.doc, "string");
      assert.deepEqual(JSON.parse(row!.doc!), { title: "Hi" });
    });

    test("jsonText reads scalars with the same spelling on both dialects; jsonSet writes", async () => {
      const value = { s: "Hi", i: 42, t: true, f: false, z: null, meta: { lang: "en" } };
      await kernel.execute(sql`INSERT INTO kernel_probe (id, doc) VALUES ('a', ${JSON.stringify(value)})`);
      await kernel.execute(sql`INSERT INTO kernel_probe (id, doc) VALUES ('b', NULL)`);
      const doc = sql.ref("doc");
      await kernel.execute(sql`UPDATE kernel_probe SET doc = ${jsonSet(kernel.dialect, doc, ["meta", "lang"], "fr")} WHERE id = 'a'`);
      await kernel.execute(sql`UPDATE kernel_probe SET doc = ${jsonSet(kernel.dialect, doc, ["s"], "New")} WHERE id = 'b'`);
      const read = (...path: string[]) => jsonText(kernel.dialect, doc, path);
      const rows = await kernel.query<Record<string, string | null>>(
        sql`SELECT id, ${read("s")} AS s, ${read("i")} AS i, ${read("t")} AS t, ${read("f")} AS f,
                   ${read("z")} AS z, ${read("missing")} AS missing, ${read("meta", "lang")} AS lang
            FROM kernel_probe ORDER BY id`
      );
      assert.deepEqual(
        rows.map((row) => ({ ...row })),
        [
          { id: "a", s: "Hi", i: "42", t: "true", f: "false", z: null, missing: null, lang: "fr" },
          { id: "b", s: "New", i: null, t: null, f: null, z: null, missing: null, lang: null },
        ]
      );
      assert.throws(() => jsonText(kernel.dialect, doc, ["a'b"]), { message: "JSON path key 'a'b' is not a plain identifier" });
    });

    test("nowIso is Date#toISOString text", async () => {
      const [row] = await kernel.query<{ now: string }>(sql`SELECT ${nowIso(kernel.dialect)} AS now`);
      assert.match(row!.now, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
      assert.ok(Math.abs(Date.parse(row!.now) - Date.now()) < 60_000);
    });

    test("introspection lists tables and columns", async () => {
      assert.ok((await listTables(kernel as StorageKernel<unknown>)).includes("kernel_probe"));
      assert.equal(await tableExists(kernel as StorageKernel<unknown>, "kernel_probe"), true);
      assert.equal(await tableExists(kernel as StorageKernel<unknown>, "no_such_table"), false);
      const columns = await listColumns(kernel as StorageKernel<unknown>, "kernel_probe");
      assert.deepEqual(
        columns.map(({ name, notNull, primaryKey }) => ({ name, notNull, primaryKey })),
        [
          { name: "id", notNull: true, primaryKey: true },
          { name: "doc", notNull: false, primaryKey: false },
          { name: "n", notNull: false, primaryKey: false },
          { name: "flag", notNull: false, primaryKey: false },
        ]
      );
    });
  });
}

test("sqlite: one kernel per connection, and a legacy BEGIN IMMEDIATE is joined, not nested", async () => {
  // An ORM handle that carries its client as `$client` (Drizzle's shape) resolves to the same kernel.
  const db = { $client: new Database(":memory:") };
  const kernel = sqliteKernel<{ t: { id: string } }>(db);
  assert.equal(sqliteKernel(db), kernel);
  assert.equal(sqliteKernel(db.$client), kernel);
  await kernel.execute(sql`CREATE TABLE t (id text)`);
  db.$client.exec("BEGIN IMMEDIATE");
  await kernel.transaction(async () => {
    await kernel.lockKey("joined");
    await kernel.execute(sql`INSERT INTO t VALUES ('a')`);
  });
  db.$client.exec("ROLLBACK");
  assert.deepEqual(await kernel.query(sql`SELECT id FROM t`), []);
});

test("a missing capability is an explicit error, never a silent downgrade", async () => {
  const base = new Kysely<unknown>({ dialect: new SqliteDialect({ database: new Database(":memory:") }) });
  const kernel = buildKernel<unknown>({
    dialect: "sqlite",
    transport: "better-sqlite3",
    capabilities: { interactiveTransactions: false, atomicBatch: true, transactionalDdl: true, backup: false },
    ready: Promise.resolve(),
    base,
    oneConnection: true,
    begin: () => assert.fail("begin must not be reached"),
    lockKey: async () => {},
    close: () => base.destroy(),
  });
  await assert.rejects(kernel.transaction(async () => {}), (error: unknown) => {
    assert.ok(error instanceof UnsupportedCapabilityError);
    assert.equal(error.message, "the better-sqlite3 storage driver does not support interactiveTransactions");
    return true;
  });
  assert.throws(() => kernel.require("backup"), { message: "the better-sqlite3 storage driver does not support backup" });
  kernel.require("atomicBatch");
  await kernel.close();
});

test("toBool / toBytes accept each driver's shape and refuse anything else", () => {
  assert.deepEqual([toBool(true), toBool(1), toBool(false), toBool(0), toBool(null)], [true, true, false, false, null]);
  assert.deepEqual([...toBytes(Buffer.from([1, 2]))], [1, 2]);
  assert.deepEqual([...toBytes(new Uint8Array([3]))], [3]);
  assert.throws(() => toBytes("AQI="), { message: "expected a binary column value, got string" });
});

test("TurnLock: a queued transaction goes before later readers (FIFO, no starvation)", async () => {
  const lock = new TurnLock();
  const order: string[] = [];
  await lock.acquire("shared");
  const writer = lock.acquire("exclusive").then(() => order.push("writer"));
  const reader = lock.acquire("shared").then(() => order.push("reader"));
  lock.release("shared");
  await writer;
  assert.deepEqual(order, ["writer"]);
  lock.release("exclusive");
  await reader;
  assert.deepEqual(order, ["writer", "reader"]);
});
