import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MigrationStep } from "@jini-ai/core/contracts/storage";

import { type KyselyKernel } from "../../kernel/index.js";
import { openPgliteKernel } from "../../kernel/pglite/index.js";
import { openMemorySqliteKernel } from "../../kernel/sqlite/index.js";
import { runMigrations } from "../../migrate/index.js";
import {
  ensureLegacyLedger, readLegacyLedger, validateLegacyMapping, type LegacyLedgerMapping,
} from "../../migrate/legacy-ledger.js";
import { pruneDatabaseCopies } from "../../sqlite/backup-policy.js";
import { SqliteDbOpsAdapter } from "../../sqlite/db-ops.js";
import { LEDGER, openSqlite } from "../helpers.js";

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "jini-gaps-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const step = (id: string, table: string): MigrationStep<KyselyKernel<unknown>> => ({
  id, checksum: "a".repeat(64),
  up: async (kernel) => { await kernel.execute(sql`CREATE TABLE ${sql.table(table)} (id text PRIMARY KEY)`); },
});

describe("runner backup callbacks", () => {
  async function withExistingTable() {
    const kernel = openMemorySqliteKernel<unknown>({ open: openSqlite });
    await kernel.execute(sql`CREATE TABLE existing_t (id text)`);
    return kernel;
  }

  it("invokes onBackupComplete with the backup path after a successful copy", async () => {
    const kernel = await withExistingTable();
    const backupPath = path.join(dir, "ok", "b.db");
    const done = vi.fn();
    const report = await runMigrations(kernel, [step("0001_a", "a_t")], { ledgerTable: LEDGER, backupPath, onBackupComplete: done });
    expect(report.applied).toEqual(["0001_a"]);
    expect(done).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledWith({ backupPath });
    await kernel.close();
  });

  it("routes a failed backup to onBackupError and still migrates (no completion callback, no note)", async () => {
    const kernel = await withExistingTable();
    const boom = new Error("disk gone");
    kernel.backupTo = async () => { throw boom; };
    const onBackupError = vi.fn();
    const onBackupComplete = vi.fn();
    const backupPath = path.join(dir, "fail", "b.db");
    const report = await runMigrations(kernel, [step("0001_a", "a_t")], { ledgerTable: LEDGER, backupPath, onBackupError, onBackupComplete });
    expect(onBackupError).toHaveBeenCalledTimes(1);
    expect(onBackupError).toHaveBeenCalledWith({ error: boom, backupPath });
    expect(onBackupComplete).not.toHaveBeenCalled();
    expect(report).toEqual({ applied: ["0001_a"], alreadyApplied: [], notes: [] });
    await kernel.close();
  });

  it("rethrows a failed backup when no onBackupError handler is given and applies nothing", async () => {
    const kernel = await withExistingTable();
    kernel.backupTo = async () => { throw new Error("disk gone"); };
    await expect(runMigrations(kernel, [step("0001_a", "a_t")], { ledgerTable: LEDGER, backupPath: path.join(dir, "x", "b.db") }))
      .rejects.toThrow("disk gone");
    await kernel.close();
  });

  it("exposes the optional callbacks to each step's context", async () => {
    const kernel = await withExistingTable();
    const onBackupError = () => {};
    const onBackupComplete = async () => {};
    const seen: object[] = [];
    const s: MigrationStep<KyselyKernel<unknown>> = {
      ...step("0001_a", "a_t"),
      prepare: async (_k, context) => { seen.push({ ...context, note: typeof context.note }); },
    };
    const backupPath = path.join(dir, "ctx", "b.db");
    await runMigrations(kernel, [s], { ledgerTable: LEDGER, backupPath, onBackupError, onBackupComplete });
    expect(seen).toEqual([{ note: "function", backupPath, onBackupError, onBackupComplete }]);
    await kernel.close();
  });
});

describe("legacy ledger", () => {
  const mapping = (identities: LegacyLedgerMapping["identities"]): LegacyLedgerMapping => ({
    columns: { version: "version", name: "name", checksum: "checksum", appliedAt: "applied_at" },
    identities,
  });
  const steps = [step("s1", "t1"), step("s2", "t2")];

  it("rejects an identity count that differs from the steps", () => {
    expect(() => validateLegacyMapping({ mapping: mapping({ s1: { version: 1, name: "a" }, s2: { version: 2, name: "b" }, extra: { version: 3, name: "c" } }), steps }))
      .toThrow("legacy identities must match the supplied steps");
  });

  it.each([
    [{ version: 0, name: "a" }, "legacy versions must be positive safe integers"],
    [{ version: 1.5, name: "a" }, "legacy versions must be positive safe integers"],
    [{ version: 1, name: "" }, "legacy names must be nonempty strings"],
    [{ version: 1, name: 5 as unknown as string }, "legacy names must be nonempty strings"],
  ])("rejects invalid identity %j", (identity, message) => {
    expect(() => validateLegacyMapping({ mapping: mapping({ s1: identity, s2: { version: 2, name: "b" } }), steps })).toThrow(message);
  });

  it("creates a bigint version column on Postgres and reads unmapped rows as legacy:<v>:<name>", async () => {
    const kernel = openPgliteKernel<unknown>({ PGlite });
    try {
      const m = mapping({ s1: { version: 1, name: "first" } });
      const ledger = { table: "legacy_hist", schema: undefined, lockKey: "k", mapping: m, run: <T>(fn: (db: never) => Promise<T>) => kernel.run(fn as never) as Promise<T> };
      await ensureLegacyLedger({ ledger: ledger as never, mapping: m, dialect: "postgres" });
      const cols = await kernel.query<{ data_type: string }>(sql`SELECT data_type FROM information_schema.columns WHERE table_name = 'legacy_hist' AND column_name = 'version'`);
      expect(cols).toEqual([{ data_type: "bigint" }]);
      await kernel.execute(sql`INSERT INTO legacy_hist (version, name, checksum) VALUES (1, 'first', 'c1'), (9, 'mystery', 'c9')`);
      const rows = await readLegacyLedger({ ledger: ledger as never, mapping: m });
      expect(rows.map((r) => ({ id: r.id, checksum: r.checksum }))).toEqual([
        { id: "s1", checksum: "c1" },
        { id: "legacy:9:mystery", checksum: "c9" },
      ]);
    } finally { await kernel.close(); }
  });
});

describe("pruneDatabaseCopies tie-break", () => {
  it("orders equal-timestamp copies by descending path so retention is deterministic", async () => {
    const copies = ["a", "b", "c", "d", "e", "f", "g"].map((n) => ({ filePath: path.join(dir, `${n}.db`), createdAt: 100 }));
    const removed: string[] = [];
    await pruneDatabaseCopies({ copies, justWritten: path.join(dir, "g.db") }, { remove: async (c) => { removed.push(path.basename(c.filePath)); } });
    // 5 retained: g f e d c (highest names first); a and b pruned
    expect(removed.sort()).toEqual(["a.db", "b.db"]);
  });
});

describe("SqliteDbOpsAdapter.captureRestorePoint", () => {
  it("surfaces a non-collision reservation error instead of retrying", async () => {
    const backup = vi.fn();
    const adapter = new SqliteDbOpsAdapter({ connection: { backup }, filePath: ":memory:", readWatermark: () => 0, now: () => 1 });
    const notADir = path.join(dir, "plain-file");
    fs.writeFileSync(notADir, "x");
    await expect(adapter.captureRestorePoint({ scopeId: "s" }, { directory: notADir })).rejects.toMatchObject({ code: "ENOTDIR" });
    expect(backup).not.toHaveBeenCalled();
  });
});
