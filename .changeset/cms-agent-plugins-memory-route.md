---
"@jini-ai/cms": patch
"@jini-ai/core": patch
---

The admin agent-plugin memory routes (GET/PUT) ship as server-neutral `defineJsonRoute` specs (`@jini-ai/cms/admin-http/routes/agent-plugins/memory`, `agentPluginMemoryGetRoute`/`agentPluginMemoryPutRoute`), with the `AdminAgentPluginMemoryEnvelope` wire DTO in `@jini-ai/core/contracts/site/cms-agent-plugins`. The host injects the installed check, the plugin memory store, its caps and its system-error predicate. Wire bodies and statuses are unchanged.
