import * as filesystem from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AgentPluginLayout } from "@jini-ai/core/contracts/headless/plugin-host";
import { withWorkspaceMigrationLock } from "@jini-ai/agent-plugins/persistent-state";
import { parseAgentPluginManifest } from "../../lifecycle/manifest.js";
import { createPluginMemoryBindings } from "../memory.js";
import { createSetAgentPluginEnabled } from "../set-enabled.js";
import { createPluginExportSource } from "../exports/source.js";

describe("plugin host bindings", () => {
  it("notifies only after the lifecycle durably records OFF", async () => {
    const events: string[] = [];
    const lifecycle = { setAgentPluginEnabled: vi.fn(async () => { events.push("OFF"); return { pluginId: "synthetic", enabled: false }; }) };
    const createLifecycle = vi.fn(() => lifecycle);
    const operation = createSetAgentPluginEnabled({ createLifecycle, bindProviderFacePorts: () => ({ links: async () => new Map() }), assertAgentPluginReady: async () => {}, AgentPluginLinkedError: class extends Error { constructor(_required: { pluginId: string; providerPluginId: string }) { super("linked"); } } });
    const agentPluginLayout = { forWorkspace: () => ({ root: "/workspace" }) } as AgentPluginLayout;
    await operation({ agentPluginLayout, workspaceId: "ws", pluginId: "synthetic", enabled: false, actor: "owner" }, { notifyRosterChanged: async () => { events.push("notify"); } });
    await operation({ agentPluginLayout, workspaceId: "ws", pluginId: "synthetic", enabled: false, actor: "owner" });
    expect(events).toEqual(["OFF", "notify", "OFF"]);
    expect(createLifecycle).toHaveBeenCalledTimes(1);
  });

  it("migrates siblings before the held active workspace without acquiring sibling locks under it", async () => {
    const root = await filesystem.mkdtemp(path.join(tmpdir(), "plugin-memory-"));
    const locks: string[] = [];
    const layout = { root, forWorkspace: ({ workspaceId }: { workspaceId: string }) => ({ root: path.join(root, "ws", workspaceId) }) } as AgentPluginLayout;
    try {
      await filesystem.mkdir(path.join(root, "ws", "active"), { recursive: true });
      await filesystem.mkdir(path.join(root, "ws", "sibling"));
      const effects = { filesystem, contain: async ({ root, entryPath }: { root: string; entryPath: string }) => path.join(root, entryPath), withLock: async <T>({ lockPath, run }: { lockPath: string; run(): Promise<T> }) => { locks.push(lockPath); return run(); } };
      const binding = createPluginMemoryBindings({ ...effects, parseManifest: parseAgentPluginManifest, onEvent: () => {}, warnInvalidWorkspace: () => {}, warnMigration: () => {} });
      await binding.migrateSiblingAgentPluginLayouts({ layout, workspaceId: "active", contain: effects.contain });
      expect(locks.some(lock => lock.includes("sibling"))).toBe(true);
      await withWorkspaceMigrationLock({ ...effects, workspaceRoot: layout.forWorkspace({ workspaceId: "active" }).root, run: async ({ ownership }) => {
        const before = locks.length;
        await binding.migrateSiteAgentPluginLayouts({ layout, workspaceId: "active", contain: effects.contain }, { ownership });
        expect(locks.slice(before)).toEqual([]);
        expect(ownership.isHeld()).toBe(true);
      } });
    } finally { await filesystem.rm(root, { recursive: true, force: true }); }
  });

  it("discovers an inactive trusted export independently of the active set", async () => {
    const plugin = { pluginId: "synthetic", archiveDigest: "a".repeat(64), packageRoot: "/package" };
    const findTrustedPluginPackages = vi.fn(async ({ requireActive }: { requireActive?: boolean }) => requireActive ? [] : [{ trusted: plugin }]);
    const source = createPluginExportSource({ lifecycle: { findTrustedPluginPackages, readTrustedPluginFile: async () => JSON.stringify({ $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", name: "synthetic", version: "1.0.0", extensions: { jini: { id: "example/synthetic" } } }), assertContainedOnDisk: async () => "/package/image.png" }, parseAgentPluginManifest, readAssetFile: async () => new Uint8Array([137, 80, 78, 71]) });
    const packages = await source.list({ workspaceId: "ws" });
    expect(packages).toHaveLength(1);
    expect(packages[0]?.enabled).toBe(false);
    expect(findTrustedPluginPackages.mock.calls.map(([input]) => input.requireActive)).toEqual([false, true]);
  });
});
