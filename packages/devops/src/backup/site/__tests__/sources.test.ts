import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
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
  type SiteBackupWalkFileSystem,
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

it("backs up local uploads and approved settings without including chat files or following setting links", async () => {
  const site = tmp();
  const media = path.join(site, "uploads");
  write(path.join(media, "public", "photo.webp"), "photo");
  write(path.join(media, "chat-attachments", "private.webp"), "chat");
  write(path.join(site, "private", "config.json"), "private");
  mkdirSync(path.join(site, ".site-meta.json"));
  symlinkSync(path.join(site, "private", "config.json"), path.join(site, "config.json"));
  const sources = makeSources(site, { mediaUploadsDir: media, isMediaRemote: async () => false });
  const result = await collectSiteBackupFiles({ sources, include: { ...NONE, media: true, settings: true }, deps: makeDeps() });
  expect(result.files.map(f => ({ path: f.path, bytes: f.bytes }))).toEqual([{ path: "uploads/public/photo.webp", bytes: 5 }]);
  expect(result.skipped).toEqual([
    { path: "settings/config.json", reason: "a symbolic link — never followed, so nothing outside the site can ride along" },
    { path: "settings/.site-meta.json", reason: "not a regular file" },
  ]);
  expect(result.scopeNotes).toEqual({});
});

it("only walks installer-owned workspace package and memory paths, with linked workspaces and plugin roots reported", async () => {
  const site = tmp();
  const ap = path.join(site, "ap");
  const ws = path.join(ap, "ws");
  const working = path.join(ws, "normal");
  write(path.join(working, "activations.json"), "{}");
  write(path.join(working, "packages", "sha256", "legacy", "main.js"), "legacy");
  write(path.join(working, "active", "package", "sha256", "current", "main.js"), "current");
  write(path.join(working, "active", "memory", "notes", "notes.md"), "notes");
  write(path.join(working, "active", "memory", "learned"), "not a directory");
  write(path.join(working, "active", "data", "private.json"), "private");
  write(path.join(working, "linked-memory", "package", "sha256", "fresh", "main.js"), "fresh");
  mkdirSync(path.join(working, "linked-memory", "memory"));
  symlinkSync(path.join(working, "active", "memory", "notes"), path.join(working, "linked-memory", "memory", "notes"));
  mkdirSync(path.join(working, "staging"));
  symlinkSync(path.join(working, "active"), path.join(working, "linked-plugin"));
  symlinkSync(working, path.join(ws, "linked-workspace"));
  mkdirSync(path.join(ws, "UNKNOWN"));
  write(path.join(ws, "not-a-directory"), "not a workspace");
  const layout = {
    root: ap, workspacesDir: ws,
    forWorkspace: ({ workspaceId }: { workspaceId: string }) => {
      if (workspaceId !== "normal") throw new Error("Foreign workspace id");
      const pluginRootDir = ({ pluginId }: { pluginId: string }) => {
        if (!["active", "linked-memory", "linked-plugin"].includes(pluginId)) throw new Error("Not a plugin id");
        return path.join(working, pluginId);
      };
      return { root: working, packages: path.join(working, "packages"), pluginRootDir,
        pluginPackagesDir: ({ pluginId }: { pluginId: string }) => path.join(pluginRootDir({ pluginId }), "package", "sha256"),
        pluginMemoryDir: ({ pluginId, kind }: { pluginId: string; kind: "learned" | "notes" }) => path.join(pluginRootDir({ pluginId }), "memory", kind),
      };
    },
  } as unknown as AgentPluginLayout;
  const result = await collectSiteBackupFiles({ sources: makeSources(site, { agentPlugins: layout }), include: { ...NONE, plugins: true }, deps: makeDeps() });
  expect(result.files.map(f => f.path)).toEqual([
    "agent-plugins/ws/normal/activations.json",
    "agent-plugins/ws/normal/active/memory/notes/notes.md",
    "agent-plugins/ws/normal/active/package/sha256/current/main.js",
    "agent-plugins/ws/normal/linked-memory/package/sha256/fresh/main.js",
    "agent-plugins/ws/normal/packages/sha256/legacy/main.js",
  ]);
  expect(result.skipped.map(f => [f.path, f.reason]).sort()).toEqual([
    ["agent-plugins/ws/UNKNOWN", "not a workspace folder the plugin installer writes"],
    ["agent-plugins/ws/linked-workspace", "a symbolic link — never followed, so nothing outside the site can ride along"],
    ["agent-plugins/ws/normal/linked-memory/memory/notes", "a symbolic link — never followed, so nothing outside the site can ride along"],
    ["agent-plugins/ws/normal/linked-plugin", "a symbolic link — never followed, so nothing outside the site can ride along"],
  ]);
});

it("reports capture and readback failures separately and treats a missing snapshot as already removed", async () => {
  const directory = tmp();
  const absent = path.join(directory, "absent.db");
  const capture = vi.fn<DbOpsPort["captureRestorePoint"]>()
    .mockRejectedValueOnce(Object.assign(new Error("driver refused"), { code: "EIO" }))
    .mockResolvedValueOnce({ artifactRef: absent, watermarkAtCapture: 4 } as Awaited<ReturnType<DbOpsPort["captureRestorePoint"]>>);
  const dbOps = { getCapabilities: async () => ({ restorePoint: { costClass: "cheap", kind: "file-snapshot" } }), captureRestorePoint: capture } as unknown as DbOpsPort;
  const args = { dbOps, scopeId: "fixture", snapshotDirPrefix: "snap-" };
  const logger = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(await captureDatabaseSnapshot(args)).toMatchObject({ ok: false, message: "the database snapshot failed; nothing was backed up" });
    expect(await captureDatabaseSnapshot(args)).toMatchObject({ ok: false, message: "the database snapshot could not be read back; nothing was backed up" });
    expect(capture.mock.calls).toEqual([[{ scopeId: "fixture" }], [{ scopeId: "fixture" }]]);
    expect(logger).not.toHaveBeenCalled();
  } finally { logger.mockRestore(); }
});

it("refuses a missing hash-pinned file before asking the reviewed-file reader and reports GiB accurately", async () => {
  const root = realpathSync(tmp());
  const file: PlannedDiskFile = {
    path: "themes/missing.css", absPath: path.join(root, "missing.css"), root, bytes: 5, identity: null, nlink: 1, mtimeMs: 1, scope: "themes", sha256: sha("bytes"),
  };
  const readReviewedFile = vi.fn<SiteBackupSourceDeps["readReviewedFile"]>();
  expect(await readPlannedFile(file, { deps: makeDeps({ readReviewedFile }) })).toEqual({
    ok: false, message: "'themes/missing.css' changed since the plan was made. Call site_backup_plan again.",
  });
  expect(readReviewedFile).not.toHaveBeenCalled();
  expect(formatByteSize({ bytes: 1024 ** 3 })).toBe("1 GiB");
  expect(formatByteSize({ bytes: 1.5 * 1024 ** 3 })).toBe("1.5 GiB");
});

it("distinguishes a missing directory from an unreadable one instead of silently omitting its contents", async () => {
  const site = tmp();
  const sources = makeSources(site);
  const required = { sources, include: { ...NONE, themes: true }, deps: makeDeps() };
  expect((await collectSiteBackupFiles(required)).files).toEqual([]);
  const denied = Object.assign(new Error("theme directory could not be read"), { code: "EACCES" });
  const read = vi.fn<SiteBackupWalkFileSystem["readdir"]>().mockRejectedValue(denied);
  const fileSystem: SiteBackupWalkFileSystem = {
    readdir: read,
    lstat: ({ file }) => lstat(file),
    lstatBigInt: ({ file }) => lstat(file, { bigint: true }),
  };
  write(path.join(sources.themesDir, "index.html"), "published content");
  await expect(collectSiteBackupFiles(required, { fileSystem })).rejects.toBe(denied);
  expect(read.mock.calls).toEqual([[{ dir: sources.themesDir }]]);
});

it("propagates an unexpected settings read error but allows a setting removed during discovery", async () => {
  const site = tmp();
  const sources = makeSources(site);
  const meta = path.join(site, ".site-meta.json");
  write(meta, "{}");
  const missing = Object.assign(new Error("removed"), { code: "ENOENT" });
  const denied = Object.assign(new Error("settings unreadable"), { code: "EACCES" });
  const fileSystem: SiteBackupWalkFileSystem = {
    readdir: ({ dir }) => readdir(dir, { withFileTypes: true }),
    lstat: async ({ file }) => { if (path.basename(file) === "config.json") throw missing; return lstat(file); },
    lstatBigInt: ({ file }) => lstat(file, { bigint: true }),
  };
  const required = { sources, include: { ...NONE, settings: true }, deps: makeDeps() };
  expect((await collectSiteBackupFiles(required, { fileSystem })).files.map(f => f.path)).toEqual(["settings/.site-meta.json"]);
  await expect(collectSiteBackupFiles(required, { fileSystem: {
    ...fileSystem, lstat: async ({ file }) => { if (file === meta) throw denied; throw missing; },
  } })).rejects.toBe(denied);
});

it("passes the legacy open-file override and safe stat helpers to the reviewed-file port", async () => {
  const root = realpathSync(tmp());
  const absPath = path.join(root, "one");
  write(absPath, "review");
  const file: PlannedDiskFile = { path: "themes/one", bytes: 6, root, absPath, identity: null, nlink: 1, mtimeMs: 1, scope: "themes" };
  const openFile = vi.fn<NonNullable<Parameters<typeof readPlannedFile>[1]["openFile"]>>();
  const reader = vi.fn<SiteBackupSourceDeps["readReviewedFile"]>(async ({ file: input }, optional) => {
    const fs = optional?.fileSystem;
    if (!fs) throw new Error("Expected file system with explicit opener");
    expect(fs.open).toBe(openFile);
    expect(await fs.realpath(input.absPath)).toBe(absPath);
    expect((await fs.lstat(input.absPath)).nlink).toBe(1n);
    return Buffer.from("review");
  });
  expect(await readPlannedFile(file, { deps: makeDeps({ readReviewedFile: reader }), openFile })).toEqual({ ok: true, bytes: Buffer.from("review") });
  expect(reader.mock.calls.map(([input]) => input)).toEqual([{ file }]);
});

it("does not capture a restore point when its private snapshot directory cannot be created", async () => {
  const root = tmp();
  const captureRestorePoint = vi.fn<DbOpsPort["captureRestorePoint"]>();
  const dbOps = {
    getCapabilities: async () => ({ restorePoint: { costClass: "cheap", kind: "file-snapshot" } }), captureRestorePoint,
  } as unknown as DbOpsPort;
  await expect(captureDatabaseSnapshot(
    { dbOps, scopeId: "fixture", snapshotDirPrefix: "snap-" },
    { snapshotRoot: path.join(root, "absent") },
  )).resolves.toMatchObject({
    ok: false, message: "the database snapshot failed; nothing was backed up", logDetail: expect.stringContaining("ENOENT"),
  });
  expect(captureRestorePoint).not.toHaveBeenCalled();
  expect(existsSync(path.join(root, "absent"))).toBe(false);
});
