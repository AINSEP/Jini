---
"@jini-ai/core": patch
---

Add two host-neutral contracts. `./contracts/site/agent-plugins-admin-surfaces` (`AdminSurfaceBootstrap`, `AdminSurfaceAction`, `AdminSurfaceActionOutcome`, `AdminSurfacePluginStatePersistence`, `AgentPluginStateScope`, `AgentPluginStateStore`, `AgentPluginStateSummary`, `AdminSurfaceConnections` and their structural closure) is an additive copy of the declarations in `@jini-ai/agent-plugins/admin-surfaces`; that package keeps its identical declarations and its exports until the paired cutover. `./contracts/site/api-ai-assistant-api-types` (`SiteAssistantCredential`, `SiteAssistantCredentialPatch`, `AdminExecutionCredential`, `AdminExecutionCredentialPatch`) holds the write-only admin wire shapes of the site and per-admin assistant credentials.
