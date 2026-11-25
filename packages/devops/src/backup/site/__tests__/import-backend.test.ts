import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSiteImportBackend, parseSiteImportInput, type SiteImportHost, type SiteImportWorkspace } from "../import-backend.js";
import type { ImportHttpClient } from "../import-backend-steps.js";
import type { SiteImportRecord, SiteImportRegistry } from "../import-registry.js";

const UPLOAD_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const VERIFIED = { name: "Verified Name", database: Buffer.from("db"), files: new Map<string, Buffer>(), warnings: [], modified: new Set<string>(), plugins: [], trustedPlugins: [], credentialWarnings: [] };

/** An in-memory stand-in for the host's durable registry, writing payloads under one temp directory. */
function memoryRegistry(directory: string): SiteImportRegistry {
  const rows = new Map<string, SiteImportRecord>();
  const uploads = new Map<string, { uploadId: string; principalId: string; createdAt: number; consumedBy?: string }>();
  return {
    directory, expire: () => undefined, exclusive: ({ run }: { run: () => Promise<unknown> }) => run(),
    list: ({ principalId }: { principalId: string }) => [...rows.values()].filter((r) => r.principalId === principalId),
    get: ({ importId }: { importId: string }) => rows.get(importId)!, put: ({ row }: { row: SiteImportRecord }) => { rows.set(row.importId, row); },
    stagePath: (r: SiteImportRecord) => path.join(directory, `${r.importId}.stage`), uploadPath: ({ uploadId }: { uploadId: string }) => path.join(directory, `${uploadId}.upload.zip`),
    saveUpload: ({ row }: { row: { uploadId: string; principalId: string; createdAt: number } }) => { uploads.set(row.uploadId, row); },
    getUpload: ({ uploadId }: { uploadId: string }) => uploads.get(uploadId)!,
  } as unknown as SiteImportRegistry;
}

function fixture(overrides: { host?: Partial<SiteImportHost>; http?: ImportHttpClient } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "import-backend-"));
  const registry = memoryRegistry(directory);
  const created: Array<{ name: string; displayName: string; adminPassword: string }> = [];
  const host: SiteImportHost = {
    maxArchiveBytes: 16, maxExpandedBytes: 1, errorLogOptions: {}, copy: { homeSpace: "home", stagingSpace: "staging", downloadFailed: "download failed", uploadTooLarge: "upload too large" },
    developmentDefaultPassword: "dev-default", timeoutMsOf: () => undefined, assertPortableName: () => undefined, reconcileCreation: async () => "failed",
    verifySiteImport: async () => VERIFIED, stageVerifiedImport: ({ root }) => { fs.mkdirSync(root); }, stagedImportWarnings: () => [],
    resolveNewSiteAdminPassword: ({ adminPassword }) => `resolved:${String(adminPassword)}`, tidyImportDatabases: async () => undefined, ...overrides.host,
  };
  const workspace: SiteImportWorkspace = { home: () => directory };
  const backend = createSiteImportBackend({
    registry, workspace, host, setupBase: "/imports", reader: {} as never, schema: { index: 1, tag: "t" }, sanitize: async () => ({ bytes: Buffer.alloc(0) }),
    http: overrides.http ?? { send: async () => ({ status: 200, headers: { "content-type": "application/zip" }, bodyBytes: Buffer.from("zip"), bodyBytesTruncated: false }) },
    startSite: async () => ({ adminUrl: "http://site.example/admin", status: "running" }),
    createSite: async (required, optional) => {
      created.push(required);
      optional.onAllocated({ siteId: "site-1", name: required.name, dbPath: "/db" } as never);
      await optional.verifiedRestore.restore({ dir: "/d", dbPath: "/db", siteId: "site-1" });
      return { siteId: "site-1", name: required.name } as never;
    },
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
