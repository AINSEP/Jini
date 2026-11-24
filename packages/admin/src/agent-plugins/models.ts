/**
 * HTTP presentation projection; installation paths/digests never enter the browser.
 * Restated from the plugin lifecycle's `InstalledAgentPlugin` (only the fields the screen reads) so admin owns its
 * plugin-list port; `__tests__/installed-plugin-fit.typecheck.ts` fails to compile when the lifecycle's types drift.
 */
export interface AgentPluginSummary {
  readonly pluginId: string;
  readonly version: string | null;
  readonly description: string | null;
  readonly keywords: readonly string[];
  readonly skills: readonly { readonly name: string; readonly summary: string }[];
  readonly mcpServerIds: readonly string[];
  readonly enabled: boolean;
}
/** One row of `GET .../agent-plugins` as the host's screen reads it: {@link AgentPluginSummary} plus the optional
 *  host-owned lifecycle/account fields. `version`/`description` are nullable, not optional-absent: the wire always
 *  sends the key, `null` when the package's own manifest carries none. Agent Plugins (agent-plugins.org packages) are
 *  a DIFFERENT family from the site/runtime plugins `AdminPlugin` describes. */
export interface AgentPluginListRow extends AgentPluginSummary {
  /** Account state is independent of activation; absent for plugins with no sign-in. */
  connectionStatus?: "connected" | "disconnected" | "pending" | "needs_reauth";
  /** Host maturity; absent means normal. */
  maturity?: "untested" | "soon";
  /** The provider plugin (Plugins screen) whose switch this plugin follows; it has no switch of its own. */
  providerPlugin?: string;
  provides?: string[];
  origin?: "bundled" | "operator-installed";
  hostOk?: boolean;
  missingRequires?: string[];
  requiredBy?: string[];
  archiveDigest?: string;
  /** `plugin.json`'s `extensions.jini.displayName`; `null` (or absent, from a server predating the
   *  field) means title-case `pluginId` instead. */
  displayName?: string | null;
  /** `plugin.json`'s `extensions.jini.summary` — the plain-language explainer the row shows in place
   *  of `description` (which is written for the assistant); `null`/absent means show `description`. */
  summary?: string | null;
  keywords: string[];
  skills: Array<{ name: string; summary: string }>;
  mcpServerIds: string[];
}
export interface AgentPluginActivationInput { readonly pluginId: string; readonly enabled: boolean }
export interface AgentPluginPackageFile {
  readonly relativePath: string;
  readonly sizeBytes: number;
  readonly content: string | null;
  readonly omitted: null | 'binary' | 'too-large' | 'symlink' | 'unreadable';
}
/** The existing read-only route's bounded listing, not lifecycle's on-disk files array. */
export interface AgentPluginFiles {
  readonly pluginId: string;
  readonly files: readonly AgentPluginPackageFile[];
  readonly truncated: boolean;
  readonly limits: { readonly maxFiles: number; readonly maxEntries: number; readonly maxFileBytes: number; readonly maxTotalBytes: number };
}
export interface AgentPluginRequestOptions { readonly signal?: AbortSignal }
export type AgentPluginTab = 'installed' | 'downloaded' | 'marketplace';
export interface AgentPluginDisableRequest { readonly pluginId: string; readonly variant: 'disable' | 'remove' }
export interface AgentPluginsState {
  readonly plugins: readonly AgentPluginSummary[] | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly actionError: string | null;
  readonly busyIds: readonly string[];
  readonly expandedIds: readonly string[];
  readonly pendingDisable: AgentPluginDisableRequest | null;
  readonly inspectedId: string | null;
}
export interface AgentPluginFilesState {
  readonly pluginId: string | null;
  readonly listing: AgentPluginFiles | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly selectedPath: string;
}
