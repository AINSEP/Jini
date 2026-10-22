# DR-001: Outbox retries are bounded and worker-owned

Status: restated from the existing reliability rationale; no runtime changes.

## Context

Immediately requeueing a permanently failing event lets the worker spin at its full batch rate forever. Incrementing an attempt counter is insufficient if no component uses it to stop retries. A crashed claimer also needs recovery, while a still-running timed-out delivery must not immediately acquire a second execution.

## Decision

The worker owns retry-versus-terminal policy and adapters persist the supplied outcome. Apply capped exponential backoff with equal jitter: half the exponential step plus a random fraction of the remaining half. Seal exhausted rows as failed, outside future claims. Use claim leases for recovery after a dead worker. An overrun records its failure promptly but defers eligibility through the lease window because the underlying handler cannot be cancelled. Cap each drain and keep background scheduling separate from request handling.

## Consequences and current limits

Jitter avoids zero-delay retry storms. Delivery is at least once; consumers must be idempotent. Adapters with claim tokens can fence late outcomes; adapters without tokens retain a late-write race. Lease recovery alone does not cancel an old handler or guarantee exactly once. Host adapters supply durable storage, scheduler, logger and randomness. The worker keeps its own policy rather than importing a feature-domain implementation across the dependency boundary.

## Defect prevented

A poison event spinning forever, a crashed worker leaving rows processing permanently, concurrent drains overlapping an uncancellable overrun, or storage adapters disagreeing about terminal state.

## Source and enforcement

The [worker JSDoc](../../src/events/outbox/worker.ts), [drainer JSDoc](../../src/events/outbox/drainer.ts) and [enqueue-only JSDoc](../../src/events/outbox/enqueue-only.ts) record the inherited fixes and their limitations. Historical identifiers remain outside the engine. This record concerns the outbox source entry; it does not broaden the older database shim guarantees.
