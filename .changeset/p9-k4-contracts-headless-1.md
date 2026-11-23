---
"@jini-ai/core": patch
---

Add host-neutral headless contracts, all type-only: `./contracts/headless/form-delivery-status` (`FormDeliveryStatusRow`, `FormDeliveryStatusPort`), `./contracts/headless/plugin-export-catalog` (`PluginExportCatalogRow`, `PluginExportCatalogPort`), `./contracts/headless/plugin-host` (`AgentPluginWorkspaceLayout`, `AgentPluginLayout`, `OperatorLocaleDeps`, `AgentPluginUninstallToolDeps`, `SetAgentPluginEnabledInput`, `AgentPluginHostCapability`, `PluginHostPort`, and re-exported `PluginLookupPort`/`PluginProvider`), `./contracts/headless/site-cookie-consent` (`SiteCookieConsentDeps`, `ConsentPluginHttp`, `ConsentPluginContribution`), and `./contracts/headless/operator-locale` (`GetEffectiveSetting`). They name only core site contracts. `./contracts/site/plugin-directory` is a type-only copy of the `PluginProvider`, `PluginLookupPort` and `PluginIdentityCandidate` declarations from `./plugin-directory`, which stays unchanged.
