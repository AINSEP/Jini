import { existsSync, linkSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { sql } from "kysely";
import { expect, onTestFinished, test, vi } from "vitest";

import { listColumns, listIndexes, listTables } from "../../kernel/index.js";
import { sqliteKernel } from "../../kernel/sqlite/index.js";
import { checkNamespaceAdoption, declareDataModule, getPluginIdentity, type DataModuleDecl, type PluginCoreTables } from "../index.js";

const provenance = { sourceUrl: "builtin://notes", publisher: "first-publisher" };
const table = { name: "notes", columns: [
  { name: "id", type: "TEXT", primaryKey: true },
  { name: "tag", type: "TEXT", notNull: true },
  { name: "body", type: "TEXT" },
] } satisfies DataModuleDecl["tables"][number];
const decl: DataModuleDecl = { pluginId: "writer", pluginTier: "tier-2", provenance, tables: [table] };
const fq = "p_writer__notes";

function database(fileBacked = false) {
  const dir = fileBacked ? realpathSync(mkdtempSync(join(tmpdir(), "jini-data-module-"))) : null;
  const dbPath = dir === null ? ":memory:" : join(dir, "content.db");
  const raw = new Database(dbPath);
  onTestFinished(() => {
    raw.close();
    if (dir !== null) rmSync(dir, { recursive: true, force: true });
  });
  if (dir !== null) raw.pragma("journal_mode = WAL");
  const db = sqliteKernel<PluginCoreTables>({ source: raw });
  const report = { warn: vi.fn(), error: vi.fn() };
  return { db, raw, dbPath, dir, report };
}

type Refusal = { label: string; invalid: DataModuleDecl; code: string; message: string };
const refusalCases: Refusal[] = [
  { label: "plugin identifier", invalid: { ...decl, pluginId: "Bad" }, code: "BAD_PLUGIN_ID", message: "invalid pluginId: Bad" },
  { label: "tier-1", invalid: { ...decl, pluginTier: "tier-1" }, code: "TIER1_NOT_ALLOWED", message: "Tier-1 plugins cannot request it" },
  { label: "empty declaration", invalid: { ...decl, tables: [] }, code: "EMPTY", message: "declaration lists no tables" },
  { label: "table identifier", invalid: { ...decl, tables: [{ ...table, name: "notes!" }] }, code: "BAD_TABLE_NAME", message: "invalid table name: notes!" },
  { label: "oversized qualified table", invalid: { ...decl, tables: [{ ...table, name: "n".repeat(54) }] }, code: "IDENTIFIER_TOO_LONG", message: "(64 bytes)" },
  { label: "empty columns", invalid: { ...decl, tables: [{ ...table, columns: [] }] }, code: "NO_COLUMNS", message: "table notes declares no columns" },
  { label: "column identifier", invalid: { ...decl, tables: [{ ...table, columns: [{ name: "1id", type: "TEXT" }] }] }, code: "BAD_COLUMN", message: "invalid column name: 1id" },
  { label: "unsupported column affinity", invalid: { ...decl, tables: [{ ...table, columns: [{ name: "id", type: "JSON" as DataModuleDecl["tables"][number]["columns"][number]["type"] }] }] }, code: "BAD_TYPE", message: "unsupported column type for id: JSON" },
  { label: "index identifier", invalid: { ...decl, tables: [{ ...table, indexes: [{ name: "By_tag", columns: ["tag"] }] }] }, code: "BAD_INDEX_NAME", message: "invalid index name: By_tag" },
  { label: "oversized qualified index", invalid: { ...decl, tables: [{ ...table, indexes: [{ name: "n".repeat(44), columns: ["tag"] }] }] }, code: "IDENTIFIER_TOO_LONG", message: "(65 bytes)" },
  { label: "empty index", invalid: { ...decl, tables: [{ ...table, indexes: [{ name: "by_tag", columns: [] }] }] }, code: "EMPTY_INDEX", message: "index by_tag on table notes declares no columns" },
  { label: "undeclared indexed column", invalid: { ...decl, tables: [{ ...table, indexes: [{ name: "by_tag", columns: ["tag", "missing"] }] }] }, code: "INDEX_UNKNOWN_COLUMN", message: "references undeclared column: missing" },
];

test.each(refusalCases)("rejects $label before writing identity or DDL", async ({ invalid, code, message }) => {
  const { db, dbPath, report } = database();
  expect(await declareDataModule({ db, dbPath, decl: invalid }, { report })).toEqual({
    ok: false, created: [], altered: [], snapshotPath: null,
    error: { code, message: expect.stringContaining(message) },
  });
  expect(await listTables({ kernel: db })).toEqual([]);
});

test("accepts a generated index including all 63 bytes of the portable identifier budget", async () => {
  const { db, dbPath, report } = database();
  const name = "n".repeat(42);
  expect(await declareDataModule({ db, dbPath, decl: { ...decl, tables: [{ ...table, indexes: [{ name, columns: ["tag"] }] }] } }, { report }))
    .toEqual({ ok: true, created: [fq], altered: [], snapshotPath: null });
  expect([...(await listIndexes({ kernel: db, table: fq })).values()]).toEqual([
    { name: `idx_p_writer__notes__${name}`, columns: ["tag"], unique: false },
  ]);
});

type Drift = { label: string; changed: DataModuleDecl["tables"][number]["columns"]; code: string; message: string };
const driftCases: Drift[] = [
  { label: "additional primary key", changed: [...table.columns, { name: "extra", type: "TEXT", primaryKey: true }], code: "COLUMN_ADD_PRIMARY_KEY", message: 'missing declared column "extra", which is a PRIMARY KEY' },
  { label: "required new column without a default", changed: [...table.columns, { name: "extra", type: "TEXT", notNull: true }], code: "COLUMN_ADD_NOT_NULL_WITHOUT_DEFAULT", message: 'missing declared column "extra", declared NOT NULL' },
  { label: "type replacement", changed: [{ name: "body", type: "INTEGER" }], code: "COLUMN_TYPE_MISMATCH", message: 'column "body" is declared INTEGER but the live column is TEXT' },
  { label: "not-null tightening", changed: [{ name: "body", type: "TEXT", notNull: true }], code: "COLUMN_NOT_NULL_MISMATCH", message: 'column "body" is declared NOT NULL but the live column is nullable' },
  { label: "not-null loosening", changed: [{ name: "tag", type: "TEXT" }], code: "COLUMN_NOT_NULL_MISMATCH", message: 'column "tag" is declared nullable but the live column is NOT NULL' },
  { label: "primary-key removal", changed: [{ name: "id", type: "TEXT" }], code: "COLUMN_PRIMARY_KEY_MISMATCH", message: 'column "id" is declared not a PRIMARY KEY but the live column is part of the table' },
  { label: "primary-key promotion", changed: [{ name: "body", type: "TEXT", primaryKey: true }], code: "COLUMN_PRIMARY_KEY_MISMATCH", message: 'column "body" is declared a PRIMARY KEY but the live column is not part of the table' },
];

test.each(driftCases)("refuses $label without partially creating a sibling table", async ({ changed, code, message }) => {
  const { db, raw, dbPath, report } = database();
  const install = (input: DataModuleDecl) => declareDataModule({ db, dbPath, decl: input }, { report });
  expect(await install(decl)).toEqual({ ok: true, created: [fq], altered: [], snapshotPath: null });
  raw.exec("INSERT INTO p_writer__notes VALUES ('n1','keep','original')");
  expect(await install({ ...decl, tables: [{ ...table, name: "sibling" }, { ...table, columns: changed }] })).toEqual({
    ok: false, created: [], altered: [], snapshotPath: null,
    error: { code, message: expect.stringContaining(message) },
  });
  expect(await listTables({ kernel: db })).not.toContain("p_writer__sibling");
  expect(raw.prepare("SELECT * FROM p_writer__notes").all()).toEqual([{ id: "n1", tag: "keep", body: "original" }]);
  expect(raw.prepare("SELECT table_name FROM _plugin_migrations").all()).toEqual([{ table_name: fq }]);
});

test("reconciles index shape and nullable columns without dropping undeclared live data or repeating DDL", async () => {
  const { db, dbPath, raw, report } = database();
  const install = (input: DataModuleDecl) => declareDataModule({ db, dbPath, decl: input }, { report });
  expect(await install({ ...decl, tables: [{ ...table, indexes: [
    { name: "ordered", columns: ["tag", "body"] },
    { name: "length", columns: ["tag"] },
    { name: "unique", columns: ["body"] },
    { name: "keep", columns: ["id"] },
  ] }] })).toEqual({ ok: true, created: [fq], altered: [], snapshotPath: null });
  raw.exec("INSERT INTO p_writer__notes VALUES ('n1','a','retained')");
  const next: DataModuleDecl = { ...decl, tables: [{ ...table, columns: [
    ...table.columns.filter(c => c.name !== "body"), { name: "score", type: "REAL" },
  ], indexes: [{ name: "new", columns: ["score"] }] }] };
  // A declared index can only reference declared columns. Keep body declared for the
  // reconciling indexes, then omit it from the next declaration to exercise drift retention.
  const indexes = [
    { name: "ordered", columns: ["body", "tag"] },
    { name: "length", columns: ["tag", "body"] },
    { name: "unique", columns: ["body"], unique: true },
    { name: "new", columns: ["score"] },
  ];
  const full: DataModuleDecl = { ...next, tables: [{ ...table, columns: [...table.columns, { name: "score", type: "REAL" }], indexes }] };
  expect(await install(full)).toEqual({ ok: true, created: [], altered: [fq], snapshotPath: null });
  expect(await listColumns({ kernel: db, table: fq })).toEqual(expect.arrayContaining([expect.objectContaining({ name: "score", type: "real", notNull: false })]));
  expect([...(await listIndexes({ kernel: db, table: fq })).values()]).toEqual([
    { name: "idx_p_writer__notes__keep", columns: ["id"], unique: false },
    { name: "idx_p_writer__notes__length", columns: ["tag", "body"], unique: false },
    { name: "idx_p_writer__notes__new", columns: ["score"], unique: false },
    { name: "idx_p_writer__notes__ordered", columns: ["body", "tag"], unique: false },
    { name: "idx_p_writer__notes__unique", columns: ["body"], unique: true },
  ]);
  expect(await install(full)).toEqual({ ok: true, created: [], altered: [], snapshotPath: null });
  expect(await install(next)).toEqual({ ok: true, created: [], altered: [], snapshotPath: null });
  expect(raw.prepare("SELECT * FROM p_writer__notes").all()).toEqual([{ id: "n1", tag: "a", body: "retained", score: null }]);
  expect(raw.prepare("SELECT count(*) AS count FROM _plugin_migrations").get()).toEqual({ count: 13 });
});

test("same-key provenance can adopt retained data without replacing the first minted identity", async () => {
  const { db } = database();
  const clock = vi.spyOn(Date, "now").mockReturnValue(9000);
  const original = { ...provenance, signature: "original-key" };
  try {
    const adopt = (incoming: typeof provenance & { signature?: string }) =>
      checkNamespaceAdoption({ db, pluginId: "writer", provenance: incoming });
    expect(await adopt(original)).toEqual({ allowed: true, track: "first-mint" });
    clock.mockReturnValue(10000);
    expect(await adopt(original)).toEqual({ allowed: true, track: "unchanged" });
    expect(await adopt({ ...original, publisher: "second-publisher" })).toEqual({ allowed: true, track: "verified-signature" });
    for (const incoming of [provenance, { ...original, signature: "different-key" }]) {
      expect(await adopt(incoming)).toEqual({
        allowed: false, track: "consent-required",
        reason: "pluginId 'writer' has retained data from a previously-seen, provenance-mismatched artifact — explicit operator consent is required before adopting this namespace",
      });
    }
    expect(await getPluginIdentity({ db, pluginId: "writer" })).toEqual({ pluginId: "writer", provenance: original, mintedAt: 9000 });
    expect(await getPluginIdentity({ db, pluginId: "unrelated" })).toBeNull();
  } finally { clock.mockRestore(); }
});

test("a provenance mismatch refuses schema changes before creating new plugin tables", async () => {
  const { db, dbPath, report } = database();
  expect(await declareDataModule({ db, dbPath, decl }, { report })).toEqual({ ok: true, created: [fq], altered: [], snapshotPath: null });
  expect(await declareDataModule({ db, dbPath, decl: { ...decl, provenance: { ...provenance, publisher: "another" }, tables: [{ ...table, name: "new_notes" }] } }, { report })).toEqual({
    ok: false, created: [], altered: [], snapshotPath: null,
    error: { code: "IDENTITY_ADOPTION_REQUIRES_CONSENT", message: expect.stringContaining("explicit operator consent") },
  });
  expect(await listTables({ kernel: db })).not.toContain("p_writer__new_notes");
  expect(await getPluginIdentity({ db, pluginId: "writer" })).toMatchObject({ provenance });
});

test.each([12, null])("refuses insufficient headroom reported as %j before snapshot or DDL", async (freeBytes) => {
  const { db, dbPath, report } = database(true);
  const checkHeadroom = vi.fn(() => ({ ok: false, requiredBytes: 60, freeBytes }));
  const backupTo = vi.fn(async () => { throw new Error("backup must not run"); });
  expect(await declareDataModule({ db: { ...db, backupTo }, dbPath, decl }, { checkHeadroom, report })).toEqual({
    ok: false, created: [], altered: [], snapshotPath: null,
    error: { code: "INSUFFICIENT_DISK_HEADROOM", message: `dataModule declare refused: needs ~60 bytes free, only ${freeBytes ?? "unknown"} available` },
  });
  expect(checkHeadroom.mock.calls).toEqual([[{ dbPath }]]);
  expect(backupTo.mock.calls).toEqual([]);
  expect(await listTables({ kernel: db })).toEqual(["_plugin_identity"]);
});

test("a path mismatch warns and binds the checkpoint, snapshot, and DDL to the open file", async () => {
  const { db, dbPath, dir, report } = database(true);
  if (dir === null) throw new Error("expected a file-backed fixture");
  const checkHeadroom = vi.fn(() => ({ ok: true, requiredBytes: 600, freeBytes: 900 }));
  const clock = vi.spyOn(Date, "now").mockReturnValue(17000);
  const otherPath = join(dir, "other.db");
  const other = new Database(otherPath);
  try {
    const snapshotPath = join(dir, "content.db.snapshot-writer-17000");
    expect(await declareDataModule({ db, dbPath: otherPath, decl }, { checkHeadroom, report })).toEqual({
      ok: true, created: [fq], altered: [], snapshotPath,
    });
    expect(checkHeadroom.mock.calls).toEqual([[{ dbPath }]]);
    expect(report.warn.mock.calls).toEqual([[{ message: expect.stringContaining("another file is open") }]]);
    expect(await db.run(k => k.selectFrom("_plugin_migration_journal").select(["plugin_id", "phase", "snapshot_path"]).execute())).toEqual([
      { plugin_id: "writer", phase: "COMMITTED", snapshot_path: snapshotPath },
    ]);
    expect(existsSync(snapshotPath)).toBe(false);
    expect(await listTables({ kernel: db })).toContain(fq);
    expect(other.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all()).toEqual([]);
  } finally { clock.mockRestore(); other.close(); }
});

test("duplicate DDL rolls back the entire file-backed attempt and retains its forensic snapshot", async () => {
  const { db, dbPath, dir, report, raw } = database(true);
  if (dir === null) throw new Error("expected a file-backed fixture");
  raw.exec("CREATE TABLE base(value TEXT); INSERT INTO base VALUES ('before')");
  const clock = vi.spyOn(Date, "now").mockReturnValue(24000);
  try {
    const snapshotPath = join(dir, "content.db.snapshot-writer-24000");
    const broken = { ...decl, tables: [table, table] };
    expect(await declareDataModule({ db, dbPath, decl: broken }, { report, checkHeadroom: () => ({ ok: true, requiredBytes: 0, freeBytes: 1 }) })).toEqual({
      ok: false, created: [], altered: [], snapshotPath, recoveryPoint: snapshotPath,
      error: { code: "DDL_FAILED", message: "The tables for plugin writer could not be created or altered; the change was rolled back." },
    });
    expect(report.error).toHaveBeenCalledWith(
      { message: "The tables for plugin writer could not be created or altered; the change was rolled back." },
      { error: expect.objectContaining({ message: expect.stringContaining("already exists") }) },
    );
    expect(await listTables({ kernel: db })).not.toContain(fq);
    expect(await listTables({ kernel: db })).not.toContain("_plugin_migrations");
    expect(await db.run(k => k.selectFrom("_plugin_migration_journal").select(["plugin_id", "phase"]).execute()))
      .toEqual([{ plugin_id: "writer", phase: "ROLLED_BACK" }]);
    const recovered = new Database(snapshotPath, { readonly: true, fileMustExist: true });
    try { expect(recovered.prepare("SELECT value FROM base").all()).toEqual([{ value: "before" }]); }
    finally { recovered.close(); }
  } finally { clock.mockRestore(); }
});

test("a failed catalog read is reported without revealing native SQL or applying DDL", async () => {
  const { db, dbPath, report } = database();
  const native = new Error("catalog read failed with private detail");
  const lookedUp: string[] = [];
  const query: typeof db.query = async statement => {
    const text = await db.run(k => statement.compile(k).sql);
    if (text.includes("FROM sqlite_schema")) { lookedUp.push(text); throw native; }
    return db.query(statement);
  };
  expect(await declareDataModule({ db: { ...db, query }, dbPath, decl }, { report })).toEqual({
    ok: false, created: [], altered: [], snapshotPath: null,
    error: { code: "PREFLIGHT_FAILED", message: "The existing tables for plugin writer could not be read, so nothing was changed." },
  });
  expect(lookedUp).toHaveLength(1);
  expect(report.error.mock.calls).toEqual([[{ message: "The existing tables for plugin writer could not be read, so nothing was changed." }, { error: native }]]);
  expect(await db.query(sql`SELECT name FROM sqlite_schema WHERE type='table'`)).toEqual([]);
});

test.each([
  { name: "new table", ddl: 'CREATE TABLE "p_writer__fresh" ("id" TEXT)', diagnostic: "p_writer__fresh" },
  { name: "nullable column", ddl: 'ALTER TABLE "p_writer__notes" ADD COLUMN "score" REAL', diagnostic: "p_writer__notes.score" },
  { name: "index", ddl: 'CREATE INDEX "idx_p_writer__notes__lookup" ON "p_writer__notes" ("id")', diagnostic: "index idx_p_writer__notes__lookup" },
])("post-DDL verification rolls back other changes when storage accepts but omits a $name", async ({ ddl, diagnostic }) => {
  const { db, dbPath, raw, report } = database();
  expect(await declareDataModule({ db, dbPath, decl }, { report })).toMatchObject({ ok: true, created: [fq] });
  raw.exec("INSERT INTO p_writer__notes VALUES ('n1','keep','original')");
  const next: DataModuleDecl = { ...decl, tables: [
    { name: "fresh", columns: [{ name: "id", type: "TEXT" }] },
    { ...table, columns: [...table.columns, { name: "score", type: "REAL" }], indexes: [{ name: "lookup", columns: ["id"] }] },
  ] };
  const ignored: string[] = [];
  const execute: typeof db.execute = async statement => {
    const text = await db.run(k => statement.compile(k).sql);
    if (text === ddl) { ignored.push(text); return; }
    await db.execute(statement);
  };
  expect(await declareDataModule({ db: { ...db, execute }, dbPath, decl: next }, { report })).toEqual({
    ok: false, created: [], altered: [], snapshotPath: null, recoveryPoint: undefined,
    error: { code: "DDL_FAILED", message: "The tables for plugin writer could not be created or altered; the change was rolled back." },
  });
  expect(ignored).toEqual([ddl]);
  expect(report.error.mock.calls).toEqual([[
    { message: "The tables for plugin writer could not be created or altered; the change was rolled back." },
    { error: expect.objectContaining({ message: `post-DDL verification failed: ${diagnostic} not found after DDL` }) },
  ]]);
  expect(await listTables({ kernel: db })).not.toContain("p_writer__fresh");
  expect(raw.prepare("SELECT * FROM p_writer__notes").all()).toEqual([{ id: "n1", tag: "keep", body: "original" }]);
  expect([...(await listIndexes({ kernel: db, table: fq })).values()]).toEqual([]);
  expect(raw.prepare("SELECT table_name FROM _plugin_migrations").all()).toEqual([{ table_name: fq }]);
});

test("a post-commit checkpoint failure does not turn durable DDL or the committed phase into a rollback", async () => {
  const { db, dbPath, report } = database(true);
  const clock = vi.spyOn(Date, "now").mockReturnValue(21000);
  let guardedCheckpoint = 0;
  const phasesAtCommit: string[] = [];
  const transaction: typeof db.transaction = async work => {
    const result = await db.transaction(work);
    if ((await listTables({ kernel: db })).includes("_plugin_migration_journal")) {
      phasesAtCommit.push((await db.run(k => k.selectFrom("_plugin_migration_journal").select("phase").executeTakeFirstOrThrow())).phase);
    }
    return result;
  };
  const fault = new Error("simulated checkpoint failure after commit");
  const query: typeof db.query = async statement => {
    if ((await db.run(k => statement.compile(k).sql)) === "PRAGMA wal_checkpoint(FULL)") {
      const row = await db.run(k => k.selectFrom("_plugin_migration_journal").select("phase").executeTakeFirstOrThrow());
      if (row.phase === "COMMITTED") { guardedCheckpoint += 1; throw fault; }
    }
    return db.query(statement);
  };
  try {
    const snapshotPath = `${dbPath}.snapshot-writer-21000`;
    expect(await declareDataModule({ db: { ...db, query, transaction }, dbPath, decl }, {
      report, checkHeadroom: () => ({ ok: true, freeBytes: 100, requiredBytes: 99 }),
    })).toEqual({ ok: true, created: [fq], altered: [], snapshotPath });
    expect(guardedCheckpoint).toBe(1);
    expect(phasesAtCommit).toEqual(["COMMITTED"]);
    expect(await listTables({ kernel: db })).toContain(fq);
    expect(await db.run(k => k.selectFrom("_plugin_migration_journal").select("phase").execute())).toEqual([{ phase: "COMMITTED" }]);
    expect(report.error.mock.calls).toEqual([]);
  } finally { clock.mockRestore(); }
});

test("a file path mismatch on a memory connection warns without requiring disk or writing a journal", async () => {
  const { db, report } = database();
  const checkHeadroom = vi.fn(() => { throw new Error("must not measure on memory database"); });
  expect(await declareDataModule({ db, dbPath: join(tmpdir(), "jini-configured-but-not-open.db"), decl }, { report, checkHeadroom }))
    .toEqual({ ok: true, created: [fq], altered: [], snapshotPath: null });
  expect(checkHeadroom.mock.calls).toEqual([]);
  expect(report.warn.mock.calls).toEqual([[{ message: expect.stringContaining("an in-memory database is open") }]]);
  expect(await listTables({ kernel: db })).not.toContain("_plugin_migration_journal");
  expect(await listTables({ kernel: db })).toContain(fq);
});

test("a hard-linked configured path is accepted as the same database and default headroom permits the checkpoint", async () => {
  const { db, dbPath, dir, report } = database(true);
  if (dir === null) throw new Error("expected a file-backed fixture");
  const alias = join(dir, "alias.db");
  linkSync(dbPath, alias);
  const clock = vi.spyOn(Date, "now").mockReturnValue(34000);
  try {
    expect(await declareDataModule({ db, dbPath: alias, decl }, { report })).toEqual({
      ok: true, created: [fq], altered: [], snapshotPath: join(dir, "content.db.snapshot-writer-34000"),
    });
    expect(report.warn.mock.calls).toEqual([]);
    expect(await listTables({ kernel: db })).toContain(fq);
    expect(existsSync(join(dir, "content.db.snapshot-writer-34000"))).toBe(false);
  } finally { clock.mockRestore(); }
});
