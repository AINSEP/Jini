---
"@jini-ai/core": patch
"@jini-ai/agent-plugins": patch
"@jini-ai/chat": patch
---

Finish the K4 declaration cutover for the Agent Plugin lifecycle and chat run-event contracts. `@jini-ai/core/contracts/site/agent-plugins-lifecycle` and `./agent-plugins-manifest` now own `InstalledAgentPlugin`, `InstalledAgentPluginSkill`, `SetAgentPluginEnabledInput`, `SetAgentPluginEnabledResult`, the layout ports, the uninstall and archive-reader contracts, `PluginManifestAuthor` and the `AgentPluginExport` vocabulary; `@jini-ai/core/contracts/site/chat-core` owns `AgentEvent` and `ToolResultMediaBlock`. Agent-plugins and chat import them from core and keep their runtime values. Their public entries still export the moved names as deprecated type-only re-exports, so this is not a breaking change; the re-exports are removed at the next major.
