---
"@jini-ai/db": minor
---

`@jini-ai/db/events` adds `SqlChangeSetRepo` and `SqlOutboxAdapter`, the Kysely adapters for the change-set and outbox ports declared in `@jini-ai/core/contracts/events`, and `outboxEventValues`, the one definition of the stored outbox row; the host passes the kernel and its table names, and the outbox adapter also requires `claimLeaseMs`.
