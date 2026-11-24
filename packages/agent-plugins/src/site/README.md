# `src/site`

Generic plugin-host pieces extracted from a site host. Everything product-specific is injected.

## Wiring

- `retired-plugin-tool-aliases.ts` (`./site/retired-plugin-tool-aliases`): the host injects `replacements`
  (its retired plugin id -> successor catalog) and `toToolId` (its plugin id -> tool id rule) on the
  existing `required` object, at the composition root that registers the agent-plugin tool family.
- `deploy-split-activation.ts` (`./site/deploy-split-activation`, `carryPluginRenameActivation`): the host injects `activations`
  (its lifecycle owner's activation calls) plus the predecessor plugin id (`fromPluginId`), its successor plugin id
  (`toPluginId`) and the write `actor`, and runs it before bundled seeding.
- `bundled-id-upgrade.ts` (`./site/bundled-id-upgrade`): `upgradeRenamedBundledPlugins` / `restoreUnseededUpgrades`; the host injects
  the rename map (`renamed`), the held-reason wording (`ledgerMismatchReason`) and the lifecycle `port`, and runs it around bundled seeding.
- `admin-surfaces/` (`./site/admin-surfaces/*`): see that folder's README.
- `customize-tool.ts` (`./site/customize-tool`): the host injects `lifecycle` (its lifecycle owner's
  `listInstalledPlugins`, `readBundledAgentPluginDigests`, `preferBundledAgentPluginDigests`,
  `maxAgentPluginInstallArchiveBytes`) on the existing args object; the host keeps the tool definition and
  its model-facing copy, and calls this from its install tool after authorization.
- `activation-effects.ts` (`./site/activation-effects`): the host injects `resolveAgentPluginActivation`
  (its lifecycle owner's activation resolution, so all writers share one queue) next to `workspaceRoot`.
- `provider-plugin-link.ts` (`./site/provider-plugin-link`): the host injects `activations` (its lifecycle
  owner's `reconcileAgentPluginActivation` / `readAgentPluginActivations` / `isAgentPluginActive`) and `catalog`
  (`list`, `bundled`, `preferBundled`, `read`) into `bindProviderFacePorts`, and a required `reportFollowFailure` port into
  `followProviderActivations`; the host keeps its linked-face refusal error (its copy names the host's switch).
- `host-plugin-guidance.ts` (`./site/host-plugin-guidance`): the host injects `overlaysDir` (its shipped overlays)
  on every reader's required args, and `isYamlMapping` (its failsafe YAML reader) into
  `removeChatRefusedToolPermissions` / `deliverHostPluginGuidance`.
- `analytics-provider-registry.ts` (`./site/analytics-provider-registry`): the host injects `analytics` (its analytics
  package's forwarder/ingest-hook `contract`s and `validate`rs, `createForwarderRegistry`, and its product-named
  manifest `filename`s) next to `loadContributions` (its lifecycle owner's trust-gated loader) into `loadAnalyticsProviders`.
- `host-signals.ts` (`./site/host-signals`): the host injects `sources` (its hermetic bundled-source policy) on
  `readBundledHostSignalDeclaration`, and `sources` plus its core policy functions `evaluateHostSignals` /
  `selectCoreHostSignalDeclaration` (which own the security fallback) on `resolveBundledHostSignals`.
- `service-ports.ts` (`./site/service-ports`): types only; `AgentPluginApiConnectionsPort<TConnection>` is
  instantiated with the host's declared-connection record.
- `bundled-contribution-sources.ts` (`./site/bundled-contribution-sources`): the host injects `retired` (its retired
  bundled plugin ids) into `listBundledContributionSources` and binds the result as the `sources` port
  (`BundledContributionSources`) its bundled readers take.
- `auth-schemes.ts` (`./site/auth-schemes`): the host injects `parseCredentialSchemesFile`
  (`@jini-ai/integrations/credentialed-http`; this package may not import integrations) everywhere, plus
  `loadContributions` (its lifecycle owner's trust-gated loader) into `loadCredentialSchemeRegistry`, `loadFromSource`
  (its lifecycle owner's source loader) into `loadCredentialSchemeRegistryFromSource`, and both `loadFromSource` and
  `sources` (its bound bundled-source policy) into `loadBundledCredentialSchemeRegistry`.
