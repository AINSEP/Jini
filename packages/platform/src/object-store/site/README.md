# `@jini-ai/platform/object-store/site/setting`

Which object-store provider holds a site's media bytes. It is one workspace-scoped setting,
`core.storage` / `mediaObjectStore`, kept on the existing settings ledger with no schema change.
The empty default means the registry default, `local`. Rationale for the split lives in
[`ADS-memory/reports/jini-port/extraction-plan.md`](../../../../../ADS-memory/reports/jini-port/extraction-plan.md).

## Wiring

**What it needs injected.** Both functions take the ledger's implementations on their required
args, so this module only type-imports the contracts from `@jini-ai/core/settings`.
- `ensureMediaObjectStoreSetting` takes `deps: EnsureSettingDefinitionsDeps` (`settingsRepo`,
  `clock`, `ids`, `principals`), a `systemPrincipalId`, and the writer `ensureSettingDefinitions`.
- `readMediaObjectStoreSetting` takes `settingsRepo: SettingsRepoPort`, a `workspaceId`, and the
  reader `getEffective`.

**What it provides.**
- `ensureMediaObjectStoreSetting`: registers the definition without replacing an owner's stored value.
- `readMediaObjectStoreSetting`: the saved provider id, trimmed; `""` when unset, blank,
  non-string or unregistered.
- `STORAGE_SETTINGS_NAMESPACE` (`"core.storage"`) and `MEDIA_OBJECT_STORE_KEY` (`"mediaObjectStore"`).

The value is read once per boot when media is first touched, so a change applies on the next
restart. Any environment override is the host's call: this module reads no environment.

```ts
import { ensureSettingDefinitions, getEffective } from "@jini-ai/core/settings";
import { ensureMediaObjectStoreSetting, readMediaObjectStoreSetting }
  from "@jini-ai/platform/object-store/site/setting";

await ensureMediaObjectStoreSetting({ deps: { settingsRepo, clock, ids, principals }, systemPrincipalId, ensureSettingDefinitions });
const stored = await readMediaObjectStoreSetting({ settingsRepo, workspaceId, getEffective });
const providerId = hostEnvOverride ?? (stored || undefined); // undefined: use the registry default (`local`)
const blobStore = await hostCreateBlobStore({ providerId });  // the host maps the id to a provider
```

**Must never import.** Host modules, a concrete settings implementation (the writer and reader
arrive as arguments), a server framework, or product names.

The site-level object-store modules a host composes: the media-store setting (`setting.ts`) and the
provider registry loader (`registry.ts`).

## Wiring (host-injected collaborators)

- `setting.ts` — the host binds the settings ledger (`ensureSettingDefinitions`, `getEffective`) on
  each function's required args.
- `registry.ts` — `loadObjectStoreRegistry` / `loadBundledObjectStoreRegistry` /
  `readBundledObjectStoreEnvDeclarations` are generic over the provider host object (`Host`) and the
  host's contribution `Definition`. The host injects the agent-plugins contribution seam
  (`defineProviderContribution`, `contributeProviders`) and its plugin loaders (`loadContributions`,
  `bundledContributionSources`, `loadPluginContributionsFromSource`) as required fields. The host binds
  them in its media-storage composition.
