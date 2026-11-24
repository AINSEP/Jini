import type { MailTestModeSetting } from "@jini-ai/core/contracts/mail";
import type { JsonValue } from "@jini-ai/core/primitives";
import { ensureSettingDefinitions, getEffective, resolveDefinitionRaw, DefinitionNotFoundError, SCOPE_BIT, type EnsureSettingDefinitionsDeps, type SetValueRequired, type SettingsRepoPort, type SettingsValueWriteOptions } from "@jini-ai/core/settings";

import { set, type SiteSettingsWritePolicies } from "./site-title-write.js";

/**
 * @file Which mail provider each delivery lane uses, and the site's mail test mode, on the existing
 * settings ledger next to the sender (`mail-sender.ts`, same `core.mail` namespace):
 *
 * - `core.mail.provider` = Jini `MailProviderSetting` `{transactional, bulk}`; `null` per lane is the
 *   explicit `unconfigured` state. Unset (the registered default) means "never decided": boot writes
 *   the provider the old implicit chain picked, once (`server/runtime/boot/resolve-mailer.ts`).
 * - `core.mail.testMode` = `{mode: "off"}` | `{mode: "redirect", to}` | `{mode: "capture"}`.
 *
 * A malformed stored value fails closed: an invalid provider reads as both lanes unconfigured (never
 * as "unset", which would re-run the first-boot migration), an invalid test mode as `off`.
 */

/** One provider adapter id per delivery lane; `null` is the explicit unconfigured state. Structurally
 * the mail platform's own `MailProviderSetting`, declared here so this module needs only core. */
export type MailProviderSetting = { transactional: string | null; bulk: string | null };

export const MAIL_PROVIDER_NAMESPACE = "core.mail";
export const MAIL_PROVIDER_KEY = "provider";
export const MAIL_TEST_MODE_KEY = "testMode";


const UNCONFIGURED: MailProviderSetting = { transactional: null, bulk: null };

/**
 * Registers both definitions without replacing stored values. The provider default `{}` is never read as a value: an unstored setting is "unset".
 * @complexity O(1), two definitions.
 */
export function ensureMailProviderSettings(
  required: { deps: EnsureSettingDefinitionsDeps; systemPrincipalId: string },
  _optional: Record<string, never> = {}
): Promise<void> {
  return ensureSettingDefinitions(required.deps, { namespace: MAIL_PROVIDER_NAMESPACE, systemPrincipalId: required.systemPrincipalId, definitions: [
    { key: MAIL_PROVIDER_KEY, schema: { type: "json" }, defaultValue: {}, scopes: SCOPE_BIT.workspace },
    { key: MAIL_TEST_MODE_KEY, schema: { type: "json" }, defaultValue: { mode: "off" }, scopes: SCOPE_BIT.workspace },
  ] });
}

function isLaneValue(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value !== "");
}

/**
 * The stored provider setting, or `null` when no value was ever stored (or the definition is not
 * registered). Pure. @complexity O(1).
 */
export function parseMailProviderSetting(required: { value: JsonValue | undefined }, _optional: Record<string, never> = {}): MailProviderSetting {
  const { value } = required;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return UNCONFIGURED;
  const record = value as Record<string, unknown>;
  if (!isLaneValue(record.transactional) || !isLaneValue(record.bulk)) return UNCONFIGURED;
  return { transactional: record.transactional, bulk: record.bulk };
}

/**
 * Reads `core.mail.provider` fresh. `null` = never stored (first boot).
 * @throws Propagates ledger failures.
 * @complexity One effective setting read.
 */
export async function readMailProviderSetting(
  required: { settingsRepo: SettingsRepoPort; workspaceId: string },
  _optional: Record<string, never> = {}
): Promise<MailProviderSetting | null> {
  const found = await getEffective({ deps: { repo: required.settingsRepo }, namespace: MAIL_PROVIDER_NAMESPACE, key: MAIL_PROVIDER_KEY, scopeContext: { workspaceId: required.workspaceId } });
  if (!found || found.sourceLayer === "default") return null;
  return parseMailProviderSetting({ value: found.value });
}

/** Read the exact workspace layer once so displayed lanes and revision describe the same row.
 * @returns The current lanes and addressed revision (zero when never stored).
 * @throws When definitions are unavailable or the settings ledger cannot be read.
 * @complexity One definition lookup and one addressed value read; O(1) space.
 */
export async function readMailProviderSelection(
  required: { settingsRepo: SettingsRepoPort; workspaceId: string },
  _optional: Record<string, never> = {},
): Promise<{ setting: MailProviderSetting; revisionSeq: number }> {
  const definition = await resolveDefinitionRaw({ repo: required.settingsRepo }, {
    namespace: MAIL_PROVIDER_NAMESPACE, key: MAIL_PROVIDER_KEY, workspaceId: required.workspaceId,
  });
  if (!definition) throw new DefinitionNotFoundError("Mail provider settings are unavailable. Nothing was changed. Try again after this site finishes starting.");
  const row = await required.settingsRepo.getWorkspaceValue({ workspaceId: required.workspaceId, settingId: definition.settingId });
  return { setting: parseMailProviderSetting({ value: row?.state === "set" ? row.valueJson : undefined }), revisionSeq: row?.seq ?? 0 };
}

/**
 * Writes both lanes through the host settings chokepoint (authorization is the caller's `deps`).
 * An approved snapshot uses the settings ledger's existing transactional revision guard.
 * @throws {SettingsRevisionConflictError} If the addressed setting changed after approval preparation.
 * @complexity One settings write and, when guarded, one addressed-layer read in its transaction.
 */
export async function writeMailProviderSetting(
  required: {
    deps: SetValueRequired["deps"]; workspaceId: string; callerPrincipalId: string; value: MailProviderSetting;
    /** The host's chokepoint policy, bound once where the host builds its settings writes. */
    writePolicies: SiteSettingsWritePolicies;
  },
  optional: SettingsValueWriteOptions = {}
): Promise<void> {
  await set({ deps: required.deps, writePolicies: required.writePolicies, input: {
    namespace: MAIL_PROVIDER_NAMESPACE, key: MAIL_PROVIDER_KEY, scope: "workspace", workspaceId: required.workspaceId,
    authWorkspaceId: required.workspaceId, callerPrincipalId: required.callerPrincipalId,
    value: { transactional: required.value.transactional, bulk: required.value.bulk },
  } }, optional);
}

/** Parses a stored test mode; anything unrecognised is `off`. Pure. @complexity O(1). */
export function parseMailTestMode(required: { value: JsonValue | undefined }, _optional: Record<string, never> = {}): MailTestModeSetting {
  const { value } = required;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { mode: "off" };
  const record = value as Record<string, unknown>;
  if (record.mode === "capture") return { mode: "capture" };
  if (record.mode === "redirect" && typeof record.to === "string" && record.to.includes("@")) return { mode: "redirect", to: record.to.trim() };
  return { mode: "off" };
}

/**
 * Reads `core.mail.testMode` fresh, so switching it applies to the next send.
 * @complexity One effective setting read.
 */
export async function readMailTestMode(
  required: { settingsRepo: SettingsRepoPort; workspaceId: string },
  _optional: Record<string, never> = {}
): Promise<MailTestModeSetting> {
  const found = await getEffective({ deps: { repo: required.settingsRepo }, namespace: MAIL_PROVIDER_NAMESPACE, key: MAIL_TEST_MODE_KEY, scopeContext: { workspaceId: required.workspaceId } });
  return parseMailTestMode({ value: found?.value });
}
