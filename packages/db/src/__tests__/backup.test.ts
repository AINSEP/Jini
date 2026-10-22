import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll as after, test } from "vitest";

import Database from "better-sqlite3";
import { sql } from "kysely";

import { openPgliteKernel } from "../kernel/pglite/index.js";
import { sqliteKernel } from "../kernel/sqlite/index.js";
import { PGlite } from "@electric-sql/pglite";

/**
 * @file `StorageKernel.backupTo`: a consistent copy of the whole database (SQLite: a normal SQLite
 * file; PGlite: a data-dir tarball), refused inside a transaction.
 */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jini-db-kernel-backup-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("SQLite backupTo writes a readable copy with the committed rows", async () => {
  const client = new Database(path.join(tmp, "source.db"));
  const kernel = sqliteKernel<unknown>(client);
  await kernel.execute(sql`CREATE TABLE t (id text)`);
  await kernel.execute(sql`INSERT INTO t VALUES ('a')`);
  await kernel.backupTo(path.join(tmp, "copy.db"));
  await assert.rejects(kernel.transaction(async () => kernel.backupTo(path.join(tmp, "never.db"))), /outside a transaction/);
  client.close();
  const copy = new Database(path.join(tmp, "copy.db"), { readonly: true });
  assert.deepEqual(copy.prepare("SELECT id FROM t").all(), [{ id: "a" }]);
  copy.close();
});

test("PGlite backupTo writes a data-dir dump", async () => {
  const kernel = openPgliteKernel<unknown>({ PGlite });
  try {
    await kernel.execute(sql`CREATE TABLE t (id text)`);
    await kernel.transaction(async () => {
      await kernel.execute(sql`INSERT INTO t VALUES ('first'), ('second')`);
    });
    await kernel.backupTo(path.join(tmp, "pglite.tar"));
    await assert.rejects(kernel.transaction(async () => kernel.backupTo(path.join(tmp, "never.tar"))), /outside a transaction/);
    assert.equal(fs.existsSync(path.join(tmp, "never.tar")), false);
    assert.ok(fs.statSync(path.join(tmp, "pglite.tar")).size > 1024);
    const restored = new PGlite({ loadDataDir: new Blob([fs.readFileSync(path.join(tmp, "pglite.tar"))]) });
    try {
      const result = await restored.query("SELECT id FROM t ORDER BY id");
      assert.deepEqual(result.rows, [{ id: "first" }, { id: "second" }]);
    } finally {
      await restored.close();
    }
  } finally {
    await kernel.close();
  }
});
