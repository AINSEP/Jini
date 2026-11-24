---
"@jini-ai/cms": patch
---

The admin commerce status route ships as a server-neutral `defineJsonRoute` spec (`@jini-ai/cms/admin-http/routes/commerce/status`). It reads only the served workspace and one injected status read, which the host binds to whichever payment runtime it composed; the Commerce package stays out of `@jini-ai/cms`. Wire bodies and statuses are unchanged.
