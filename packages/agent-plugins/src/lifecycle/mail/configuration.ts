import type { MailProviderModule, MailProviderSetting, MailProviderConfiguration, MailProviderConfigurationReport } from "@jini-ai/core/contracts/mail";
import type { MailProviderCatalog } from "./catalog.js";
/** Metadata only: no credential values cross this configuration projection. */
export interface MailCredentialRow { id: string; label: string; username?: string | null; updatedAt: string }
/** @agent-note Refusal copy is host product wording, supplied without defaults. */
export function createMailConfiguration(requiredHost: { mailHostText: { localOnly: string; missingCredential: (required: { label: string | undefined }) => string } }, _optional: Record<string,never> = {}) {
/**
 * @file The safe provider configuration DTO the admin Email page, `mail_list_providers` and
 * `system_get_mail_status` share (email phase 2, 2026-10-22). Pure over already-read facts: the
 * catalog, the workspace's credential rows (metadata only — nothing here decrypts or returns a
 * secret, and the saved username is reduced to presence) and the `core.mail.provider` setting.
 *
 * "Saved" is a presence check, cheap enough for every status read. Activation (`checkProvider`)
 * still decrypts the key before it lets a provider send, so a saved-but-unreadable key is caught there.
 */

type CatalogEntry = { pluginId?: string; id: string; provider: MailProviderModule; origin: "core" | "plugin" };

/** Lanes `id` currently sends for. @complexity O(1). */
function lanesFor({ setting, id }: { setting: MailProviderSetting; id: string }, _options: Record<string, never> = {}): ("transactional" | "bulk")[] {
  return (["transactional", "bulk"] as const).filter((lane) => setting[lane] === id);
}

/** A saved row counts once it holds every field the provider reads beyond the always-stored token/origin. */
function rowComplete(provider: MailProviderModule, record: MailCredentialRow): boolean {
  return !provider.credentialKeys.includes("username") || Boolean(record.username);
}

/** Credential presence, never its value. @complexity O(c) rows. */
function credentialFacts(required: { label: string | undefined; provider: MailProviderModule; records: readonly MailCredentialRow[] }, _options: Record<string, never> = {}): MailProviderConfiguration["credential"] {
  const { label, provider } = required;
  if (label === undefined) return { required: false, saved: false };
  const record = required.records.find((row) => row.label === label);
  if (!record) return { required: true, saved: false, label };
  return { required: true, saved: rowComplete(provider, record), label, credentialId: record.id, updatedAt: record.updatedAt };
}

/** Why `mail_set_provider` would refuse it, judged by presence; undefined = selectable. */
function refusalFor(provider: MailProviderModule, credential: MailProviderConfiguration["credential"]): string | undefined {
  if (!provider.capabilities.hosted) return requiredHost.mailHostText.localOnly;
  if (credential.required && !credential.saved) return requiredHost.mailHostText.missingCredential({ label: credential.label });
  return undefined;
}

function describeOne(required: { catalog: MailProviderCatalog; entry: CatalogEntry; records: readonly MailCredentialRow[]; setting: MailProviderSetting }, _options: Record<string, never> = {}): MailProviderConfiguration {
  const { catalog, entry, setting } = required;
  const { provider } = entry;
  const credential = credentialFacts({ label: catalog.credentialLabelFor({ id: entry.id }), provider, records: required.records });
  const refusal = refusalFor(provider, credential);
  const { feedback, domainVerification, rateLimit } = provider.capabilities;
  return {
    id: entry.id, label: provider.label, origin: entry.origin, hosted: provider.capabilities.hosted, lanes: lanesFor({ setting: setting, id: entry.id }),
    ...(entry.pluginId ? { pluginId: entry.pluginId } : {}),
    capabilities: { feedback, domainVerification, ...(rateLimit ? { rateLimit: { perSecond: rateLimit.perSecond, burst: rateLimit.burst } } : {}) },
    credential, selectable: refusal === undefined, ...(refusal ? { refusal } : {}), setup: catalog.setupFor({ id: entry.id }),
  };
}

/**
 * Every installed provider's safe configuration, in registry order.
 * @complexity O(p * c) providers by credential rows, both small.
 */
function describeMailProviders(
  required: { catalog: MailProviderCatalog; records: readonly MailCredentialRow[]; setting: MailProviderSetting },
  _optional: Record<string, never> = {}
): MailProviderConfigurationReport {
  const { catalog, records, setting } = required;
  const providers = catalog.registry.list().map((entry) => describeOne({ catalog, entry, records, setting }));
  return { setting: { transactional: setting.transactional, bulk: setting.bulk }, providers, refusals: catalog.refusals };
}

return { describeMailProviders };
}
