# Outbox

Outbox delivery is at least once: a lease expiry, a timed-out handler or a crash between the effect
and `markDelivered` publishes the same event again. Worker lease fencing (claim tokens) protects the
delivery row, not the subscriber's side effect, so effects need their own idempotency.

## Subscribe with a stable idempotency key

A durable outbox subscriber registers through `subscribeOutbox`, which is where the guarantee is
enforced:

```ts
import { subscribeOutbox } from '@jini-ai/infra/events/outbox';

await subscribeOutbox({
  bus, eventName: 'form.submitted', handlerId: 'notify',
  handler: async ({ event, idempotencyKey }) => { /* effect */ },
  processOnce, // host-injected completion record
});
```

- `handlerId` is required, stable across deploys and unique per event name; it is part of every key.
- The key is `outboxIdempotencyKey({ workspaceId, eventId, handlerId })`: a versioned
  (`outbox-subscriber.v1`) URI-encoded triple. It never includes an attempt number, so every retry of
  the same event carries the same key. An event with no `id` or `workspaceId` is refused (the
  delivery fails) rather than given a key that could collide.
- Keys are per subscriber: one subscriber finishing never marks the broadcast processed for the
  others, and the worker still marks the row delivered only when every subscriber succeeded.
- Ordinary `bus.subscribe` listeners and the worker's retry, lease and fencing are unchanged.

### `processOnce` and the crash guarantees

`processOnce({ key, effect })` runs `effect` unless `key` is already recorded, and records the key
only together with the effect:

- **Transactional database effect**: commit the key and the effect's writes in one transaction. A
  crash before the commit leaves neither, so the retry runs it; a crash after the commit (before
  `markDelivered`) finds the key and skips it. This is exactly once per subscriber.
- **External effect** (mail, webhook, search provider): pass `idempotencyKey` to a provider or
  ledger that dedupes on it. After an ambiguous completion (timeout, lost reply) the retry sends the
  same key, so the provider applies it once.
- A claim recorded before the effect, without an atomic effect or a recoverable lease, is **not** a
  completion record: a crash mid-effect would skip the effect forever.
- Where the provider cannot dedupe after process loss, the subscriber is **at least once**; document
  that instead of claiming exactly once.

Jini ships `InMemoryProcessOnceLedger` (tests, single-process hosts): it records the key after the
effect succeeds and lets a concurrent duplicate share the in-flight outcome. It forgets everything
on restart.

## In-memory guard (legacy, single process)

`withProcessedEventGuard` (keyed by `event.id` and a `handlerId`) stays for in-memory callers. It
claims the key first, releases it if the handler throws, and leaves the claim behind if the process
dies mid-handler, so it is not a durable completion record. Production hosts implementing its
`ProcessedEventStore` port should commit the claim in the handler's own transaction, or move to
`subscribeOutbox`.
