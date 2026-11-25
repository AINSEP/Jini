import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentPluginLayout } from "@jini-ai/core/contracts/headless/plugin-host";
import type { DbOpsPort } from "@jini-ai/core/contracts/site/gated-mutations-ports";
import type { PluginDiscoveryRecord } from "@jini-ai/core/contracts/site/host-node";
import { SiteShareRefusal } from "../share-refusal.js";
import {
  buildSiteBackupManifest,
  captureDatabaseSnapshot,
  checkSiteBackupLimits,
  collectSiteBackupFiles,
  formatByteSize,
  readPlannedFile,
  skipOversizedFiles,
  type PlannedDiskFile,
  type SiteBackupInclude,
  type SiteBackupSourceDeps,
  type SiteBackupSources,
} from "../sources.js";

const NONE: SiteBackupInclude = { database: false, media: false, themes: false, plugins: false, settings: false };
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); vi.restoreAllMocks(); });

function tmp(): string {
  const root = mkdtempSync(path.join(tmpdir(), "devops-sources-"));
  roots.push(root);
  return root;
}
function write(file: string, content: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}
const sha = (text: string): string => createHash("sha256").update(text).digest("hex");

function makeDeps(over: Partial<SiteBackupSourceDeps> = {}): SiteBackupSourceDeps {
  return {
    sharePolicy: { excludedSharePath: () => false, validateSharePath: () => undefined, checkShareLimits: () => undefined },
    listSitePluginPackage: async () => { throw new Error("no plugins"); },
    isPluginPackagePathError: () => false,
    readReviewedFile: async ({ file }) => (existsSync(file.absPath) ? Buffer.from("bytes") : null),
    reviewedFileIdentity: ({ info }) => `id:${info.ino}`,
    mediaInObjectStorageNote: "host media note",
    ...over,
  };
}
function makeSources(siteDir: string, over: Partial<SiteBackupSources> = {}): SiteBackupSources {
  const layout = { root: path.join(siteDir, "ap"), workspacesDir: path.join(siteDir, "ap", "ws"), forWorkspace: () => { throw new Error("unused"); } } as unknown as AgentPluginLayout;
  return { siteDir, mediaUploadsDir: null, themesDir: path.join(siteDir, "themes"), agentPlugins: layout, skillsDir: path.join(siteDir, "skills"), ...over };
}

describe("collectSiteBackupFiles", () => {
  it("walks a scope sorted, drops junk, reports links and stamps the injected identity", async () => {
    const site = tmp();
    write(path.join(site, "themes/b.css"), "b");
    write(path.join(site, "themes/a/index.html"), "a");
    write(path.join(site, "themes/.DS_Store"), "junk");
    write(path.join(site, "themes/.git/config"), "junk");
    symlinkSync(site, path.join(site, "themes/link"));
    const out = await collectSiteBackupFiles({ sources: makeSources(site), include: { ...NONE, themes: true }, deps: makeDeps() });
    expect(out.files.map(f => f.path)).toEqual(["themes/a/index.html", "themes/b.css"]);
    expect(out.files.every(f => f.identity?.startsWith("id:"))).toBe(true);
    expect(out.skipped.map(s => s.path)).toEqual(["themes/link"]);
  });

  it("notes media living in object storage with the host's own text", async () => {
    const site = tmp();
    const out = await collectSiteBackupFiles({ sources: makeSources(site), include: { ...NONE, media: true }, deps: makeDeps() });
    expect(out.scopeNotes.media).toBe("host media note");
  });

  it("asks the injected share policy about every share path and surfaces its refusal", async () => {
    const site = tmp();
    write(path.join(site, "themes/keep.css"), "k");
    write(path.join(site, "themes/secret.txt"), "s");
    const seen: string[] = [];
    const deps = makeDeps({ sharePolicy: {
      excludedSharePath: ({ path: p }, optional) => { if (p.endsWith("secret.txt")) { optional?.notices?.push(`left out ${p}`); return true; } return false; },
      validateSharePath: ({ path: p }) => { seen.push(p); },
      checkShareLimits: () => undefined,
    } });
    const out = await collectSiteBackupFiles({ sources: makeSources(site), include: { ...NONE, themes: true }, deps }, { profile: "share" });
    expect(out.files.map(f => f.path)).toEqual(["themes/keep.css"]);
    expect(out.notices).toEqual(["left out themes/secret.txt"]);
    expect(seen).toContain("themes/keep.css");
    const refusing = makeDeps({ sharePolicy: { ...deps.sharePolicy, checkShareLimits: () => { throw new SiteShareRefusal({ code: "LIMIT_EXCEEDED", message: "too big" }); } } });
    await expect(collectSiteBackupFiles({ sources: makeSources(site), include: { ...NONE, themes: true }, deps: refusing }, { profile: "share" })).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
  });

  it("refuses a hardlinked share file", async () => {
    const site = tmp();
    write(path.join(site, "themes/a.css"), "a");
    const { linkSync } = await import("node:fs");
    linkSync(path.join(site, "themes/a.css"), path.join(site, "themes/b.css"));
    await expect(collectSiteBackupFiles({ sources: makeSources(site), include: { ...NONE, themes: true }, deps: makeDeps() }, { profile: "share" })).rejects.toMatchObject({ code: "UNSAFE_FILE" });
  });

  it("ships a site plugin only through the injected listing, pinned to its hash, naming what it leaves out", async () => {
    const site = tmp();
    const installDir = path.join(site, "plugins");
    write(path.join(installDir, "good/pkg/plugin.json"), "{}");
    write(path.join(installDir, "changed/pkg/plugin.json"), "{}");
    write(path.join(installDir, "broken/pkg/plugin.json"), "{}");
    const records = ["good", "changed", "broken"].map(id => ({ source: "site", id, version: "1", status: "valid" }) as unknown as PluginDiscoveryRecord);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    class ListingError extends Error {}
    const deps = makeDeps({
      listSitePluginPackage: async ({ record }) => {
        if (record.id === "broken") throw new ListingError("not installed");
        return { rootDir: path.join(installDir, record.id, "pkg"), files: [{ relativePath: "plugin.json", sha256: record.id === "good" ? sha("{}") : "0".repeat(64) }] };
      },
      isPluginPackagePathError: error => error instanceof ListingError,
      readReviewedFile: async ({ file }) => Buffer.from(existsSync(file.absPath) ? "{}" : ""),
    });
    const sources = makeSources(site, { sitePlugins: async () => ({ installDir, records }) });
    const out = await collectSiteBackupFiles({ sources, include: { ...NONE, plugins: true }, deps }, { profile: "share" });
    expect(out.files.filter(f => f.path.startsWith("plugins/")).map(f => [f.path, f.sha256])).toEqual([["plugins/good/package/plugin.json", sha("{}")]]);
    expect(out.scopeNotes.plugins).toContain("'broken', 'changed'");
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe("readPlannedFile", () => {
  const planned = (file: string, over: Partial<PlannedDiskFile> = {}): PlannedDiskFile => ({ path: "themes/a", bytes: 5, scope: "themes", absPath: file, root: path.dirname(file), identity: null, nlink: 1, mtimeMs: 1, ...over });

  it("returns the bytes the injected reader proves, and the stale message when it refuses", async () => {
    const root = tmp();
    const file = path.join(root, "a");
    write(file, "bytes");
    expect(await readPlannedFile(planned(file), { deps: makeDeps() })).toEqual({ ok: true, bytes: Buffer.from("bytes") });
    const refused = await readPlannedFile(planned(file), { deps: makeDeps({ readReviewedFile: async () => null }) });
    expect(refused).toEqual({ ok: false, message: "'themes/a' changed since the plan was made. Call site_backup_plan again." });
  });

  it("refuses a pinned file whose digest changed", async () => {
    const root = tmp();
    const file = path.join(root, "a");
    write(file, "bytes");
    const deps = makeDeps();
    expect((await readPlannedFile(planned(file, { sha256: sha("bytes") }), { deps })).ok).toBe(true);
    expect((await readPlannedFile(planned(file, { sha256: sha("other") }), { deps })).ok).toBe(false);
  });
});

describe("captureDatabaseSnapshot", () => {
  const caps = (kind: string) => ({ getCapabilities: async () => ({ restorePoint: { costClass: "cheap", kind } }) });
  function dbOps(kind = "file-snapshot"): { port: DbOpsPort; directories: string[] } {
    const directories: string[] = [];
    const port = {
      ...caps(kind),
      captureRestorePoint: async (_scope: unknown, options?: { directory?: string }) => {
        const dir = options?.directory ?? tmp();
        directories.push(dir);
        const artifactRef = path.join(dir, "snap.db");
        writeFileSync(artifactRef, "snapshot");
        return { artifactRef, watermarkAtCapture: 7 };
      },
    } as unknown as DbOpsPort;
    return { port, directories };
  }

  it("captures into a private folder named with the injected prefix and removes it", async () => {
    const { port, directories } = dbOps();
    const out = await captureDatabaseSnapshot({ dbOps: port, scopeId: "s", snapshotDirPrefix: "host-snap-" }, { snapshotRoot: tmp() });
    expect(out).toEqual({ ok: true, bytes: Buffer.from("snapshot"), watermarkAtCapture: 7 });
    expect(path.basename(directories[0] ?? "")).toMatch(/^host-snap-/);
    expect(existsSync(directories[0] ?? "")).toBe(false);
  });

  it("captures inside an injected host-owned temp root and reads the bytes before the scope settles", async () => {
    const { port, directories } = dbOps();
    const root = tmp();
    const events: string[] = [];
    const tempRoot = async <T>({ work }: { work: (owned: { root: string }) => Promise<T> }): Promise<T> => {
      events.push("lock");
      try { return await work({ root }); } finally { events.push("release"); }
    };
    const out = await captureDatabaseSnapshot({ dbOps: port, scopeId: "s", snapshotDirPrefix: "unused-" }, { snapshotRoot: tmp(), tempRoot });
    expect(out).toEqual({ ok: true, bytes: Buffer.from("snapshot"), watermarkAtCapture: 7 });
    expect(directories).toEqual([root]);
    expect(events).toEqual(["lock", "release"]);
  });

  it("answers the fixed snapshot failure when the injected temp root cannot be prepared", async () => {
    const tempRoot = async (): Promise<never> => { throw new Error("lock busy /private/path"); };
    const out = await captureDatabaseSnapshot({ dbOps: dbOps().port, scopeId: "s", snapshotDirPrefix: "x-" }, { tempRoot });
    expect(out).toMatchObject({ ok: false, message: "the database snapshot failed; nothing was backed up" });
  });

  it("refuses a restore mechanism that is not a cheap file snapshot, and an oversize snapshot", async () => {
    const refused = await captureDatabaseSnapshot({ dbOps: dbOps("pg-dump").port, scopeId: "s", snapshotDirPrefix: "x-" });
    expect(refused.ok).toBe(false);
    const big = await captureDatabaseSnapshot({ dbOps: dbOps().port, scopeId: "s", snapshotDirPrefix: "x-" }, { maxBytes: 3 });
    expect(big).toEqual({ ok: false, message: "Database snapshot exceeds the 300 MiB share cap." });
  });
});

describe("limits and manifest", () => {
  const host = { label: "Host", maxFileBytes: 100 };
  const limits = { maxTotalBytes: 1000, maxFiles: 2 };

  it("checks the injected caps and names every file over the host limit", () => {
    expect(checkSiteBackupLimits({ files: [{ path: "a", bytes: 1 }], host, limits })).toEqual({ ok: true, totalBytes: 1 });
    expect(checkSiteBackupLimits({ files: [{ path: "a", bytes: 1 }, { path: "b", bytes: 1 }, { path: "c", bytes: 1 }], host, limits })).toMatchObject({ ok: false, message: expect.stringContaining("over the 2-file cap") });
    expect(checkSiteBackupLimits({ files: [{ path: "a", bytes: 600 }], host: {label: "Host"}, limits: { ...limits, maxTotalBytes: 500 } })).toMatchObject({ ok: false, message: expect.stringContaining("cap") });
    expect(checkSiteBackupLimits({ files: [{ path: "big", bytes: 101 }], host, limits })).toMatchObject({ ok: false, message: expect.stringContaining("big (101 B, 101 bytes)") });
  });

  it("skips oversize disk files and formats sizes", () => {
    const file = (bytes: number) => ({ path: `f${bytes}`, bytes }) as PlannedDiskFile;
    const out = skipOversizedFiles({ files: [file(5), file(500)], host });
    expect(out.files.map(f => f.path)).toEqual(["f5"]);
    expect(out.skipped).toEqual([{ path: "f500", reason: "500 B, over Host's 100 B per-file limit" }]);
    expect(formatByteSize({ bytes: 1536 })).toBe("1.5 KiB");
    expect(formatByteSize({ bytes: 1024 * 1024 * 100 })).toBe("100 MiB");
  });

  it("names the producer in the manifest from the injected identity", () => {
    const text = buildSiteBackupManifest({
      createdAt: "2026-01-01T00:00:00Z", hostVersion: "9.9", schema: { index: 1, tag: "one" }, site: { name: "S", folderName: "s" },
      database: { watermarkAtCapture: 3 }, include: { ...NONE, database: true }, scopeNotes: { media: "note" },
      files: [{ path: "a", bytes: 1, sha256: "h" }],
    }, { format: "host-site-backup", producerKey: "host" });
    const manifest = JSON.parse(text);
    expect(manifest).toMatchObject({ format: "host-site-backup", host: { version: "9.9" }, database: { path: "database/content.db", engine: "sqlite", watermarkAtCapture: 3 } });
    expect(manifest.scopes.media).toEqual({ included: false, note: "note" });
  });
});
