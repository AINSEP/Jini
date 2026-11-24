import type { AdminPlugin, AdminPluginFiles, AdminPluginProviderSettings } from "./plugins-api.types.js";

/** The host's authenticated admin request — it owns the base URL, authentication, retries, error
 *  decoding and failure publishing, so this client only names paths, methods and bodies. */
export type PluginsRequestFn = <T>(required: { path: string }, optional?: { init?: RequestInit }) => Promise<T>;

/** What the host injects into {@link createPluginsApi}. */
export interface PluginsApiDeps {
  /** The host's authenticated admin request. */
  request: PluginsRequestFn;
  /** The workspace every plugins path is scoped under (`/workspaces/<id>/plugins`). */
  workspaceId: string;
}

/** The admin API calls of the plugins feature, bound to the host's injected collaborators.
 *  @example const pluginsApi = createPluginsApi({ request, workspaceId }); */
export function createPluginsApi({ request, workspaceId }: PluginsApiDeps, _optional: Record<string, never> = {}) {
  return {
    // SPEC-005 REQ-12..17 (1.1.0 UI amendment) — consumes REQ-10's PLUGINS_LIST/PLUGIN_SET_ENABLED
    // HTTP contract as a black box (ui.spec.md §3.1/§4.2).
    listPlugins: () => request<{ plugins: AdminPlugin[] }>({ path: `/workspaces/${workspaceId}/plugins` }),
    /** PLUGIN_PROVIDER_SETTINGS (2026-10-26) — a provider plugin's declared settings card. */
    getPluginProviderSettings: ({ pluginId }: { pluginId: string }, _optional: Record<string, never> = {}) =>
      request<AdminPluginProviderSettings>({ path: `/workspaces/${workspaceId}/plugins/${encodeURIComponent(pluginId)}/provider-settings` }),
    /** Saves and reapplies card values; a blank secret keeps the saved one. */
    savePluginProviderSettings: ({ pluginId, values }: { pluginId: string; values: Record<string, string> }, _optional: Record<string, never> = {}) =>
      request<AdminPluginProviderSettings>({ path: `/workspaces/${workspaceId}/plugins/${encodeURIComponent(pluginId)}/provider-settings` }, { init: {
        method: "PUT", body: JSON.stringify({ values }),
      } }),
    setPluginEnabled: ({ pluginId, enabled }: { pluginId: string; enabled: boolean }, _optional: Record<string, never> = {}) =>
      request<{ plugin: { id: string; version: string; enabled: boolean; updatedAt: string }; changeSetId: string }>(
        { path: `/workspaces/${workspaceId}/plugins/${encodeURIComponent(pluginId)}` },
        { init: { method: "PATCH", body: JSON.stringify({ enabled }) } }
      ),
    /** Moves a site plugin to the 60-day Trash. `PLUGIN_IN_TRASH` reports an existing parked copy. */
    uninstallPlugin: ({ pluginId }: { pluginId: string }, _optional: Record<string, never> = {}) =>
      request<{ pluginId: string; trashed: true }>(
        { path: `/workspaces/${workspaceId}/plugins/${encodeURIComponent(pluginId)}` },
        { init: { method: "DELETE" } }
      ),
    /** PLUGIN_FILES (2026-09-13) — `GET /workspaces/:id/plugins/:pluginId/files`: the read-only,
     *  server-capped listing of one plugin's own files behind the Plugins screen's package-files
     *  viewer. Refuses `PLUGIN_NOT_FOUND` (404) and `PLUGIN_ID_INVALID` (400). */
    getPluginFiles: ({ pluginId }: { pluginId: string }, _optional: Record<string, never> = {}) =>
      request<AdminPluginFiles>({ path: `/workspaces/${workspaceId}/plugins/${encodeURIComponent(pluginId)}/files` }),
  };
}
