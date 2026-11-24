/** One field of a provider plugin's settings card (`PLUGIN_PROVIDER_SETTINGS`). A secret field never
 *  carries its value back: `saved` says whether one is stored. */
export interface AdminPluginProviderSettingField {
  name: string;
  label: string;
  hint?: string;
  /** Public fields: the plugin's declared value while none is saved (prefilled on the card). */
  default?: string;
  /** Public fields: the plugin's declared choices, shown as a select. */
  options?: { value: string; label: string }[];
  /** With `options`: a "Custom…" choice opens free text. */
  allowCustom?: true;
  secret: boolean;
  required: boolean;
  requiredUnless?: { readonly field: string; readonly equals: string; readonly orPresent?: string; readonly headerNames?: readonly string[] };
  requiredWhen?: { readonly field: string; readonly in: readonly string[] };
  saved: boolean;
  value?: string;
}

/** `GET|PUT /workspaces/:id/plugins/:pluginId/provider-settings` (2026-10-26). */
export interface AdminPluginProviderSettings {
  pluginId: string;
  /** Where this key lives; project keys are visible to attached sites only. */
  store: "project" | "site";
  appliesAt: "now" | "restart" | "failed"; message?: string;
  keyId?: string;
  usedByThisSite: boolean;
  usedBy: string[];
  projectAvailable?: boolean;
  /** A key was saved the retired way (wave 2's `plugin:<id>` API credential) and nothing yet the new way. */
  legacyCredential?: true;
  /** Settings are saved but this machine can't open them (the store's key was lost or re-minted):
   *  shown as not configured until they are entered again. */
  unreadable?: true;
  fields: AdminPluginProviderSettingField[];
}
