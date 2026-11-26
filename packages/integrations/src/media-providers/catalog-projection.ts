import type { MediaProviderOption } from "@jini-ai/core";
import { canonicalMediaProviderId, type MediaProviderRegistry } from "@jini-ai/integrations/media-providers";


/**
 * @file The admin "External Providers" catalog, projected from the SAME live media-provider registry
 * generation dispatches through (`RouteDeps.mediaProviderRegistry`), so a plugin-mounted vendor such
 * as xAI Grok Imagine shows up as a card exactly when generation can route to it.
 *
 * The projection is an allow-list: only `id`, `label`, a credential-free `defaultBaseUrl` and model
 * ids are copied. Contribution objects, registry refusals and anything else a plugin attaches never
 * reach the API, so no key, token or raw provider error can ride along.
 */

/** The registry slice the projection reads. */
export type MediaProviderCatalogSource = Pick<MediaProviderRegistry, "providers">;

export interface MediaProviderCatalogOptions {
  aliases: Readonly<Record<string, string>>;
}

/** Vendors with no credential surface: `settingsVisible: false` entries and the local `stub`
 *  renderer — the same two exclusions the old static catalog made. @complexity O(1). */
function isConfigurable(provider: { id: string; settingsVisible?: boolean }): boolean {
  return provider.settingsVisible !== false && provider.id !== "stub";
}

/** A base URL only when it carries no credentials: no user info, query or fragment, since a plugin
 *  could ship a key in any of them. @complexity O(n) in URL length. */
function credentialFreeBaseUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  try {
    const url = new URL(value);
    return url.username || url.password || url.search || url.hash ? undefined : value;
  } catch {
    return undefined;
  }
}

/** One card's safe fields, built field by field (never a spread of the contribution). @complexity O(m). */
function toOption({ id, provider, models }: { id: string; provider: { label: string; defaultBaseUrl?: string }; models: readonly { id: string }[] }): MediaProviderOption {
  const defaultBaseUrl = credentialFreeBaseUrl(provider.defaultBaseUrl);
  const modelIds = [...new Set(models.map((model) => model.id))];
  return { id, label: provider.label, ...(defaultBaseUrl ? { defaultBaseUrl } : {}), ...(modelIds.length > 0 ? { models: modelIds } : {}) };
}

/**
 * The configurable provider cards, one per public provider, in registry order.
 *
 * Why: public aliases can converge without making sealed credential identities interchangeable —
 * `grok` and `xai-grok-imagine` publish ONE card under the canonical id here, while the credential
 * store still opens a legacy `grok` envelope under its own stored id (`resolveMediaCredentialIds`).
 *
 * @complexity O(p + m) over registered providers and their models; no I/O, no credential reads.
 */
export function projectMediaProviderCatalog(
  { registry, aliases }: { registry: MediaProviderCatalogSource } & MediaProviderCatalogOptions,
  _optional: Record<string, never> = {},
): MediaProviderOption[] {
  const seen = new Set<string>();
  return registry.providers.list().flatMap(({ provider: contribution }) => {
    const id = canonicalMediaProviderId({ id: contribution.provider.id }, { aliases });
    if (!isConfigurable(contribution.provider) || seen.has(id)) return [];
    seen.add(id);
    return [toOption({ id, provider: contribution.provider, models: contribution.models })];
  });
}
