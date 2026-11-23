---
"@jini-ai/cms": patch
---

The admin settings routes (raw/effective/definitions reads, value set/clear, namespace reset, definition batches) ship as server-neutral `defineJsonRoute` specs (`@jini-ai/cms/admin-http/routes/settings/{get-raw,get-effective,list-definitions,set,clear,reset,register-definitions,shared,protected-namespaces}`). The host injects the settings service factory, the write-service deps, the cross-principal read policy and the protected-namespace write fence with its copy. Wire bodies and statuses are unchanged.
