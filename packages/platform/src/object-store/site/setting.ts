import { SCOPE_BIT, type EnsureSettingDefinitionsDeps, type SettingsRepoPort } from "@jini-ai/core/settings";
import type { ensureSettingDefinitions, getEffective } from "@jini-ai/core/settings";

/**
 * @file Which object-store provider holds the site's media bytes: `core.storage.mediaObjectStore`
 * on the existing settings ledger (workspace scope, no schema change). The empty default means the
 * registry default, `local`. Read once per boot when media is first touched, so a change applies
 * on the next restart. The host's media blob-store env var, when set, overrides it.
 *
 * ## Wiring
 * The host binds the settings ledger's implementations: `ensureSettingDefinitions` (the
 * definition writer) and `getEffective` (the reader) arrive on each function's required args, so
 * this module only type-imports their contracts from `@jini-ai/core/settings`.
 */

export const STORAGE_SETTINGS_NAMESPACE = "core.storage";
export const MEDIA_OBJECT_STORE_KEY = "mediaObjectStore";

/**
 * Registers the definition without replacing an owner's stored value.
 * @complexity O(1), one definition.
 */
export function ensureMediaObjectStoreSetting(
  required: { deps: EnsureSettingDefinitionsDeps; systemPrincipalId: string; ensureSettingDefinitions: typeof ensureSettingDefinitions },
  _optional: Record<string, never> = {}
): Promise<void> {
  return required.ensureSettingDefinitions(required.deps, { namespace: STORAGE_SETTINGS_NAMESPACE, systemPrincipalId: required.systemPrincipalId, definitions: [
    { key: MEDIA_OBJECT_STORE_KEY, schema: { type: "string" }, defaultValue: "", scopes: SCOPE_BIT.workspace },
  ] });
}

/**
 * The saved provider id, trimmed; `""` when unset, blank, non-string or unregistered.
 * @complexity One effective setting read.
 */
export async function readMediaObjectStoreSetting(
  required: { settingsRepo: SettingsRepoPort; workspaceId: string; getEffective: typeof getEffective },
  _optional: Record<string, never> = {}
): Promise<string> {
  const effective = await required.getEffective({ deps: { repo: required.settingsRepo }, namespace: STORAGE_SETTINGS_NAMESPACE, key: MEDIA_OBJECT_STORE_KEY, scopeContext: { workspaceId: required.workspaceId } });
  return typeof effective?.value === "string" ? effective.value.trim() : "";
}
