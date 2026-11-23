---
"@jini-ai/core": patch
---

Add the host-neutral Agent Plugin lifecycle contract `./contracts/site/agent-plugins-lifecycle` (`InstalledAgentPlugin`, `InstalledAgentPluginSkill`, `AgentPluginExportMetadata`, `PluginManifestAuthor`, `SetAgentPluginEnabledInput`, `SetAgentPluginEnabledResult`, `UninstallAgentPluginRequired`, `UninstallAgentPluginOptional`, `UninstallAgentPluginResult`, `AgentPluginUninstallPreview`, `AgentPluginLayout`, `AgentPluginLayoutPort`, `AgentPluginWorkspaceLayout`, `AgentPluginArchiveReaderPort`, `AgentPluginArchiveEntry`). It is an additive copy of the declarations in `@jini-ai/agent-plugins/lifecycle`; that package keeps its identical declarations, its runtime values and its exports until the paired cutover.
