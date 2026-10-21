import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll as after, describe, test } from "vitest";

import { PGlite } from "@electric-sql/pglite";
import { sql } from "kysely";

import { listTables, type StorageKernel } from "../../kernel/index.js";
import { openPgliteKernel } from "../../kernel/pglite/index.js";
import { openMemorySqliteKernel, openSqliteFileKernel } from "../../kernel/sqlite/index.js";
import { hasLedger, MigrationChecksumError, type MigrationStep, runMigrations } from "../../migrate/index.js";
import { LEDGER, openSqlite } from "../helpers.js";

/**
 * @file Where the runner puts things, and when: the pre-change backup (taken once, only when a step
 * is pending, the database holds tables and the driver can copy), the ledger's Postgres schema (one
 * runner, several histories), and a step another process recorded between this run's ledger read
 * and its own transaction (applied exactly once).
 */

const sum = (char: string) => char.repeat(64);

function tableStep(id: string, table: string, checksum = sum("a")): MigrationStep {
  return {
    id,
    checksum,
    up: async (kernel) => {
      await kernel.execute(sql`CREATE TABLE ${sql.table(table)} (id text PRIMARY KEY)`);
    },
  };
}

const kernels: Array<StorageKernel<unknown>> = [];
const dirs: string[] = [];
after(async () => {
  for (const kernel of kernels) await kernel.close();
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

function track<K extends StorageKernel<unknown>>(kernel: K): K {
  kernels.push(kernel);
  return kernel;
}

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jini-runner-"));
  dirs.push(dir);
  return dir;
}

const sqliteMemory = () => track(openMemorySqliteKernel<unknown>({ open: openSqlite }));
const pglite = () => track(openPgliteKernel<unknown>({ PGlite }));

/** Tables in a SQLite file, read through its own short-lived connection. */
function tablesInFile(filePath: string): string[] {
  const db = openSqlite(filePath, { readonly: true, fileMustExist: true });
  try {
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>;
    return rows.map((row) => row.name);
  } finally {
    db.close();
  }
}

describe("the pre-change backup", () => {
  test("copies a database holding tables once, before the first pending step, into a folder it creates", async () => {
    const kernel = sqliteMemory();
    await kernel.execute(sql`CREATE TABLE existing_t (id text)`);
    const backupPath = path.join(tempDir(), "nested", "deeper", "before.db");
    const steps = [tableStep("0001_first", "first_t"), tableStep("0002_second", "second_t")];

    const report = await runMigrations(kernel, steps, { ledgerTable: LEDGER, backupPath });

    assert.deepEqual(report, {
      applied: ["0001_first", "0002_second"],
      alreadyApplied: [],
      notes: [`backed up the database to ${backupPath} before migrating it`],
    });
    // The copy is the database exactly as it was: no step's table, and no trace of the runner.
    assert.deepEqual(tablesInFile(backupPath), ["existing_t"]);
  });

  test("passes the backup path to each step's context, even when no copy is taken", async () => {
    const kernel = sqliteMemory();
    const backupPath = path.join(tempDir(), "unused", "before.db");
    const seen: Array<string | undefined> = [];
    const step: MigrationStep = {
      id: "0001_first",
      checksum: sum("a"),
      prepare: async (_kernel, context) => {
        seen.push(context.backupPath);
      },
      up: async (_kernel, context) => {
        seen.push(context.backupPath);
      },
    };

    const report = await runMigrations(kernel, [step], { ledgerTable: LEDGER, backupPath });

    assert.deepEqual(seen, [backupPath, backupPath]);
    // An empty database has nothing to copy: no note, and no folder left behind.
    assert.deepEqual(report.notes, []);
    assert.equal(fs.existsSync(path.dirname(backupPath)), false);
  });

  test("is not taken when nothing is pending", async () => {
    const kernel = sqliteMemory();
    const steps = [tableStep("0001_first", "first_t")];
    await runMigrations(kernel, steps, { ledgerTable: LEDGER });
    const backupPath = path.join(tempDir(), "rerun.db");

    const report = await runMigrations(kernel, steps, { ledgerTable: LEDGER, backupPath });

    assert.deepEqual(report, { applied: [], alreadyApplied: ["0001_first"], notes: [] });
    assert.equal(fs.existsSync(backupPath), false);
  });

  test("is skipped for a driver that cannot copy (no `backup` capability)", async () => {
    const real = sqliteMemory();
    await real.execute(sql`CREATE TABLE existing_t (id text)`);
    let copies = 0;
    const noBackup: StorageKernel<unknown> = {
      ...real,
      capabilities: { ...real.capabilities, backup: false },
      backupTo: async () => {
        copies += 1;
      },
    };
    const backupPath = path.join(tempDir(), "never", "before.db");

    const report = await runMigrations(noBackup, [tableStep("0001_first", "first_t")], { ledgerTable: LEDGER, backupPath });

    assert.deepEqual(report, { applied: ["0001_first"], alreadyApplied: [], notes: [] });
    assert.equal(copies, 0);
    assert.equal(fs.existsSync(path.dirname(backupPath)), false);
  });

  test("works for a file-backed database too, and the source keeps serving afterwards", async () => {
    const dir = tempDir();
    const kernel = track(openSqliteFileKernel<unknown>({ filePath: path.join(dir, "live.db"), open: openSqlite }));
    await kernel.execute(sql`CREATE TABLE existing_t (id text)`);
    const backupPath = path.join(dir, "backups", "before.db");

    await runMigrations(kernel, [tableStep("0001_first", "first_t")], { ledgerTable: LEDGER, backupPath });

    assert.deepEqual(tablesInFile(backupPath), ["existing_t"]);
    assert.deepEqual((await listTables(kernel)).sort(), [LEDGER, "existing_t", "first_t"]);
  });
});

describe("the ledger's Postgres schema", () => {
  test("is refused on a dialect other than Postgres, before anything is read or applied", async () => {
    const kernel = sqliteMemory();
    await assert.rejects(
      runMigrations(kernel, [tableStep("0001_first", "first_t")], { ledgerTable: LEDGER, schema: "history_a" }),
      (error: unknown) => error instanceof Error && error.message === "a migration ledger schema ('history_a') needs Postgres, not sqlite"
    );
    assert.deepEqual(await listTables(kernel), []);
  });

  test("holds the ledger in the named schema, created with it, and a rerun reads it from there", async () => {
    const kernel = pglite();
    const steps = [tableStep("0001_first", "first_t")];

    assert.deepEqual(await runMigrations(kernel, steps, { ledgerTable: LEDGER, schema: "history_a" }), {
      applied: ["0001_first"],
      alreadyApplied: [],
      notes: [],
    });

    const recorded = await kernel.query<{ id: string; checksum: string }>(sql`SELECT id, checksum FROM history_a.app_migrations`);
    assert.deepEqual(recorded, [{ id: "0001_first", checksum: sum("a") }]);
    assert.equal(await hasLedger(kernel, LEDGER), false, "no ledger in the default schema");
    assert.deepEqual(await runMigrations(kernel, steps, { ledgerTable: LEDGER, schema: "history_a" }), {
      applied: [],
      alreadyApplied: ["0001_first"],
      notes: [],
    });
  });

  test("keeps two histories with the same ledger name apart, one per schema", async () => {
    const kernel = pglite();
    await runMigrations(kernel, [tableStep("0001_alpha", "alpha_t")], { ledgerTable: LEDGER, schema: "history_a" });

    // Same ledger name, other schema: history_a's record is not visible, and its id is not "unknown".
    const report = await runMigrations(kernel, [tableStep("0001_beta", "beta_t")], { ledgerTable: LEDGER, schema: "history_b" });

    assert.deepEqual(report.applied, ["0001_beta"]);
    assert.deepEqual(await kernel.query(sql`SELECT id FROM history_a.app_migrations`), [{ id: "0001_alpha" }]);
    assert.deepEqual(await kernel.query(sql`SELECT id FROM history_b.app_migrations`), [{ id: "0001_beta" }]);
  });
});

const dialects = [
  { name: "sqlite", open: sqliteMemory },
  { name: "pglite", open: pglite },
];

/** A promise every caller of `arrive()` waits on until `count` callers have arrived. */
function barrier(count: number): () => Promise<void> {
  let arrived = 0;
  let release: () => void = () => {};
  const all = new Promise<void>((resolve) => {
    release = resolve;
  });
  return async () => {
    arrived += 1;
    if (arrived === count) release();
    await all;
  };
}

for (const { name, open } of dialects) {
  describe(`two runs racing on ${name}`, () => {
    test("apply a step another run recorded after this one read the ledger exactly once", async () => {
      const kernel = open();
      const arrive = barrier(2);
      let ups = 0;
      const step: MigrationStep = {
        id: "0001_once",
        checksum: sum("a"),
        // Both runs have read an empty ledger by the time either reaches its transaction.
        prepare: arrive,
        up: async (k) => {
          ups += 1;
          await k.execute(sql`CREATE TABLE once_t (id text)`);
        },
      };

      const reports = await Promise.all([
        runMigrations(kernel, [step], { ledgerTable: LEDGER }),
        runMigrations(kernel, [step], { ledgerTable: LEDGER }),
      ]);

      assert.equal(ups, 1);
      assert.deepEqual(reports.map((report) => report.applied).flat(), ["0001_once"]);
      assert.deepEqual(reports.map((report) => report.alreadyApplied).flat(), ["0001_once"]);
      assert.deepEqual(await kernel.query(sql`SELECT id FROM app_migrations`), [{ id: "0001_once" }]);
    });

    test("a run whose step was recorded concurrently with another checksum fails without applying it", async () => {
      const kernel = open();
      const arrive = barrier(2);
      const variant = (checksum: string): MigrationStep => ({ ...tableStep("0001_raced", "raced_t", checksum), prepare: arrive });

      const outcomes = await Promise.allSettled([
        runMigrations(kernel, [variant(sum("a"))], { ledgerTable: LEDGER }),
        runMigrations(kernel, [variant(sum("b"))], { ledgerTable: LEDGER }),
      ]);

      const won = outcomes.flatMap((outcome) => (outcome.status === "fulfilled" ? [outcome.value] : []));
      const lost = outcomes.flatMap((outcome) => (outcome.status === "rejected" ? [outcome.reason as unknown] : []));
      assert.equal(won.length, 1);
      assert.deepEqual(won[0]?.applied, ["0001_raced"]);
      assert.equal(lost.length, 1);
      const [recorded] = await kernel.query<{ checksum: string }>(sql`SELECT checksum FROM app_migrations`);
      const error = lost[0];
      assert.ok(error instanceof MigrationChecksumError);
      assert.equal(error.id, "0001_raced");
      assert.equal(error.recorded, recorded?.checksum);
      assert.notEqual(error.expected, error.recorded);
    });
  });
}
