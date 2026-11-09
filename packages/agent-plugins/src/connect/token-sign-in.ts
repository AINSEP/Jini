import { probeToken, type AgentPluginTokenCredentialsPort, type AgentPluginTokenValidator } from "./access-token-tool.js";
import { titleCaseFromPluginId, type ResolvedAgentPluginForConnect } from "./connect-tool.js";
import type { AgentPluginTokenAuth, McpServerConfig } from "@jini-ai/agent-plugins/lifecycle";

/**
 * @file Which installed Agent Plugins can be connected with a pasted access token, and a check of one
 * token before anything is saved — for create-site onboarding, which offers "connect <plugin> now"
 * next to the site's name. Generic: a plugin qualifies by declaring `tokenAuth` on exactly one
 * remote server in its `mcp.json`; the tokens page and the probe URL both come from there.
 */

/** One plugin the onboarding form can offer a token field for. */
export interface TokenSignInPlugin {
  readonly pluginId: string;
  readonly displayName: string;
  /** Where the person creates a token (the plugin's own `tokenAuth.helpUrl`). */
  readonly helpUrl: string;
}

/** The plugin's one token-auth declaration, or `null` for none or more than one (the same rule
 *  `agent_plugin_set_access_token` refuses on). */
function soleTokenAuth(servers: Readonly<Record<string, McpServerConfig>>): AgentPluginTokenAuth | null {
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

export type TokenCheckOutcome = "ok" | "invalid" | "refused" | "unavailable" | "unsupported";

/**
 * Checks `token` against the plugin's declared probe URL (one GET; 401/403 refused). Never throws,
 * never returns or logs the token. `unsupported`: the plugin is not installed or takes no token.
 */
export async function checkAgentPluginAccessToken(
  required: {
    /** @agent-note Second host: `tokenValidator` is your token rule (R1, required); `resolveInstalledPlugin` your installed read. */
    readonly deps: {
      readonly workspaceId: string;
      readonly credentials: Pick<AgentPluginTokenCredentialsPort, "probe">;
      readonly resolveInstalledPlugin: (pluginId: string) => Promise<ResolvedAgentPluginForConnect | null>;
      readonly tokenValidator: Pick<AgentPluginTokenValidator, "assertToken">;
    };
    readonly input: { readonly pluginId: string; readonly token: string };
  },
  _optional: Record<string, never> = {},
): Promise<TokenCheckOutcome> {
  const { deps, input } = required;
  const resolvePlugin = deps.resolveInstalledPlugin;
  let plugin: ResolvedAgentPluginForConnect | null;
  try {
    plugin = await resolvePlugin(input.pluginId);
  } catch {
    return "unsupported";
  }
  const auth = plugin ? soleTokenAuth(plugin.servers) : null;
  if (!auth) return "unsupported";
  return probeToken({ probeUrl: auth.probeUrl, token: input.token, credentials: deps.credentials, tokenValidator: deps.tokenValidator });
}
