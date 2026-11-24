import type { PluginPreviewRequest } from "../rules.js";

/**
 * @file What `use-content-analysis.hooks.ts` needs from the outside world, as an interface rather
 * than a direct `lib/api` import — the `useX(dependencies)` / `useWiredX()` pair documented in
 * `development/docs/architecture/wired-hooks-convention.md`.
 *
 * `previewStatus` is the preview route's own `GET` (`PLUGIN_PREVIEW_STATUS`, gated on
 * `content.write` like the preview itself) — not the Plugins screen's list, which needs
 * `admin.plugins.read` and so hid the card from built-in editors the preview admits.
 */

/** The generic plugin preview route's reply: ONE plugin's ext patch for an unsaved draft, validated
 *  against the plugin's declared fields and never saved (AW-7 Tier-2 brief). */
export interface PluginPreviewResponse {
  pluginId: string;
  fields: Record<string, string | number | boolean>;
}

export interface ContentAnalysisPort {
  /** `GET /plugins/:pluginId/preview` — whether that plugin is enabled; rejects with an `ApiError`
   *  carrying `PLUGIN_NOT_FOUND` (404) when it is not installed. */
  previewStatus(target: { pluginId: string }): Promise<{ pluginId: string; enabled: boolean }>;
  /** `POST /plugins/:pluginId/preview` — rejects with an `ApiError` carrying `PLUGIN_NOT_FOUND`
   *  (404), `PLUGIN_NOT_ENABLED` (409) or `PLUGIN_HOOK_FAILED` (422). */
  previewPlugin(required: { target: { pluginId: string }; body: PluginPreviewRequest }, optional?: Record<string, never>): Promise<PluginPreviewResponse>;
}
