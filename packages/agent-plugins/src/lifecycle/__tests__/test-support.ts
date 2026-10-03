import { parseAgentPluginMcpConfig as parseAgentPluginMcpConfigValue } from '../manifest.js';
import { createSeedBundledModule } from '../seed-bundled.js';
import { createRetireBundledModule } from '../retire-bundled.js';
import { fetchAgentPluginArchive as fetchAgentPluginArchiveValue, maxAgentPluginArchiveBytes as maxAgentPluginArchiveBytesValue, type FetchAgentPluginArchiveOptional } from '../fetch-archive.js';
import path from 'node:path';
import { createAgentPluginLayout } from '../layout.js';
import { createNodeAgentPluginEffects } from '../node.js';
import type { AgentPluginLifecyclePorts } from '../ports.js';
import { createActivationModule } from "../activation.js";
import { createBundledDigestsModule } from "../bundled-digests.js";
import { createBundledSourceArchiveModule } from "../bundled-source-archive.js";
import { createCapabilityProjectionModule } from "../capability-projection.js";
export { withFileLock, isContendedLockError } from "@jini-ai/platform/fs/file-lock";
import { createInstallModule } from "../install.js";
import { createPackagePathsModule } from "../package-paths.js";
import { createResolveAgentPluginRefsModule } from "../resolve-agent-plugin-refs.js";
import { createSearchModule } from "../search.js";
import { createSetEnabledModule } from "../set-enabled.js";
import { createTrustedPluginFilesModule } from "../trusted-plugin-files.js";
import { createUninstallModule } from "../uninstall.js";
export const ports: AgentPluginLifecyclePorts = {
  ...createNodeAgentPluginEffects({}),
  layout: {
    get root() { return resolveAgentPluginLayout().root; },
    forWorkspace: input => resolveAgentPluginLayout().forWorkspace(input),
  },
  onEvent: ({ message }) => console.warn(message),
  formatPluginToolPointer: ({ pluginId }) => {
    const toolId = `agent_plugin_${pluginId.replace(/-/g, '_')}`;
    return [
      'MANDATORY — before you begin this task, make this one tool call and follow what it returns:', '',
      `  ${toolId}({})`, '', 'If your tools are proxied, that call is:',
      `  mcp__jini__execute_delegated_tool({ "toolId": "${toolId}", "input": {} })`, '',
      "Called with no argument, it returns this Agent Plugin's own instructions — not a summary, and",
      'not background material you may skip. Follow them, including any files they direct you to load,',
      'before you start work.',
    ].join('\n');
  },
  productName: 'the host', extensionNamespace: 'org.example.host', deliveryMode: 'inject',
  seededEnabledPluginIds: new Set(["new-integration"]), retiredBundledPlugins: new Map([["old-integration", "new-integration"]]), bundledArchiveMagic: 'EXAMPLEPKG1\n',
  fetch: async () => { throw new Error('unexpected network request'); },
  outboundGuard: { assertAllowed: async () => { throw new Error('unexpected outbound URL'); } },
  mcpProvisioning: { provision: async () => {}, setEnabled: async () => {}, remove: async () => {}, notifyRosterChanged: async () => {} },
};
/** Test fixture root is explicit or supplied by the suite, never a real site directory. */
export function resolveAgentPluginLayout(input: { cwd?: string; env?: Record<string, string | undefined> } = {}) {
  const root = input.env?.PLUGIN_ROOT ?? (input.env === undefined ? process.env.PLUGIN_ROOT : undefined) ?? path.join(input.cwd ?? '/tmp/plugin-test-fixture', 'agent-plugins');
  return createAgentPluginLayout({ root });
}
export function resolveAgentPluginDeliveryMode(input: { PLUGIN_DELIVERY?: string | undefined } = {}) {
  return input.PLUGIN_DELIVERY === 'pointer' ? 'pointer' : 'inject';
}
export const { isAgentPluginActive, filterActiveAgentPlugins, readAgentPluginActivations, assertAgentPluginActivationsWritable, isAgentPluginRecordedAsBundled, resolveAgentPluginActivation, normalizeActivations, setAgentPluginActivation, recordBundledAgentPluginIfAbsent, enableBundledAgentPluginUnlessOperatorDisabled, deleteAgentPluginActivation } = createActivationModule(ports);
export const { readBundledAgentPluginDigests, normalizeBundledDigests, recordBundledAgentPluginDigests, removeBundledAgentPluginDigest, preferBundledAgentPluginDigests } = createBundledDigestsModule(ports);
export const { packAgentPluginDirectory, createBundledSourceArchiveReader } = createBundledSourceArchiveModule(ports);
export const { classifyAgentPluginMcpServerTrust, readInstalledSkillMarkdown, readInstalledMcpServerIds, readInstalledMcpServers } = createCapabilityProjectionModule(ports);
export const { maxAgentPluginInstallArchiveBytes, installAgentPlugin, indexInstalledRoot } = createInstallModule(ports);
export const { normalizePackageEntryPath, assertContainedOnDisk } = createPackagePathsModule(ports);
export const { resolveAgentPluginRefs, listInstalledPlugins, isInstalledDigestPresent } = createResolveAgentPluginRefsModule(ports);
export const { rankInstalledAgentPlugins } = createSearchModule(ports);
export const { setAgentPluginEnabled } = createSetEnabledModule(ports);
export const { findTrustedPluginPackages, readTrustedPluginFile, importContainedModule } = createTrustedPluginFilesModule(ports);
export const { previewAgentPluginUninstall, uninstallAgentPlugin } = createUninstallModule(ports);

export const { seedBundledAgentPlugins } = createSeedBundledModule(ports);
export const { retireBundledAgentPlugins } = createRetireBundledModule(ports);
export function maxAgentPluginArchiveBytes() { return maxAgentPluginArchiveBytesValue({}); }
export function fetchAgentPluginArchive(input: { url: string }, optional: FetchAgentPluginArchiveOptional & { fetchImpl?: typeof fetch } = {}) {
  return fetchAgentPluginArchiveValue({ ...input, fetch: ({ url }, options) => (optional.fetchImpl ?? globalThis.fetch)(url, options), outboundGuard: { assertAllowed: async () => {} } }, optional);
}

export const RETIRED_BUNDLED_AGENT_PLUGINS = ports.retiredBundledPlugins;
export function parseAgentPluginMcpConfig(value: unknown, pluginManifest?: unknown) {
  return parseAgentPluginMcpConfigValue({ value, extensionNamespace: ports.extensionNamespace }, { pluginManifest });
}

/** Consumer-neutral projection for the copied digest-selection scenarios, never registers tools. */
export async function loadFixturePluginSources({ workspaceId }: { workspaceId: string }) {
  const workspace = resolveAgentPluginLayout().forWorkspace({ workspaceId });
  const preferred = preferBundledAgentPluginDigests(await listInstalledPlugins(workspace.packages), await readBundledAgentPluginDigests(workspace.root));
  const sources: { pluginId: string; archiveDigest: string; skills: { markdown: string }[] }[] = [];
  for (const plugin of preferred) {
    if (preferred.filter(p => p.pluginId === plugin.pluginId).length !== 1) continue;
    if ((await resolveAgentPluginActivation(workspace.root, plugin.pluginId)).verdict !== 'active') continue;
    const skills = await Promise.all(plugin.skills.map(async skill => ({ markdown: await readInstalledSkillMarkdown(plugin.packageRoot, skill.skillPath) })));
    sources.push({ pluginId: plugin.pluginId, archiveDigest: plugin.archiveDigest, skills });
  }
  return sources;
}
