import type { JsonValue } from "@jini-ai/core/primitives";
import { SCOPE_BIT, type EnsureSettingDefinitionsDeps, type EnsureSettingDefinitionsPort, type GetEffectivePort, type SettingsRepoPort } from "@jini-ai/core/settings";

/**
 * @file The site's outbound mail sender, on the existing settings ledger: `core.mail.senderEmail`
 * (the From address system emails use) and `core.mail.senderName` (its display name). No schema
 * change: both are ordinary workspace-scoped definitions. `platform/mail/sender-identity.ts` reads
 * them through {@link readMailSenderSetting} and decides what an unset value means.
 *
 * Both default to the empty string, which reads as "not configured". `core.*` forces a core,
 * platform-wide definition whose values stay per-workspace — see `site-title.ts`'s header.
 */

export const MAIL_SENDER_NAMESPACE = "core.mail";
export const MAIL_SENDER_EMAIL_KEY = "senderEmail";
export const MAIL_SENDER_NAME_KEY = "senderName";

/**
 * Registers both definitions without replacing an owner's stored values.
 * @complexity O(1), two definitions.
 */
export function ensureMailSenderSettings(
  required: { deps: EnsureSettingDefinitionsDeps & EnsureSettingDefinitionsPort; systemPrincipalId: string },
  _optional: Record<string, never> = {}
): Promise<void> {
  return required.deps.ensureSettingDefinitions(required.deps, { namespace: MAIL_SENDER_NAMESPACE, systemPrincipalId: required.systemPrincipalId, definitions: [
    { key: MAIL_SENDER_EMAIL_KEY, schema: { type: "string" }, defaultValue: "", scopes: SCOPE_BIT.workspace },
    { key: MAIL_SENDER_NAME_KEY, schema: { type: "string" }, defaultValue: "", scopes: SCOPE_BIT.workspace },
  ] });
}

/**
 * The site's saved sender, read fresh for every send so a change applies to the next email. A
 * blank, non-string or unregistered value is left out.
 * @complexity Two effective setting reads.
 */
export async function readMailSenderSetting(
  required: { settingsRepo: SettingsRepoPort; workspaceId: string } & GetEffectivePort,
  _optional: Record<string, never> = {}
): Promise<{ email?: string; name?: string }> {
  const read = ({ key }: { key: string }, _optional = {}) => required.getEffective({ deps: { repo: required.settingsRepo }, namespace: MAIL_SENDER_NAMESPACE, key, scopeContext: { workspaceId: required.workspaceId } });
  const [email, name] = await Promise.all([read({ key: MAIL_SENDER_EMAIL_KEY }), read({ key: MAIL_SENDER_NAME_KEY })]);
  return { ...nonBlank({ field: "email", value: email?.value }), ...nonBlank({ field: "name", value: name?.value }) };
}

/** `{ [field]: trimmed }` for a non-blank string, else `{}`. Pure. */
function nonBlank(
  { field, value }: { field: "email" | "name"; value: JsonValue | undefined },
  _optional = {}
): { email?: string; name?: string } {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? { [field]: trimmed } : {};
}
