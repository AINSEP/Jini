---
"@jini-ai/cms": patch
---

The admin Trash routes ship as server-neutral `defineJsonRoute` specs (`@jini-ai/cms/admin-http/routes/trash/{list,restore,purge,items}`, shared guards and selection limits at `@jini-ai/cms/admin-http/routes/trash/shared`) with the screen's row DTO at `@jini-ai/cms/admin-http/http/trash`. Each spec reads only its own small deps type; the host injects the Trash entry gate, the per-kind permission check and visibility filter, the generic move, the user listing and the post-subtype lookup. Wire bodies, statuses and check order are unchanged.
