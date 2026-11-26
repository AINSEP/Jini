import type { parsePluginCredentialCards } from './credential-cards.js';
import type { AgentPluginInstalledMcpReads } from './federate-mcp.js';
import type { createAgentPluginLifecycle } from '../lifecycle/index.js';
import type { AgentPluginLayout } from '@jini-ai/core/contracts/headless/plugin-host';
import type { PluginCredentialCard } from '@jini-ai/core/contracts/credentials';
import type { McpServerConfig } from '../lifecycle/manifest.js';

/** One installed plugin's declared MCP servers — the slice `agent_plugin_connect` needs. Kept
 *  narrower than `InstalledAgentPlugin` (no version/keywords/skills: this tool cares only about
 *  what it can connect). */
/** @agent-note A fresh trusted installed declaration from your lifecycle owner, shared with
 * provisioning/approval. Credential cards contain safe display copy, never saved credentials. */
export interface ResolvedAgentPluginForConnect {
  readonly credentialCards?: readonly PluginCredentialCard[];
  readonly servers: Readonly<Record<string, McpServerConfig>>;
}

/** The real, on-disk resolution — the SAME walk `federate-mcp.ts`'s `resolveAgentPluginMcpServers`
 *  performs, restated here rather than imported so this tool does not need to import a second
 *  plugin's worth of exports just to reach the one function; both read `mcp.json` off the winning
 *  (bundled-preferred) installed digest for a pluginId. Returns `null` for a pluginId not installed
 *  in this workspace. */
export async function resolveInstalledAgentPlugin(input: { workspaceId: string; pluginId: string; agentPluginLayout: AgentPluginLayout;
  parseCredentialCards: typeof parsePluginCredentialCards;
  lifecycle: AgentPluginInstalledMcpReads & Pick<ReturnType<typeof createAgentPluginLifecycle>, "readTrustedPluginFile"> }, _options = {}): Promise<ResolvedAgentPluginForConnect | null> {
  const { listInstalledPlugins, readBundledAgentPluginDigests, preferBundledAgentPluginDigests, readTrustedPluginFile, readInstalledMcpServers } = input.lifecycle;
  const workspaceLayout = input.agentPluginLayout.forWorkspace({ workspaceId: input.workspaceId });
  const installed = preferBundledAgentPluginDigests({
    installed: await listInstalledPlugins({ workspaceRoot: workspaceLayout.root }),
    bundled: await readBundledAgentPluginDigests({ workspaceRoot: workspaceLayout.root }),
  });
  const plugin = installed.find((candidate) => candidate.pluginId === input.pluginId);
  if (!plugin) return null;
  const cards = input.parseCredentialCards({ raw: await readTrustedPluginFile({ plugin, filename: "plugin.json" }) });
  return { servers: await readInstalledMcpServers({ packageRoot: plugin.packageRoot }), credentialCards: cards.ok ? cards.descriptors : [] };
}

