import type { DataModuleDecl } from "@jini-ai/core/contracts/site/db-data-modules";
import type { ArchiveMediaCopy } from "../../archive-media.js";
import { listTables, listColumns } from "@jini-ai/db/kernel";
import { declareDataModule } from "@jini-ai/db/data-modules";
import { expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { sql } from "kysely";
import { mkdtemp, rm, statfs, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sqliteKernel, sqliteClientOf, sqliteConnectionOf, closeSqliteConnection } from "@jini-ai/db/kernel/sqlite";
import { createShareDatabaseProjection, sanitizeShareDatabase, type StagingSpacePort, type ShareProjectionHost } from "../projection.js";
import { prepareSharePluginTables } from "../projection.tables.js";
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
  host.deps.sqliteConnectionOf = () => undefined;
  events.length = 0;
  await expect(projection.rewriteArchiveMedia({ bytes: override.bytes, copies: [] }, { tempRoot: explicitArchive })).rejects.toThrow("Share database has no SQLite connection");
  expect(events).toEqual(["source-close", "archive-cleanup"]);
  host.deps.sqliteConnectionOf = () => { throw new Error("archive failed"); };
  events.length = 0;
  await expect(projection.rewriteArchiveMedia({ bytes: override.bytes, copies: [] }, { tempRoot: explicitArchive })).rejects.toThrow("archive failed");
  expect(events).toEqual(["source-close", "archive-cleanup"]);
  expect(explicitRoots.map(row => row.phase)).toEqual(["sanitize", "archive", "sanitize", "archive", "archive"]);
  expect(roots.map(row => row.phase)).toEqual(["sanitize", "archive"]);
  const db = new Database(":memory:"); const target = host.deps.sqliteKernel({ source: db });
  try {
    expect(await projection.prepareSharePluginTables({ target, present: new Set(), modules: [] })).toEqual({ portable: new Set(), private: new Set() });
    db.exec("CREATE TABLE unknown_populated (value TEXT); INSERT INTO unknown_populated VALUES ('refuse')");
    await expect(projection.refuseUnknownShareTables({ source: target, trusted: new Set() })).rejects.toMatchObject({ code: "UNSUPPORTED_DATA" });
  } finally { await target.close(); }
});

const portableSchema = `
  CREATE TABLE media (id TEXT PRIMARY KEY, workspace_id TEXT, kind TEXT, status TEXT, original_filename TEXT, slug TEXT, source_sha256 TEXT, created_by TEXT, created_at TEXT, source_metadata_json TEXT);
  CREATE TABLE posts (id TEXT, featured_media_id TEXT);
  CREATE TABLE entry_refs (id TEXT, target_kind TEXT, target_id TEXT);
  CREATE TABLE media_slug_history (workspace_id TEXT, media_id TEXT, slug TEXT);
  CREATE TABLE asset_blobs (id TEXT, workspace_id TEXT, sha256 TEXT, storage_key TEXT, status TEXT, content_type TEXT, document_owned INTEGER, created_by_principal TEXT, created_at TEXT, tombstoned_at TEXT, UNIQUE (workspace_id, sha256));
  CREATE TABLE asset_renditions (id TEXT PRIMARY KEY, workspace_id TEXT, asset_id TEXT, transform_name TEXT, version INTEGER, storage_key TEXT, created_at TEXT);
  CREATE TABLE transform_registry (workspace_id TEXT, name TEXT, version INTEGER, params_json TEXT);
  CREATE TABLE setting_definitions (setting_id TEXT, namespace TEXT, key TEXT, secret INTEGER, status TEXT, scopes INTEGER, version INTEGER, schema_json TEXT, default_json TEXT);
  CREATE TABLE setting_values_workspace (setting_id TEXT, def_version INTEGER, workspace_id TEXT, state TEXT, value_json TEXT, updated_by TEXT);
`;
const hashA = "a".repeat(64), hashB = "b".repeat(64), hashC = "c".repeat(64), hashD = "d".repeat(64);
const shareConfig = { searchConfig: "search", projectionVersionSettingId: "version" };
const mediaPath = (hash: string) => `ws/blobs/${hash}`;

function projectionFixture(overrides: Partial<ShareProjectionHost> = {}) {
  const tempRoot: OwnedTempRootScope = async ({ work }) => {
    const root = await mkdtemp(path.join(tmpdir(), "portable-projection-"));
    try { return await work({ root }); } finally { await rm(root, { recursive: true, force: true }); }
  };
  const documentContentType = vi.fn<ShareProjectionHost["documentContentType"]>(({ filename }) => {
    if (!filename.endsWith(".pdf")) throw new Error("Unexpected document type");
    return "application/pdf";
  });
  const host = {
    deps: { listTables, listColumns, declareDataModule, sqliteKernel, sqliteClientOf, sqliteConnectionOf, closeSqliteConnection },
    SHARE_LIMITS: { maxExpandedBytes: 1024 * 1024 }, SHARE_TABLES: ["media", "posts", "entry_refs", "media_slug_history", "asset_blobs", "asset_renditions", "transform_registry"],
    SHARE_LEGACY_PRIVATE_TABLES: new Set<string>(), CHAT_TABLE_NAMES: [], PUBLISHABLE_SETTINGS: { "theme:headline": true, "theme:wrong-default": true, "theme:site-only": true, "theme:secret": true },
    statfs: async () => ({ bavail: 100000, bsize: 4096 }), writeFile, databaseCapMessage: "too large", insufficientStorageMessage: "not enough space",
    redactSecretShapes: ({ text }: { text: string }) => ({ text: text.replaceAll("fixture-marker", "[REDACTED:labeled_secret]"), redactions: text.includes("fixture-marker") ? 1 : 0 }),
    tempRoot, openSqliteFileKernel: ({ filePath }: { filePath: string }, options: { readOnly?: boolean } = {}) => sqliteKernel({ source: new Database(filePath, { readonly: options.readOnly }) }),
    openContentDb: () => { const db = new Database(":memory:"); db.exec(portableSchema); return db; },
    sql, schemaErasedKernel: ({ store }: Parameters<ShareProjectionHost["schemaErasedKernel"]>[0]) => sqliteKernel({ source: store }),
    backfillPostSearchIndex: async () => 0, documentContentType,
    computeBlobStorageKey: ({ workspaceId, sha256 }: { workspaceId: string; sha256: string }) => `${workspaceId}/blobs/${sha256}`,
    ...overrides,
  } as unknown as ShareProjectionHost;
  return { projection: createShareDatabaseProjection({ host, archiveMediaTempRoot: tempRoot }), host, documentContentType };
}

function mediaSnapshot(mutate: (db: Database.Database) => void = () => {}): Buffer {
  const db = new Database(":memory:");
  try {
    db.exec(portableSchema);
    const media = db.prepare("INSERT INTO media VALUES (?, 'ws', ?, ?, ?, ?, ?, 'source-user', 't0', NULL)");
    media.run("image", "media", "active", null, "photo", hashA);
    media.run("doc", "document", "active", "guide.pdf", "guide", hashB);
    media.run("trashed", "document", "trash", "trashed.pdf", null, hashC);
    media.run("omitted", "media", "active", null, "removed", hashD);
    const blob = db.prepare("INSERT INTO asset_blobs VALUES (?, 'ws', ?, ?, 'active', ?, 0, 'source-user', 't0', NULL)");
    for (const [id, hash, type] of [["image", hashA, "image/png"], ["doc", hashB, "application/pdf"], ["trashed", hashC, "application/pdf"], ["omitted", hashD, "image/png"]]) blob.run(id, hash, mediaPath(hash), type);
    const rendition = db.prepare("INSERT INTO asset_renditions VALUES (?, 'ws', ?, ?, ?, ?, 't0')");
    rendition.run("image:old", "image", "public", 1, "unused/1");
    rendition.run("image:public", "image", "public", 2, mediaPath(hashA));
    rendition.run("doc:original", "doc", "original", 1, mediaPath(hashB));
    rendition.run("doc:thumbnail", "doc", "thumbnail", 2, mediaPath(hashB));
    rendition.run("omitted:original", "omitted", "original", 1, mediaPath(hashD));
    db.exec(`
      INSERT INTO media_slug_history VALUES ('ws','image','photo-prev'), ('ws','omitted','old'), ('other','image','wrong-workspace');
      INSERT INTO posts VALUES ('one','image'), ('two','omitted');
      INSERT INTO entry_refs VALUES ('media-ref','media','omitted'), ('page-ref','page','omitted');
      INSERT INTO transform_registry VALUES ('ws','public',2,'{"format":"webp"}'), ('ws','public',1,'{"format":"png"}');
    `);
    mutate(db);
    return db.serialize();
  } finally { db.close(); }
}

it("projects retained media by workspace, keeps document bytes private and removes omitted references", async () => {
  const { projection, documentContentType } = projectionFixture();
  const result = await projection.sanitizeShareDatabase({ snapshot: mediaSnapshot(), modules: [], searchHost: shareConfig, omittedMediaIds: ["omitted"] });
  expect(result.documents).toEqual([{ storageKey: mediaPath(hashB), sha256: hashB, originalFilename: "guide.pdf" }]);
  expect(documentContentType.mock.calls).toEqual([[{ filename: "guide.pdf" }]]);
  const byId = new Map(result.archiveMedia?.map(item => [item.id, item]));
  expect(byId).toEqual(new Map([
    ["image", { id: "image", workspaceId: "ws", slug: "photo", kind: "media", originalFilename: null, storageKey: mediaPath(hashA), sha256: hashA, documentOwned: false,
      public: { version: 2, params: { format: "webp" }, storageKey: mediaPath(hashA), sha256: hashA } }],
    ["doc", { id: "doc", workspaceId: "ws", slug: "guide", kind: "document", originalFilename: "guide.pdf", storageKey: mediaPath(hashB), sha256: hashB, documentOwned: true,
      public: { version: 2, params: { format: "webp" } } }],
  ]));
  const portable = new Database(result.bytes);
  try {
    expect(portable.prepare("SELECT id, created_by FROM media ORDER BY id").all()).toEqual([{ id: "doc", created_by: null }, { id: "image", created_by: "source-user" }]);
    expect(portable.prepare("SELECT id, document_owned, created_by_principal FROM asset_blobs ORDER BY id").all()).toEqual([
      { id: "doc", document_owned: 1, created_by_principal: "share" }, { id: "image", document_owned: 0, created_by_principal: "source-user" },
    ]);
    expect(portable.prepare("SELECT id FROM asset_renditions ORDER BY id").all()).toEqual([{ id: "doc:original" }, { id: "image:old" }, { id: "image:public" }]);
    expect(portable.prepare("SELECT slug FROM media_slug_history").all()).toEqual([{ slug: "photo-prev" }]);
    expect(portable.prepare("SELECT id, featured_media_id FROM posts ORDER BY id").all()).toEqual([{ id: "one", featured_media_id: "image" }, { id: "two", featured_media_id: null }]);
    expect(portable.prepare("SELECT id FROM entry_refs").all()).toEqual([{ id: "page-ref" }]);
  } finally { portable.close(); }
});

it.each([
  { sql: "UPDATE media SET kind='other' WHERE id='doc'", code: "INVALID_DOCUMENT", message: "Unsupported media kind in share database." },
  { sql: "UPDATE asset_renditions SET storage_key=? WHERE id='image:public'", args: [mediaPath(hashB)], code: "INVALID_DOCUMENT", message: "Ordinary rendition references a private document blob." },
  { sql: "UPDATE asset_renditions SET storage_key=? WHERE id='doc:original'", args: [mediaPath(hashA)], code: "INVALID_DOCUMENT", message: "Document original rendition has an invalid blob key." },
  { sql: "UPDATE asset_blobs SET status='trash' WHERE id='doc'", code: "INVALID_DOCUMENT", message: "Document source blob is missing or has an invalid key/hash." },
  { sql: "DELETE FROM asset_blobs WHERE id='image'", code: "MISSING_MEDIA", message: "Media 'image' has no source blob." },
])("refuses a nonportable media reference with its specific diagnostic ($message)", async ({ sql: statement, args, code, message }) => {
  const { projection } = projectionFixture();
  const snapshot = mediaSnapshot(db => { db.prepare(statement).run(...(args ?? [])); });
  await expect(projection.sanitizeShareDatabase({ snapshot, modules: [], searchHost: shareConfig })).rejects.toMatchObject({ code, message });
});

it("rebuilds only original and current public renditions and preserves existing content type and document ownership", async () => {
  const { projection } = projectionFixture();
  const projected = await projection.sanitizeShareDatabase({ snapshot: mediaSnapshot(), modules: [], searchHost: shareConfig, omittedMediaIds: ["omitted"] });
  const copies: ArchiveMediaCopy[] = [
    { id: "image", slug: "photo", workspaceId: "ws", path: "media/photo.webp", storageKey: "archive/photo.webp", sha256: hashD, contentType: "image/webp", publicVersion: 2 },
    { id: "doc", slug: "guide", workspaceId: "ws", path: "media/guide.pdf", storageKey: "archive/guide.pdf", sha256: hashB, contentType: "application/octet-stream" },
  ];
  await expect(projection.rewriteArchiveMedia({ bytes: projected.bytes, copies: copies.slice(0, 1) })).rejects.toMatchObject({
    code: "INVALID_MEDIA", message: "Archive media does not cover the snapshot.",
  });
  await expect(projection.rewriteArchiveMedia({ bytes: projected.bytes, copies: [copies[0]!, { ...copies[1]!, workspaceId: "other" }] })).rejects.toMatchObject({
    code: "INVALID_MEDIA", message: "Unknown archive media item.",
  });
  const rewritten = new Database(await projection.rewriteArchiveMedia({ bytes: projected.bytes, copies }));
  try {
    expect(rewritten.prepare("SELECT id, source_sha256 FROM media ORDER BY id").all()).toEqual([{ id: "doc", source_sha256: hashB }, { id: "image", source_sha256: hashD }]);
    expect(rewritten.prepare("SELECT storage_key, content_type, document_owned FROM asset_blobs ORDER BY storage_key").all()).toEqual([
      { storage_key: "archive/guide.pdf", content_type: "application/pdf", document_owned: 1 },
      { storage_key: "archive/photo.webp", content_type: "image/webp", document_owned: 0 },
    ]);
    expect(rewritten.prepare("SELECT asset_id, transform_name, version, storage_key FROM asset_renditions ORDER BY asset_id, transform_name").all()).toEqual([
      { asset_id: "doc", transform_name: "original", version: 1, storage_key: "archive/guide.pdf" },
      { asset_id: "image", transform_name: "original", version: 1, storage_key: "archive/photo.webp" },
      { asset_id: "image", transform_name: "public", version: 2, storage_key: "archive/photo.webp" },
    ]);
  } finally { rewritten.close(); }
});

it("preserves document ownership when an active public item shares the same archive bytes", async () => {
  const { projection } = projectionFixture();
  const snapshot = mediaSnapshot(db => {
    db.prepare("UPDATE media SET source_sha256=? WHERE id='image'").run(hashB);
    db.prepare("UPDATE asset_renditions SET storage_key=? WHERE id='image:public'").run(mediaPath(hashB));
  });
  const projected = await projection.sanitizeShareDatabase({
    snapshot, modules: [], searchHost: shareConfig, omittedMediaIds: ["omitted"],
  });
  expect(new Map(projected.archiveMedia?.map(item => [item.id, { sha256: item.sha256, documentOwned: item.documentOwned }]))).toEqual(new Map([
    ["image", { sha256: hashB, documentOwned: true }], ["doc", { sha256: hashB, documentOwned: true }],
  ]));
  const shared = { workspaceId: "ws", path: "media/shared.pdf", storageKey: "archive/shared.pdf", sha256: hashB, contentType: "application/pdf" };
  const rewritten = new Database(await projection.rewriteArchiveMedia({ bytes: projected.bytes, copies: [
    { ...shared, id: "image", slug: "photo", publicVersion: 2 },
    { ...shared, id: "doc", slug: "guide" },
  ] }));
  try {
    expect(rewritten.prepare("SELECT sha256, storage_key, document_owned FROM asset_blobs").all()).toEqual([
      { sha256: hashB, storage_key: "archive/shared.pdf", document_owned: 1 },
    ]);
    expect(rewritten.prepare("SELECT asset_id, transform_name, storage_key FROM asset_renditions ORDER BY asset_id, transform_name").all()).toEqual([
      { asset_id: "doc", transform_name: "original", storage_key: "archive/shared.pdf" },
      { asset_id: "image", transform_name: "original", storage_key: "archive/shared.pdf" },
      { asset_id: "image", transform_name: "public", storage_key: "archive/shared.pdf" },
    ]);
  } finally { rewritten.close(); }
});

it.each([
  { key: "renditions/public/" + hashC, expectedHash: hashC },
  { key: "renditions/public/external", expectedHash: undefined },
])("preserves public renditions whose key is not backed by a blob ($key)", async ({ key, expectedHash }) => {
  const { projection } = projectionFixture();
  const snapshot = mediaSnapshot(db => {
    db.prepare("UPDATE asset_renditions SET storage_key=? WHERE id='image:public'").run(key);
    db.exec("UPDATE media SET slug=NULL WHERE id='image'");
  });
  const projected = await projection.sanitizeShareDatabase({ snapshot, modules: [], searchHost: shareConfig });
  const item = projected.archiveMedia?.find(media => media.id === "image");
  expect(item).toMatchObject({ id: "image", slug: "image", storageKey: mediaPath(hashA) });
  expect(item?.public).toEqual({
    version: 2, params: { format: "webp" }, storageKey: key, ...(expectedHash === undefined ? {} : { sha256: expectedHash }),
  });
});

const moduleDecl: DataModuleDecl = {
  pluginId: "library", pluginTier: "tier-2", provenance: { sourceUrl: "https://example.test/library", publisher: "Fixture" },
  tables: [
    { name: "titles", columns: [{ name: "id", type: "TEXT", primaryKey: true }, { name: "title", type: "TEXT" }, { name: "notes", type: "TEXT" }],
      portability: { kind: "portable", columns: ["id", "title"] } },
    { name: "members", columns: [{ name: "email", type: "TEXT" }], portability: { kind: "private" } },
  ],
};

it("copies only allowlisted plugin columns and current workspace settings, preserving warning locations", async () => {
  const { projection } = projectionFixture();
  const snapshot = mediaSnapshot(db => {
    db.exec(`CREATE TABLE p_library__titles (id TEXT, title TEXT, notes TEXT);
      INSERT INTO p_library__titles VALUES ('book','fixture-marker','private note');
      CREATE TABLE p_library__members (email TEXT);
      INSERT INTO p_library__members VALUES ('private member');`);
    const insertDefinition = db.prepare("INSERT INTO setting_definitions VALUES (?, 'theme', ?, ?, 'active', ?, 2, ?, ?)");
    for (const [id, key, secret, scope, fallback] of [
      ["s1", "headline", 0, 2, '"default"'], ["s2", "wrong-default", 0, 2, "1"], ["s3", "site-only", 0, 1, '"default"'],
      ["s4", "secret", 1, 2, '"default"'], ["s5", "not-allowed", 0, 2, '"default"'],
    ]) insertDefinition.run(id, key, secret, scope, '{"type":"string"}', fallback);
    const insertValue = db.prepare("INSERT INTO setting_values_workspace VALUES ('s1', ?, ?, ?, ?, 'owner')");
    insertValue.run(2, "current", "set", '"fixture-marker"');
    insertValue.run(2, "cleared", "cleared", null);
    insertValue.run(2, "invalid", "set", '29');
    insertValue.run(1, "old", "set", '"old"');
  });
  const result = await projection.sanitizeShareDatabase({ snapshot, modules: [moduleDecl], searchHost: shareConfig });
  const db = new Database(result.bytes);
  try {
    expect(db.prepare("SELECT * FROM p_library__titles").all()).toEqual([{ id: "book", title: "fixture-marker" }]);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='p_library__members'").all()).toEqual([]);
    expect(db.prepare("SELECT setting_id FROM setting_definitions").all()).toEqual([{ setting_id: "s1" }]);
    expect(db.prepare("SELECT workspace_id, state, value_json, updated_by FROM setting_values_workspace ORDER BY workspace_id").all()).toEqual([
      { workspace_id: "cleared", state: "cleared", value_json: "null", updated_by: "share" },
      { workspace_id: "current", state: "set", value_json: '"fixture-marker"', updated_by: "share" },
    ]);
    expect(result.credentialWarnings).toEqual([
      { path: "content.db:p_library__titles.title", kind: "labeled secret" },
      { path: "content.db:setting_values_workspace.value_json", kind: "labeled secret" },
    ]);
  } finally { db.close(); }
});

it("fills additive fields in older media tables but refuses a new unapproved core column", async () => {
  const { projection } = projectionFixture();
  const legacy = mediaSnapshot(db => {
    db.exec("ALTER TABLE media DROP COLUMN source_metadata_json; ALTER TABLE asset_blobs DROP COLUMN document_owned;");
  });
  const projected = await projection.sanitizeShareDatabase({ snapshot: legacy, modules: [], searchHost: shareConfig, omittedMediaIds: ["omitted"] });
  const db = new Database(projected.bytes);
  try {
    expect(db.prepare("SELECT id, source_metadata_json FROM media ORDER BY id").all()).toEqual([
      { id: "doc", source_metadata_json: null }, { id: "image", source_metadata_json: null },
    ]);
    expect(db.prepare("SELECT id, document_owned FROM asset_blobs ORDER BY id").all()).toEqual([
      { id: "doc", document_owned: 1 }, { id: "image", document_owned: 0 },
    ]);
  } finally { db.close(); }
  const updated = mediaSnapshot(source => {
    source.exec("ALTER TABLE media ADD COLUMN private_label TEXT; UPDATE media SET private_label='private' WHERE id='image';");
  });
  await expect(projection.sanitizeShareDatabase({ snapshot: updated, modules: [], searchHost: shareConfig })).rejects.toMatchObject({
    name: "SiteShareRefusal", code: "UNSUPPORTED_SCHEMA",
    message: "Cannot share 'media': its columns differ from the trusted current schema. Update the site first.",
  });
});

it("refuses undeclared portable columns and exposes only safe text for a DDL adapter refusal", async () => {
  const { host } = projectionFixture();
  const db = new Database(":memory:");
  const target = host.deps.sqliteKernel({ source: db });
  const error = vi.fn();
  const declare = vi.fn<ShareProjectionHost["deps"]["declareDataModule"]>(async () => ({ ok: false, error: { message: "cannot apply fixture-marker" } }));
  const bound = { ...host, deps: { ...host.deps, declareDataModule: declare } };
  const present = new Set(["p_library__titles"]);
  try {
    await expect(prepareSharePluginTables({ host: bound, target, present, modules: [
      { ...moduleDecl, tables: [{ ...moduleDecl.tables[0]!, portability: { kind: "portable", columns: ["unknown"] } }] },
    ] }, { logger: { error } })).rejects.toMatchObject({
      code: "UNSUPPORTED_SCHEMA", message: "Invalid portable columns for 'p_library__titles': its portability policy names a column the table does not declare.",
    });
    expect(declare).not.toHaveBeenCalled();
    await expect(prepareSharePluginTables({ host: bound, target, present, modules: [moduleDecl] }, { logger: { error } })).rejects.toMatchObject({
      code: "UNSUPPORTED_SCHEMA", message: "Cannot build portable plugin schema for 'library': the bundled portable-data declaration could not be installed.",
    });
    expect(error.mock.calls).toEqual([[{ message: "Cannot build portable plugin schema" }, { meta: { diagnostic: "cannot apply [REDACTED:labeled_secret]" } }]]);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='p_library__titles'").all()).toEqual([]);
  } finally { await target.close(); }
});
