/**
 * @file The per-site `core.search/provider` setting: which search provider a site's index and
 * queries use. Default `builtin` (`@jini-ai/search`'s `BUILTIN_SEARCH_PROVIDER_ID`), so a site with
 * no choice keeps every document in the owner's in-process provider.
 *
 * On the existing settings ledger, workspace scope (one workspace per site in v1). Writes go
 * through the host chokepoint (`features/settings/site-title-write.ts`), which authorizes and
 * records a revision. The id grammar is checked here on both sides: the typed write refuses a bad
 * id, and a read of a value stored any other way refuses it too rather than guessing a provider.
 */
import type { JsonValue } from "@jini-ai/core/primitives";
import {
  ensureSettingDefinitions, getEffective, SCOPE_BIT, ValueValidationFailedError,
  type EnsureSettingDefinitionsDeps, type SetValueRequired, type SettingsRepoPort,
} from "@jini-ai/core/settings";
import { BUILTIN_SEARCH_PROVIDER_ID } from "../index.js";

export const SEARCH_SETTINGS_NAMESPACE = "core.search";
export const SEARCH_PROVIDER_KEY = "provider";

/** The provider registry's id grammar. */
const PROVIDER_ID = /^[a-z][a-z0-9_]{0,63}$/;

/** True for a value that can name a registered provider. @complexity O(1), bounded length. */
export function isSearchProviderId(value: unknown): value is string {
  return typeof value === "string" && PROVIDER_ID.test(value);
}

const rejection = ({ value }: { value: unknown }, _optional = {}) =>
  new ValueValidationFailedError(`value for '${SEARCH_SETTINGS_NAMESPACE}.${SEARCH_PROVIDER_KEY}' must match ${PROVIDER_ID.source}; got ${JSON.stringify(value).slice(0, 80)}`);

/**
 * Register the definition without replacing an owner's stored value.
 * @complexity O(1), one definition.
 */
export function ensureSearchProviderSetting(
  required: { deps: EnsureSettingDefinitionsDeps; systemPrincipalId: string },
  _optional: Record<string, never> = {},
): Promise<void> {
  return ensureSettingDefinitions(required.deps, {
    namespace: SEARCH_SETTINGS_NAMESPACE, systemPrincipalId: required.systemPrincipalId,
    definitions: [{ key: SEARCH_PROVIDER_KEY, schema: { type: "string" }, defaultValue: BUILTIN_SEARCH_PROVIDER_ID, scopes: SCOPE_BIT.workspace }],
  });
}

/**
 * A reader of a site's provider id, read fresh on each call. An unregistered definition reads as
 * the default.
 * @throws ValueValidationFailedError (from the returned reader) for a stored value outside the grammar.
 * @complexity O(1) to build; each read is one effective-setting read.
 */
export function readSearchProviderSetting(
  required: { settingsRepo: SettingsRepoPort },
  _optional: Record<string, never> = {},
): (input: { workspaceId: string }) => Promise<string> {
  return async ({ workspaceId }) => {
    const found = await getEffective({ deps: { repo: required.settingsRepo }, namespace: SEARCH_SETTINGS_NAMESPACE, key: SEARCH_PROVIDER_KEY, scopeContext: { workspaceId } });
    const value = found?.value ?? BUILTIN_SEARCH_PROVIDER_ID;
    if (!isSearchProviderId(value)) throw rejection({ value });
    return value;
  };
}

/** The host settings write (`features/settings` `set`), injected by composition so search never imports settings. */
export type SearchSettingWriter = (required: SetValueRequired) => Promise<{ value: JsonValue; revisionSeq: number }>;

/**
 * A writer of a site's provider id through the host settings chokepoint. It checks the grammar
 * only: whether a provider with that id is installed is the caller's question (the registry).
 * @throws ValueValidationFailedError for an id outside the grammar, before anything is written;
 *   authorization and ledger errors from the settings write propagate.
 * @complexity O(1) to build; each write is one settings write.
 */
export function writeSearchProviderSetting(
  required: { deps: SetValueRequired["deps"]; writeSetting: SearchSettingWriter },
  _optional: Record<string, never> = {},
): (input: { workspaceId: string; callerPrincipalId: string; providerId: string }) => Promise<{ value: JsonValue; revisionSeq: number }> {
  return async ({ workspaceId, callerPrincipalId, providerId }) => {
    if (!isSearchProviderId(providerId)) throw rejection({ value: providerId });
    return required.writeSetting({ deps: required.deps, input: {
      namespace: SEARCH_SETTINGS_NAMESPACE, key: SEARCH_PROVIDER_KEY, scope: "workspace", workspaceId, callerPrincipalId, value: providerId,
    } });
  };
}
