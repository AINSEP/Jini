import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { installUploadedAgentPlugin, previewUploadedAgentPlugin, bindAgentPluginUpload, toObjectArgArchiveReader, toZeroArgArchiveReader, type InstallUploadedAgentPluginOptional } from "../install-upload.js";
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

function uploadBinding(reader: ReturnType<Parameters<typeof bindAgentPluginUpload>[0]['archiveReader']>) {
  const archive = new Uint8Array([1]); const digest = createHash("sha256").update(archive).digest("hex");
  const candidate = { pluginId: 'synthetic', archiveDigest: digest, skills: [] };
  const installAgentPlugin = vi.fn(async (input: { archiveReader: ReturnType<typeof toZeroArgArchiveReader> }, options: { previewOnly?: boolean; publishGuard(input: { plugin: typeof candidate; publish(): Promise<typeof candidate> }): Promise<typeof candidate> }) => {
    for await (const entry of input.archiveReader.entries({ archive })) {
      expect(entry.entryPath).toBe('plugin.json');
      if (entry.kind === 'file') for await (const _chunk of entry.openReadStream()) {}
    }
    return options.previewOnly ? candidate : options.publishGuard({ plugin: candidate, publish: async () => candidate });
  });
  const updateAgentPlugin = vi.fn(async (input: { archiveReader: ReturnType<typeof toZeroArgArchiveReader> }) => {
    for await (const entry of input.archiveReader.entries({ archive })) {
      expect(entry.entryPath).toBe('plugin.json');
      if (entry.kind === 'file') for await (const _chunk of entry.openReadStream()) {}
    }
    return { plugin: candidate, alreadyInstalled: false, enabled: true, warnings: [] };
  });
  const bound = bindAgentPluginUpload({
    lifecycle: { installAgentPlugin, listInstalledPlugins: async () => [], setAgentPluginActivation: vi.fn() },
    createLifecycle: () => ({ updateAgentPlugin }), archiveReader: () => reader,
    parseManifest: () => ({ ok: true, manifest: { name: 'synthetic' } }), sha256: () => digest,
    maxAgentPluginInstallArchiveBytes: () => 1024, assertOwnedPluginPath: async () => '/packages', contain: async () => '/packages',
    path: { relative: () => 'packages', join: (...parts: string[]) => parts.join('/') }, lstat: vi.fn(), readInstallIdentity: vi.fn(), warnCleanup: vi.fn(),
  } as unknown as Parameters<typeof bindAgentPluginUpload>[0]);
  const input = { archive, expectedSha256: digest, workspaceId: 'ws', actor: 'owner' };
  const layout = { forWorkspace: () => ({ root: '/ws', pluginPackagesDir: () => '/packages' }) } as InstallUploadedAgentPluginOptional['layout'];
  return { bound, input, layout };
}

it('keeps canonical prefix enumeration lazy through preview, install and update', async () => {
  let enumerations = 0;
  const canonical = { kind: 'file' as const, entryPath: 'folder/plugin.json', async *openReadStream(input: Record<string, never>) {
    expect(arguments.length).toBe(1); expect(input).toEqual({}); expect(this).toBe(canonical);
    yield Buffer.from(JSON.stringify({ name: 'synthetic' }));
  } };
  const f = uploadBinding({ async *entries() { enumerations++; yield canonical; } });
  expect(enumerations).toBe(0);
  await f.bound.previewUploadedAgentPlugin(f.input, { layout: f.layout });
  await f.bound.installUploadedAgentPlugin(f.input, { layout: f.layout });
  const updated = await f.bound.installUploadedAgentPlugin({ ...f.input, update: { pluginId: 'synthetic', expectedOldDigest: 'old' } }, { layout: f.layout, snapshotSettings: async () => ({}) });
  const enabled: boolean = updated.enabled;
  expect(enabled).toBe(true); expect(enumerations).toBe(6);
});

it('converts legacy overrides on ingress and adapts lifecycle opens without changing receivers', async () => {
  const manifest = Buffer.from(JSON.stringify({ name: 'synthetic' }));
  let legacyOpens = 0;
  const directory = { kind: 'directory' as const, entryPath: 'folder/' };
  const legacy = { kind: 'file' as const, entryPath: 'folder/plugin.json', async *openReadStream() {
    expect(arguments.length).toBe(0); expect(this).toBe(legacy); legacyOpens++; yield manifest;
  } };
  const reader = { async *entries() { yield directory; yield legacy; } };
  const adapted = toObjectArgArchiveReader({ reader });
  const f = uploadBinding(adapted);
  await f.bound.previewUploadedAgentPlugin(f.input, { layout: f.layout, archiveReader: reader });
  await f.bound.installUploadedAgentPlugin(f.input, { layout: f.layout, archiveReader: reader });
  await f.bound.installUploadedAgentPlugin({ ...f.input, update: { pluginId: 'synthetic', expectedOldDigest: 'old' } }, { layout: f.layout, archiveReader: reader, snapshotSettings: async () => ({}) });
  expect(legacyOpens).toBe(6);
  const roundTrip = toZeroArgArchiveReader({ reader: adapted });
  for await (const entry of roundTrip.entries({ archive: f.input.archive })) {
    if (entry.kind === 'directory') expect(entry).toBe(directory);
    if (entry.kind === 'file') {
      const chunks = []; for await (const chunk of entry.openReadStream()) chunks.push(chunk);
      expect(chunks).toEqual([manifest]);
    }
  }
});
