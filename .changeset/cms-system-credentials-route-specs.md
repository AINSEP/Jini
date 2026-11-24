---
"@jini-ai/cms": patch
---

The admin saved-credential routes ship as server-neutral `defineJsonRoute` specs: source-control keys (`@jini-ai/cms/admin-http/routes/system/source-control-credentials`), custom keys (`…/system/custom-credentials`) and publish credentials (`…/system/publish-credentials/{list,create,update,verify,delete,shared}`). The host injects the credential store, its error classes, the project-key attach, the invalidation and verification hooks and its copy. Wire bodies and statuses are unchanged.
