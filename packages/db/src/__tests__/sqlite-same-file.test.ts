import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import Database from "better-sqlite3";
import { sql } from "kysely";

import { sqliteKernel } from "../sqlite/index.js";

/**
 * @file Several connections to ONE SQLite file in one process take turns through one lock.
 *
 * A kernel transaction yields to the event loop between `BEGIN IMMEDIATE` and `COMMIT` (its body is
 * async). If a second connection to the same file then ran its own `BEGIN IMMEDIATE`, better-sqlite3
 * would busy-wait on the file lock with the whole thread blocked, so the first transaction could
 * never commit: `SQLITE_BUSY` after `busy_timeout`. Sharing the turn lock per file makes the second
 * transaction wait in JavaScript instead.
 */

function openTwo() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "kernel-same-file-")), "db.sqlite");
  const a = new Database(file);
  a.pragma("journal_mode = WAL");
  a.pragma("busy_timeout = 200");
  a.exec("CREATE TABLE probe (v TEXT NOT NULL)");
  const b = new Database(file);
  b.pragma("busy_timeout = 200");
  return { a, b };
}

test("concurrent transactions on two connections to one file both commit", async () => {
  const { a, b } = openTwo();
  const insert = (v: string) => sql`INSERT INTO probe (v) VALUES (${v})`;
  const [ka, kb] = [sqliteKernel(a), sqliteKernel(b)];

  await Promise.all([
    ka.transaction(async () => {
      await ka.execute(insert("a"));
    }),
    kb.transaction(async () => {
      await kb.execute(insert("b"));
    }),
  ]);

  assert.deepEqual(
    (a.prepare("SELECT v FROM probe ORDER BY v").all() as { v: string }[]).map((row) => row.v),
    ["a", "b"]
  );
});

test("a transaction that reaches for a second connection to the same file fails fast instead of waiting on itself", async () => {
  const { a, b } = openTwo();
  const [ka, kb] = [sqliteKernel(a), sqliteKernel(b)];

  await assert.rejects(
    ka.transaction(() => kb.transaction(async () => {})),
    /another connection to the same database file/
  );
  await assert.rejects(
    ka.transaction(() => kb.run(() => undefined)),
    /another connection to the same database file/
  );
});
