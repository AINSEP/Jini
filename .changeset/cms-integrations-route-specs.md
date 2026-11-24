---
"@jini-ai/cms": patch
---

The admin integrations (webhook subscription) routes ship as server-neutral `defineJsonRoute` specs (`@jini-ai/cms/admin-http/routes/integrations/{list,create,pause,delete,deliveries}`) with their DTO helper at `@jini-ai/cms/admin-http/http/integrations`. Each spec reads only its own small deps type; the webhook feature stays the host's, injected as function-typed lifecycle services (create, pause, delete) plus failure matchers for its validation and not-found errors, and the two repos as narrow read views, so `@jini-ai/cms` takes no dependency on the webhook package. Wire bodies and statuses are unchanged.
