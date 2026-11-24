import type { AdminPluginConflict } from "../api/plugins-api.types.js";

/** Site-plugin install transport; agent plugins have a separate lifecycle and store. Mirrors
 *  the host install service's `PluginInstallPreview` (`@jini-ai/core/contracts/site/host-node`). */
export interface PluginInstallPreview {
  id: string; name: string; version: string; tier: string;
  capabilities: readonly string[]; hooks: readonly string[];
  /** `false` only for a manifest-only (tier-1) package — nothing in it runs (AW-7 Tier 1). */
  hasCode: boolean; digest: string; upgradeFrom?: string;
  /** Content-type keys the manifest declares; created when the plugin is turned on. */
  contentTypes: readonly string[];
  /** Names it would clash with if turned on in the CURRENT workspace (install is site-wide). */
  conflicts: readonly AdminPluginConflict[];
}
export interface PluginInstallSource { source: { kind: "folder"; path: string } | { kind: "zip"; file: File }; replace?: boolean }
export interface PluginInstallPort {
  preview(required: PluginInstallSource, optional?: Record<string, never>): Promise<{ plugin: PluginInstallPreview }>;
  install(required: PluginInstallSource & { expectedDigest: string }, optional?: Record<string, never>): Promise<{ plugin: PluginInstallPreview }>;
}
