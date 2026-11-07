---
"@jini-ai/agent-plugins": patch
---

The `search_agent_plugin_local` description no longer names host tools. A host passes its own tool names through `messages.searchHostTools` (`inventory`, `setEnabled`, `loadGuidance`); `agentPluginSearchToolCatalog` takes the same `messages` as its optional argument. Without them the text is neutral.
