import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { buildAgentPluginSearchRegistrations, loadAgentPluginSearchCandidates } from "../search-tool.js";
import type { AgentPluginHostToolPorts } from "../ports.js";

const unexpected = () => { throw new Error("unexpected port call"); };
const layoutReads: unknown[] = [];
const ports: AgentPluginHostToolPorts = {
  layout: { forWorkspace: input => {
    layoutReads.push(input);
    return { root: "/workspace", pluginPackagesDir: unexpected };
  } },
  lifecycle: {
    listInstalledPlugins: async () => [],
    readBundledAgentPluginDigests: async () => new Map(),
    preferBundledAgentPluginDigests: ({ installed }) => installed,
    isInstalledDigestPresent: unexpected,
    readInstalledSkillMarkdown: unexpected,
    readInstalledSkillFile: unexpected,
    readInstalledMcpServerIds: unexpected,
    rankInstalledAgentPlugins: unexpected,
    normalizePackageEntryPath: unexpected,
  },
  activations: {
    readAgentPluginActivations: async () => ({ schemaVersion: 1, plugins: {} }),
    filterActiveAgentPlugins: unexpected,
    isAgentPluginActive: unexpected,
    resolveAgentPluginActivation: unexpected,
  },
  memory: { pluginMemory: unexpected, appendNotes: unexpected },
  permissions: { use: "workspace.plugins.use", enable: "workspace.plugins.enable" },
  readFrontmatterField: unexpected,
};

test("search checks the principal's configured use permission before reading the workspace", async () => {
  const denial = new Error("plugin search denied");
  const checks: unknown[] = [];
  const registration = buildAgentPluginSearchRegistrations({ workspaceId: "workspace-a", ports,
    requirePermission: async (input, entity) => {
      checks.push({ input, entity });
      if (input.principalId === "denied") throw denial;
    },
  })[0]!;
  const context = { executionId: "search-1", run: { id: "run-1" }, input: {}, signal: new AbortController().signal };
  await assert.rejects(registration.handler({ ...context, principal: { id: "denied" } }),
    actual => actual === denial, "the denied principal receives the injected denial");
  assert.deepEqual(layoutReads, [], "denial happens before the workspace layout read");
  const result = await registration.handler({ ...context, principal: { id: "allowed" } });
  assert.deepEqual(result, { matches: [], totalInstalled: 0, totalMatches: 0, nextOffset: null },
    "the allowed principal receives the empty search page");
  assert.deepEqual(layoutReads, [{ workspaceId: "workspace-a" }], "only the allowed search reads the workspace layout");
  assert.deepEqual(checks, [
    { input: { workspaceId: "workspace-a", principalId: "denied", permission: ports.permissions.use },
      entity: { entityType: "workspace", entityId: "workspace-a" } },
    { input: { workspaceId: "workspace-a", principalId: "allowed", permission: ports.permissions.use },
      entity: { entityType: "workspace", entityId: "workspace-a" } },
  ], "both principals are checked for the configured use permission in the same workspace");
});

test("search omits absent metadata and preserves display and dependency field order", async () => {
  const packageRoot = await mkdtemp(path.join(os.tmpdir(), "search-fields-"));
  try {
    await writeFile(path.join(packageRoot, "plugin.json"), JSON.stringify({ name: "metadata", version: "1.0.0", description: "identity fixture" }));
    const candidates = await loadAgentPluginSearchCandidates({
      workspaceId: "workspace-a",
      ports: {
        ...ports,
        lifecycle: {
          ...ports.lifecycle,
          listInstalledPlugins: async () => [
            { pluginId: "sparse", packageRoot, archiveDigest: "digest-17", files: [], skills: [] },
            { pluginId: "full", packageRoot, archiveDigest: "digest-29", files: [], skills: [],
              displayName: "", summary: "summary-41", version: "2.3.5", description: "description-53", requires: [], companions: ["peer-67"] },
          ],
          readInstalledMcpServerIds: async () => [],
        },
        activations: { ...ports.activations, isAgentPluginActive: () => true },
      },
    });
    expect(candidates).toHaveLength(2);
    const [sparse, full] = candidates;
    expect(Object.keys(sparse!).filter(key => ["displayName", "summary", "version", "description", "requires", "companions"].includes(key))).toEqual([]);
    expect(Object.keys(sparse!).slice(0, 5)).toEqual(["pluginId", "id", "provides", "keywords", "enabled"]);
    expect(full).toMatchObject({ displayName: "", summary: "summary-41", version: "2.3.5", description: "description-53", requires: [], companions: ["peer-67"] });
    expect(Object.keys(full!).slice(0, 11)).toEqual([
      "pluginId", "displayName", "summary", "version", "description", "id", "provides", "requires", "companions", "keywords", "enabled",
    ]);
  } finally {
    await rm(packageRoot, { recursive: true, force: true });
  }
});
