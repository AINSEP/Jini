---
"@jini-ai/infra": patch
---

Add an opt-in `FencedOutboxPort` and `processFencedOutbox`: a durable begin-dispatch fence, bounded authorization and fence calls, expired never-dispatched leases returned to pending, expired dispatches held as `uncertain` for host reconciliation, and retries only on a confirmed no-effect result. Add an opt-in `FencedEnqueuePort` (`enqueueWithReceipt({ intent }, { transaction })`: inserted/existing/request-digest-mismatch receipts under `(scope, idempotencyKey)`, joining a caller-owned transaction), `outboxRequestDigest`, an `InMemoryFencedOutbox` reference adapter and `fencedOutboxConformance` cases for host adapters. Add an independent fixed-interval serial pump sharing the existing drainer lifecycle. Existing outbox APIs, defaults and immediate/full-batch drainer scheduling remain unchanged.
