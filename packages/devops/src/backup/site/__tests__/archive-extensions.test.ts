import { describe, expect, it } from "vitest";
import type { AgentPluginLayout } from "@jini-ai/core/contracts/headless/plugin-host";
import { prepareArchiveExtensions, type ArchiveExtensionsDeps, type InstalledAgentPluginRecord } from "../archive-extensions.js";
import type { PlannedDiskFile, SiteBackupSources } from "../sources.js";

const digestA = "a".repeat(64);
const digestB = "b".repeat(64);
const layout = { root: "/site/ap", workspacesDir: "/site/ap/ws", forWorkspace: ({ workspaceId }: { workspaceId: string }) => ({ root: `/site/ap/ws/${workspaceId}` }) } as unknown as AgentPluginLayout;
const sources: SiteBackupSources = { siteDir: "/site", mediaUploadsDir: null, themesDir: "/site/themes", skillsDir: "/site/skills", agentPlugins: layout };
const file = (path: string, over: Partial<PlannedDiskFile> = {}): PlannedDiskFile => ({ path, bytes: 1, scope: "plugins", absPath: `/site/${path}`, root: "/site", identity: null, nlink: 1, mtimeMs: 1, ...over });

interface Setup { installed?: InstalledAgentPluginRecord[]; bundled?: Map<string, string>; original?: { originalDir: string } | null; originalFiles?: PlannedDiskFile[]; originalSkipped?: { path: string; reason: string }[]; reads?: Map<string, string | null> }
function makeDeps(setup: Setup = {}): ArchiveExtensionsDeps {
  return {
    collectSiteBackupFiles: async () => ({ files: setup.originalFiles ?? [], skipped: setup.originalSkipped ?? [], scopeNotes: {}, notices: ["original notice"] }),
    readPlannedFile: async f => { const text = setup.reads?.get(f.path); return text === null || text === undefined ? { ok: false, message: `${f.path} changed` } : { ok: true, bytes: Buffer.from(text) }; },
    createLifecycle: () => ({
      listInstalledPlugins: async () => setup.installed ?? [],
      readBundledAgentPluginDigests: async () => setup.bundled ?? new Map(),
      preferBundledAgentPluginDigests: candidates => candidates,
      readAgentPluginActivations: async () => ({ plugins: { alpha: { enabled: false } } }),
    }),
    resolveThemeOriginalSource: () => setup.original,
    runtimeToArchivePath: ({ path }) => (path.startsWith("private/") ? null : path),
    pluginManifestFilenames: ["manifest.json"],
  };
}

describe("prepareArchiveExtensions", () => {
  it("refuses more than one plugin workspace", async () => {
    const files = [file("agent-plugins/ws/w1/alpha/x"), file("agent-plugins/ws/w2/beta/x")];
    await expect(prepareArchiveExtensions({ sources, files, deps: makeDeps() })).rejects.toMatchObject({ code: "UNSUPPORTED_DATA" });
  });

  it("keeps a live baseline for a theme with no packaged original, or the original the owner names", async () => {
    const live = [file("themes/static/t1/theme.json", { scope: "themes" })];
    const none = await prepareArchiveExtensions({ sources, files: live, deps: makeDeps() });
    expect(none.files.map(f => f.path)).toContain("themes/__original-themes__/static/t1/theme.json");
    const packaged = await prepareArchiveExtensions({ sources, files: live, deps: makeDeps({ original: { originalDir: "/stock/t1" }, originalFiles: [file("themes/theme.json", { scope: "themes" })] }) });
    expect(packaged.files.map(f => f.path)).toContain("themes/__original-themes__/static/t1/theme.json");
    expect(packaged.notices).toEqual(["original notice"]);
    const skipped = makeDeps({ original: { originalDir: "/stock/t1" }, originalSkipped: [{ path: "themes/l", reason: "a link" }] });
    await expect(prepareArchiveExtensions({ sources, files: live, deps: skipped })).rejects.toMatchObject({ code: "UNSAFE_FILE" });
  });

  it("drops a superseded bundled revision and records installed agent plugins with their activation", async () => {
    const files = [file(`agent-plugins/ws/w1/alpha/package/sha256/${digestA}/m`), file(`agent-plugins/ws/w1/alpha/package/sha256/${digestB}/m`)];
    const installed = [{ pluginId: "alpha", version: "2", archiveDigest: digestB }];
    const out = await prepareArchiveExtensions({ sources, files, deps: makeDeps({ installed, bundled: new Map([["alpha", digestB]]) }) });
    expect(out.files.map(f => f.path)).toEqual([`agent-plugins/ws/w1/alpha/package/sha256/${digestB}/m`]);
    expect(out.plugins).toEqual([{ kind: "agent", id: "alpha", version: "2", digest: digestB, enabled: false, shipped: true }]);
  });

  it("refuses two installed digests for one plugin id", async () => {
    const files = [file(`agent-plugins/ws/w1/alpha/package/sha256/${digestA}/m`)];
    const installed = [{ pluginId: "alpha", archiveDigest: digestA }, { pluginId: "alpha", archiveDigest: digestB }];
    await expect(prepareArchiveExtensions({ sources, files, deps: makeDeps({ installed }) })).rejects.toMatchObject({ code: "UNSUPPORTED_PLUGIN" });
  });

  it("reads a site plugin's version only from the injected manifest name, and refuses a stale file", async () => {
    const files = [file("plugins/p1/package/manifest.json"), file("plugins/p1/package/nested/manifest.json"), file("private/x")];
    const reads = new Map([["plugins/p1/package/manifest.json", JSON.stringify({ version: "3.1" })], ["plugins/p1/package/nested/manifest.json", JSON.stringify({ version: "9" })]]);
    const out = await prepareArchiveExtensions({ sources, files, deps: makeDeps({ reads }) });
    expect(out.plugins).toMatchObject([{ kind: "site", id: "p1", version: "3.1", enabled: false, shipped: true }]);
    expect(out.files.map(f => f.path)).not.toContain("private/x");
    await expect(prepareArchiveExtensions({ sources, files, deps: makeDeps() })).rejects.toMatchObject({ code: "PLAN_STALE" });
  });
});

it("preserves unindexed agent package files without treating them as enabled", async () => {
  const paths = [
    `agent-plugins/ws/w1/alpha/package/sha256/${digestA}/agent.json`,
    `agent-plugins/ws/w1/alpha/package/sha256/${digestA}/README.md`,
  ];
  const out = await prepareArchiveExtensions({ sources, files: paths.map(path => file(path)), deps: makeDeps() });
  expect(out.files.map(f => f.path)).toEqual(paths);
  expect(out.plugins).toEqual([{ kind: "agent", id: "alpha", version: "unknown", digest: digestA, enabled: false, shipped: true }]);
});

it("refuses two unindexed disk revisions for one agent plugin", async () => {
  const files = [digestA, digestB].map(digest => file(`agent-plugins/ws/w1/alpha/package/sha256/${digest}/agent.json`));
  await expect(prepareArchiveExtensions({ sources, files, deps: makeDeps() })).rejects.toMatchObject({
    code: "UNSUPPORTED_PLUGIN", message: "Plugin 'alpha' has multiple installed digests.",
  });
});
