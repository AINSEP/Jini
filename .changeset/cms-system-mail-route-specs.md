---
"@jini-ai/cms": patch
---

The admin system mail routes ship as server-neutral `defineJsonRoute` specs (`@jini-ai/cms/admin-http/routes/system/{mail-status,mail-dns,mail-test-send,mail-activity}`). Each spec reads only its own small deps type; the host injects the mailer predicate, status source, DNS operations, recipient rules, send and activity operations and its permission names. Wire bodies and statuses are unchanged.
