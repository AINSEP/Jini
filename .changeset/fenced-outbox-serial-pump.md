---
"@jini-ai/infra": patch
---

Add opt-in fenced outbox contracts and processing with durable dispatch gates, conservative
unknown-effect handling, scoped idempotency receipts and caller-owned transaction semantics.
Add an independent fixed-interval serial pump sharing the existing drainer lifecycle. Existing
outbox APIs, defaults and immediate/full-batch drainer scheduling remain unchanged.
