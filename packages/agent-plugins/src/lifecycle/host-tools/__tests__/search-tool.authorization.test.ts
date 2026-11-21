import assert from "node:assert/strict";
import { test } from "vitest";
import { buildAgentPluginSearchRegistrations } from "../search-tool.js";
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
