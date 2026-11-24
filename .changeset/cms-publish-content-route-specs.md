---
"@jini-ai/cms": patch
---

The admin publish-content peer routes (list/create/update/delete) and destination routes (read/connect/disconnect) ship as server-neutral `defineJsonRoute` specs (`@jini-ai/cms/admin-http/routes/publish-content/{peers,destination}`, shared guards in `transport-shared`), and the import report DTO helpers move to `@jini-ai/cms/admin-http/http/publish-content`. The host injects the peer store, connect/disconnect handshake, publishable types and its error classes. Wire bodies and statuses are unchanged.
