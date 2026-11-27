/** @file The provider plugin's switch is the one switch; its linked agent plugin face follows it. */
import assert from "node:assert/strict";
import { test } from "vitest";

import type { PluginActivationRecord, PluginActivationRepoPort } from "@jini-ai/core/contracts/site/plugins-host";
import { bindProviderFacePorts, followProviderActivations, syncProviderFaces, type ProviderFacePorts } from "../provider-plugin-link.js";
import { linkedProviderOf } from "../../core/provider-plugin-link.js";

const WS = "11111111-1111-4111-8111-111111111111";
const row = (pluginId: string, enabled: boolean, workspaceId = WS) => ({ pluginId, workspaceId, version: "1.0.0", enabled, updatedAt: "2026-10-25T00:00:00.000Z" });
const ignoreWarn = () => {};

/** Rows keyed by workspace and plugin, like the host's in-memory activation repo. */
class MemoryActivationRepo implements PluginActivationRepoPort {
  readonly rows = new Map<string, PluginActivationRecord>();
  async getActivation({ workspaceId, pluginId }: { workspaceId: string; pluginId: string }) { return this.rows.get(`${workspaceId}/${pluginId}`) ?? null; }
  async save(record: PluginActivationRecord) { this.rows.set(`${record.workspaceId}/${record.pluginId}`, record); }
  async deleteActivation({ workspaceId, pluginId }: { workspaceId: string; pluginId: string }) { this.rows.delete(`${workspaceId}/${pluginId}`); }
  async listAll() { return [...this.rows.values()]; }
}

/** Faces in memory; `writes` records every face write so tests can see a no-op stayed a no-op. */
function fakeFaces(initial: Record<string, boolean>, links: Record<string, string>) {
  const faces = new Map(Object.entries(initial));
  const writes: [string, boolean][] = [];
  const ports: ProviderFacePorts = {
    links: async () => new Map(Object.entries(links)),
    reconcileFace: async ({ pluginId, resolveEnabled }) => {
      const enabled = await resolveEnabled();
      if (await ports.isFaceActive({ pluginId }) === enabled) return false;
      faces.set(pluginId, enabled);
      writes.push([pluginId, enabled]);
      return true;
    },
    isFaceActive: async ({ pluginId }) => faces.get(pluginId) ?? true,
  };
  return { faces, writes, ports };
}

test("sync switches only faces that differ from their provider, and only the named provider's", async () => {
  const { faces, writes, ports } = fakeFaces({ metrics: false, errors: false, traces: true }, { metrics: "metrics-provider", errors: "errors-provider", traces: "traces-provider" });
  const enabled: Record<string, boolean> = { "metrics-provider": true, "errors-provider": true, "traces-provider": true };
  assert.deepEqual(await syncProviderFaces({ ports, providerEnabled: async ({ pluginId }) => enabled[pluginId]! }, { providerId: "metrics-provider" }), ["metrics"]);
  assert.equal(faces.get("errors"), false);
  assert.deepEqual(await syncProviderFaces({ ports, providerEnabled: async ({ pluginId }) => enabled[pluginId]! }), ["errors"]);
  assert.deepEqual(writes, [["metrics", true], ["errors", true]]);
});

test("every provider activation write in this workspace moves its face; other workspaces and plugins do not", async () => {
  const { faces, ports } = fakeFaces({ metrics: false }, { metrics: "metrics-provider" });
  const repo = followProviderActivations({ repo: new MemoryActivationRepo(), workspaceId: WS, ports, reportFollowFailure: ignoreWarn });
  await repo.save(row("metrics-provider", true, "22222222-2222-4222-8222-222222222222"));
  await repo.save(row("unrelated", true));
  assert.equal(faces.get("metrics"), false);
  await repo.save(row("metrics-provider", true));
  assert.equal(faces.get("metrics"), true);
  assert.equal((await repo.getActivation({ workspaceId: WS, pluginId: "metrics-provider" }))?.enabled, true);
  await repo.save({ ...row("metrics-provider", false), quarantinedAt: "2026-10-25T00:00:00.000Z", quarantineReason: "boom", quarantineFailureCount: 3 });
  assert.equal(faces.get("metrics"), false);
  await repo.save(row("metrics-provider", true));
  await repo.deleteActivation({ workspaceId: WS, pluginId: "metrics-provider" });
  assert.equal(faces.get("metrics"), false);
  assert.equal((await repo.listAll()).length, 2);
});

test("a face that cannot follow is reported to the warn sink, never fails the provider decision; a failed provider write moves nothing", async () => {
  const warnings: { pluginId: string; error: unknown }[] = [];
  const failure = new Error("disk full");
  const failing: ProviderFacePorts = { ...fakeFaces({}, { metrics: "metrics-provider" }).ports, reconcileFace: async () => { throw failure; } };
  const repo = followProviderActivations({ repo: new MemoryActivationRepo(), workspaceId: WS, ports: failing, reportFollowFailure: entry => warnings.push(entry) });
  await repo.save(row("metrics-provider", true));
  assert.equal((await repo.getActivation({ workspaceId: WS, pluginId: "metrics-provider" }))?.enabled, true);
  // The sink gets structured data (the host formats its own line); the raw failure is passed as-is.
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.pluginId, "metrics-provider");
  assert.equal(warnings[0]?.error, failure);

  const { faces, ports } = fakeFaces({ metrics: false }, { metrics: "metrics-provider" });
  const inner = new MemoryActivationRepo();
  inner.save = async () => { throw new Error("db locked"); };
  await assert.rejects(followProviderActivations({ repo: inner, workspaceId: WS, ports, reportFollowFailure: ignoreWarn }).save(row("metrics-provider", true)), /db locked/);
  assert.equal(faces.get("metrics"), false);
});

test("a face resolves to its provider plugin; an unlinked plugin to none", async () => {
  const { ports } = fakeFaces({}, { metrics: "metrics-provider" });
  assert.equal(await linkedProviderOf({ ports, pluginId: "metrics" }), "metrics-provider");
  assert.equal(await linkedProviderOf({ ports, pluginId: "other" }), undefined);
});

test("bound links follow the selected workspace and mirror its live canonical activation", async () => {
  let root = "/plugins/site-a";
  const old = { pluginId: "analytics", archiveDigest: "old" };
  const current = { pluginId: "analytics", archiveDigest: "current" };
  const invalid = { pluginId: "unreadable", archiveDigest: "other" };
  const reads: unknown[] = [];
  const enabledByRoot = new Map([["/plugins/site-b", false]]);
  const ports = bindProviderFacePorts({
    workspaceRoot: () => root,
    catalog: {
      list: async ({ workspaceRoot }) => workspaceRoot === "/plugins/site-a" ? [old, current, invalid] : [current],
      bundled: async ({ workspaceRoot }) => workspaceRoot === "/plugins/site-a" ? "current" : null,
      preferBundled: (items, bundled) => bundled ? items.filter(item => item.archiveDigest === bundled || item.pluginId !== "analytics") : items,
      read: async ({ plugin, filename }) => {
        reads.push({ plugin, filename });
        if (plugin === invalid) return "{";
        assert.equal(plugin, current);
        return '{"extensions":{"jini":{"providerPlugin":"metrics-provider"}}}';
      },
    },
    activations: {
      readAgentPluginActivations: async ({ workspaceRoot }) => enabledByRoot.get(workspaceRoot) ?? true,
      isAgentPluginActive: ({ pluginId, activations }) => pluginId === "analytics" && activations,
      reconcileAgentPluginActivation: async ({ workspaceRoot, pluginId, actor, resolveEnabled }) => {
        assert.deepEqual({ workspaceRoot, pluginId, actor }, { workspaceRoot: "/plugins/site-b", pluginId: "analytics", actor: "system:provider-plugin" });
        const next = await resolveEnabled();
        if (enabledByRoot.get(workspaceRoot) === next) return false;
        enabledByRoot.set(workspaceRoot, next);
        return true;
      },
    },
  });
  assert.deepEqual(await ports.links({}), new Map([["analytics", "metrics-provider"]]));
  root = "/plugins/site-b";
  assert.equal(await ports.isFaceActive({ pluginId: "analytics" }), false);
  assert.deepEqual(await syncProviderFaces({ ports, providerEnabled: async ({ pluginId }) => pluginId === "metrics-provider" }), ["analytics"]);
  assert.equal(await ports.isFaceActive({ pluginId: "analytics" }), true);
  assert.deepEqual(reads, [{ plugin: current, filename: "plugin.json" }, { plugin: invalid, filename: "plugin.json" }, { plugin: current, filename: "plugin.json" }]);
});

test("bound links refuse multiple selected revisions without reading either declaration", async () => {
  const ports = bindProviderFacePorts({
    workspaceRoot: () => "/plugins/site-b",
    catalog: {
      list: async () => [{ pluginId: "analytics", archiveDigest: "old" }, { pluginId: "analytics", archiveDigest: "new" }],
      bundled: async () => new Map(),
      preferBundled: items => items,
      read: async () => { throw new Error("should not read a conflicted declaration"); },
    },
    activations: {
      readAgentPluginActivations: async () => true,
      isAgentPluginActive: () => true,
      reconcileAgentPluginActivation: async () => { throw new Error("not reconciling"); },
    },
  });
  await assert.rejects(ports.links({}), { message: "Agent Plugin 'analytics' matches 2 installed packages — refusing to guess which one to use" });
});
