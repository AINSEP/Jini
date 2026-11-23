/**
 * @file Where a provider plugin's saved settings live: a storage-neutral port,
 * `pluginId → { settings, secrets }`, so boot and the admin settings card never know which store
 * answered. Types only.
 *
 * Owner of these declarations; `@jini-ai/plugins/host` re-exports the types from here. The host
 * supplies the adapters (site vault, project store); none live here.
 */
import type { ProviderKeyUsage, ProviderWriteResult } from "./plugins-host.js";

/** Saved values for one provider plugin; keys are the plugin's declared setting names. */
export interface ProviderPluginConfig {
  readonly settings: Readonly<Record<string, string>>;
  readonly secrets: Readonly<Record<string, string>>;
}

/** The admin card's view: public values and the NAMES of saved secrets, never a secret value. */
export interface ProviderSettingsView {
  readonly settings: Readonly<Record<string, string>>;
  readonly secretNames: readonly string[];
  /** A row is saved but this machine cannot open it (the store's key was lost or re-minted): shown as
   *  not configured, with a notice to enter the settings again. */
  readonly unreadable?: true;
}

export interface ProviderConfigSource {
  usage(required: { pluginId: string }, optional?: Record<string, never>): Promise<ProviderKeyUsage>;
  /** Which store this is, for the admin card ("saved for this project" vs "this site"). */
  readonly scope: "project" | "site";
  /** Null when nothing was ever saved for the plugin.
   *  Throws the host's unreadable-config error when a row is saved but cannot be opened here. */
  read(required: { pluginId: string }, optional?: Record<string, never>): Promise<ProviderPluginConfig | null>;
  /** Public values and secret names. The row holding both halves is decrypted to read them, so an
   *  endpoint and its credential are one saved snapshot, but no secret value is returned.
   *  Null when nothing was saved. */
  readSettings(required: { pluginId: string }, optional?: Record<string, never>): Promise<ProviderSettingsView | null>;
  /** Saves the whole config, overwriting a row this machine cannot open. */
  write(required: { pluginId: string; config: ProviderPluginConfig }, optional?: Record<string, never>): Promise<ProviderWriteResult | void>;
}
