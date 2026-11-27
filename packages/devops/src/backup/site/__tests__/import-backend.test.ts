import { afterEach, describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSiteImportBackend, parseSiteImportInput, type SiteImportBackendRequired, type SiteImportHost, type SiteImportWorkspace } from "../import-backend.js";
import type { ImportHttpClient } from "../import-backend-steps.js";
import type { SiteImportRecord } from "@jini-ai/core/contracts/site/site-import-history";
import { SiteShareRefusal } from "../share-refusal.js";
import Database from "better-sqlite3";
import type { ImportHistoryPolicy } from "@jini-ai/core/contracts/site/site-import-history";
import type { SqliteSyncClient } from "@jini-ai/core/contracts/storage";
import { SiteImportRegistry } from "../import-registry.js";
import { createImportIndexStore } from "../import-index/store.js";
import { migrateImportIndex } from "../import-index/schema.js";
import { nodePayload } from "./node-payload.fixture.js";

const roots: string[] = [];
afterEach(() => { for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

const UPLOAD_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const VERIFIED = { name: "Verified Name", database: Buffer.from("db"), files: new Map<string, Buffer>(), warnings: [], modified: new Set<string>(), plugins: [], trustedPlugins: [], credentialWarnings: [] };

/** An in-memory stand-in for the host's durable registry, writing payloads under one temp directory. */
function memoryRegistry(directory: string): SiteImportRegistry {
  const rows = new Map<string, SiteImportRecord>();
  const uploads = new Map<string, { uploadId: string; principalId: string; createdAt: number; consumedBy?: string }>();
  return {
    directory, payloadDirectory: directory, clock: { nowMs: () => Date.now() }, session: { kind: "legacy" }, expire: () => undefined, expirePayloads: () => undefined, countStagedPayloads: () => 0, exclusive: ({ run }: { run: () => Promise<unknown> }) => run(),
    list: ({ principalId }: { principalId: string }) => [...rows.values()].filter((r) => r.principalId === principalId),
    get: ({ importId, principalId }: { importId: string; principalId: string }) => {
      const row = rows.get(importId);
      if (!row || row.principalId !== principalId) throw new SiteShareRefusal({ code: "NOT_FOUND", message: "Import not found." });
      return row;
    }, put: ({ row }: { row: SiteImportRecord }) => { rows.set(row.importId, row); },
    stagePath: (r: SiteImportRecord) => path.join(directory, `${r.importId}.stage`), uploadPath: ({ uploadId }: { uploadId: string }) => path.join(directory, `${uploadId}.upload.zip`),
    saveUpload: ({ row }: { row: { uploadId: string; principalId: string; createdAt: number } }) => { uploads.set(row.uploadId, row); },
    getUpload: ({ uploadId, principalId }: { uploadId: string; principalId: string }) => {
      const upload = uploads.get(uploadId);
      if (!upload || upload.principalId !== principalId) throw new SiteShareRefusal({ code: "NOT_FOUND", message: "Upload not found or expired. Upload the ZIP again." });
      return upload;
    },
  } as unknown as SiteImportRegistry;
}

function fixture(overrides: { host?: Partial<SiteImportHost>; http?: ImportHttpClient; createSite?: SiteImportBackendRequired<SiteImportWorkspace>["createSite"]; registry?: SiteImportRegistry; authority?: SiteImportBackendRequired<SiteImportWorkspace>["authority"] } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "import-backend-"));
  roots.push(directory);
  const registry = overrides.registry ?? memoryRegistry(directory);
  const created: Array<{ name: string; displayName: string; adminPassword: string }> = [];
  const host: SiteImportHost = {
    maxArchiveBytes: 16, maxExpandedBytes: 1, errorLogOptions: {}, copy: { homeSpace: "home", stagingSpace: "staging", downloadFailed: "download failed", uploadTooLarge: "upload too large" },
    developmentDefaultPassword: "dev-default", timeoutMsOf: () => undefined, assertPortableName: () => undefined, reconcileCreation: async () => "failed",
    verifySiteImport: async () => VERIFIED, stageVerifiedImport: ({ root }) => { fs.mkdirSync(root); }, stagedImportWarnings: () => [],
    resolveNewSiteAdminPassword: ({ adminPassword }) => `resolved:${String(adminPassword)}`, tidyImportDatabases: async () => undefined, ...overrides.host,
  };
  const workspace: SiteImportWorkspace = { home: () => directory };
  const backend = createSiteImportBackend({
    authority: overrides.authority ?? { refusal: () => undefined, retire: () => ({ removed: 0, finished: true }) },
    registry, workspace, host, setupBase: "/imports", reader: {} as never, schema: { index: 1, tag: "t" }, sanitize: async () => ({ bytes: Buffer.alloc(0) }),
    http: overrides.http ?? { send: async () => ({ status: 200, headers: { "content-type": "application/zip" }, bodyBytes: Buffer.from("zip"), bodyBytesTruncated: false }) },
    startSite: async () => ({ adminUrl: "http://site.example/admin", status: "running" }),
    createSite: overrides.createSite ?? (async (required, optional) => {
      created.push(required);
      optional.onAllocated({ siteId: "site-1", name: required.name, dbPath: "/db" } as never);
      await optional.verifiedRestore.restore({ dir: "/d", dbPath: "/db", siteId: "site-1" });
      return { siteId: "site-1", name: required.name } as never;
    }),
    restoreStagedImport: async () => undefined,
  });
  return { backend, registry, created, directory };
}

describe("parseSiteImportInput", () => {
  it("accepts one source and refuses an unknown key", () => {
    expect(parseSiteImportInput({ input: { uploadId: UPLOAD_ID } })).toEqual({ source: { uploadId: UPLOAD_ID } });
    expect(() => parseSiteImportInput({ input: { uploadId: UPLOAD_ID, path: "/etc" } })).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
  });
});

describe("createSiteImportBackend", () => {
  it("refuses an upload over the host's archive cap with the host's copy, and stores one within it privately", async () => {
    const { backend, directory } = fixture();
    await expect(backend.upload({ principalId: "p1", archive: Buffer.alloc(17) })).rejects.toMatchObject({ code: "LIMIT_EXCEEDED", message: "upload too large" });
    const { uploadId } = await backend.upload({ principalId: "p1", archive: Buffer.alloc(16) });
    expect(fs.statSync(path.join(directory, `${uploadId}.upload.zip`)).mode & 0o777).toBe(0o600);
  });

  it("downloads, verifies and stages a url import, then completes owner setup through the host's password and creation", async () => {
    const { backend, created } = fixture();
    const pending = await backend.importBackup({ principalId: "p1", source: { url: "https://share.example/a.zip" }, requestId: "r1" });
    expect(pending).toMatchObject({ status: "needs-owner", setupUrl: `/imports/${pending.importId}/owner` });
    const ready = await backend.completeOwner({ principalId: "p1", importId: pending.importId, adminPassword: "pw-1" });
    expect(created).toEqual([{ name: "verified-name", displayName: "Verified Name", adminPassword: "resolved:pw-1" }]);
    expect(ready).toMatchObject({ status: "ready", newSiteId: "site-1", adminUrl: "http://site.example/admin" });
  });

  it("replays the same requestId for the same source and refuses it for another source", async () => {
    const { backend } = fixture();
    const first = await backend.importBackup({ principalId: "p1", source: { url: "https://share.example/a.zip" }, requestId: "r1" });
    expect((await backend.importBackup({ principalId: "p1", source: { url: "https://share.example/a.zip" }, requestId: "r1" })).importId).toBe(first.importId);
    await expect(backend.importBackup({ principalId: "p1", source: { url: "https://share.example/b.zip" }, requestId: "r1" })).rejects.toMatchObject({ code: "REQUEST_CONFLICT" });
  });

  it("records a verification failure on the row, never a raw error, and removes the stage", async () => {
    const { backend, registry } = fixture({ host: { verifySiteImport: async () => { throw new Error("raw sql detail"); } } });
    await expect(backend.importBackup({ principalId: "p1", source: { url: "https://share.example/a.zip" } })).rejects.toThrow("raw sql detail");
    const [failed] = registry.list({ principalId: "p1" } as never) as SiteImportRecord[];
    expect(failed).toMatchObject({ status: "failed", error: "Archive verification failed. No site was created." });
  });

  it("tidies expired payloads through the host", async () => {
    const tidyImportDatabases = vi.fn(async () => undefined);
    await fixture({ host: { tidyImportDatabases } }).backend.tidy({});
    expect(tidyImportDatabases).toHaveBeenCalledOnce();
  });
});

it("verifies exact uploaded bytes, deletes the consumed ZIP, and replays only the original request", async () => {
  const store = vi.fn<SiteImportHost['verifySiteImport']>(async () => VERIFIED);
  const send = vi.fn<ImportHttpClient['send']>();
  const { backend, registry } = fixture({ host: { verifySiteImport: store }, http: { send } });
  const bytes = Buffer.from("archive bytes");
  const { uploadId } = await backend.upload({ principalId: "p1", archive: bytes });
  const input = { principalId: "p1", source: { uploadId }, requestId: "same-request" };

  await expect(backend.importBackup({ ...input, principalId: "other" })).rejects.toMatchObject({
    code: "NOT_FOUND", message: "Upload not found or expired. Upload the ZIP again.",
  });
  expect(fs.readFileSync(registry.uploadPath({ uploadId }))).toEqual(bytes);
  const pending = await backend.importBackup(input);
  expect(pending).toMatchObject({ status: "needs-owner", source: { uploadId } });
  expect(registry.get({ importId: pending.importId, principalId: "p1" }).displayName).toBe("Verified Name");
  expect(fs.existsSync(registry.uploadPath({ uploadId }))).toBe(false);
  expect(registry.getUpload({ uploadId, principalId: "p1" }).consumedBy).toBe(pending.importId);
  expect(await backend.importBackup(input)).toEqual(pending);
  await expect(backend.importBackup({ ...input, requestId: "new-request" })).rejects.toMatchObject({
    code: "UPLOAD_USED", message: "This upload was already imported. Use the original requestId or upload again for a separate site.",
  });
  expect(store.mock.calls.map(([request]) => request.archive)).toEqual([bytes]);
  expect(send).not.toHaveBeenCalled();
});

it("rolls back a failed creation after allocation and removes the verified stage", async () => {
  const cause = new Error("private creation detail");
  const createSite = vi.fn<SiteImportBackendRequired<SiteImportWorkspace>["createSite"]>(async (args, options) => {
    options.onAllocated({ siteId: "site-allocated", name: args.name, dbPath: "/db", dir: "/d" });
    throw cause;
  });
  const { backend, registry } = fixture({ createSite });
  const pending = await backend.importBackup({ principalId: "p1", source: { url: "https://share.example/a.zip" } });
  const lookup = { principalId: "p1", importId: pending.importId };
  expect(fs.existsSync(registry.stagePath(lookup))).toBe(true);

  await expect(backend.completeOwner({ ...lookup, adminPassword: "fixture-password" })).rejects.toBe(cause);

  expect(createSite.mock.calls.map(([args]) => args)).toEqual([{ name: "verified-name", displayName: "Verified Name", adminPassword: "resolved:fixture-password" }]);
  expect(fs.existsSync(registry.stagePath(lookup))).toBe(false);
  expect(backend.get(lookup)).toMatchObject({
    status: "failed", newSiteId: null, newSiteName: null, error: "Site creation failed and was rolled back. Import the archive again.",
  });
});

it("removes the verified stage on cancellation before any site creation", async () => {
  const { backend, registry, created } = fixture();
  const pending = await backend.importBackup({ principalId: "p1", source: { url: "https://share.example/a.zip" } });
  const lookup = { principalId: "p1", importId: pending.importId };
  const controller = new AbortController();
  const cancelled = new Error("operator stopped import");
  controller.abort(cancelled);
  await expect(backend.completeOwner({ ...lookup, adminPassword: "fixture-password" }, { signal: controller.signal })).rejects.toBe(cancelled);
  expect(created).toEqual([]);
  expect(fs.existsSync(registry.stagePath(lookup))).toBe(false);
  expect(backend.get(lookup)).toMatchObject({
    status: "failed", newSiteId: null, newSiteName: null, error: "The import was stopped. No site was created. Import the archive again.",
  });
});

it("pages legacy history by owner and timestamp, using descending id as a stable tiebreaker", async () => {
  const { backend, registry } = fixture();
  const base: Omit<SiteImportRecord, "importId"> = {
    principalId: "p1", source: { uploadId: UPLOAD_ID }, displayName: "Imported",
    status: "ready", createdAt: "2026-11-10T00:00:00.000Z", expiresAt: 0, newSiteId: "site-1", newSiteName: "imported",
  };
  const low = "11111111-1111-1111-1111-111111111111";
  const high = "33333333-3333-3333-3333-333333333333";
  const old = "22222222-2222-2222-2222-222222222222";
  registry.put({ row: { ...base, importId: old, createdAt: "2026-11-01T00:00:00.000Z" } });
  registry.put({ row: { ...base, importId: low } });
  registry.put({ row: { ...base, importId: high } });
  registry.put({ row: { ...base, importId: "44444444-4444-4444-4444-444444444444", principalId: "other" } });
  const first = await backend.listPage({ principalId: "p1", limit: 1 });
  expect(first.imports.map(r => r.importId)).toEqual([high]);
  if (first.nextCursor === undefined) throw new Error("Expected a cursor for the remaining rows");
  const second = await backend.listPage({ principalId: "p1", limit: 2, cursor: first.nextCursor });
  expect(second.imports.map(r => r.importId)).toEqual([low, old]);
  expect(second).not.toHaveProperty("nextCursor");
});

it("removes an uploaded ZIP when its metadata write fails", async () => {
  const { backend, registry, directory } = fixture();
  const error = new Error("metadata store full");
  const save = vi.spyOn(registry, "saveUpload").mockImplementationOnce(() => { throw error; });
  await expect(backend.upload({ principalId: "p1", archive: Buffer.from("archive") })).rejects.toBe(error);
  expect(save.mock.calls.map(([request]) => request.row.principalId)).toEqual(["p1"]);
  expect(fs.readdirSync(directory)).toEqual([]);
  save.mockRestore();
});

it("replays older requests without a stored digest only for the recorded link origin", async () => {
  const verifySiteImport = vi.fn<SiteImportHost["verifySiteImport"]>(async () => VERIFIED);
  const { backend, registry } = fixture({ host: { verifySiteImport } });
  const importId = "11111111-1111-1111-1111-111111111111";
  registry.put({ row: {
    importId, principalId: "p1", requestId: "legacy-request", source: { url: "https://share.example" },
    displayName: "Archived collection", status: "ready", createdAt: "2026-11-10T00:00:00.000Z",
    expiresAt: 0, newSiteId: "existing-site", newSiteName: "archived", adminUrl: "https://admin.example",
  } });
  const call = { principalId: "p1", requestId: "legacy-request" };

  await expect(backend.importBackup({ ...call, source: { url: "https://share.example/relocated.zip?signature=changed" } })).resolves.toMatchObject({
    importId, source: { url: "https://share.example" }, status: "ready", newSiteId: "existing-site", adminUrl: "https://admin.example",
  });
  await expect(backend.importBackup({ ...call, source: { url: "https://unrelated.example/archive.zip" } })).rejects.toMatchObject({
    name: "SiteShareRefusal", code: "REQUEST_CONFLICT", message: "requestId already belongs to another source.",
  });
  expect(verifySiteImport).not.toHaveBeenCalled();
});

it("uses indexed authority for admission, replay, lock-free expiry projection and tidy", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "indexed-import-backend-"));
  roots.push(dir);
  const native = new Database(":memory:");
  let now = Date.parse("2026-11-09T00:00:00Z");
  const clock = { nowMs: () => now };
  const db = native as unknown as SqliteSyncClient;
  const policy: ImportHistoryPolicy = { cutoverPolicy: "enable", historyVisibleMs: 2_592_000_000, replayFenceMs: 31_536_000_000, legacyRetireMs: 2_592_000_000, sweepOnClockRollback: false };
  const sweep = vi.fn();
  const expireHistory = vi.fn();
  const beforeWrite = vi.fn();
  const retire = vi.fn(() => ({ removed: 0, finished: true }));
  try {
    migrateImportIndex({ db, clock });
    const store = createImportIndexStore({ db, clock, policy });
    const session: Extract<SiteImportRegistry["session"], { kind: "index" }> = {
      kind: "index", db, store, policy, beforeWrite, sweep, expireHistory,
    };
    const history: NonNullable<SiteImportRegistry["history"]> = {
      read: ({ run }) => run(session),
      locked: ({ run }) => run(session),
    };
    const payload = nodePayload({ writes: [], locks: [] });
    const registry = new SiteImportRegistry({ directory: dir, history, payload: { ...payload, clock } });
    const verify = vi.fn<SiteImportHost["verifySiteImport"]>(async () => VERIFIED);
    const { backend } = fixture({ registry, authority: { refusal: () => undefined, retire }, host: { verifySiteImport: verify } });
    const input = { principalId: "p1", source: { url: "https://share.example/site.zip" }, requestId: "indexed-request" };
    const pending = await backend.importBackup(input);
    const lookup = { principalId: "p1", importId: pending.importId };
    expect(pending).toMatchObject({ status: "needs-owner", source: input.source });
    expect(backend.get(lookup)).toMatchObject({ status: "needs-owner", setupUrl: `/imports/${pending.importId}/owner` });
    expect(await backend.importBackup(input)).toEqual(pending);
    expect(verify).toHaveBeenCalledOnce();
    expect(beforeWrite.mock.calls).toEqual([[{}, {}], [{}, {}]]);
    expect(sweep).toHaveBeenCalledOnce();
    expect(expireHistory).toHaveBeenCalledOnce();
    expect(fs.existsSync(path.join(dir, pending.importId + ".json"))).toBe(false);
    now += 3_600_001;
    const page = await backend.listPage({ principalId: "p1", limit: 1 });
    expect(page.imports).toEqual(await backend.list({ principalId: "p1" }));
    expect(page.imports).toEqual([backend.get(lookup)]);
    expect(page.imports[0]).toMatchObject({ status: "failed", error: "Owner setup expired", credentialWarnings: [] });
    expect(page.imports[0]).not.toHaveProperty("setupUrl");
    expect(store.statusOf({ importId: pending.importId })).toBe("needs-owner");
    expect(fs.existsSync(registry.stagePath(lookup))).toBe(true);
    expect(retire).not.toHaveBeenCalled();
    await backend.tidy({});
    expect(sweep).toHaveBeenCalledTimes(2);
    expect(expireHistory).toHaveBeenCalledTimes(2);
    expect(retire.mock.calls).toEqual([[{}]]);
    expect(registry.session.kind).toBe("legacy");
  } finally { native.close(); }
});

it("replays the original indexed outcome after the detailed record ages out of history", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "indexed-import-replay-"));
  roots.push(dir);
  const native = new Database(":memory:");
  let now = Date.parse("2026-11-10T00:00:00.000Z");
  const clock = { nowMs: () => now };
  const db = native as unknown as SqliteSyncClient;
  const policy: ImportHistoryPolicy = { cutoverPolicy: "enable", historyVisibleMs: 100, replayFenceMs: 1_000, legacyRetireMs: 200, sweepOnClockRollback: false };
  try {
    migrateImportIndex({ db, clock });
    const store = createImportIndexStore({ db, clock, policy });
    const session: Extract<SiteImportRegistry["session"], { kind: "index" }> = {
      kind: "index", db, store, policy, beforeWrite: () => {}, sweep: () => {}, expireHistory: () => {},
    };
    const registry = new SiteImportRegistry({
      directory: dir, payload: { ...nodePayload({ writes: [], locks: [] }), clock },
      history: { read: ({ run }) => run(session), locked: ({ run }) => run(session) },
    });
    const verifySiteImport = vi.fn<SiteImportHost["verifySiteImport"]>(async () => VERIFIED);
    const { backend, created } = fixture({ registry, host: { verifySiteImport } });
    const request = { principalId: "p1", requestId: "original", source: { url: "https://share.example/private.zip?token=fixture" } };
    const pending = await backend.importBackup(request);
    const ready = await backend.completeOwner({ principalId: "p1", importId: pending.importId, adminPassword: "fixture-password" });
    expect(ready).toMatchObject({ status: "ready", newSiteId: "site-1", adminUrl: "http://site.example/admin" });
    expect(await backend.listPage({ principalId: "p1" })).toMatchObject({ imports: [{ importId: pending.importId, status: "ready" }] });

    now += 101;
    expect(await backend.listPage({ principalId: "p1" })).toEqual({ imports: [] });
    await expect(backend.importBackup(request)).resolves.toMatchObject({
      importId: pending.importId, status: "ready", newSiteId: "site-1", adminUrl: "http://site.example/admin",
      source: { url: "https://share.example" }, credentialWarnings: [],
    });
    expect(verifySiteImport).toHaveBeenCalledOnce();
    expect(created).toEqual([{ name: "verified-name", displayName: "Verified Name", adminPassword: "resolved:fixture-password" }]);
  } finally { native.close(); }
});
