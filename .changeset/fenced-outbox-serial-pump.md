---
"@jini-ai/infra": patch
---

Add an opt-in `FencedOutboxPort` and `processFencedOutbox`: a durable begin-dispatch fence, bounded authorization and fence calls, expired never-dispatched leases returned to pending, expired dispatches held as `uncertain` for host reconciliation, and retries only on a confirmed no-effect result. Enqueueing stays with the host's storage; no reference adapter ships, so host adapters need their own conformance tests. Add an independent fixed-interval serial pump sharing the existing drainer lifecycle. Existing outbox APIs, defaults and immediate/full-batch drainer scheduling remain unchanged.
