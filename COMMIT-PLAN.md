# Commit plan — y5q-plugpubj

Working tree only: the coordinator makes the commits. No git metadata was written.
Scope: the Jini half of the three admin screens and publish confirmation hook. Other sheets and the host half are outside this dispatch.

## 1. adm-other — completed Jini subset

Create:
- packages/admin/src/screens/plugins/AgentPlugins.tsx
- packages/admin/src/screens/plugins/AgentPluginLists.tsx
- packages/admin/src/screens/plugins/AgentPluginsTabs.tsx
- packages/admin/src/screens/plugins/AgentPluginsOverlays.tsx
- packages/admin/src/screens/plugins/Plugins.tsx
- packages/admin/src/screens/plugins/PluginLists.tsx
- packages/admin/src/screens/plugins/PluginsOverlays.tsx

Change:
- packages/admin/src/screens/providers/Providers.tsx
- packages/admin/src/screens/providers/ProvidersTabBody.tsx
- packages/admin/src/screens/__tests__/y5-admin-surfaces.test.tsx
- packages/admin/package.json
- .changeset/y5-adm-other.md

Providers and its binder already existed at HEAD. This pass preserves that implementation, splits its header at the existing view seam, neutralizes product references in its why-comments, and strengthens the locale-boundary assertion.

New public entries:
- @jini-ai/admin/screens/plugins/AgentPlugins: AgentPlugins, AgentPluginsProps, AgentPluginUpdateSlot, bindAgentPlugins.
- @jini-ai/admin/screens/plugins/Plugins: Plugins, PluginsProps, bindPlugins.
- @jini-ai/admin/screens/providers/Providers remains the existing entry with Providers, ProvidersProps, bindProviders.

Admin test declarations: 6 before, 8 after; no test was deleted or weakened. The plugin mutation cases were written before creating the plugin implementations, and the provider assertion before changing Providers.

Named mutations for Opus (not applied or executed here):
- AgentPlugins: DROP_UPDATE_DIGEST removes expectedOldDigest from the update-hook call. The spy must reject the missing shown digest.
- Plugins: ALLOW_UNAVAILABLE_ADD accepts add when canInstall is false. The Installed selection and empty-state assertions must fail.
- Providers: DROP_LOCALE_BOUNDARY supplies en instead of the injected locale to I18nProvider. The fr data-locale assertion must fail.

## 2. adm-publish-content — completed Jini hook subset

Create:
- packages/cms/src/react/publish-content/hooks/use-publish-content-confirm.hooks.ts
- packages/cms/src/react/publish-content/hooks/publish-peers.hooks.ts
- packages/cms/src/react/publish-content/hooks/publish-plan.hooks.ts
- packages/cms/src/react/publish-content/hooks/publish-execution.hooks.ts
- packages/cms/src/react/publish-content/hooks/publish-lifecycle.hooks.ts

Change:
- packages/cms/src/react/publish-content/hooks/publish-confirm-view.ts
- packages/cms/src/react/publish-content/__tests__/y5-publish-ceremony.test.tsx
- packages/cms/package.json
- .changeset/y5-adm-publish-content.md

New public entry:
- @jini-ai/cms/react/publish-content/hooks/use-publish-content-confirm.hooks: usePublishContentConfirm, PublishContentConfirmView, PublishContentConnectOffer, PublishPrimaryKind, CONFIRM_ARM_DELAY_MS, liveGapLinesFor, publishMismatchMessage, bindPublishContentConfirm.

The existing universal publish-content-confirm.rules export remains the direct home of overwriteTooltipFor, reportRowNote and reportRowPillClass. No duplicate rules were added. The new browser entry copies PublishSectionButton's isolation domain and forbidden list. No dependency edges were added.

CMS test declarations: 2 before, 8 after; no test was deleted or weakened. Ceremony tests preceded the move; the final review extended them with scoped criteria confirmation and a late overwrite response after peer switching.

Named mutation for Opus (not applied or executed here):
- EXECUTE_BEFORE_CONFIRM lets a planned phase initiate execution without a confirmed token. The no-execute-after-planning assertion must fail; the gated-confirm case also asserts no execute before the server returns its token and exactly one execute afterward.

## Host binding handoff

Do not count the four host files yet: their bindings and keep entries are the host half.

- AgentPlugins: call bindAgentPlugins once with kit.AgentPluginDetailsModal, all current hooks grouped under hooks, and deps containing productName, isApiError, folderZip, pluginRules, agentPluginDisplayName, updatableAgentPluginDigest, agentPluginInstallPort, defaultAgentPluginSurfacesPort, translateAdminNavLabel, dictionaries, uninstallNote, marketplaceNote and downloadedNote. Keep every copy string byte-identical. The bound screen accepts the existing flat hook overrides supplied by panels. Raw AgentPluginUpdateSlot now takes hooks.useAgentPluginUpdateHook and its required deps subset.
- Plugins: call bindPlugins once with the current hooks (including files, settings, focus and locale), kit.TabBar/Toast/PluginProviderSettingsDialog, bound rules, productName, the original two product-copy strings as builtInNote/marketplaceNote, translateAdminNavLabel and the existing tab-navigation callback as deps.onTabChange. The returned screen accepts the existing controller override and route query props.
- Providers: use existing bindProviders with the four real body slots, locale/theme/integrations hooks, dictionaries, translations, restartLabel, mcpServerHandleLabel and onTabChange. Pass the existing External MCP hook through the allowed one-expression arity adapter. Keep the demo MCP slot without a live port.
- Confirmation: call bindPublishContentConfirm once with the live port, hooks.useLocaleHook and deps containing the existing host-bound applyPublishCriteria, preparePublishConfirmation, toPublishReportRows, publishEntityTypePluralLabel, publishSectionForEntityTypes, scope title/description functions, describeApiError, now: () => performance.now(), and overwriteUnavailableKey with the original sentence. The returned hook accepts the dialog's current optional port/criteria/scope/onPlanned/arming override fields, including explicit undefined. liveGapLinesFor takes its required plural-label collaborator under deps.

The host coordinator must update lazy imports/raw test imports, repoint the provider i18n source probe to Providers.tsx plus ProvidersTabs.tsx, and append the four anchored paths inside the Keep rules text fence only after validating final G3 bindings.

## Closeout

No stopped sheet or known behavior blocker in the dispatched subset. No installs, builds, tests, mutation executions, typechecks, linters or counter runs were performed, per dispatch. All runtime/type correctness and mutation evidence remain pending Opus.

Final diff review deletions: removed generated unused imports and collaborator destructuring; removed unused kit plumbing from list subtrees; removed unused helper exports and unused empty return objects; restored unchanged manifest Unicode and pre-existing array formatting. No production behavior, branch, assertion, or existing test was deleted.
