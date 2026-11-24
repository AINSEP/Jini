# Outbox

Outbox delivery is at least once: a lease expiry, a timed-out handler or a crash between the effect
and `markDelivered` publishes the same event again.

## Run a handler once per event

A handler whose effect must not repeat (sending an email, rebuilding a sitemap) wraps itself with
`withProcessedEventGuard`, keyed by the event's `id` and a stable `handlerId` you choose:

```ts
import { InMemoryProcessedEventStore, withProcessedEventGuard } from '@jini-ai/infra/events/outbox';

bus.subscribe({ eventName, handler: withProcessedEventGuard({ store, handlerId: 'sitemap', handler }) });
```

- The guard claims the key first and then runs the handler. A second delivery of the same event
  finds the claim and returns without running it.
- If the handler fails, the claim is released before the error is rethrown. The outbox still sees
  the failure, and its retry runs the handler again.
- Jini ships only `InMemoryProcessedEventStore` (tests, single-process hosts). Production hosts
  implement the `ProcessedEventStore` port over their own database, ideally in the handler's own
  transaction.
