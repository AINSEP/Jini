# object-store/site

The site-level object-store modules a host composes: the media-store setting (`setting.ts`) and the
provider registry loader (`registry.ts`).

## Wiring

- `setting.ts` — the host binds the settings ledger (`ensureSettingDefinitions`, `getEffective`) on
  each function's required args.
- `registry.ts` — `loadObjectStoreRegistry` / `loadBundledObjectStoreRegistry` /
  `readBundledObjectStoreEnvDeclarations` are generic over the provider host object (`Host`) and the
  host's contribution `Definition`. The host injects the agent-plugins contribution seam
  (`defineProviderContribution`, `contributeProviders`) and its plugin loaders (`loadContributions`,
  `bundledContributionSources`, `loadPluginContributionsFromSource`) as required fields. Tovu binds
  them in `server/runtime/composition/site-deps/media-storage.ts`.
