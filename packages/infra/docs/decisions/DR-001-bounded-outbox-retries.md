# DR-001: Outbox retries are bounded and worker-owned

Status: existing reliability rationale restated; additive opt-in contracts clarified below.

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

## Opt-in fenced delivery and independent pump (2026-10-25)

`FencedOutboxPort` and `processFencedOutbox` add a separate, explicitly selected contract without
changing the legacy port, statuses or retry semantics above. Host adapters atomically enforce
scope, row identity, claim token, state and expiry. Authorization precedes a durable begin-dispatch
marker; expiry is checked again after awaiting that marker. Expired leased rows never passed that
marker and return to pending; expired dispatching rows become uncertain, never automatically pending. Only a confirmed no-effect transport outcome may use the
existing bounded retry policy. Throws, invalid outcomes and timeouts require host reconciliation;
late success cannot automatically release uncertainty. Acknowledgement failure retains the durable
fence, since the storage operation may have committed before throwing. Unavailable storage cannot
guarantee an immediate literal uncertain write.

Enqueue receipt uniqueness is `(scope, idempotencyKey)` and compares both digest and exact canonical
request atomically. A supplied transaction is the caller's exact live session, shared with its
intent/journal; unsupported sessions are rejected. No new transaction is opened, committed or
retried on that path. Callers roll back on conflict/failure. Storage/schema owners stay with the
host. This addition leaves CMS's separate co-persistence decision in place.

`createSerialPump` reuses the drainer's private scheduling lifecycle with an inert construction,
positive fixed interval before every complete callback, and terminal shutdown awaiting that whole
callback. It ignores batch counts. The existing drainer retains its initial-zero/full-batch timing
and bounded-drain shutdown. Neither orchestration API creates a scheduler, transport or database.
