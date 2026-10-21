import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll as after, test } from "vitest";

import Database from "better-sqlite3";
import { sql } from "kysely";
import { PGlite, type PGliteOptions } from "@electric-sql/pglite";

import { StorageOpError } from "../kernel/index.js";
import { openPgliteKernel, pgliteOps } from "../kernel/pglite/index.js";
import { sqliteKernel, sqliteOps } from "../kernel/sqlite/index.js";
import { LEDGER } from "./helpers.js";

/**
 * @file The storage ops' refusals on real databases: a SQLite compaction whose final checkpoint is
 * held up by another reader, or whose integrity check fails, is a StorageOpError; a PGlite copy whose
 * restore fails removes the half-written target directory and rethrows.
 */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jini-db-ops-fail-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("SQLite compactAndVerify refuses when another connection's read keeps the final checkpoint busy", async () => {
  const file = path.join(tmp, "busy.db");
  // No busy wait: the checkpoint reports the reader at once instead of retrying for 5 s.
  const writer = new Database(file, { timeout: 0 });
  writer.pragma("journal_mode = WAL");
  writer.exec("CREATE TABLE t (id text); INSERT INTO t VALUES ('a')");
  const reader = new Database(file);
  reader.exec("BEGIN");
  reader.prepare("SELECT * FROM t").all(); // holds a read snapshot the checkpoint cannot pass
  try {
    await assert.rejects(sqliteOps(sqliteKernel<unknown>(writer)).compactAndVerify(), (err: unknown) => {
      assert.ok(err instanceof StorageOpError);
      assert.equal(err.message, `final WAL checkpoint on ${file} reported busy=1`);
      return true;
    });
  } finally {
    reader.exec("COMMIT");
    reader.close();
    writer.close();
  }
});

test("SQLite compactAndVerify refuses a database that fails integrity_check", async () => {
  const client = new Database(path.join(tmp, "check.db"));
  client.exec("CREATE TABLE t (n integer CHECK (n > 0))");
  // A row written while CHECK enforcement was off: the file now violates its own schema.
  client.pragma("ignore_check_constraints = ON");
  client.exec("INSERT INTO t VALUES (-1)");
  client.pragma("ignore_check_constraints = OFF");
  try {
    await assert.rejects(sqliteOps(sqliteKernel<unknown>(client)).compactAndVerify(), (err: unknown) => {
      assert.ok(err instanceof StorageOpError);
      assert.equal(err.message, `${client.name} failed integrity_check: {"integrity_check":"CHECK constraint failed in t"}`);
      return true;
    });
  } finally {
    client.close();
  }
});

/** The consumer's PGlite class, whose restore writes the data dir and then fails (a full disk, say). */
class RestoreFailsLate extends PGlite {
  // Both of PGlite.create's call shapes; pgliteOps calls the options one.
  static override async create(dataDirOrOptions?: string | PGliteOptions, options?: PGliteOptions): Promise<never> {
    const restored = typeof dataDirOrOptions === "string" ? await PGlite.create(dataDirOrOptions, options) : await PGlite.create(dataDirOrOptions);
    await restored.close();
    throw new Error("disk full while restoring");
  }
}

test("PGlite copyTo removes a partly restored target and rethrows the restore failure", async () => {
  const kernel = openPgliteKernel<unknown>({ PGlite });
  const target = path.join(tmp, "half-copy");
  try {
    await kernel.execute(sql`CREATE TABLE t (id text)`);
    await assert.rejects(pgliteOps(kernel, { PGlite: RestoreFailsLate, ledgerTable: LEDGER }).copyTo(target), /^Error: disk full while restoring$/);
    assert.equal(fs.existsSync(target), false);
  } finally {
    await kernel.close();
  }
});
