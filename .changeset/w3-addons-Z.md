---
"@jini-ai/agent-plugins": patch
"@jini-ai/agentic": patch
---

Agent plugins: `AgentPluginUninstallHost` gains a required `reportRefusal` reporter; a busy, locked or unreadable uninstall refusal is reported to it (`{ pluginId, reason, error }`) instead of the engine writing `console.warn`. Agentic: `SkillSiteHost` gains required `reportLifecycleEvent` (a `SkillLifecycleEvent` for installed / enabled-changed / removed) and `reportSkippedFolder`; the site install service and skill tool loader no longer write the console.
