---
"@jini-ai/core": patch
"@jini-ai/integrations": patch
---

`AssertVersionedWritePort` (the injectable shape of `assertVersionedWrite`) now lives in `@jini-ai/core/optimistic-concurrency`; the webhook SQL and in-memory subscription repos import it there instead of from the SQL adapter barrel (`@jini-ai/integrations/webhooks/sql` no longer re-exports it).
