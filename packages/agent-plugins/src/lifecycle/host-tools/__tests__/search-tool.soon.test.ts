import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { buildAgentPluginSearchRegistrations } from "../search-tool.js";
import type { AgentPluginHostToolPorts } from "../ports.js";

const unexpected = () => { throw new Error("unexpected port call"); };

async function searchWith({ manifestMaturity, hostMaturity }: { manifestMaturity?: string; hostMaturity?: AgentPluginHostToolPorts["hostMaturity"] }) {
  const packageRoot = await mkdtemp(path.join(os.tmpdir(), "soon-plugin-"));
  const extensions = manifestMaturity ? { jini: { maturity: manifestMaturity } } : {};
  await writeFile(path.join(packageRoot, "plugin.json"), JSON.stringify({ name: "later", version: "1.0.0", description: "Does a thing later.", extensions }));
  const ports: AgentPluginHostToolPorts = {
    layout: { forWorkspace: () => ({ root: "/workspace", pluginPackagesDir: unexpected }) },
    lifecycle: {
      listInstalledPlugins: async () => [{ pluginId: "later", packageRoot, skills: [], archiveDigest: "d" } as never],
      readBundledAgentPluginDigests: async () => new Map(),
      preferBundledAgentPluginDigests: ({ installed }) => installed,
      isInstalledDigestPresent: unexpected, readInstalledSkillMarkdown: unexpected, readInstalledSkillFile: unexpected,
      readInstalledMcpServerIds: async () => [],
      rankInstalledAgentPlugins: unexpected, normalizePackageEntryPath: unexpected,
    },
    activations: {
      readAgentPluginActivations: async () => ({ schemaVersion: 1, plugins: { later: { enabled: false } } } as never),
      filterActiveAgentPlugins: unexpected, isAgentPluginActive: () => false, resolveAgentPluginActivation: unexpected,
    },
    memory: { pluginMemory: unexpected, appendNotes: unexpected },
    permissions: { use: "use", enable: "enable" },
    readFrontmatterField: unexpected,
    ...(hostMaturity ? { hostMaturity } : {}),
  };
  const [registration] = buildAgentPluginSearchRegistrations({ workspaceId: "w", ports, requirePermission: async () => undefined });
  const result = await registration!.handler({ input: {}, principal: { id: "p" } } as never) as { matches: { maturity?: string; description: string }[] };
  return result.matches[0]!;
}

test("a Soon plugin is not offered for enable", async () => {
  const match = await searchWith({ manifestMaturity: "soon" });
  expect(match.maturity).toBe("soon");
  expect(match.description).toMatch(/coming soon/i);
  expect(match.description).not.toMatch(/installed, off/);
});

test("a plugin the host lists as Soon is not offered for enable", async () => {
  const match = await searchWith({ hostMaturity: ({ pluginId }) => (pluginId === "later" ? "soon" : undefined) });
  expect(match.maturity).toBe("soon");
  expect(match.description).toMatch(/coming soon/i);
});

test("an ordinary off plugin is still offered as installed, off", async () => {
  const match = await searchWith({});
  expect(match.maturity).toBeUndefined();
  expect(match.description).toMatch(/installed, off/);
});
