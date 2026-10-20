import type { MediaProviderCatalogPolicy } from '../ports.js';

/** A host that treats every ID literally; importing UI must not impose vendor aliases. */
export const identityCatalogPolicy: MediaProviderCatalogPolicy = {
  canonicalMediaProviderId: ({ id }) => id,
  normalizeMediaProviderMap: ({ providers }) => ({ ...providers }),
};
