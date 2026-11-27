import { soleTokenAuth } from "../core/token-sign-in-list.js";
import { probeToken, type AgentPluginTokenCredentialsPort, type AgentPluginTokenValidator } from "./access-token-tool.js";
import type { ResolvedAgentPluginForConnect } from "./installed-plugin.js";

/**
 * @file Which installed Agent Plugins can be connected with a pasted access token, and a check of one
 * token before anything is saved — for create-site onboarding, which offers "connect <plugin> now"
 * next to the site's name. Generic: a plugin qualifies by declaring `tokenAuth` on exactly one
 * remote server in its `mcp.json`; the tokens page and the probe URL both come from there.
 */

/** One plugin the onboarding form can offer a token field for.
 * @agent-note Safe display projection of your installed declaration; helpUrl is the plugin's
 * declared human token page, never a saved token or a newly trusted endpoint. */
export interface TokenSignInPlugin {
  readonly pluginId: string;
  readonly displayName: string;
  /** Where the person creates a token (the plugin's own `tokenAuth.helpUrl`). */
  readonly helpUrl: string;
}

/** @agent-note The host validator/probe decides this bounded safe outcome. No token, response body
 * or provider fault text is returned or persisted by the check. */
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
  try {
    return await probeToken({ probeUrl: auth.probeUrl, token: input.token, credentials: deps.credentials, tokenValidator: deps.tokenValidator });
  } catch {
    // A host probe that rejects (transport fault) is an outage, never its private fault text.
    return "unavailable";
  }
}
