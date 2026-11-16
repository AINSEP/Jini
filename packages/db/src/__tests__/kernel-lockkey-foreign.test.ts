import Database from "better-sqlite3";
import { expect, it } from "vitest";

import { sqliteKernel } from "../kernel/sqlite/index.js";

it("lockKey outside transaction() is refused, but joins a foreign BEGIN IMMEDIATE on the same connection", async () => {
  const db = new Database(":memory:");
  const kernel = sqliteKernel<unknown>(db);
  await expect(kernel.lockKey("k")).rejects.toThrow("lockKey() must be called inside transaction()");
  db.exec("BEGIN IMMEDIATE");
  try {
    await expect(kernel.lockKey("k")).resolves.toBeUndefined();
  } finally { db.exec("ROLLBACK"); }
  await kernel.close();
  db.close();
});
