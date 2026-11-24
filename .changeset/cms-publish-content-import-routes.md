---
"@jini-ai/cms": patch
---

The admin publish-content import ceremony routes (plan, confirm, execute, run status) ship as server-neutral `defineJsonRoute` specs (`@jini-ai/cms/admin-http/routes/publish-content/import`, with `readOverwriteEntityKeys`). The host injects the gated-mutation calls, the grant-attenuated authorizers and its typed error mapping. Wire bodies and statuses are unchanged.
