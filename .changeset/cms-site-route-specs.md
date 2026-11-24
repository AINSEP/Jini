---
"@jini-ai/cms": patch
---

The admin site profile route ships as a server-neutral `defineJsonRoute` spec (`@jini-ai/cms/admin-http/routes/site/profile`, with the `parseSections` and `parsePageLimit` query parsers it exports). The host injects the profile builder and the builder's own section vocabulary and page cap, so the route validates against exactly what the builder understands. Like before, the route authorizes nothing itself: every section is authorized inside the builder. Wire bodies and statuses are unchanged.
