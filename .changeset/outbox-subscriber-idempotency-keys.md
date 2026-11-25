---
"@jini-ai/infra": minor
---

Add `subscribeOutbox`, an outbox subscription boundary that gives each subscriber a stable, versioned idempotency key (`[workspaceId, event.id, handlerId]`) and runs its effect through a host-injected `processOnce`, plus the `InMemoryProcessOnceLedger` reference and `outboxIdempotencyKey`. The existing `withProcessedEventGuard` stays for in-memory callers.
