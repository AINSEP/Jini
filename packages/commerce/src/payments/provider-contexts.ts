/** Site-owned configuration is the only credential source; commerce never opens a store itself. */
import type { HttpClientPort } from "@jini-ai/core/primitives";
import { paymentError, type ProviderContext } from "./contract/provider.js";
import type { PaymentScope } from "./contract/scope.js";
import type { ProviderContextPort, ProviderContextResult } from "./provider-registry.js";

/** Structural mirror of the plugin host's reader; importing the host would reverse ownership. */
export interface PaymentProviderConfigReader {
  read(required: { pluginId: string }, optional?: Record<string, never>): Promise<{
    readonly settings: Readonly<Record<string, string>>;
    readonly secrets: Readonly<Record<string, string>>;
  } | null>;
}
export interface ProviderContextsRequired {
  readonly bindings: Readonly<Record<string, string>>;
  readonly configFor: (required: { siteId: string }) => PaymentProviderConfigReader;
  readonly urlsFor: (required: { scope: PaymentScope }) => Pick<ProviderContext, "webhookUrl" | "returnUrl" | "cancelUrl"> | null;
  readonly httpClient: HttpClientPort;
  readonly now: () => number;
}

/** Fixed refusals never expose saved values or the reader's exception text. */
function refusal({ unreadable = false }: { unreadable?: boolean } = {}): ProviderContextResult {
  return { ok: false, error: paymentError({ code: "NO_CREDENTIALS_CONFIGURED", message: unreadable
    ? "provider configuration could not be read; re-enter it in settings"
    : "provider credentials or URLs are not configured for this scope" }, { retryable: unreadable }) };
}

/** Select only declared, nonempty secret slots for this mode. O(keys) time and space. */
function credentialsFor({ keys, secrets, mode }: { keys: readonly string[]; secrets: Readonly<Record<string, string>>; mode: string }): Record<string, string> | null {
  const entries: Array<[string, string]> = [];
  for (const key of keys) {
    const slot = `${mode}_${key}`;
    if (!Object.hasOwn(secrets, slot) || !secrets[slot]!.trim()) return null;
    entries.push([key, secrets[slot]!]);
  }
  return Object.fromEntries(entries);
}

/**
 * Resolve a site's bound plugin, exact account and mode before any payment is written.
 * @param required - Host bindings, site reader, scoped URLs, transport and clock ports.
 * @returns A context port; unreadable storage returns a retryable refusal with no secret text.
 * @complexity O(credentialKeys) time/space per resolution; one configuration read.
 * @example createProviderContexts({ bindings, configFor, urlsFor, httpClient, now });
 */
export function createProviderContexts(required: ProviderContextsRequired, _optional: Record<string, never> = {}): ProviderContextPort {
  return { resolve: async ({ scope, provider }) => {
    if (provider.id !== scope.providerId || !Object.hasOwn(required.bindings, scope.providerId)) return refusal();
    const pluginId = required.bindings[scope.providerId]!;
    let saved: Awaited<ReturnType<PaymentProviderConfigReader["read"]>>;
    try { saved = await required.configFor({ siteId: scope.siteId }).read({ pluginId }); }
    // Unreadable encrypted rows and storage errors both require redelivery, never a leaked secret.
    catch { return refusal({ unreadable: true }); }
    if (!saved || saved.settings.accountId !== scope.providerAccountId) return refusal();
    const credentials = credentialsFor({ keys: provider.credentialKeys, secrets: saved.secrets, mode: scope.mode });
    if (!credentials) return refusal();
    const urls = required.urlsFor({ scope });
    if (!urls || ![urls.webhookUrl, urls.returnUrl, urls.cancelUrl].every(url => url.trim())) return refusal();
    return { ok: true, ctx: { credentials, account: { providerAccountId: scope.providerAccountId, mode: scope.mode },
      ...urls, httpClient: required.httpClient, now: required.now } };
  } };
}
