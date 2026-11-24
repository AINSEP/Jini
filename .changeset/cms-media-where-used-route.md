---
"@jini-ai/cms": patch
"@jini-ai/core": patch
---

The admin media where-used route ships as a server-neutral `defineJsonRoute` spec (`@jini-ai/cms/admin-http/routes/media/where-used`, `mediaWhereUsedRoute`), with `AdminMediaWhereUsedEnvelope` in `@jini-ai/core/contracts/site/cms-media`. The host injects its usage finder and its denial body. Wire bodies and statuses are unchanged.
