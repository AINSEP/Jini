import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { sqliteKernel } from "@jini-ai/db/kernel/sqlite";
import { activateStore as createRuntime, SEED_PRODUCTS } from "../store-plugin.js";
/** Store runtime tests use a real kernel and fixed tables; CMS snapshot semantics stay in Tovu. */
function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "commerce-store-"));
  const dbPath = path.join(dir, "content.db");
  const db = new Database(dbPath);
  return { db, dbPath, dir };
}
async function activateStore({ db }: { db: Database.Database; dbPath: string }) {
  return createRuntime({ kernel: sqliteKernel<unknown>(db), prepareStorage: async () => {
    db.exec("CREATE TABLE IF NOT EXISTS p_store__products (id TEXT PRIMARY KEY, title TEXT NOT NULL, price INTEGER NOT NULL, stock INTEGER NOT NULL, version INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS p_store__orders (id TEXT PRIMARY KEY, product_id TEXT NOT NULL, qty INTEGER NOT NULL, total INTEGER NOT NULL, at INTEGER NOT NULL)");
  } });
}
test("store: activation is idempotent — a second boot does not double-seed", async () => {
  const { db, dbPath, dir } = tempDb();
  const store1 = await activateStore({ db, dbPath });
  assert.ok((await store1.checkout({ productId: "prod-candle", qty: 2 })).ok);
  db.prepare("UPDATE p_store__products SET title = ?, price = ? WHERE id = ?").run("Edited Candle", 1750, "prod-candle");
  const modified = await store1.listProducts();
  const store2 = await activateStore({ db, dbPath }); // simulate a restart
  assert.equal((await store2.listProducts()).length, SEED_PRODUCTS.length, "still one set of products");
  assert.deepEqual(await store2.listProducts(), modified, "purchased stock, OCC version, edited title and price survive reactivation");

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("store: checkout decrements stock (OCC) and records an order", async (t) => {
  const now = 1780000000123;
  t.mock.method(Date, "now", () => now);
  const { db, dbPath, dir } = tempDb();
  const store = await activateStore({ db, dbPath });

  const before = (await store.listProducts()).find((p) => p.id === "prod-candle")!;
  const result = await store.checkout({ productId: "prod-candle", qty: 2 });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.remainingStock, before.stock - 2);
    assert.ok(result.orderId.startsWith("ord-"));
    const order = db.prepare("SELECT * FROM p_store__orders WHERE id = ?").get(result.orderId);
    assert.deepEqual(order, { id: result.orderId, product_id: "prod-candle", qty: 2, total: 2400, at: now });
  }
  const after = (await store.listProducts()).find((p) => p.id === "prod-candle")!;
  assert.equal(after.stock, before.stock - 2, "stock decremented");
  assert.equal(after.version, before.version + 1, "OCC version bumped");
  assert.equal(
    (db.prepare(`SELECT COUNT(*) AS n FROM p_store__orders WHERE product_id = ?`).get("prod-candle") as { n: number }).n,
    1,
    "an order row was written"
  );

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("store: checkout refuses out-of-stock and unknown products (no order, no decrement)", async () => {
  const { db, dbPath, dir } = tempDb();
  const store = await activateStore({ db, dbPath });

  const tooMany = await store.checkout({ productId: "prod-candle", qty: 999 });
  assert.deepEqual(tooMany, { ok: false, reason: "out-of-stock", retries: 0 });

  const missing = await store.checkout({ productId: "nope", qty: 1 });
  assert.deepEqual(missing, { ok: false, reason: "not-found", retries: 0 });

  assert.equal(
    (db.prepare(`SELECT COUNT(*) AS n FROM p_store__orders`).get() as { n: number }).n,
    0,
    "no orders written for refused checkouts"
  );

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("store: invalid quantities are refused without stock, version, or order changes", async () => {
  const { db, dbPath, dir } = tempDb();
  try {
    const store = await activateStore({ db, dbPath });
    const before = await store.listProducts();
    for (const qty of [0, -1, 0.5, NaN, Infinity, -Infinity]) {
      const result = await store.checkout({ productId: "prod-candle", qty: qty });
      assert.deepEqual(result, { ok: false, reason: "invalid-quantity", retries: 0 }, `quantity ${qty} is refused`);
      assert.deepEqual(await store.listProducts(), before);
      assert.equal((db.prepare("SELECT COUNT(*) AS n FROM p_store__orders").get() as { n: number }).n, 0);
    }
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
