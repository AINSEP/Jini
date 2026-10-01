import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll as after, test } from "vitest";

import Database from "better-sqlite3";
import { sql } from "kysely";

import { closeSqliteConnection, openSqliteFileKernel, sqliteKernel, sqliteOps } from "../sqlite/index.js";
import { openPgliteKernel, pgliteOps } from "../pglite/index.js";
import { startPgliteOwner } from "../pglite/index.js";
import { openPgliteSocketKernel, postgresOps } from "../postgres/index.js";
import { StorageOpError, StorageOpNotSupportedError } from "../kernel/index.js";
import type { StorageKernel } from "../kernel/index.js";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { LEDGER, LOCK_FILE, openSqlite, OWNER } from "./helpers.js";

/**
 * @file The storage ops (`sqliteOps`, `pgliteOps`, `postgresOps`) and the SQLite file helpers they lean on: a WAL-safe copy
 * from a read-only open, compact + seal + verify; PGlite in process and through its owner (a
 * data-dir dump restored into a new dir). Real Postgres: not covered here (needs a server).
 */

/** What a consumer passes `pgliteOps`: its PGlite class, its ledger, its owner lock file name. */
const PG_OPS = { PGlite, ledgerTable: LEDGER, ownerLockFileName: LOCK_FILE };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jini-db-kernel-ops-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function walSource(name: string): { file: string; writer: Database.Database } {
  const file = path.join(tmp, name);
  const writer = new Database(file);
  writer.pragma("journal_mode = WAL");
  writer.pragma("wal_autocheckpoint = 0"); // keep the committed rows in the -wal file
  writer.exec("CREATE TABLE t (id text); INSERT INTO t VALUES ('a'), ('b')");
  return { file, writer };
}

test("SQLite copyTo from a read-only open includes rows still in the WAL, and never writes the source", async () => {
  const { file, writer } = walSource("wal-source.db");
  const mainBytesBefore = fs.readFileSync(file);
  const source = openSqliteFileKernel<unknown>({ filePath: file, open: openSqlite }, { readOnly: true });
  try {
    await sqliteOps(source).copyTo(path.join(tmp, "wal-copy.db"));
    await assert.rejects(source.execute(sql`INSERT INTO t VALUES ('c')`), /readonly/);
  } finally {
    await source.close();
  }
  assert.deepEqual(fs.readFileSync(file), mainBytesBefore);
  writer.close();
  const copy = new Database(path.join(tmp, "wal-copy.db"), { readonly: true });
  assert.deepEqual(copy.prepare("SELECT id FROM t ORDER BY id").all(), [{ id: "a" }, { id: "b" }]);
  copy.close();
});

test("SQLite copyTo refuses an existing target with the driver's own error", async () => {
  const { file, writer } = walSource("exists-source.db");
  writer.close();
  const taken = new Database(path.join(tmp, "taken.db"));
  taken.exec("CREATE TABLE keep (id text)");
  taken.close();
  const source = openSqliteFileKernel<unknown>({ filePath: file, open: openSqlite }, { readOnly: true });
  try {
    await assert.rejects(sqliteOps(source).copyTo(path.join(tmp, "taken.db")), /output file already exists/);
  } finally {
    await source.close();
  }
});

test("SQLite compactAndVerify leaves a WAL-mode file with no sidecar content, and refuses inside a transaction", async () => {
  const file = path.join(tmp, "compact.db");
  const kernel = openSqliteFileKernel<unknown>({ filePath: file, open: openSqlite });
  try {
    await kernel.execute(sql`CREATE TABLE t (id text)`);
    await kernel.execute(sql`INSERT INTO t VALUES ('a')`);
    await kernel.execute(sql`DELETE FROM t`);
    await sqliteOps(kernel).compactAndVerify();
    const [mode] = await kernel.query<{ journal_mode: string }>(sql`PRAGMA journal_mode`);
    assert.equal(mode?.journal_mode, "wal");
    assert.equal(fs.existsSync(`${file}-wal`) ? fs.statSync(`${file}-wal`).size : 0, 0);
    await assert.rejects(
      kernel.transaction(async () => sqliteOps(kernel).compactAndVerify()),
      /must be called outside a transaction/
    );
  } finally {
    await kernel.close();
  }
});

test("sqliteOps works on the kernel of a Drizzle-style handle, and closeSqliteConnection closes it", async () => {
  const client = new Database(path.join(tmp, "handle.db"));
  const handle = { $client: client };
  await sqliteOps(sqliteKernel<unknown>(handle)).copyTo(path.join(tmp, "handle-copy.db"));
  assert.ok(fs.existsSync(path.join(tmp, "handle-copy.db")));
  closeSqliteConnection(handle);
  assert.equal(client.open, false);
});

test("openSqliteFileKernel readOnly requires the file to exist", () => {
  assert.throws(() => openSqliteFileKernel<unknown>({ filePath: path.join(tmp, "missing.db"), open: openSqlite }, { readOnly: true }), /unable to open/i);
});

async function seedPg(kernel: StorageKernel<unknown>, rows: number): Promise<void> {
  await kernel.execute(sql`CREATE TABLE app_migrations (id text PRIMARY KEY)`);
  await kernel.execute(sql`INSERT INTO app_migrations VALUES ('0000_test')`);
  await kernel.execute(sql`CREATE TABLE t (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, v text)`);
  await kernel.execute(sql`INSERT INTO t (v) SELECT 'row ' || g FROM generate_series(1, ${rows}) g`);
}

async function countT(dataDir: string): Promise<number> {
  const copy = openPgliteKernel<unknown>({ PGlite }, { dataDir });
  try {
    const [row] = await copy.query<{ n: number }>(sql`SELECT count(*)::int AS n FROM t`);
    return row?.n ?? -1;
  } finally {
    await copy.close();
  }
}

test("PGlite in process: copyTo restores the whole data dir into a new one; compactAndVerify reads the ledger back", async () => {
  const kernel = openPgliteKernel<unknown>({ PGlite }, { dataDir: path.join(tmp, "pglite-src") });
  const target = path.join(tmp, "pglite-copy");
  try {
    await seedPg(kernel, 250);
    await pgliteOps(kernel, PG_OPS).copyTo(target);
    await assert.rejects(pgliteOps(kernel, PG_OPS).copyTo(target), /already exists/);
    await pgliteOps(kernel, PG_OPS).compactAndVerify();
    await assert.rejects(
      kernel.transaction(async () => pgliteOps(kernel, PG_OPS).compactAndVerify()),
      /must be called outside a transaction/
    );
  } finally {
    await kernel.close();
  }
  assert.equal(await countT(target), 250);
  assert.equal(fs.existsSync(path.join(target, LOCK_FILE)), false);
});

test("PGlite compactAndVerify refuses an empty migration ledger", async () => {
  const kernel = openPgliteKernel<unknown>({ PGlite });
  try {
    await kernel.execute(sql`CREATE TABLE app_migrations (id text PRIMARY KEY)`);
    await assert.rejects(pgliteOps(kernel, PG_OPS).compactAndVerify(), (err: unknown) => {
      assert.ok(err instanceof StorageOpError);
      assert.equal(err.message, "the migration ledger app_migrations is empty after compacting");
      return true;
    });
  } finally {
    await kernel.close();
  }
});

test("PGlite socket client: copyTo goes through the owner's exclusive window, and is refused without it", async () => {
  const dataDir = path.join(tmp, "owned");
  const owner = await startPgliteOwner({ ...OWNER, dataDir }, { socketDir: fs.mkdtempSync(path.join(os.tmpdir(), "jini-db-ops-")) });
  const client = openPgliteSocketKernel<unknown>({ pg, socketPath: owner.socketPath });
  const target = path.join(tmp, "owned-copy");
  try {
    await seedPg(client, 30);
    await assert.rejects(postgresOps(client, { ledgerTable: LEDGER }).copyTo(path.join(tmp, "never")), (err: unknown) => {
      assert.ok(err instanceof StorageOpNotSupportedError);
      assert.equal(
        err.message,
        "storage op copyTo is not supported on the pglite-socket driver: a PGlite socket client copies through its owner's exclusive window (use pgliteOps with pgliteOwner)"
      );
      return true;
    });
    await postgresOps(client, { ledgerTable: LEDGER }).compactAndVerify(); // as a plain client: VACUUM + CHECKPOINT over the socket
    const ops = pgliteOps(client, PG_OPS, { pgliteOwner: owner });
    await ops.copyTo(target);
    await ops.compactAndVerify();
    // The owner still serves after its exclusive window.
    const [row] = await client.query<{ n: number }>(sql`SELECT count(*)::int AS n FROM t`);
    assert.equal(row?.n, 30);
  } finally {
    await client.close();
    await owner.close();
  }
  assert.equal(fs.existsSync(path.join(dataDir, LOCK_FILE)), false);
  assert.equal(await countT(target), 30);
  assert.equal(fs.existsSync(path.join(target, LOCK_FILE)), false);
});

test("each driver's ops refuse a kernel of another driver", async () => {
  const foreign = sqliteKernel<unknown>(new Database(":memory:"));
  assert.throws(() => sqliteOps({ ...foreign }), /^Error: sqliteOps: this SQLite kernel was not built by the sqlite driver$/);
  assert.throws(() => postgresOps(foreign, { ledgerTable: LEDGER }), /^Error: postgresOps: a better-sqlite3 kernel is not a node-postgres connection$/);
  assert.throws(() => pgliteOps(foreign, PG_OPS), /^Error: pgliteOps: a better-sqlite3 kernel is not PGlite in this process/);
});
