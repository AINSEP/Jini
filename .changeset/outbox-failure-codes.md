---
"@jini-ai/infra": patch
---

Outbox worker: `OutboxRetryPolicy` gains an optional `failureCodes: { codes, codeOf }`. A failed delivery stores `codeOf(...)` in `lastError` only when the result is on the policy's own `codes` list; anything else (and a throwing `codeOf`, which is reported) stores the class label as before. Each failed delivery now writes one `logger.error` entry with `{ outboxId, attempt, lastError }` and the original error, so a host diagnostics sink receives it; the row itself stores no error ID.
