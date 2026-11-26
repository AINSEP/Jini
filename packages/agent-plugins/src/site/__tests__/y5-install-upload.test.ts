import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { installUploadedAgentPlugin, previewUploadedAgentPlugin, type InstallUploadedAgentPluginOptional } from "../install-upload.js";
import { parseAgentPluginManifest } from "../../lifecycle/manifest.js";

describe("upload admission and rollback", () => {
  it("opens zero streams for a bad digest in both preview and installation", async () => {
    const entries = vi.fn();
    const options = { lifecycle: {}, archiveReader: { entries }, maxAgentPluginInstallArchiveBytes: () => 1024, sha256: (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex") } as unknown as InstallUploadedAgentPluginOptional;
    const input = { archive: new Uint8Array([1]), expectedSha256: "0".repeat(64), workspaceId: "ws", actor: "owner" };
    await expect(installUploadedAgentPlugin(input, options)).rejects.toMatchObject({ code: "DIGEST_MISMATCH" });
    await expect(previewUploadedAgentPlugin(input, options)).rejects.toMatchObject({ code: "DIGEST_MISMATCH" });
    expect(entries).not.toHaveBeenCalled();
  });

  it("removes a failed replacement before restoring the staged old package", async () => {
    const events: string[] = [];
    const failure = new Error("publication failed");
    const archive = new Uint8Array([1]);
    const digest = createHash("sha256").update(archive).digest("hex");
    const previous = { pluginId: "synthetic", packageRoot: "/packages/old", archiveDigest: "a".repeat(64), version: "1.0.0" };
    const indexed = { ...previous, archiveDigest: digest, version: "1.0.1" };
    const options = {
      archiveReader: { async *entries() { yield { kind: "file", entryPath: "plugin.json", async *openReadStream() { yield Buffer.from(JSON.stringify({ $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", name: "synthetic", version: "1.0.1" })); } }; } },
      lifecycle: {
        installAgentPlugin: async (_required: unknown, { publishGuard }: { publishGuard: (required: { plugin: typeof indexed; publish: () => Promise<never> }) => Promise<unknown> }) => publishGuard({ plugin: indexed, publish: async () => { events.push("publish"); throw failure; } }),
        listInstalledPlugins: async () => [previous], isAgentPluginRecordedAsBundled: async () => false, resolveAgentPluginActivation: async () => ({ verdict: "inactive" }),
        stageForRemoval: async () => { events.push("stage"); return { original: previous.packageRoot, quarantined: "/staged" }; },
        removeFrozenPackageTree: async () => { events.push("remove failed"); },
        restoreStagedTrees: async ({ cause }: { cause: unknown }) => { events.push("restore"); return cause; },
        setAgentPluginActivation: vi.fn(),
      },
      layout: { forWorkspace: () => ({ root: "/workspace", pluginPackagesDir: () => "/packages" }) },
      contain: async () => "/packages", assertOwnedPluginPath: async () => "/packages", lstat: async () => ({ isDirectory: () => true }),
      maxAgentPluginInstallArchiveBytes: () => 1024, parseManifest: parseAgentPluginManifest, readInstallIdentity: vi.fn(), sha256: (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex"), warnCleanup: vi.fn(),
    } as unknown as InstallUploadedAgentPluginOptional;
    await expect(installUploadedAgentPlugin({ archive, expectedSha256: digest, workspaceId: "ws", actor: "owner", replace: true }, options)).rejects.toBe(failure);
    expect(events).toEqual(["stage", "publish", "remove failed", "restore"]);
    expect(options.lifecycle.setAgentPluginActivation).not.toHaveBeenCalled();
  });
});
