# media/site-generation

## Wiring

- `media-provider-registry.ts` — `loadMediaProviderRegistry({ workspaceId, loadContributions, filename, contract,
  createRegistry, registryId, defineProviderContribution, contributeProviders })`. Every cross-package
  collaborator (agent-plugins contribution seam, integrations media-provider registry) and the product-named
  manifest `filename` is injected; the host binds them in its composition.
