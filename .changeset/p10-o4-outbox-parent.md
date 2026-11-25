---
"@jini-ai/core": minor
"@jini-ai/diagnostics": patch
"@jini-ai/infra": minor
"@jini-ai/db": minor
---

Add a durable outbox correlation seam. `OperationSpanOptions` gains an optional structural `traceparent`, which the diagnostics tracker forwards to the provider's `trackOperation` (never as an attribute). `SqlOutboxAdapter` and `SqlChangeSetRepo` accept an optional `prepareOutboxEvent` hook that runs inside the existing write (including the co-persisted change-set transaction), keeps the event's id, workspace and occurrence time, and persists the original envelope without failing the write when preparation throws. `trackOutboxDelivery` accepts an optional `readParent` and passes the persisted parent in trace options on every delivery attempt; subscriber invocation and errors are unchanged.
