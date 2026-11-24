---
"@jini-ai/cms": patch
---

The admin deployment overview, site export (trigger + status) and publish status/preview/targets routes ship as server-neutral `defineJsonRoute` specs (`@jini-ai/cms/admin-http/routes/system/{deployment-overview,export-site}`, `…/system/publish-site/{status,preview,targets}`). The host injects its process-state snapshot, default owner password, export run slot and publish preview/target readers. Wire bodies and statuses are unchanged.
