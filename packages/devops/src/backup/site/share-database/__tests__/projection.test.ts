import { listTables, listColumns } from "@jini-ai/db/kernel";
import { declareDataModule } from "@jini-ai/db/data-modules";
import { expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { sql } from "kysely";
import { mkdtemp, rm, statfs, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sqliteKernel, sqliteClientOf, sqliteConnectionOf, closeSqliteConnection } from "@jini-ai/db/kernel/sqlite";
import { createShareDatabaseProjection, sanitizeShareDatabase, type StagingSpacePort } from "../projection.js";
import type { OwnedTempRootScope } from "../../owned-temp-root.js";

it("refuses an unknown populated source table before portable projection or search backfill", async () => {
  const source = new Database(":memory:");
  source.exec("CREATE TABLE unexpected (value TEXT); INSERT INTO unexpected VALUES ('fixture')");
  const snapshot = source.serialize(); source.close();
  const backfillPostSearchIndex = vi.fn();
  let fresh: Database.Database | undefined;
  const host = {
    deps: { listTables, listColumns, declareDataModule, sqliteKernel, sqliteClientOf, sqliteConnectionOf, closeSqliteConnection },
    SHARE_LIMITS: { maxExpandedBytes: 1024 * 1024 }, SHARE_TABLES: ["portable"], SHARE_LEGACY_PRIVATE_TABLES: new Set(), CHAT_TABLE_NAMES: [],
    statfs, writeFile, databaseCapMessage: "cap", insufficientStorageMessage: "space", redactSecretShapes: ({ text }: { text: string }) => ({ text }),
    tempRoot: async ({ work }: { work: (required: { root: string }) => Promise<unknown> }) => { const root = await mkdtemp(path.join(tmpdir(), "wmz-projection-")); try { return await work({ root }); } finally { await rm(root, { recursive: true, force: true }); } },
    openSqliteFileKernel: ({ filePath }: { filePath: string }, options: { readOnly?: boolean } = {}) => sqliteKernel({ source: new Database(filePath, { readonly: options.readOnly }) }),
    openContentDb: () => { fresh = new Database(":memory:"); fresh.exec("CREATE TABLE portable (id TEXT)"); return fresh; },
    sql, backfillPostSearchIndex,
  } as unknown as Parameters<typeof sanitizeShareDatabase>[0]["host"];
  await expect(sanitizeShareDatabase({ snapshot, modules: [], searchHost: {} as never, host })).rejects.toMatchObject({ code: "UNSUPPORTED_DATA", message: "Cannot share unsupported nonempty table 'unexpected'. Add an approved portable-data policy for this table first." });
  expect(backfillPostSearchIndex).not.toHaveBeenCalled(); expect(fresh?.open).toBe(false);
});

it("binds trusted bootstrap and preserves explicit staging scopes (mutation: overwrite-archive-temp-root)", async () => {
  const source = new Database(":memory:");
  const schema = "CREATE TABLE media (id TEXT, kind TEXT); CREATE TABLE asset_blobs (storage_key TEXT, sha256 TEXT); CREATE TABLE asset_renditions (storage_key TEXT, transform_name TEXT); CREATE TABLE transform_registry (workspace_id TEXT, name TEXT, version INTEGER); CREATE TABLE setting_definitions (secret INTEGER, status TEXT); CREATE TABLE setting_values_workspace (definition_id TEXT);";
  source.exec(schema);
  source.exec("CREATE TABLE source_only (value TEXT); CREATE TRIGGER untrusted_trigger AFTER INSERT ON source_only BEGIN DELETE FROM media; END;");
  const snapshot = source.serialize(); source.close();
  const roots: { phase: string; root: string }[] = [];
  const resources: Database.Database[] = [];
  const events: string[] = [];
  const explicitRoots: { phase: string; root: string }[] = [];
  const explicitProjection: OwnedTempRootScope = async ({ work }) => {
    const root = await mkdtemp(path.join(tmpdir(), "explicit-projection-")); explicitRoots.push({ phase: "sanitize", root });
    try { return await work({ root }); } finally {
      expect(resources.every(db => !db.open)).toBe(true); events.push("sanitize-cleanup");
      await rm(root, { recursive: true, force: true });
    }
  };
  const explicitArchive: OwnedTempRootScope = async ({ work }) => {
    const root = await mkdtemp(path.join(tmpdir(), "explicit-archive-")); explicitRoots.push({ phase: "archive", root });
    try { return await work({ root }); } finally {
      expect(resources.every(db => !db.open)).toBe(true); events.push("archive-cleanup");
      await rm(root, { recursive: true, force: true });
    }
  };
  const tempRoot: OwnedTempRootScope = async ({ work }) => {
    const root = await mkdtemp(path.join(tmpdir(), "share-projection-")); roots.push({ phase: "sanitize", root });
    try { return await work({ root }); } finally { await rm(root, { recursive: true, force: true }); }
  };
  const archiveMediaTempRoot: OwnedTempRootScope = async ({ work }) => {
    const root = await mkdtemp(path.join(tmpdir(), "share-media-")); roots.push({ phase: "archive", root });
    try { return await work({ root }); } finally { await rm(root, { recursive: true, force: true }); }
  };
  const openContentDb = vi.fn(() => { const db = new Database(":memory:"); resources.push(db); db.exec(schema); return db; });
  const backfillPostSearchIndex = vi.fn(async () => 0);
  const host = {
    deps: { listTables, listColumns, declareDataModule, sqliteKernel, sqliteClientOf, sqliteConnectionOf, closeSqliteConnection },
    SHARE_LIMITS: { maxExpandedBytes: 1024 * 1024 }, SHARE_TABLES: ["media", "asset_blobs", "asset_renditions", "transform_registry"], SHARE_LEGACY_PRIVATE_TABLES: new Set<string>(), CHAT_TABLE_NAMES: [], PUBLISHABLE_SETTINGS: {},
    statfs, writeFile, databaseCapMessage: "cap", insufficientStorageMessage: "space", redactSecretShapes: ({ text }: { text: string }) => ({ text }), tempRoot,
    openSqliteFileKernel: ({ filePath }: { filePath: string }, options: { readOnly?: boolean } = {}) => sqliteKernel({ source: new Database(filePath, { readonly: options.readOnly }) }),
    openContentDb, sql, schemaErasedKernel: ({ store }: Parameters<Parameters<typeof sanitizeShareDatabase>[0]["host"]["schemaErasedKernel"]>[0]) => sqliteKernel({ source: store }), backfillPostSearchIndex,
  } as unknown as Parameters<typeof sanitizeShareDatabase>[0]["host"];
  const openSource = vi.fn(host.openSqliteFileKernel);
  host.openSqliteFileKernel = (input, optional) => {
    const kernel = openSource(input, optional);
    const close = kernel.close.bind(kernel);
    kernel.close = async () => { await close(); events.push("source-close"); };
    return kernel;
  };
  host.deps.closeSqliteConnection = input => { closeSqliteConnection(input); events.push("fresh-close"); };
  const writer = vi.fn(writeFile); host.writeFile = writer;
  const probe = vi.fn<StagingSpacePort>(file => statfs(file)); host.statfs = probe;
  const projection = createShareDatabaseProjection({ host, archiveMediaTempRoot });
  const projected = await projection.sanitizeShareDatabase({ snapshot, modules: [], searchHost: { searchConfig: "search", projectionVersionSettingId: "version" } });
  expect(openContentDb).toHaveBeenCalledOnce(); expect(backfillPostSearchIndex).toHaveBeenCalledOnce();
  const rebuilt = new Database(projected.bytes);
  expect(rebuilt.prepare("SELECT name FROM sqlite_master WHERE name IN ('source_only', 'untrusted_trigger')").all()).toEqual([]);
  rebuilt.close();
  const rewritten = await projection.rewriteArchiveMedia({ bytes: projected.bytes, copies: [] });
  expect(rewritten.length).toBeGreaterThan(0); expect(roots.map(row => row.phase)).toEqual(["sanitize", "archive"]);
  expect(roots[0]?.root).not.toBe(roots[1]?.root);
  const overrideProbe = vi.fn(async () => ({ bavail: 100000, bsize: 4096 }));
  events.length = 0;
  const override = await projection.sanitizeShareDatabase({ snapshot, modules: [], searchHost: { searchConfig: "search", projectionVersionSettingId: "version" } }, { tempRoot: explicitProjection, statfs: overrideProbe });
  expect(events).toEqual(["source-close", "fresh-close", "sanitize-cleanup"]);
  expect(probe).toHaveBeenCalledOnce();
  expect(overrideProbe).toHaveBeenCalledWith(explicitRoots[0]!.root);
  expect(writer).toHaveBeenLastCalledWith(path.join(explicitRoots[0]!.root, "snapshot.db"), snapshot, { flag: "wx", mode: 0o600 });
  expect(openSource).toHaveBeenLastCalledWith({ filePath: path.join(explicitRoots[0]!.root, "snapshot.db") }, { readOnly: true });
  events.length = 0;
  await projection.rewriteArchiveMedia({ bytes: override.bytes, copies: [] }, { tempRoot: explicitArchive });
  expect(events).toEqual(["source-close", "archive-cleanup"]);
  expect(writer).toHaveBeenLastCalledWith(path.join(explicitRoots[1]!.root, "content.db"), override.bytes, { mode: 0o600, flag: "wx" });
  expect(openSource).toHaveBeenLastCalledWith({ filePath: path.join(explicitRoots[1]!.root, "content.db") }, undefined);
  backfillPostSearchIndex.mockRejectedValueOnce(new Error("projection failed"));
  events.length = 0;
  await expect(projection.sanitizeShareDatabase({ snapshot, modules: [], searchHost: { searchConfig: "search", projectionVersionSettingId: "version" } }, { tempRoot: explicitProjection })).rejects.toThrow("projection failed");
  expect(events).toEqual(["source-close", "fresh-close", "sanitize-cleanup"]);
  host.deps.sqliteConnectionOf = () => { throw new Error("archive failed"); };
  events.length = 0;
  await expect(projection.rewriteArchiveMedia({ bytes: override.bytes, copies: [] }, { tempRoot: explicitArchive })).rejects.toThrow("archive failed");
  expect(events).toEqual(["source-close", "archive-cleanup"]);
  expect(explicitRoots.map(row => row.phase)).toEqual(["sanitize", "archive", "sanitize", "archive"]);
  expect(roots.map(row => row.phase)).toEqual(["sanitize", "archive"]);
  const db = new Database(":memory:"); const target = host.deps.sqliteKernel({ source: db });
  try {
    expect(await projection.prepareSharePluginTables({ target, present: new Set(), modules: [] })).toEqual({ portable: new Set(), private: new Set() });
    db.exec("CREATE TABLE unknown_populated (value TEXT); INSERT INTO unknown_populated VALUES ('refuse')");
    await expect(projection.refuseUnknownShareTables({ source: target, trusted: new Set() })).rejects.toMatchObject({ code: "UNSUPPORTED_DATA" });
  } finally { await target.close(); }
});
