# settings/site

Site-level settings helpers a host composes into its own settings feature: admin-interface keys,
chart provider, form delivery bindings and destinations, mail sender and provider, site time zone, site title
and its write chokepoint, chat execution selection writes, and the
read-only admin-language discovery tool (`ui-locales-tool.ts`).

## Wiring

**Needs injected** (`ui-locales-tool.ts`): `UiLocalesToolDeps` — the host's `authorize: AuthorizeFn`,
`workspaceId`, and `locales: readonly UiLocaleOption[]` (the languages its admin selector offers;
product copy the engine never ships). Host tool metadata (search vocabulary, approval policy) is
not bound by the package.

**Provides**: `buildUiLocalesRegistrations(deps)` (one `settings_list_ui_locales` registration),
`uiLocalesAgentToolCatalog`, `uiLocalesDerivedRisk`.

```ts
import { withToolMetadata, type ToolContributor } from "@jini-ai/core";
import { buildUiLocalesRegistrations, uiLocalesDerivedRisk, type UiLocalesToolDeps } from "@jini-ai/cms/settings/site/ui-locales-tool";

export const contributeUiLocalesTools = (): ToolContributor<Omit<UiLocalesToolDeps, "locales">, unknown> => ({
  domain: "settings-ui-locales",
  build: (deps) => withToolMetadata({ registrations: buildUiLocalesRegistrations({ ...deps, locales: HOST_ADMIN_LOCALES }), metadata: hostToolMetadata }),
  risk: uiLocalesDerivedRisk,
});
```

**Needs injected** (settings helpers — `admin-interface.ts`, `chart-provider.ts`, `form-delivery.ts`,
`form-destination.ts`, `mail-sender.ts`, `site-timezone.ts`): the settings ledger's implementations,
bound by the host from `@jini-ai/core/settings`. Every `ensure*` registrar takes
`deps.ensureSettingDefinitions` (`EnsureSettingDefinitionsPort`) on its existing
`EnsureSettingDefinitionsDeps`; every reader (`readFormsAutoPull`, `readFormDeliveryBindings`,
`readFormDestinationSetting`, `readMailSenderSetting`, and `resolveSiteTimeZone` /
`createSiteTimeZonePort` through `ResolveSiteTimeZoneDeps`) takes `getEffective` (`GetEffectivePort`)
on its existing required args. Neither function is imported here, so a test can hand in a spy.

```ts
import { ensureSettingDefinitions, getEffective } from "@jini-ai/core/settings";

const settingsDeps = { settingsRepo, clock, ids, principals, ensureSettingDefinitions };
await ensureMailSenderSettings({ deps: settingsDeps, systemPrincipalId });
const sender = await readMailSenderSetting({ settingsRepo, workspaceId, getEffective });
```

**Needs injected** (`site-title.ts`, `core.site.title`): the host's legacy title, product copy the
engine never ships, as a required `legacySiteTitle` on three existing args objects — the
`ensureSiteTitleSettingDefinition` input (the stored definition default), the
`preserveLegacySiteTitles` input (the workspace pin) and `ResolveSiteTitleDeps` (the render
fallback). Pass the same value to all three. The ledger's functions arrive the same way as the
helpers above: `deps.ensureSettingDefinitions` on the registrar, `deps.set` and
`deps.resolveDefinitionRaw` on `PreserveLegacySiteTitlesDeps`, and `getEffective` on
`ResolveSiteTitleDeps`. The host also binds the `SiteTitlePreservationStorePort` adapter over its
own marker table and the `SiteDisplayNameSource` for its site directory. Logging is injected too:
`reportSiteTitleFailure` (`SiteTitleFailureReporter`, required on both `PreserveLegacySiteTitlesDeps`
and `ResolveSiteTitleDeps`) receives a `SiteTitleFailureEvent` of fixed text (`SITE_TITLE_*_MESSAGE`)
plus `workspaceId` and, when something was thrown, `errorClass`. The thrown error's message is never
passed, since a repository error can echo a connection string or a stored value. `reportPreservationSummary`
(required on `PreserveLegacySiteTitlesDeps`) receives each run's `PreserveLegacySiteTitlesResult`.

```ts
import { ensureSettingDefinitions, getEffective, resolveDefinitionRaw, set } from "@jini-ai/core/settings";
import { ensureSiteTitleSettingDefinition, preserveLegacySiteTitles, resolveSiteTitle } from "@jini-ai/cms/settings/site/site-title";

await ensureSiteTitleSettingDefinition({ ...settingsDeps, ensureSettingDefinitions }, { systemPrincipalId, legacySiteTitle: HOST_LEGACY_TITLE });
const reportSiteTitleFailure = (event) => logger.error({ message: event.message }, { meta: { workspaceId: event.workspaceId, errorClass: event.errorClass } });
const reportPreservationSummary = (result) => logger.info({ message: `pinned=${result.pinnedWorkspaceIds.length} failed=${result.failedWorkspaceIds.length}` });
await preserveLegacySiteTitles({ ...settingsDeps, preservationStore, set, resolveDefinitionRaw, reportSiteTitleFailure, reportPreservationSummary }, { systemPrincipalId, legacySiteTitle: HOST_LEGACY_TITLE });
const title = await resolveSiteTitle({ settingsRepo, preservationStore, workspaceRepo, siteDisplayName, getEffective, legacySiteTitle: HOST_LEGACY_TITLE, reportSiteTitleFailure }, { workspaceId });
```

**Needs injected** (`site-title-write.ts`, the settings write chokepoint, and the writers that go
through it — `form-delivery-write.ts`, `mail-provider.ts`): the host's write policy as a required
`writePolicies: SiteSettingsWritePolicies` field on the existing required args of `set`, `clear`,
`resetNamespace`, `refuseDedicatedSettingClear`/`Reset`, `writeFormDeliveryBindings` and
`writeMailProviderSetting`. `writePolicies.dedicatedWriters` lists the host's own dedicated
writers (coordinates, permission override, refusal reason, optional `normalize` hook); the package
always checks its comments-provider writer first. Bind the policy once where the host builds its
`set`, and hand the resulting `SiteSettingsSetFn` to `SettingsToolDeps.set`.

**Needs injected** (`chat-execution-write.ts`, `tool-deps.ts`): `prepareChatExecutionWrite` takes the
agent runtime's `validateRuntimeSelection` (`ValidateRuntimeSelectionPort`) on its args object, and
reads the host's live picker through `deps.assistantAgentInventory` (`ChatAgentInventoryPort`, a
structural slice; `SettingsToolDeps<TInventory>` keeps the host's full inventory type).

```ts
import { set as setWithPolicies, type SiteSettingsSetFn, type SiteSettingsWritePolicies } from "@jini-ai/cms/settings/site/site-title-write";

const writePolicies: SiteSettingsWritePolicies = { dedicatedWriters: [HOST_VISITOR_TOOLS_WRITER] };
export const set: SiteSettingsSetFn = (required, optional = {}) => setWithPolicies({ ...required, writePolicies }, optional);
await writeMailProviderSetting({ deps, writePolicies, workspaceId, callerPrincipalId, value });
await prepareChatExecutionWrite({ deps, request, validateRuntimeSelection });
```

**Provides**: `set`/`clear`/`resetNamespace` (chokepoint), `dedicatedSettingsWriters`,
`COMMENTS_PROVIDER_*`, `writeFormDeliveryBindings`/`guardedBindingsRepo`, the `core.mail.provider` /
`testMode` registrar, readers and writer, `prepareChatExecutionWrite`/`CHAT_EXECUTION_KEYS`, and the
`SettingsToolDeps` type.

**Visitor-tools management** (`visitor-tools-{contract,write,configure,service,registrations}.ts`):
the host owns the visitor-tools policy contract and binds it once as a `VisitorToolsHostContract`
(`visitor-tools-contract.ts` holds only that bundle's type; the shared policy and catalog types come from `@jini-ai/core/contracts/site/site-assistant-visitor-tools-management`): the stored setting coordinates, the
management permission, default limits and calls per turn, its validation error class, its
closed-object guard, `parsePolicy` and `resolveChoice`. It reaches the code as the required
`visitorTools` field on `createVisitorToolsManagement`'s `deps`, on `readVisitorToolsSnapshot` /
`writeVisitorTools` / `parseVisitorToolsConfigure`, and on the `VisitorToolsToolHostPolicy` that
`contributeVisitorTools` takes (with the host's catalog copy, tool metadata and approval-card engine).
`createVisitorToolsManagement` also takes `writePolicies` for the chokepoint write.

**Site-setting publishing** (`publish-content.ts`): `contributeSiteSettingPublish` takes the host's
repo-backed publish factory (`createRepoPublishHandler`), its gateway accessor (`gatewayDeps`, whose
`authorize` checks the write), its allowlist (`publishableSettings`: `namespace:key` → label), its
`writePolicies` and its `principalLookup`, bound once at the host's publish-content manifest.

```ts
createVisitorToolsManagement({ deps: { workspaceId, settings, ready, listCatalog, visitorTools: HOST_VISITOR_TOOLS, writePolicies } });
contributeSiteSettingPublish({ createRepoPublishHandler, gatewayDeps, publishableSettings, writePolicies, principalLookup });
```

**Needs injected** (`settings-confirm-write.ts`, the settings tools' `confirmWrite`):
`settingsConfirmWrite` takes, all required on its args object, the host's `surfaces`
(`AssistantSurfaceDeps`), its `routeDeps` (`SettingsToolDeps`, for the workspace, the chat-selection
reads and `approvalIdentityForRun`), its approval-card engine (`approvalToolHandler`,
`SettingsConfirmApprovalHandlerPort`), the agent runtime's `validateRuntimeSelection`, and the card's
wording as `copy` (`SettingsConfirmWriteCopy`: error code, set/clear titles, description suffix, clear
fallback wording, confirm label and detail labels; product copy the engine never ships). The host
keeps its rule tables (denied and confirmation-required settings) and tool metadata, and passes them
to `@jini-ai/core/settings`'s `buildSettingsRegistrations` itself.

**Provides**: `settingsConfirmWrite(args)` → a `SettingsConfirmWriteFn` for `SettingsToolDeps.confirmWrite`.

```ts
import { settingsConfirmWrite } from "@jini-ai/cms/settings/site/settings-confirm-write";

buildSettingsRegistrations({ ...routeDeps, confirmationSettings: HOST_CONFIRMATION_RULES,
  confirmWrite: settingsConfirmWrite({ surfaces, routeDeps, approvalToolHandler, validateRuntimeSelection, copy: HOST_SETTINGS_CARD_COPY }) });
```

See [`DR-005`](../../../../../docs/decisions/DR-005-portable-package-boundaries.md) for the boundary rule.

**Must never import**: a host's locale list, tool-metadata contracts, settings storage or any host
module; other `@jini-ai/*` packages only through their public entries (`@jini-ai/core`).
