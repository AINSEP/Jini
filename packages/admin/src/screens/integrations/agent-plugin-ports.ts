import type { AgentPluginFiles, AgentPluginListRow } from "../../agent-plugins/models.js";

/**
 * @file What `use-agent-plugin-install.hooks.ts` needs from outside: the "Add a plugin" upload
 * (`AGENT_PLUGIN_INSTALL_ZIP`) and a SHA-256 of the chosen file. Agent Plugins have their own
 * store and lifecycle, so this is not `plugin-install-port.hooks.ts`'s site-plugin transport.
 */
export interface AgentPluginInstallResult {
  /** True when these exact bytes were already installed; the server changed nothing. */
  alreadyInstalled: boolean;
  warnings?: string[];
  /** The installed row in `listAgentPlugins`' shape, switched off on a fresh install. */
  agentPlugin: AgentPluginListRow | null;
}

export interface AgentPluginInstallPort {
  installZip(required: { file: File; sha256: string; replace?: boolean; update?: { pluginId: string; expectedOldDigest: string } }, optional?: Record<string, never>): Promise<AgentPluginInstallResult>;
  /** Lowercase hex SHA-256 of the file's bytes, so the server can refuse a damaged upload. */
  sha256(required: { file: File }, optional?: Record<string, never>): Promise<string>;
}

/**
 * @file What `use-agent-plugins.hooks.ts` needs from the outside world, as an interface rather than
 * a direct `lib/api` import. Same `useX(dependencies)` / `useWiredX()` pair `plugins-port.hooks.ts`
 * establishes for this feature's sibling screen (`Plugins.tsx`).
 *
 * `setAgentPluginEnabled` resolves to the ONE updated row, unlike `PluginsPort`'s own
 * `setPluginEnabled` (which resolves to a change-set id and leaves its caller to re-fetch the whole
 * list). The row comes back in `listAgentPlugins`' exact shape, so the hook replaces one entry in
 * place — no second GET, and no window in which an unrelated row could be clobbered by a reload
 * that settled after a newer toggle.
 */
export interface AgentPluginsPort {
  listAgentPlugins(): Promise<{ agentPlugins: AgentPluginListRow[] }>;
  setAgentPluginEnabled(required: { pluginId: string; input: { enabled: boolean } }, optional?: Record<string, never>): Promise<{ agentPlugin: AgentPluginListRow }>;
  /** `AGENT_PLUGIN_FILES` — the read-only package-files listing behind the row's eye button
   *  (`use-agent-plugin-details-modal.hooks.ts`). */
  getAgentPluginFiles(required: { pluginId: string }, optional?: Record<string, never>): Promise<AgentPluginFiles>;
}
