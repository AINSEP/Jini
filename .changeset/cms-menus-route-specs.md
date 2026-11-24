---
"@jini-ai/cms": patch
---

The admin menus routes ship as server-neutral `defineJsonRoute` specs (`@jini-ai/cms/admin-http/routes/menus/{get-by-id,list,create,update-tree,assign-location,delete}`) with their DTO helper at `@jini-ai/cms/admin-http/http/menus`. Each spec reads only its own small deps type; the host injects the authorizer, the raw-HTML permission, the HTML normalizer and the trash move. Wire bodies and statuses are unchanged.
