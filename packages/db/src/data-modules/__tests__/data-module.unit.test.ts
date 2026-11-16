import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listColumns, listIndexes, listTables } from "../../kernel/index.js";
import { openPgliteKernel } from "../../kernel/pglite/index.js";
import { openMemorySqliteKernel, openSqliteFileKernel } from "../../kernel/sqlite/index.js";
import { checkDiskHeadroom } from "../disk-headroom.js";
import {
  type DataModuleDecl,
  declareDataModule,
} from "../data-module.js";
import {
  advanceJournalPhase, beginJournalEntry, ensureMigrationJournal, findIncompleteJournalEntries,
  isIncompletePhase, journalEntryOf, stageJournalPhase,
} from "../migration-journal.js";
import {
  recoverIncompleteDataModuleMigrations, restoreSqliteSnapshots,
} from "../migration-recovery.js";
import {
  checkNamespaceAdoption, ensurePluginIdentityTable, getPluginIdentity,
} from "../plugin-identity.js";
import { pluginKernel, type PluginCoreTables } from "../plugin-store.js";
import { restoreFromSnapshot } from "../restore.js";
import { discardCommittedSnapshot, isInMemoryDbPath, snapshotDb } from "../snapshot.js";

const open = (file: string, options?: object) => new Database(file, options);
const memKernel = () => openMemorySqliteKernel<PluginCoreTables>({ open });
const provenance = { sourceUrl: "builtin://x", publisher: "pub" };
const mk = (tables: DataModuleDecl["tables"], over: Partial<DataModuleDecl> = {}): DataModuleDecl => ({
  pluginId: "ex", pluginTier: "tier-2", provenance, tables, ...over,
});
const T = (name = "t", extra: object = {}) => ({
  name, columns: [{ name: "id", type: "TEXT" as const, primaryKey: true }], ...extra,
});

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dm-unit-")); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); vi.restoreAllMocks(); });

describe("declareDataModule validation", () => {
  const cases: Array<[string, DataModuleDecl, string]> = [
    ["BAD_PLUGIN_ID", mk([T()], { pluginId: "Bad-Id" }), "invalid pluginId: Bad-Id"],
    ["TIER1_NOT_ALLOWED", mk([T()], { pluginTier: "tier-1" }), "Tier-1 plugins cannot request it"],
    ["EMPTY", mk([]), "declaration lists no tables"],
    ["BAD_TABLE_NAME", mk([T("Bad")]), "invalid table name: Bad"],
    ["IDENTIFIER_TOO_LONG", mk([T("t".repeat(70))]), "exceeds PostgreSQL's 63-byte limit"],
    ["NO_COLUMNS", mk([{ name: "t", columns: [] }]), "table t declares no columns"],
    ["BAD_COLUMN", mk([{ name: "t", columns: [{ name: "Bad", type: "TEXT" }] }]), "invalid column name: Bad"],
    ["BAD_TYPE", mk([{ name: "t", columns: [{ name: "a", type: "JSON" as never }] }]), "unsupported column type for a: JSON"],
    ["BAD_INDEX_NAME", mk([T("t", { indexes: [{ name: "Bad", columns: ["id"] }] })]), "invalid index name: Bad"],
    ["IDENTIFIER_TOO_LONG", mk([T("t", { indexes: [{ name: "i".repeat(60), columns: ["id"] }] })]), "index iiii"],
    ["EMPTY_INDEX", mk([T("t", { indexes: [{ name: "i", columns: [] }] })]), "index i on table t declares no columns"],
    ["INDEX_UNKNOWN_COLUMN", mk([T("t", { indexes: [{ name: "i", columns: ["nope"] }] })]), "references undeclared column: nope"],
  ];
  it.each(cases)("fails closed with %s before any I/O", async (code, decl, fragment) => {
    const db = memKernel();
    const res = await declareDataModule({ db, dbPath: ":memory:", decl });
    expect(res).toMatchObject({ ok: false, created: [], altered: [], snapshotPath: null, error: { code } });
    expect(res.error?.message).toContain(fragment);
    expect(await listTables(db)).toEqual([]);
    await db.close();
  });
});

describe("declareDataModule reconciliation (in-memory)", () => {
  it("creates tables with indexes and is idempotent", async () => {
    const db = memKernel();
    const decl = mk([{
      name: "t",
      columns: [
        { name: "id", type: "TEXT", primaryKey: true },
        { name: "n", type: "INTEGER", notNull: true },
        { name: "r", type: "REAL" },
        { name: "b", type: "BLOB" },
      ],
      indexes: [{ name: "byn", columns: ["n", "r"], unique: true }, { name: "byr", columns: ["r"] }],
    }]);
    expect(await declareDataModule({ db, dbPath: ":memory:", decl })).toEqual({
      ok: true, created: ["p_ex__t"], altered: [], snapshotPath: null,
    });
    const idx = await listIndexes(db, "p_ex__t");
    expect(idx.get("idx_p_ex__t__byn")).toMatchObject({ unique: true, columns: ["n", "r"] });
    expect(idx.get("idx_p_ex__t__byr")).toMatchObject({ unique: false, columns: ["r"] });
    const ddl = await db.run((k) => k.selectFrom("_plugin_migrations").select(["table_name", "ddl"]).orderBy("id").execute());
    expect(ddl[0]).toEqual({
      table_name: "p_ex__t",
      ddl: 'CREATE TABLE "p_ex__t" ("id" TEXT PRIMARY KEY, "n" INTEGER NOT NULL, "r" REAL, "b" BLOB)',
    });
    expect(ddl.map((d) => d.table_name)).toEqual(["p_ex__t", "idx_p_ex__t__byn", "idx_p_ex__t__byr"]);
    expect(await declareDataModule({ db, dbPath: ":memory:", decl })).toEqual({
      ok: true, created: [], altered: [], snapshotPath: null,
    });
    await db.close();
  });

  it("adds a missing nullable column and a missing index to an existing table", async () => {
    const db = memKernel();
    await declareDataModule({ db, dbPath: ":memory:", decl: mk([T()]) });
    const v2 = mk([{
      name: "t", columns: [{ name: "id", type: "TEXT", primaryKey: true }, { name: "extra", type: "TEXT" }],
      indexes: [{ name: "ix", columns: ["extra"] }],
    }]);
    expect(await declareDataModule({ db, dbPath: ":memory:", decl: v2 })).toEqual({
      ok: true, created: [], altered: ["p_ex__t"], snapshotPath: null,
    });
    expect((await listColumns(db, "p_ex__t")).map((c) => c.name)).toEqual(["id", "extra"]);
    expect((await listIndexes(db, "p_ex__t")).has("idx_p_ex__t__ix")).toBe(true);
    await db.close();
  });

  it("drops and recreates an index whose declared shape changed", async () => {
    const db = memKernel();
    const cols = [{ name: "id", type: "TEXT" as const, primaryKey: true }, { name: "a", type: "TEXT" as const }, { name: "b", type: "TEXT" as const }];
    const withIdx = (indexes: object[]) => mk([{ name: "t", columns: cols, indexes: indexes as never }]);
    await declareDataModule({ db, dbPath: ":memory:", decl: withIdx([{ name: "ix", columns: ["a"] }]) });
    for (const changed of [
      { name: "ix", columns: ["a"], unique: true },
      { name: "ix", columns: ["a", "b"], unique: true },
      { name: "ix", columns: ["b", "a"], unique: true },
    ]) {
      const res = await declareDataModule({ db, dbPath: ":memory:", decl: withIdx([changed]) });
      expect(res).toMatchObject({ ok: true, created: [], altered: ["p_ex__t"] });
      expect((await listIndexes(db, "p_ex__t")).get("idx_p_ex__t__ix")).toMatchObject({ unique: true, columns: changed.columns });
    }
    // identical declaration afterwards is a no-op
    expect(await declareDataModule({ db, dbPath: ":memory:", decl: withIdx([{ name: "ix", columns: ["b", "a"], unique: true }]) }))
      .toMatchObject({ created: [], altered: [] });
    const ddls = (await db.run((k) => k.selectFrom("_plugin_migrations").select("ddl").execute())).map((r) => r.ddl);
    expect(ddls).toContain('DROP INDEX "idx_p_ex__t__ix"');
    await db.close();
  });

  const mismatch: Array<[string, object, string, string]> = [
    ["COLUMN_ADD_PRIMARY_KEY", { name: "k", type: "TEXT", primaryKey: true }, "COLUMN_ADD_PRIMARY_KEY", 'missing declared column "k", which is a PRIMARY KEY'],
    ["COLUMN_ADD_NOT_NULL_WITHOUT_DEFAULT", { name: "k", type: "TEXT", notNull: true }, "COLUMN_ADD_NOT_NULL_WITHOUT_DEFAULT", "declared NOT NULL"],
  ];
  it.each(mismatch)("refuses unsafe ADD COLUMN: %s", async (_n, col, code, fragment) => {
    const db = memKernel();
    await declareDataModule({ db, dbPath: ":memory:", decl: mk([T()]) });
    const res = await declareDataModule({
      db, dbPath: ":memory:",
      decl: mk([{ name: "t", columns: [{ name: "id", type: "TEXT", primaryKey: true }, col as never] }]),
    });
    expect(res).toMatchObject({ ok: false, error: { code } });
    expect(res.error?.message).toContain(fragment);
    await db.close();
  });

  it("fails closed on type / not-null / primary-key drift of existing columns", async () => {
    const db = memKernel();
    await declareDataModule({
      db, dbPath: ":memory:",
      decl: mk([{ name: "t", columns: [{ name: "id", type: "TEXT", primaryKey: true }, { name: "a", type: "TEXT" }, { name: "n", type: "TEXT", notNull: true }] }]),
    });
    const attempt = (columns: object[]) => declareDataModule({ db, dbPath: ":memory:", decl: mk([{ name: "t", columns: columns as never }]) });
    const id = { name: "id", type: "TEXT", primaryKey: true };
    const a = { name: "a", type: "TEXT" };
    const n = { name: "n", type: "TEXT", notNull: true };
    const typeRes = await attempt([id, { name: "a", type: "INTEGER" }, n]);
    expect(typeRes.error).toEqual({ code: "COLUMN_TYPE_MISMATCH", message: expect.stringContaining('column "a" is declared INTEGER but the live column is TEXT') });
    const nnRes = await attempt([id, { name: "a", type: "TEXT", notNull: true }, n]);
    expect(nnRes.error?.code).toBe("COLUMN_NOT_NULL_MISMATCH");
    expect(nnRes.error?.message).toContain("declared NOT NULL but the live column is nullable");
    const nnLoose = await attempt([id, a, { name: "n", type: "TEXT" }]);
    expect(nnLoose.error?.message).toContain("declared nullable but the live column is NOT NULL");
    const pkRes = await attempt([id, { name: "a", type: "TEXT", primaryKey: true }, n]);
    expect(pkRes.error?.code).toBe("COLUMN_PRIMARY_KEY_MISMATCH");
    expect(pkRes.error?.message).toContain("declared a PRIMARY KEY but the live column is not part");
    const pkLoose = await attempt([{ name: "id", type: "TEXT" }, a, n]);
    expect(pkLoose.error?.message).toContain("declared not a PRIMARY KEY but the live column is part");
    await db.close();
  });

  it("rolls back and reports DDL_FAILED for a duplicate table in one declaration", async () => {
    const db = memKernel();
    const res = await declareDataModule({ db, dbPath: ":memory:", decl: mk([T(), T()]) });
    expect(res).toMatchObject({ ok: false, created: [], altered: [], snapshotPath: null, error: { code: "DDL_FAILED" } });
    expect(res.error?.message).toContain('table "p_ex__t" already exists');
    expect(res.recoveryPoint).toBeUndefined();
    expect(await listTables(db)).not.toContain("p_ex__t");
    await db.close();
  });

  it("refuses an unconsented namespace adoption", async () => {
    const db = memKernel();
    await declareDataModule({ db, dbPath: ":memory:", decl: mk([T()]) });
    const res = await declareDataModule({
      db, dbPath: ":memory:",
      decl: mk([T("u")], { provenance: { sourceUrl: "builtin://other", publisher: "evil" } }),
    });
    expect(res).toMatchObject({ ok: false, error: { code: "IDENTITY_ADOPTION_REQUIRES_CONSENT" } });
    expect(res.error?.message).toContain("explicit operator consent is required");
    expect(await listTables(db)).not.toContain("p_ex__u");
    await db.close();
  });
});

describe("declareDataModule on PGlite and re-declare without indexes", () => {
  it("re-declaring an index-less table is a no-op", async () => {
    const db = memKernel();
    await declareDataModule({ db, dbPath: ":memory:", decl: mk([T()]) });
    expect(await declareDataModule({ db, dbPath: ":memory:", decl: mk([T()]) })).toEqual({ ok: true, created: [], altered: [], snapshotPath: null });
    await db.close();
  });

  it("treats a PRIMARY KEY column as NOT NULL on Postgres, so re-declare is idempotent and a nullable mismatch is not raised", async () => {
    const db = openPgliteKernel<PluginCoreTables>({ PGlite });
    try {
      const decl = mk([T("t", { indexes: [{ name: "i", columns: ["id"] }] })]);
      expect(await declareDataModule({ db, dbPath: ":memory:", decl })).toEqual({ ok: true, created: ["p_ex__t"], altered: [], snapshotPath: null });
      expect(await declareDataModule({ db, dbPath: ":memory:", decl })).toEqual({ ok: true, created: [], altered: [], snapshotPath: null });
    } finally { await db.close(); }
  });
});

describe("data-modules barrel", () => {
  it("re-exports the declaration engine, journal, identity, snapshot, recovery and restore helpers", async () => {
    const barrel = await import("../index.js");
    for (const name of ["declareDataModule", "ensureMigrationJournal", "checkNamespaceAdoption", "snapshotDb", "recoverIncompleteDataModuleMigrations", "checkDiskHeadroom", "restoreFromSnapshot", "pluginKernel"]) {
      expect(typeof (barrel as Record<string, unknown>)[name], name).toBe("function");
    }
    expect(barrel.declareDataModule).toBe(declareDataModule);
  });
});

describe("declareDataModule file-backed (snapshot + journal)", () => {
  const fileDb = (name = "app.db") => {
    const file = path.join(tmp, name);
    return { file, db: openSqliteFileKernel<PluginCoreTables>({ filePath: file, open }) };
  };

  it("snapshots, journals COMMITTED, then discards the snapshot", async () => {
    const { file, db } = fileDb();
    const headroom = vi.fn((_required: { dbPath: string }) => ({ ok: true, requiredBytes: 1, freeBytes: 100 }));
    const res = await declareDataModule({ db, dbPath: file, decl: mk([T()]) }, { checkHeadroom: headroom });
    expect(res.ok).toBe(true);
    expect(res.created).toEqual(["p_ex__t"]);
    expect(res.snapshotPath).toContain("app.db.snapshot-ex-");
    expect(headroom).toHaveBeenCalledTimes(1);
    expect(headroom.mock.calls[0]![0].dbPath).toBe(fs.realpathSync(file));
    expect(fs.existsSync(res.snapshotPath!)).toBe(false);
    const j = await db.run((k) => k.selectFrom("_plugin_migration_journal").selectAll().execute());
    expect(j).toHaveLength(1);
    expect(j[0]).toMatchObject({ plugin_id: "ex", phase: "COMMITTED" });
    expect(await findIncompleteJournalEntries({ store: db })).toEqual([]);
    await db.close();
  });

  it("refuses with INSUFFICIENT_DISK_HEADROOM (known and unknown free bytes)", async () => {
    const { file, db } = fileDb();
    const known = await declareDataModule({ db, dbPath: file, decl: mk([T()]) }, {
      checkHeadroom: () => ({ ok: false, requiredBytes: 900, freeBytes: 5 }),
    });
    expect(known).toMatchObject({ ok: false, snapshotPath: null, error: { code: "INSUFFICIENT_DISK_HEADROOM" } });
    expect(known.error?.message).toBe("dataModule declare refused: needs ~900 bytes free, only 5 available");
    const unknown = await declareDataModule({ db, dbPath: file, decl: mk([T()]) }, {
      checkHeadroom: () => ({ ok: false, requiredBytes: 7, freeBytes: null }),
    });
    expect(unknown.error?.message).toBe("dataModule declare refused: needs ~7 bytes free, only unknown available");
    expect(await listTables(db)).not.toContain("p_ex__t");
    await db.close();
  });

  it("keeps the snapshot as recovery point and journals ROLLED_BACK on DDL failure", async () => {
    const { file, db } = fileDb();
    const res = await declareDataModule({ db, dbPath: file, decl: mk([T(), T()]) }, {
      checkHeadroom: () => ({ ok: true, requiredBytes: 0, freeBytes: null }),
    });
    expect(res).toMatchObject({ ok: false, error: { code: "DDL_FAILED" } });
    expect(res.snapshotPath).toContain(".snapshot-ex-");
    expect(res.recoveryPoint).toBe(res.snapshotPath);
    expect(fs.existsSync(res.snapshotPath!)).toBe(true);
    const j = await db.run((k) => k.selectFrom("_plugin_migration_journal").selectAll().execute());
    expect(j.map((r) => r.phase)).toEqual(["ROLLED_BACK"]);
    await db.close();
  });

  it("warns when the named dbPath is not the open database, and falls back to :memory: for an in-memory connection", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { db } = fileDb("real.db");
    const other = path.join(tmp, "other.db");
    const headroom = () => ({ ok: true, requiredBytes: 0, freeBytes: null });
    const res = await declareDataModule({ db, dbPath: other, decl: mk([T()]) }, { checkHeadroom: headroom });
    expect(res.ok).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain(`ex: ${other} is not the database this connection has open (`);
    await db.close();

    // named a file path but connection is in-memory: pragma reports no file -> treated as :memory:, no snapshot
    warn.mockClear();
    const mem = memKernel();
    const res2 = await declareDataModule({ db: mem, dbPath: other, decl: mk([T()]) }, { checkHeadroom: headroom });
    expect(res2).toEqual({ ok: true, created: ["p_ex__t"], altered: [], snapshotPath: null });
    expect(String(warn.mock.calls[0]![0])).toContain("an in-memory database");
    await mem.close();
  });

  it("does not warn when the named path is the open file", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { file, db } = fileDb();
    await declareDataModule({ db, dbPath: file, decl: mk([T()]) }, { checkHeadroom: () => ({ ok: true, requiredBytes: 0, freeBytes: null }) });
    expect(warn).not.toHaveBeenCalled();
    await db.close();
  });

  it("uses the real disk headroom check by default", async () => {
    const { file, db } = fileDb();
    const res = await declareDataModule({ db, dbPath: file, decl: mk([T()]) });
    expect(res.ok).toBe(true);
    await db.close();
  });
});

describe("snapshot helpers", () => {
  it.each([
    [":memory:", true], ["", true], ["file::memory:", true], ["file::memory:?cache=shared", true],
    ["file:x.db?mode=memory", true], ["file:x.db", false], ["file:x.db?mode=rwc", false], ["/a/b.db", false],
  ])("isInMemoryDbPath(%j) = %s", (p, expected) => {
    expect(isInMemoryDbPath({ dbPath: p })).toBe(expected);
  });

  it("snapshotDb returns null in memory and writes a labelled backup for a file", async () => {
    const mem = memKernel();
    expect(await snapshotDb({ db: mem, dbPath: ":memory:", label: "x" })).toBeNull();
    await mem.close();
    const file = path.join(tmp, "s.db");
    const db = openSqliteFileKernel<PluginCoreTables>({ filePath: file, open });
    const snap = await snapshotDb({ db, dbPath: file, label: "lbl" });
    expect(path.dirname(snap!)).toBe(tmp);
    expect(path.basename(snap!)).toMatch(/^s\.db\.snapshot-lbl-\d+$/);
    expect(fs.existsSync(snap!)).toBe(true);
    await discardCommittedSnapshot({ snapshotPath: snap! });
    expect(fs.existsSync(snap!)).toBe(false);
    await expect(discardCommittedSnapshot({ snapshotPath: snap! })).resolves.toBeUndefined();
    await db.close();
  });

  it("pluginKernel returns the same store", () => {
    const k = memKernel();
    expect(pluginKernel({ store: k })).toBe(k);
  });
});

describe("checkDiskHeadroom", () => {
  it("is trivially ok in memory", () => {
    expect(checkDiskHeadroom({ dbPath: ":memory:" })).toEqual({ ok: true, requiredBytes: 0, freeBytes: null });
  });
  it("requires 1.5x db+wal size and compares with free space", () => {
    const f = path.join(tmp, "h.db");
    fs.writeFileSync(f, Buffer.alloc(1000));
    fs.writeFileSync(`${f}-wal`, Buffer.alloc(500));
    const r = checkDiskHeadroom({ dbPath: f });
    expect(r.requiredBytes).toBe(2250);
    expect(r.ok).toBe(r.freeBytes! >= 2250);
    expect(typeof r.freeBytes).toBe("number");
  });
  it("treats a missing file as size 0", () => {
    const r = checkDiskHeadroom({ dbPath: path.join(tmp, "nope.db") });
    expect(r).toMatchObject({ requiredBytes: 0, ok: true });
  });
  it("is ok with measurementFailed when the directory cannot be statfs'd", () => {
    const r = checkDiskHeadroom({ dbPath: path.join(tmp, "missing-dir", "x.db") });
    expect(r).toEqual({ ok: true, requiredBytes: 0, freeBytes: null, measurementFailed: true });
  });
});

describe("restore + recovery", () => {
  it("restoreFromSnapshot copies the snapshot and removes -wal/-shm", () => {
    const db = path.join(tmp, "a.db");
    const snap = path.join(tmp, "a.snap");
    fs.writeFileSync(db, "live"); fs.writeFileSync(`${db}-wal`, "w"); fs.writeFileSync(`${db}-shm`, "s");
    fs.writeFileSync(snap, "snapshot");
    restoreFromSnapshot({ dbPath: db, snapshotPath: snap });
    expect(fs.readFileSync(db, "utf8")).toBe("snapshot");
    expect(fs.existsSync(`${db}-wal`)).toBe(false);
    expect(fs.existsSync(`${db}-shm`)).toBe(false);
    restoreFromSnapshot({ dbPath: db, snapshotPath: snap }); // no wal/shm present: still fine
    expect(fs.readFileSync(db, "utf8")).toBe("snapshot");
  });

  it("restoreSqliteSnapshots restores newest entry first so the oldest wins", () => {
    const db = path.join(tmp, "b.db");
    const s1 = path.join(tmp, "s1"); const s2 = path.join(tmp, "s2");
    fs.writeFileSync(s1, "oldest"); fs.writeFileSync(s2, "newer");
    const entry = (id: number, snapshotPath: string) => ({ id, pluginId: "p", phase: "DDL_IN_PROGRESS" as const, snapshotPath, startedAt: 1, updatedAt: 1 });
    restoreSqliteSnapshots({ dbPath: db, entries: [entry(1, s1), entry(2, s2)] });
    expect(fs.readFileSync(db, "utf8")).toBe("oldest");
  });

  it("recover returns zero when there is no journal table or nothing incomplete", async () => {
    const db = memKernel();
    const restore = vi.fn();
    expect(await recoverIncompleteDataModuleMigrations({ store: db, restoreSnapshots: restore })).toEqual({ recovered: 0, entries: [] });
    await ensureMigrationJournal({ store: db });
    expect(await recoverIncompleteDataModuleMigrations({ store: db, restoreSnapshots: restore })).toEqual({ recovered: 0, entries: [] });
    expect(restore).not.toHaveBeenCalled();
    await db.close();
  });

  it("recover hands incomplete entries to restoreSnapshots on SQLite", async () => {
    const db = memKernel();
    await ensureMigrationJournal({ store: db });
    const id = await beginJournalEntry({ db, pluginId: "p1", snapshotPath: "/snap/1" });
    const done = await beginJournalEntry({ db, pluginId: "p2", snapshotPath: "/snap/2" });
    await advanceJournalPhase({ db, id: done, phase: "COMMITTED" });
    const restore = vi.fn();
    const res = await recoverIncompleteDataModuleMigrations({ store: db, restoreSnapshots: restore });
    expect(res).toEqual({ recovered: 1, entries: [{ pluginId: "p1", snapshotPath: "/snap/1" }] });
    expect(restore).toHaveBeenCalledWith([expect.objectContaining({ id, pluginId: "p1", phase: "PREPARED_SNAPSHOT" })]);
    await db.close();
  });

  it("recover marks entries ROLLED_BACK on a non-sqlite dialect (PGlite) without calling restoreSnapshots", async () => {
    const db = openPgliteKernel<PluginCoreTables>({ PGlite });
    try {
      await ensureMigrationJournal({ store: db });
      const id = await beginJournalEntry({ db, pluginId: "p1", snapshotPath: "/snap/1" });
      const restore = vi.fn();
      const res = await recoverIncompleteDataModuleMigrations({ store: db, restoreSnapshots: restore });
      expect(res).toEqual({ recovered: 1, entries: [{ pluginId: "p1", snapshotPath: "/snap/1" }] });
      expect(restore).not.toHaveBeenCalled();
      const row = await db.run((k) => k.selectFrom("_plugin_migration_journal").select("phase").where("id", "=", id).executeTakeFirstOrThrow());
      expect(row.phase).toBe("ROLLED_BACK");
    } finally { await db.close(); }
  });
});

describe("declareDataModule post-commit / verification failure paths (wrapped store)", () => {
  it("still reports success when post-commit housekeeping throws", async () => {
    const file = path.join(tmp, "pc.db");
    const real = openSqliteFileKernel<PluginCoreTables>({ filePath: file, open });
    let armed = false;
    let transactions = 0;
    const db = Object.create(real, {
      // 1st transaction = namespace-adoption mint; 2nd = the DDL transaction. Arm only after the DDL commit.
      transaction: { value: async (fn: () => Promise<unknown>) => { const r = await real.transaction(fn as never); if (++transactions === 2) armed = true; return r; } },
      query: { value: (q: never) => { if (armed) throw new Error("checkpoint boom"); return real.query(q); } },
    });
    const res = await declareDataModule({ db, dbPath: file, decl: mk([T()]) }, { checkHeadroom: () => ({ ok: true, requiredBytes: 0, freeBytes: null }) });
    expect(res).toMatchObject({ ok: true, created: ["p_ex__t"] });
    // housekeeping aborted before discarding: the snapshot is left behind, journal row already COMMITTED
    expect(fs.existsSync(res.snapshotPath!)).toBe(true);
    const j = await real.run((k) => k.selectFrom("_plugin_migration_journal").select("phase").execute());
    expect(j).toEqual([{ phase: "COMMITTED" }]);
    await real.close();
  });

  it("rolls back with DDL_FAILED when post-DDL verification cannot find the new table", async () => {
    const real = memKernel();
    let armed = false;
    const db = Object.create(real, {
      transaction: { value: (fn: () => Promise<unknown>) => real.transaction(async () => { armed = true; return fn(); }) },
      query: { value: (q: never) => (armed ? Promise.resolve([]) : real.query(q)) },
    });
    const decl = mk([T("t", { indexes: [{ name: "i", columns: ["id"] }] })]);
    const res = await declareDataModule({ db, dbPath: ":memory:", decl });
    expect(res).toMatchObject({ ok: false, error: { code: "DDL_FAILED" } });
    expect(res.error?.message).toBe("post-DDL verification failed: p_ex__t not found after DDL");
    armed = false;
    expect(await listTables(real)).not.toContain("p_ex__t");
    await real.close();
  });

  it("verification names missing columns and indexes of altered tables", async () => {
    const real = memKernel();
    await declareDataModule({ db: real, dbPath: ":memory:", decl: mk([T()]) });
    let armed = false;
    const db = Object.create(real, {
      transaction: { value: (fn: () => Promise<unknown>) => real.transaction(async () => { armed = true; return fn(); }) },
      query: { value: (q: never) => (armed ? Promise.resolve([]) : real.query(q)) },
    });
    const v2 = mk([{ name: "t", columns: [{ name: "id", type: "TEXT", primaryKey: true }, { name: "x", type: "TEXT" }], indexes: [{ name: "ix", columns: ["x"] }] }]);
    const res = await declareDataModule({ db, dbPath: ":memory:", decl: v2 });
    expect(res.error?.message).toBe("post-DDL verification failed: p_ex__t.x, index idx_p_ex__t__ix not found after DDL");
    armed = false;
    expect((await listColumns(real, "p_ex__t")).map((c) => c.name)).toEqual(["id"]);
    await real.close();
  });
});

describe("journal + identity", () => {
  it("isIncompletePhase / journalEntryOf", () => {
    expect(isIncompletePhase({ phase: "VERIFYING" })).toBe(true);
    expect(isIncompletePhase({ phase: "COMMITTED" })).toBe(false);
    expect(isIncompletePhase({ phase: "ROLLED_BACK" })).toBe(false);
    expect(journalEntryOf({ row: { id: "3" as never, plugin_id: "p", phase: "COMMITTED", snapshot_path: "s", started_at: "5" as never, updated_at: "6" as never } }))
      .toEqual({ id: 3, pluginId: "p", phase: "COMMITTED", snapshotPath: "s", startedAt: 5, updatedAt: 6 });
  });

  it("stageJournalPhase updates without requiring a checkpoint", async () => {
    const db = memKernel();
    await ensureMigrationJournal({ store: db });
    const id = await beginJournalEntry({ db, pluginId: "p", snapshotPath: "s" });
    await stageJournalPhase({ db, id, phase: "VERIFYING" });
    expect((await findIncompleteJournalEntries({ store: db }))[0]).toMatchObject({ id, phase: "VERIFYING" });
    await db.close();
  });

  it("namespace adoption tracks: first-mint, unchanged, verified-signature, consent-required", async () => {
    const db = memKernel();
    await ensurePluginIdentityTable({ store: db });
    expect(await getPluginIdentity({ db, pluginId: "p" })).toBeNull();
    const signed = { sourceUrl: "u1", publisher: "a", signature: "SIG" };
    expect(await checkNamespaceAdoption({ db, pluginId: "p", provenance: signed })).toEqual({ allowed: true, track: "first-mint" });
    expect((await getPluginIdentity({ db, pluginId: "p" }))?.provenance).toEqual(signed);
    expect(await checkNamespaceAdoption({ db, pluginId: "p", provenance: signed })).toEqual({ allowed: true, track: "unchanged" });
    expect(await checkNamespaceAdoption({ db, pluginId: "p", provenance: { sourceUrl: "u2", publisher: "b", signature: "SIG" } }))
      .toEqual({ allowed: true, track: "verified-signature" });
    const bad = await checkNamespaceAdoption({ db, pluginId: "p", provenance: { sourceUrl: "u2", publisher: "b", signature: "OTHER" } });
    expect(bad).toMatchObject({ allowed: false, track: "consent-required" });
    const unsigned = await checkNamespaceAdoption({ db, pluginId: "p", provenance: { sourceUrl: "u1", publisher: "a" } });
    expect(unsigned.allowed).toBe(false);
    await db.close();
  });
});
