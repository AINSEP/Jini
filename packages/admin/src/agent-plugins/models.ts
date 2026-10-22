import type { InstalledAgentPlugin, InstalledAgentPluginSkill, SetAgentPluginEnabledInput } from '@jini-ai/agent-plugins/lifecycle';

/** HTTP presentation projection; installation paths/digests never enter the browser. */
export interface AgentPluginSummary extends Pick<InstalledAgentPlugin, 'pluginId'> {
  readonly version: InstalledAgentPlugin['version'] | null;
  readonly description: InstalledAgentPlugin['description'] | null;
  readonly keywords: NonNullable<InstalledAgentPlugin['keywords']>;
  readonly skills: readonly (Pick<InstalledAgentPluginSkill, 'name'> & { readonly summary: string })[];
  readonly mcpServerIds: readonly string[];
  readonly enabled: SetAgentPluginEnabledInput['enabled'];
}
export type AgentPluginActivationInput = Pick<SetAgentPluginEnabledInput, 'pluginId' | 'enabled'>;
export interface AgentPluginPackageFile {
  readonly relativePath: string;
  readonly sizeBytes: number;
  readonly content: string | null;
  readonly omitted: null | 'binary' | 'too-large' | 'symlink' | 'unreadable';
}
/** The existing read-only route's bounded listing, not lifecycle's on-disk files array. */
export interface AgentPluginFiles {
  readonly pluginId: InstalledAgentPlugin['pluginId'];
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
