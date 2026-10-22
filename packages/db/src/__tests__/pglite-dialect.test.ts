import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { CompiledQuery, Kysely, sql } from "kysely";
import { test } from "vitest";

import { PgliteDialect } from "../kernel/pglite/dialect.js";

// F2.6/F3.4: use the dialect directly, so the kernel's separate turn lock cannot hide a broken queue.
test("direct Kysely callers wait outside a rolled-back PGlite transaction", async () => {
  const client = new PGlite();
  const db = new Kysely<{ probe: { id: string; payload: string } }>({ dialect: new PgliteDialect(client) });
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  try {
    await sql`CREATE TABLE probe (id text PRIMARY KEY, payload text NOT NULL)`.execute(db);
    const failed = db.transaction().execute(async tx => {
      await tx.insertInto("probe").values({ id: "inside", payload: "rolled back" }).execute();
      enter();
      await held;
      throw new Error("rollback fixture");
    });
    const rejected = assert.rejects(failed, { message: "rollback fixture" });
    await entered;
    const outside = db.insertInto("probe").values({ id: "outside", payload: "O'Brien $1" }).execute();
    let outsideSettled = false;
    const observed = outside.then(result => { outsideSettled = true; return result; });
    // F7.1: drain queued work while the transaction is explicitly held, without a guessed sleep.
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(outsideSettled, false);
    release();
    await rejected;
    assert.equal((await observed)[0]!.numInsertedOrUpdatedRows, 1n);
    assert.deepEqual(await db.selectFrom("probe").selectAll().execute(), [{ id: "outside", payload: "O'Brien $1" }]);
  } finally {
    release?.();
    await db.destroy();
    await client.close();
  }
});

// F1.2/F6.2: dropping parameters, dropping zero affectedRows, or swallowing query errors must fail.
test("connection returns exact rows and affected counts, propagates errors, and refuses streaming", async () => {
  const client = new PGlite();
  const driver = new PgliteDialect(client).createDriver();
  try {
    await driver.init();
    const connection = await driver.acquireConnection();
    try {
      assert.deepEqual(await connection.executeQuery(CompiledQuery.raw("SELECT $1::text AS payload", ["quote ' and $2"])),
        { rows: [{ payload: "quote ' and $2" }], numAffectedRows: 0n });
      await connection.executeQuery(CompiledQuery.raw("CREATE TABLE counts (id integer PRIMARY KEY)"));
      assert.deepEqual(await connection.executeQuery(CompiledQuery.raw("INSERT INTO counts VALUES (7), (9)")),
        { rows: [], numAffectedRows: 2n });
      assert.deepEqual(await connection.executeQuery(CompiledQuery.raw("DELETE FROM counts WHERE id = $1", [42])),
        { rows: [], numAffectedRows: 0n });
      await assert.rejects(connection.executeQuery(CompiledQuery.raw("SELECT * FROM missing_table")), { code: "42P01" });
      assert.deepEqual((await connection.executeQuery(CompiledQuery.raw("SELECT id FROM counts ORDER BY id"))).rows,
        [{ id: 7 }, { id: 9 }]);
      await assert.rejects(connection.streamQuery(CompiledQuery.raw("SELECT 1"), 1).next(),
        { message: "streaming queries are not supported on PGlite" });
    } finally {
      await driver.releaseConnection(connection);
    }
    await driver.destroy();
    // destroy must leave the consumer-owned client open.
    assert.deepEqual((await client.query("SELECT 23 AS n")).rows, [{ n: 23 }]);
  } finally {
    await client.close();
  }
});

// F7.1: removing await previous lets later holders execute before the current release.
test("driver grants three connection holders in FIFO order and tolerates a second release", async () => {
  const client = new PGlite();
  const driver = new PgliteDialect(client).createDriver();
  try {
    await driver.init();
    const first = await driver.acquireConnection();
    const granted: string[] = ["first"];
    const second = driver.acquireConnection().then(connection => { granted.push("second"); return connection; });
    const third = driver.acquireConnection().then(connection => { granted.push("third"); return connection; });
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(granted, ["first"]);
    await driver.releaseConnection(first);
    const next = await second;
    assert.deepEqual(granted, ["first", "second"]);
    await driver.releaseConnection(next);
    const last = await third;
    assert.deepEqual(granted, ["first", "second", "third"]);
    await driver.releaseConnection(last);
    await driver.releaseConnection(last);
    const again = await driver.acquireConnection();
    assert.deepEqual((await again.executeQuery(CompiledQuery.raw("SELECT 31 AS n"))).rows, [{ n: 31 }]);
    await driver.releaseConnection(again);
  } finally {
    await client.close();
  }
});

// F2.5/F3.6: a strict transport exercises the optional affectedRows branch and mutable parameter API.
// The real PGlite tests above cover the engine; this one pins the adapter's outgoing request.
test("driver awaits readiness and copies query parameters when the transport omits an affected count", async () => {
  let ready!: () => void;
  const waitReady = new Promise<void>(resolve => { ready = resolve; });
  const client = {
    waitReady,
    async query(text: string, parameters: unknown[]) {
      assert.equal(text, "SELECT $1::integer AS n");
      assert.deepEqual(parameters, [17]);
      parameters[0] = 99;
      return { rows: [{ n: 17 }] };
    },
  } as unknown as PGlite;
  const driver = new PgliteDialect(client).createDriver();
  let initialized = false;
  const init = driver.init().then(() => { initialized = true; });
  try {
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(initialized, false);
  } finally {
    ready();
  }
  await init;
  assert.equal(initialized, true);
  const connection = await driver.acquireConnection();
  try {
    const compiled = CompiledQuery.raw("SELECT $1::integer AS n", [17]);
    assert.deepEqual(await connection.executeQuery(compiled), { rows: [{ n: 17 }] });
    assert.deepEqual(compiled.parameters, [17]);
  } finally {
    await driver.releaseConnection(connection);
  }
});

test("driver init propagates the transport readiness failure", async () => {
  const error = new Error("PGlite initialization failed");
  const client = { waitReady: Promise.reject(error) } as PGlite;
  const driver = new PgliteDialect(client).createDriver();
  await assert.rejects(driver.init(), actual => actual === error);
});
