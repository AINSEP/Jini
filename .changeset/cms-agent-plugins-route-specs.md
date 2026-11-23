---
"@jini-ai/cms": patch
---

The admin agent-plugin routes list, files and set-enabled ship as server-neutral `defineJsonRoute` specs (`@jini-ai/cms/admin-http/routes/agent-plugins/{list,files,set-enabled}`), with `agentPluginLifecycleFields` at `@jini-ai/cms/admin-http/http/agent-plugins`. The host injects its plugin catalog, activation service, MCP provisioning, package-file reader, error classes (as predicates) and activation copy. Wire bodies and statuses are unchanged.
