
import type { Clock as ClockPort } from "@jini-ai/core/primitives";

import type { AgentPluginMcpPort, AgentPluginMcpProjectionPorts } from "../service-ports.js";


import { createApplyConnectDefaults, isPluginOffByOperator as defaultIsPluginOffByOperator, switchPluginOnUnlessOperatorOff } from "./apply-connect-defaults.js";
import type { AgentPluginLayout } from "../layout.js";

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


/** Where each "off" is switched back on in the admin (`apps/admin/src/panels.tsx` nav labels). */
export const AGENT_PLUGINS_SCREEN = "Add-Ons → Agent Plugins";
export const EXTERNAL_MCP_SCREEN = "Add-Ons → Integrations → External MCP";

export type SavedTokenSwitchOutcome =
  | { readonly state: "on" }
  | { readonly state: "plugin-off-by-operator" }
  | { readonly state: "connection-off-by-operator" };

export interface SwitchOnSavedTokenDeps {
  readonly workspaceId: string;
  readonly agentPluginLayout: AgentPluginLayout;
  readonly mcp: Pick<AgentPluginMcpPort, "repo" | "applyAccess"> & AgentPluginMcpProjectionPorts;
  readonly clock: ClockPort;
  readonly notifyRosterChanged: () => Promise<void>;
  /** Injected for tests. Defaults to `createApplyConnectDefaults`, the sign-in's own `onConnected`. */
  readonly onConnected?: (serverId: string) => Promise<void>;
  /** Injected for tests. Defaults to reading this workspace's activations file. */
  readonly isPluginOffByOperator?: (pluginId: string) => Promise<boolean>;
  /** Injected for tests. Switches the plugin's activation on unless an operator turned it off; false
   *  when an operator's "off" stopped it. Defaults to `apply-connect-defaults.ts`'s {@link switchPluginOnUnlessOperatorOff}. */
  readonly switchPluginOn?: (pluginId: string) => Promise<boolean>;
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
  const isOff = deps.isPluginOffByOperator ?? ((pluginId: string) => defaultIsPluginOffByOperator({ ...deps, pluginId }));
  if (await isOff(target.pluginId)) return { state: "plugin-off-by-operator" };

  const onConnected = deps.onConnected ?? createApplyConnectDefaults({ agentPluginLayout: deps.agentPluginLayout, workspaceId: deps.workspaceId, repo: deps.mcp.repo, applyAccess: deps.mcp.applyAccess, clock: deps.clock, notifyRosterChanged: deps.notifyRosterChanged, projections: deps.mcp.projections, classifyError: deps.mcp.classifyError });
  await onConnected(target.connectionId);

  const row = await deps.mcp.repo.findByServerId({ workspaceId: deps.workspaceId, serverId: target.connectionId });
  if (row?.enabled !== true) return { state: "connection-off-by-operator" };

  const switchPluginOn = deps.switchPluginOn ?? ((pluginId: string) => switchPluginOnUnlessOperatorOff({ ...deps, pluginId }));
  return (await switchPluginOn(target.pluginId)) ? { state: "on" } : { state: "plugin-off-by-operator" };
}

/** The plain next-step line for each outcome. Never carries a token. */
export function describeSavedTokenSwitch(outcome: SavedTokenSwitchOutcome, names: { readonly displayName: string; readonly connectionId: string }): string {
  const messages = {
    on: `${names.displayName} is connected and switched on. Its tools are ready to use.`,
    'plugin-off-by-operator': `Token saved. ${names.displayName} stays off because an operator turned it off. To use it, switch '${names.displayName}' on in ${AGENT_PLUGINS_SCREEN}.`,
    'connection-off-by-operator': `Token saved. The '${names.connectionId}' connection stays off because an operator changed its settings. To use it, switch it on in ${EXTERNAL_MCP_SCREEN}.`,
  };
  return messages[outcome.state];
}
