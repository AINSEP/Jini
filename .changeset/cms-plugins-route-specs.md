---
"@jini-ai/cms": patch
---

The admin plugins list, files, uninstall, preview and set-enabled routes ship as server-neutral `defineJsonRoute` specs (`@jini-ai/cms/admin-http/routes/plugins/{list,files,uninstall,preview,set-enabled}`, shared guards in `shared`). cms does not depend on `@jini-ai/plugins`: the host injects discovery, the activation lookup, the DTO mapper, the uninstall move, the preview filter, the hook-failure envelope and the error classes each ladder maps. Wire bodies and statuses are unchanged.
