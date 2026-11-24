---
"@jini-ai/cms": patch
---

The admin members list, get-by-id, disable and delete routes ship as server-neutral `defineJsonRoute` specs (`@jini-ai/cms/admin-http/routes/members/{list,get-by-id,disable,delete}`, with the shared guards at `.../members/shared`) and their DTO helper at `@jini-ai/cms/admin-http/http/members`. Each spec reads only its own small deps type. The members library is not part of this package, so the host injects its collaborators: the disable write service, the trash move and a `classifyMemberError` classifier for the library's error classes (each route keeps its own status ladder). Wire bodies and statuses are unchanged; `request-magic-link` stays with the host because its 429 carries a `Retry-After` header.
