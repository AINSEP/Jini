
import type { AgentPluginMcpPort } from "./ports.js";

/**
 * @file After an access token is saved onto a plugin's token-auth row, switches the plugin on the
 * same way a first sign-in does (`apply-connect-defaults.ts`), so saving a token is the only step —
 * unless an operator deliberately turned it off, in which case it stays off and the caller names the
 * screen that turns it back on.
 *
 * Two callers: `agent_plugin_set_access_token` (`access-token-tool.ts`) and the token import
 * (`import-access-token.ts`, boot env import and create-site onboarding). Added 2026-09-29: the
 * tool used to end with "ask the operator to enable it in Settings", a manual step nothing required.
 *
 * "Deliberately off" is either:
 * - a disabled Agent Plugins activation record that anyone other than the boot seeder wrote (the
 *   seeder's own disabled record is the default, not a decision — `activation.ts`'s same exception);
 * - a row the operator already edited (tool lists filled) and left disabled — `apply-connect-defaults`
 *   never touches an edited row.
 */


export type SavedTokenSwitchOutcome =
  | { readonly state: "on" }
  | { readonly state: "plugin-off-by-operator" }
  | { readonly state: "connection-off-by-operator" };

export interface SwitchOnSavedTokenDeps {
  readonly workspaceId: string;
  readonly mcp: Pick<AgentPluginMcpPort, "repo">;
  /** @agent-note Host binding of the sign-in's own `onConnected` (`createApplyConnectDefaults` over the
   *  host's one MCP repo, projections and activation owner), so a saved token and a sign-in grant alike. */
  readonly onConnected: (serverId: string) => Promise<void>;
  /** @agent-note Host activation read: whether an operator (not the seeder) turned the plugin off. */
  readonly isPluginOffByOperator: (pluginId: string) => Promise<boolean>;
  /** @agent-note Host activation owner: switches the plugin's activation on unless an operator turned it
   *  off, through the host's one activation queue; false when an operator's "off" stopped it. */
  readonly switchPluginOn: (pluginId: string) => Promise<boolean>;
}

/**
 * Switches the plugin and its `connectionId` row on after a token was saved there, unless an
 * operator turned either off. "on" means both the row and the plugin's own activation are on.
 *
 * @throws Whatever the activation read or write, the connect-defaults write, or the row read throws.
 * @complexity Two activation reads, at most one connect-defaults apply and one activation write, one row read.
 */
export async function switchOnSavedTokenConnection(
  deps: SwitchOnSavedTokenDeps,
  target: { readonly pluginId: string; readonly connectionId: string },
): Promise<SavedTokenSwitchOutcome> {
  const isOff = deps.isPluginOffByOperator;
  if (await isOff(target.pluginId)) return { state: "plugin-off-by-operator" };

  const onConnected = deps.onConnected;
  await onConnected(target.connectionId);

  const row = await deps.mcp.repo.findByServerId({ workspaceId: deps.workspaceId, serverId: target.connectionId });
  if (row?.enabled !== true) return { state: "connection-off-by-operator" };

  const switchPluginOn = deps.switchPluginOn;
  return (await switchPluginOn(target.pluginId)) ? { state: "on" } : { state: "plugin-off-by-operator" };
}
