import type { SetEnabledRequest } from '../host/tools/index.js';
import type { PluginHostCopy } from "./plugin-host-copy.js";
export const familyRequired = ({ copy }: { copy: PluginHostCopy }): string => `'family' is required and must be exactly one of: 'site-runtime' (a ${copy.sitePluginFormat} site plugin, as listed by ` +
      `${copy.pluginListToolName}) or 'agent-plugin' (an Agent Plugin, as returned by search_agent_plugin_local). ${copy.productName} has two ` +
      "unrelated plugin systems and this tool never guesses between them — if you are unsure, call the matching list/search " +
      "tool first and use the family whose results contained this id.";


/**
 * What a caller must still do after a successful toggle, per family and direction.
 *
 * This exists because "enabled: true" alone was actively misleading. The activation record is
 * durable and re-read per run, so the GATE moves immediately — but a plugin's own tool
 * (`agent_plugin_<id>` for Agent Plugins, a capability tool for site plugins) is registered once, at
 * agent-daemon boot, and the `search_tools` index is a one-shot snapshot taken right after
 * (`agent-daemon-server.ts`). So a freshly enabled plugin's TOOL is not callable in the daemon that
 * is running now. Reporting plain success and letting the operator discover that themselves is the
 * confusion this field exists to prevent.
 *
 * The two directions are deliberately NOT symmetric, for BOTH families, and the notes say so. DISABLE
 * lands immediately on the tool as well, because each tool's own `ToolPolicy` re-reads the activation
 * record per call: `agent_plugin_<id>` via `features/agent-plugins/tool-registrations.ts`'s REVOCATION
 * note, `plugin_capability_<id>` via `capability-tool-registrations.ts`'s "Revocation" section
 * (t91 F1.2). ENABLE still needs a restart, because there is no registration to re-admit: an
 * append-only `ToolRegistry` has nothing to un-skip.
 *
 * An Agent Plugin's provisioned connection rows and credentials survive disable: deleting those
 * records would destroy a sign-in the owner already earned (`federate-mcp.ts`, "THE ROW SURVIVES").
 * Retention is not permission: the connection's per-call gate now also checks the provisioning
 * plugin's activation, and reload withdraws its frozen registrations from discovery. The note must
 * distinguish saved credentials from callable tools so the model cannot keep using an OFF plugin.
 * @complexity O(1).
 */
export function restartNote({ request, copy }: { request: SetEnabledRequest; copy: PluginHostCopy }, _optional = {}): string {
  if (request.family === 'agent-plugin') {
    return request.enabled
      ? `Enabled and saved. Read its guidance now with load_agent_plugin({pluginId:"${request.pluginId}"}) and use ` +
          `agent_plugin_connect for account sign-in when needed. Tool discovery refreshes without restarting; ` +
          `search for agent_plugin_${request.pluginId} to read its guidance. Do not ask the person to restart ${copy.productName}.`
      : 'Disabled and saved. Its guidance and provisioned external MCP tools stop immediately. ' +
          'The connection rows and saved sign-in are retained. Ask to turn the plugin on through plugins_set_enabled before using it again.';
  }
  return request.enabled
    ? "Enabled and saved. The plugin's hooks are live now, but any tool it contributes is registered only when the agent " +
        `daemon starts — tell the user ${copy.productName} has to be restarted before that tool can be called.`
    : "Disabled and saved. This takes effect immediately, with no restart: any tool this plugin contributed stays listed " +
        `in the running daemon until ${copy.productName} restarts, but every call to it is refused from now on.`;
}


/** Only a pending update recovers at start. Any other journal refusal (an unreadable record, an
 *  unsafe recorded path) survives a restart, so telling the user to restart would loop them.
 *  @complexity O(1). */
export function updatePendingNextStep({ error, copy }: { error: { code: string }; copy: PluginHostCopy }, _optional = {}): string {
  return error.code === "PLUGIN_UPDATE_PENDING"
    ? `Tell the user to restart ${copy.productName} (recovery runs at start) and then try again.`
    : `Its update recovery record needs manual repair (${error.code}); restarting ${copy.productName} will not fix it. Tell the user an operator has to repair it first.`;
}
export function changedSinceConfirmation({ pluginId, name, version }: { pluginId: string; name: string; version: string }): string { return `'${pluginId}' changed after the user was asked: the confirmation showed ${name} version ${version}, and that ` +
        "is no longer what is installed. Nothing was removed. Call plugins_uninstall again so the user can review and confirm what is installed now."; }
export function hostIncompatibleNote({ pluginId, copy }: { pluginId: string; copy: PluginHostCopy }, _optional = {}): string { return `Nothing changed: '${pluginId}' is not made for this ${copy.productName} version, so it was NOT enabled. ` +
      `Tell the user it needs a version of the plugin that supports this ${copy.productName}.`; }
export function activationsUnreadableNote({ pluginId, enabled }: { pluginId: string; enabled: boolean }): string { return `Nothing changed: this workspace's Agent Plugin activation record could not be read, so '${pluginId}' was NOT ` +
      `${enabled ? "enabled" : "disabled"}. Tell the user an operator has to repair activations.json first (the server ` +
      "log names the file and the fault); until then every Agent Plugin tool call in this workspace is refused."; }
export function activationsBusyNote({ pluginId, enabled, copy }: { pluginId: string; enabled: boolean; copy: PluginHostCopy }, _optional = {}): string { return `Nothing changed: another ${copy.productName} process was writing this workspace's Agent Plugin activation record at the same ` +
      `moment, so '${pluginId}' was NOT ${enabled ? "enabled" : "disabled"}. Tell the user nothing was ` +
      "changed and to try again in a moment; if it keeps happening, the server log names the lock file."; }
export function installedNote(plugin: { name: string; version: string }): string { return `Installed ${plugin.name} ${plugin.version}. It is OFF in every workspace; turn it on with plugins_set_enabled (family 'site-runtime') if the user wants it on.`; }
export const localInstallDisabledNote = ({ copy }: { copy: PluginHostCopy }): string => `Nothing was installed: local plugin installs are off on this server. The owner has to start ${copy.productName} with ${copy.localInstallEnv}=1 first.`;
export const retryInstallHint = " Call plugins_install again to install what is there now.";
/** The host-bound set-enabled/uninstall messages; product copy arrives through `copy`. @complexity O(1). */
export function createPluginToolMessages({ copy }: { copy: PluginHostCopy }, _optional = {}) {
  return {
    familyRequired: familyRequired({ copy }),
    restartNote: (request: SetEnabledRequest) => restartNote({ request, copy }),
    changedSinceConfirmation,
    updatePendingNextStep: (error: { code: string }) => updatePendingNextStep({ error, copy }),
    hostIncompatibleNote: ({ pluginId }: { pluginId: string }) => hostIncompatibleNote({ pluginId, copy }),
    activationsUnreadableNote,
    activationsBusyNote: ({ pluginId, enabled }: { pluginId: string; enabled: boolean }) => activationsBusyNote({ pluginId, enabled, copy }),
  };
}
/** The host-bound install messages; product copy arrives through `copy`. @complexity O(1). */
export function createPluginInstallMessages({ copy }: { copy: PluginHostCopy }, _optional = {}) {
  return { installedNote, localInstallDisabledNote: localInstallDisabledNote({ copy }), retryInstallHint };
}
