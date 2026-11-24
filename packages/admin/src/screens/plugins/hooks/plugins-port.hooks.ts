import type { AdminPluginProviderSettings } from "../api/plugins-api.types.js";
import type { AdminPluginDto, AdminPluginFilesEnvelope } from "@jini-ai/core/contracts/site/cms-plugins";

/**
 * @file What the host's plugins screen hook (`use-plugins.hooks.ts`) needs from the outside world,
 * as an interface rather than a direct API-client import. Follows the `useX(dependencies)` /
 * `useWiredX()` pair and the shape `redirects/SOURCE-RATIONALE.md` uses for a single-hook feature.
 *
 * `describeApiError` is deliberately NOT part of this port — a pure error-message rule with no
 * I/O, imported directly per the pattern's own carve-out (see `redirects/SOURCE-RATIONALE.md`'s
 * identical note).
 */
export interface PluginsPort {
  useProjectKey?(required: { keyId: string; use: boolean }, optional?: Record<string, never>): Promise<{ keyId: string; usedByThisSite: boolean; usedBy: string[]; appliesAt: "now" | "restart" | "failed"; message?: string }>;
  listPlugins(): Promise<{ plugins: AdminPluginDto[]; installSources?: string[] }>;
  /** The route's own response is a partial patch echo (`id`/`version`/`enabled`/`updatedAt`) plus a
   *  `changeSetId`, not a full `AdminPluginDto` — the host's plugins hook never reads it, always
   *  re-fetching the authoritative list via `reload()` afterward. Kept exactly as narrow as the
   *  real route and the one caller need. */
  setPluginEnabled(
    required: { id: string; patch: { enabled: boolean } },
    optional?: Record<string, never>
  ): Promise<{ plugin: { id: string; version: string; enabled: boolean; updatedAt: string }; changeSetId: string }>;
  /** Moves a site plugin to the 60-day Trash; the caller reloads the authoritative list. */
  uninstallPlugin(required: { id: string }, optional?: Record<string, never>): Promise<{ pluginId: string; trashed: true }>;
  /** `PLUGIN_FILES` (`GET /workspaces/:id/plugins/:pluginId/files`) — the read-only package-files
   *  listing behind `PluginPackageFilesModal`. */
  getPluginFiles(required: { id: string }, optional?: Record<string, never>): Promise<AdminPluginFilesEnvelope>;
  /** `PLUGIN_PROVIDER_SETTINGS` read — the provider plugin's settings card (secrets never returned). */
  getProviderSettings(required: { id: string }, optional?: Record<string, never>): Promise<AdminPluginProviderSettings>;
  /** `PLUGIN_PROVIDER_SETTINGS` save; a blank secret keeps the saved one. */
  saveProviderSettings(required: { id: string; values: Record<string, string> }, optional?: Record<string, never>): Promise<AdminPluginProviderSettings>;
}
