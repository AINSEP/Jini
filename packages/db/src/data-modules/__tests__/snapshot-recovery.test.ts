import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { PGlite } from "@electric-sql/pglite";
import { expect, test, vi } from "vitest";

import { openPgliteKernel } from "../../kernel/pglite/index.js";
import { sqliteKernel } from "../../kernel/sqlite/index.js";
import {
  advanceJournalPhase, beginJournalEntry, checkDiskHeadroom, discardCommittedSnapshot,
  ensureMigrationJournal, findIncompleteJournalEntries, isInMemoryDbPath,
  recoverIncompleteDataModuleMigrations, restoreFromSnapshot, restoreSqliteSnapshots,
  snapshotDb, stageJournalPhase, type PluginCoreTables,
} from "../index.js";

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "jini-plugin-recovery-"));
  return { dir, clean: () => rmSync(dir, { recursive: true, force: true }) };
}

function readRows(file: string) {
  const reopened = new Database(file, { readonly: true, fileMustExist: true });
  try { return reopened.prepare("SELECT value FROM notes ORDER BY value").all(); }
  finally { reopened.close(); }
}

function writeDatabase(file: string, value: string) {
  const db = new Database(file);
  try {
    db.exec("CREATE TABLE notes (value TEXT)");
    db.prepare("INSERT INTO notes VALUES (?)").run(value);
  } finally { db.close(); }
}

test.each([":memory:", "", "file::memory:", "file::memory:?cache=shared", "file:shared?cache=shared&mode=memory"])(
  "does not measure disk headroom or take a backup for non-file path %j",
  async (dbPath) => {
    const db = new Database(":memory:");
    const store = sqliteKernel<PluginCoreTables>({ source: db });
    const backupTo = vi.fn(async (target: string) => { throw new Error(`unexpected backup to ${target}`); });
    try {
      expect(isInMemoryDbPath({ dbPath })).toBe(true);
      expect(checkDiskHeadroom({ dbPath })).toEqual({ ok: true, requiredBytes: 0, freeBytes: null });
      expect(await snapshotDb({ db: { ...store, backupTo }, dbPath, label: "notes" })).toBeNull();
      expect(backupTo.mock.calls).toEqual([]);
    } finally { db.close(); }
  },
);

test.each(["content.db", "file:content.db", "file:content.db?mode=ro", "file:content.db?other=memory"])(
  "keeps persistent SQLite path %j eligible for backup",
  (dbPath) => expect(isInMemoryDbPath({ dbPath })).toBe(false),
);

test("disk headroom rounds up the combined DB and WAL requirement and reports a measurement", () => {
  const { dir, clean } = scratch();
  try {
    const dbPath = join(dir, "content.db");
    writeFileSync(dbPath, "1234567");
    writeFileSync(dbPath + "-wal", "1234");
    const check = checkDiskHeadroom({ dbPath });
    expect(check.requiredBytes).toBe(17);
    expect(check.freeBytes).toEqual(expect.any(Number));
    expect(check.ok).toBe(Number(check.freeBytes) >= 17);
    expect(check.measurementFailed).toBeUndefined();
  } finally { clean(); }
});

test("a missing volume directory reports an unavailable measurement rather than an insufficiency", () => {
  const { dir, clean } = scratch();
  try {
    expect(checkDiskHeadroom({ dbPath: join(dir, "missing", "content.db") })).toEqual({
      ok: true, requiredBytes: 0, freeBytes: null, measurementFailed: true,
    });
  } finally { clean(); }
});

test("a live WAL snapshot captures committed data and discarding it leaves the live data intact", async () => {
  const { dir, clean } = scratch();
  const dbPath = join(dir, "content.db");
  const db = new Database(dbPath);
  const clock = vi.spyOn(Date, "now").mockReturnValue(1723456789000);
  try {
    db.pragma("journal_mode = WAL");
    db.pragma("wal_autocheckpoint = 0");
    db.exec("CREATE TABLE notes (value TEXT); INSERT INTO notes VALUES ('before DDL')");
    const snapshotPath = join(dir, "content.db.snapshot-notes-1723456789000");
    expect(await snapshotDb({ db: sqliteKernel({ source: db }), dbPath, label: "notes" })).toBe(snapshotPath);
    db.exec("INSERT INTO notes VALUES ('later')");
    expect(readRows(snapshotPath)).toEqual([{ value: "before DDL" }]);

    await discardCommittedSnapshot({ snapshotPath });
    await discardCommittedSnapshot({ snapshotPath });
    expect(existsSync(snapshotPath)).toBe(false);
    expect(db.prepare("SELECT value FROM notes ORDER BY value").all()).toEqual([{ value: "before DDL" }, { value: "later" }]);
  } finally { clock.mockRestore(); db.close(); clean(); }
});

test("snapshot cleanup tolerates an unlink error without deleting a directory or its contents", async () => {
  const { dir, clean } = scratch();
  try {
    const preserved = join(dir, "preserve.txt");
    writeFileSync(preserved, "not a snapshot");
    await expect(discardCommittedSnapshot({ snapshotPath: dir })).resolves.toBeUndefined();
    expect(existsSync(preserved)).toBe(true);
  } finally { clean(); }
});

test("a failed snapshot restore preserves the live database and existing sidecars", () => {
  const { dir, clean } = scratch();
  try {
    const dbPath = join(dir, "content.db");
    const snapshotPath = join(dir, "missing.snapshot");
    writeDatabase(dbPath, "live");
    writeFileSync(dbPath + "-wal", "keep WAL");
    writeFileSync(dbPath + "-shm", "keep SHM");
    expect(() => restoreFromSnapshot({ dbPath, snapshotPath })).toThrow(expect.objectContaining({ code: "ENOENT", path: snapshotPath }));
    expect(existsSync(dbPath + "-wal")).toBe(true);
    expect(existsSync(dbPath + "-shm")).toBe(true);
    rmSync(dbPath + "-wal");
    rmSync(dbPath + "-shm");
    expect(readRows(dbPath)).toEqual([{ value: "live" }]);
  } finally { clean(); }
});

test("journal begin and advance checkpoint the live file, while a staged terminal phase rolls back with DDL", async () => {
  const { dir, clean } = scratch();
  const dbPath = join(dir, "content.db");
  const db = new Database(dbPath);
  const store = sqliteKernel<PluginCoreTables>({ source: db });
  const clock = vi.spyOn(Date, "now").mockReturnValue(4100);
  const snapshotPath = join(dir, "before.snapshot");
  const readCheckpoint = () => {
    const copy = join(dir, "checkpoint.db");
    copyFileSync(dbPath, copy);
    const reopened = new Database(copy, { readonly: true, fileMustExist: true });
    try { return reopened.prepare("SELECT plugin_id, phase, snapshot_path, started_at, updated_at FROM _plugin_migration_journal").all(); }
    finally { reopened.close(); }
  };
  try {
    db.pragma("journal_mode = WAL");
    db.pragma("wal_autocheckpoint = 0");
    await ensureMigrationJournal({ store });
    const id = await beginJournalEntry({ db: store, pluginId: "notes", snapshotPath });
    expect(id).toBe(1);
    expect(readCheckpoint()).toEqual([{ plugin_id: "notes", phase: "PREPARED_SNAPSHOT", snapshot_path: snapshotPath, started_at: 4100, updated_at: 4100 }]);

    clock.mockReturnValue(5200);
    await advanceJournalPhase({ db: store, id, phase: "DDL_IN_PROGRESS" });
    expect(readCheckpoint()).toEqual([{ plugin_id: "notes", phase: "DDL_IN_PROGRESS", snapshot_path: snapshotPath, started_at: 4100, updated_at: 5200 }]);
    const rollback = new Error("rollback after staging completion");
    await expect(store.transaction(async () => {
      await stageJournalPhase({ db: store, id, phase: "COMMITTED" });
      const row = await store.run(tx => tx.selectFrom("_plugin_migration_journal").select("phase").where("id", "=", id).executeTakeFirstOrThrow());
      expect(row.phase).toBe("COMMITTED");
      throw rollback;
    })).rejects.toBe(rollback);
    expect(await findIncompleteJournalEntries({ store })).toEqual([
      { id: 1, pluginId: "notes", phase: "DDL_IN_PROGRESS", snapshotPath, startedAt: 4100, updatedAt: 5200 },
    ]);
  } finally { clock.mockRestore(); db.close(); clean(); }
});

test("SQLite boot unwinds only pending snapshots newest-first and removes stale sidecars", async () => {
  const { dir, clean } = scratch();
  const dbPath = join(dir, "content.db");
  const older = join(dir, "older.snapshot");
  const newer = join(dir, "newer.snapshot");
  const db = new Database(dbPath);
  const store = sqliteKernel<PluginCoreTables>({ source: db });
  const clock = vi.spyOn(Date, "now").mockReturnValue(8300);
  try {
    db.exec("CREATE TABLE notes (value TEXT); INSERT INTO notes VALUES ('after both migrations')");
    writeDatabase(older, "before either migration");
    writeDatabase(newer, "after the first migration");
    const unused = vi.fn(async () => { throw new Error("restore should not run"); });
    expect(await recoverIncompleteDataModuleMigrations({ store, restoreSnapshots: unused })).toEqual({ recovered: 0, entries: [] });
    await ensureMigrationJournal({ store });
    const first = await beginJournalEntry({ db: store, pluginId: "first", snapshotPath: older });
    const terminal = await beginJournalEntry({ db: store, pluginId: "done", snapshotPath: join(dir, "never-read") });
    await advanceJournalPhase({ db: store, id: terminal, phase: "COMMITTED" });
    const last = await beginJournalEntry({ db: store, pluginId: "last", snapshotPath: newer });
    await advanceJournalPhase({ db: store, id: last, phase: "VERIFYING" });
    const restoreSnapshots = vi.fn((entries: Parameters<typeof restoreSqliteSnapshots>[0]["entries"]) => {
      db.close();
      writeFileSync(dbPath + "-wal", "stale WAL");
      writeFileSync(dbPath + "-shm", "stale SHM");
      restoreSqliteSnapshots({ dbPath, entries });
    });
    expect(await recoverIncompleteDataModuleMigrations({ store, restoreSnapshots })).toEqual({
      recovered: 2, entries: [{ pluginId: "first", snapshotPath: older }, { pluginId: "last", snapshotPath: newer }],
    });
    expect(unused.mock.calls).toEqual([]);
    expect(restoreSnapshots.mock.calls).toEqual([[
      [{ id: first, pluginId: "first", phase: "PREPARED_SNAPSHOT", snapshotPath: older, startedAt: 8300, updatedAt: 8300 },
       { id: last, pluginId: "last", phase: "VERIFYING", snapshotPath: newer, startedAt: 8300, updatedAt: 8300 }],
    ]]);
    expect(existsSync(dbPath + "-wal")).toBe(false);
    expect(existsSync(dbPath + "-shm")).toBe(false);
    expect(readRows(dbPath)).toEqual([{ value: "before either migration" }]);
  } finally { clock.mockRestore(); if (db.open) db.close(); clean(); }
});

test("PGlite boot marks each pending attempt rolled back without filesystem restore and is idempotent", async () => {
  const store = openPgliteKernel<PluginCoreTables>({ PGlite });
  const restoreSnapshots = vi.fn(async () => { throw new Error("PGlite must not restore a SQLite file"); });
  try {
    await ensureMigrationJournal({ store });
    const first = await beginJournalEntry({ db: store, pluginId: "first", snapshotPath: "never-open-first" });
    const second = await beginJournalEntry({ db: store, pluginId: "second", snapshotPath: "never-open-second" });
    await advanceJournalPhase({ db: store, id: second, phase: "DDL_IN_PROGRESS" });
    expect(await recoverIncompleteDataModuleMigrations({ store, restoreSnapshots })).toEqual({
      recovered: 2, entries: [{ pluginId: "first", snapshotPath: "never-open-first" }, { pluginId: "second", snapshotPath: "never-open-second" }],
    });
    expect(await store.run(db => db.selectFrom("_plugin_migration_journal").select(["id", "phase"]).orderBy("id").execute()))
      .toEqual([{ id: first, phase: "ROLLED_BACK" }, { id: second, phase: "ROLLED_BACK" }]);
    expect(await recoverIncompleteDataModuleMigrations({ store, restoreSnapshots })).toEqual({ recovered: 0, entries: [] });
    expect(restoreSnapshots.mock.calls).toEqual([]);
  } finally { await store.close(); }
});
