import type { AgentPluginTokenAuth, McpServerConfig } from "../lifecycle/manifest.js";
import type { TokenSignInPlugin } from "../connect/token-sign-in.js";
import { titleCaseFromPluginId } from "./plugin-display-name.js";

/** The plugin's one token-auth declaration, or `null` for none or more than one (the same rule
 *  `agent_plugin_set_access_token` refuses on). */
export function soleTokenAuth(servers: Readonly<Record<string, McpServerConfig>>): AgentPluginTokenAuth | null {
  const declared = Object.values(servers).flatMap((config) => (config.type !== "stdio" && config.tokenAuth ? [config.tokenAuth] : []));
  // Exactly one element was just checked, so `declared[0]` is present; the cast only narrows the
  // index type (no fallback branch can ever run).
  return declared.length === 1 ? (declared[0] as AgentPluginTokenAuth) : null;
}

/**
 * The installed plugins that take a pasted token, sorted by id.
 * @complexity O(p·s) over installed plugins and their servers.
 */
export async function listTokenSignInPlugins(
  required: {
    readonly workspaceId: string;
    /** @agent-note Second host: your installed-plugin read (declared servers per plugin id); no filesystem default here. */
    readonly listPlugins: (workspaceId: string) => Promise<readonly { readonly pluginId: string; readonly servers: Readonly<Record<string, McpServerConfig>> }[]>;
  },
  _optional: Record<string, never> = {},
): Promise<readonly TokenSignInPlugin[]> {
  const plugins = await required.listPlugins(required.workspaceId);
  return plugins
    .flatMap(({ pluginId, servers }) => {
      const auth = soleTokenAuth(servers);
      return auth ? [{ pluginId, displayName: titleCaseFromPluginId({ pluginId }), helpUrl: auth.helpUrl }] : [];
    })
    .sort((a, b) => a.pluginId.localeCompare(b.pluginId));
}

