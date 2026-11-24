/**
 * @file The admin `plugins` wire DTOs (ADR-029): the JSON bodies the plugins admin routes (list,
 * set-enabled) answer with and an admin client reads. Declared here, once, so the route specs
 * (`@jini-ai/cms/admin-http/routes/plugins/*`), the host's serializer and any client mirror read
 * the same shapes without the client depending on CMS or the plugin engine. Serialization stays
 * with the plugin engine's `toAdminPluginResponse`; only the declarations sit in Core.
 *
 * Core cannot import the plugin engine, so its `AdminPluginEnvelope` is restated structurally
 * here; a host that binds `toAdminPluginResponse` to these specs compiles only while the engine's
 * envelope is assignable to {@link AdminPluginDto}. Keep the two sides identical.
 */

import type { PluginConflict } from './plugins-host.js';

/** Where a plugin was discovered: shipped with the host, or installed on this site. */
export type AdminPluginSource = 'built-in' | 'site';

/** The manifest-declared trust tier; a record without one is reported as `"tier-3"`. */
export type AdminPluginTier = 'tier-1' | 'tier-2' | 'tier-3';

/** The discovery-time integrity verdict. */
export type AdminPluginStatus = 'valid' | 'invalid' | 'incompatible';

/** One discovery-time problem with a plugin package (`file` is `null` when no one file is at fault). */
export interface AdminPluginErrorDto {
  readonly code: string;
  readonly file: string | null;
  readonly message: string;
}

/** Why a plugin is quarantined; present only when the activation row carries all three fields. */
export interface AdminPluginQuarantineDto {
  readonly at: string;
  readonly reason: string;
  readonly consecutiveFailures: number;
}

/**
 * One admin plugin row (api.spec.md §5). Key order is the serialized wire order.
 * `providerSettings` is absent, never `false`, for a plugin whose manifest declares no provider
 * settings.
 */
export interface AdminPluginDto {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly source: AdminPluginSource;
  readonly tier: AdminPluginTier;
  readonly status: AdminPluginStatus;
  /** Projected from the activation row; an absent row means disabled. */
  readonly enabled: boolean;
  readonly quarantine: AdminPluginQuarantineDto | null;
  readonly errors: readonly AdminPluginErrorDto[];
  /** Names this plugin claims that core or an earlier-enabled plugin already holds; empty when clear. */
  readonly conflicts: readonly PluginConflict[];
  readonly providerSettings?: true;
}

/** `GET …/plugins`: every discovered plugin plus the local install sources this server takes. */
export interface AdminPluginListEnvelope {
  plugins: AdminPluginDto[];
  installSources: string[];
}

/** `PATCH …/plugins/:pluginId`: the updated row and the change set that recorded the write. */
export interface AdminPluginSetEnabledEnvelope {
  plugin: AdminPluginDto;
  changeSetId: string;
}
