---
"@jini-ai/core": patch
---

Add four host-neutral type contracts. `./contracts/site/daemon` (`ToolAccessChange`, `PrepareToolGuidance`, `FrontendSessionOwner`), `./contracts/site/plugins-host` (`PluginActivationRecord`, `PluginActivationRepoPort`, `ProviderKeyUsage`, `ProviderWriteResult`, `PluginConflict`, `RemoveEntity`, `RemovePluginFn`, `PluginContributionsSnapshot`) and `./contracts/site/db-data-modules` (`ColumnType`, `PluginTier`, `ColumnDecl`, `IndexDecl`, `TableDecl`, `PluginProvenance`, `DataModuleDecl`) are additive copies of the declarations in `@jini-ai/daemon`, `@jini-ai/plugins/host` and `@jini-ai/db/data-modules`; those packages keep their identical declarations and exports until the paired cutover. `./contracts/site/assistant-tool-contributions` (`DuplicateResourceHandler`, `DuplicateResourceHandlerContributor<TDeps>`) is the resource-duplication contribution contract a host's generic duplicate tool resolves per resource.
