import {
  ensureSettingDefinitions,
  ensureSettingsUiTabDefinitions as ensureBaseUiTabDefinitions,
  type EnsureSettingDefinitionsDeps,
  type EnsureSettingsUiTabDefinitionsInput,
  type getEffective,
  type SettingsRepoPort,
} from '@jini-ai/core/settings';

/** Public-site policy is distinct from the admin's origin-local browser opt-out. */
export const PUBLISHED_WEBMCP_NAMESPACE = 'core.privacy';
export const PUBLISHED_WEBMCP_KEY = 'published_site_webmcp_enabled';

/** Both server composition roots already invoke this bootstrap sequentially. */
export async function ensureSettingsUiTabDefinitions(
  required: EnsureSettingDefinitionsDeps,
  optional: EnsureSettingsUiTabDefinitionsInput,
): Promise<void> {
  await ensureBaseUiTabDefinitions(required, optional);
  await ensureSettingDefinitions(required, {
    namespace: PUBLISHED_WEBMCP_NAMESPACE,
    definitions: [{ key: PUBLISHED_WEBMCP_KEY, schema: { type: 'boolean' }, defaultValue: true }],
    systemPrincipalId: optional.systemPrincipalId,
  });
}

export async function isPublishedWebMcpEnabled(
  { settingsRepo, getEffective: read }: { settingsRepo: SettingsRepoPort; getEffective: typeof getEffective },
  { workspaceId }: { workspaceId: string },
): Promise<boolean> {
  const setting = await read({ deps: { repo: settingsRepo }, namespace: PUBLISHED_WEBMCP_NAMESPACE, key: PUBLISHED_WEBMCP_KEY, scopeContext: { workspaceId } });
  // The definition may still be bootstrapping. Only absence uses the owner's
  // ON default; malformed values and read failures do not grant access.
  return setting === null ? true : setting.value === true;
}
