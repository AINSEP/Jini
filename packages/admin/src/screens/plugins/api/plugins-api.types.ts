/** Mirrors `@jini-ai/plugins/host`'s `AdminPluginEnvelope` (SPEC-005 REQ-10, api.spec.md
 * §5) — the `PLUGINS_LIST`/`PLUGIN_SET_ENABLED` per-plugin wire shape. */
export interface AdminPlugin {
  id: string;
  name: string;
  version: string;
  source: "built-in" | "site";
  /** (1.1.2, REQ-10/REQ-18) Additive — mirrors `AdminPluginEnvelope.tier`; consumed by the host Plugins screen's
   * per-row trust-tier badge (AC-26). */
  tier: "tier-1" | "tier-2" | "tier-3";
  status: "valid" | "invalid" | "incompatible";
  enabled: boolean;
  quarantine: null | {
    at: string;
    reason: string;
    consecutiveFailures: number;
  };
  errors: Array<{ code: string; file: string | null; message: string }>;
  /** (2026-10-04) Mirrors `AdminPluginEnvelope.conflicts`: names this plugin claims that core or an
   * earlier-enabled plugin already holds. Optional so a row from a server predating the field still
   * types; the current server always sends it (empty when clear). */
  conflicts?: AdminPluginConflict[];
  /** (2026-10-26) True when the plugin declares provider settings (its row offers a Settings card). */
  providerSettings?: true;
}

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

/** One entry of {@link AdminPlugin.conflicts} — `packages/plugins/src/host/plugin-claims.ts`'s
 *  `PluginConflict`. `heldBy` is `"core"` for a name the host itself reserves; `heldKey` is the holder's
 *  own spelling (a reserved prefix such as `/api/*` when that is what matched). */
export interface AdminPluginConflict {
  kind: string;
  key: string;
  heldBy: string;
  heldByName: string;
  heldKey: string;
}

/** Mirrors the host admin route's `PLUGIN_FILES` entry (2026-09-13) —
 *  one file in a plugin's own directory. `content` is `null` exactly when `omitted` is set. */
export interface AdminPluginPackageFile {
  relativePath: string;
  sizeBytes: number;
  content: string | null;
  omitted: null | "binary" | "too-large" | "symlink" | "unreadable";
}

/** `PLUGIN_FILES`' whole response: the files, whether the server's caps cut the listing short,
 *  and those caps. */
export interface AdminPluginFiles {
  pluginId: string;
  source: "built-in" | "site";
  files: AdminPluginPackageFile[];
  truncated: boolean;
  limits: { maxFiles: number; maxEntries: number; maxFileBytes: number; maxTotalBytes: number };
}
