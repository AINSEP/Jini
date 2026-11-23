---
"@jini-ai/cms": patch
---

The admin publish-content capabilities route ships as a server-neutral `defineJsonRoute` spec (`@jini-ai/cms/admin-http/routes/publish-content/capabilities`). The host injects its handler registry, the request's publishing grant and its backstop grant rules. Wire bodies and statuses are unchanged.
