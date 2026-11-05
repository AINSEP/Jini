# Event-Driven Architecture

## What It Is

Services communicate by publishing and consuming events rather than making direct calls. A producer emits an event when something significant happens. Consumers subscribe to event types they care about and react independently. Producers and consumers are decoupled — they do not know about each other.

```
Direct calls (tight coupling):          Event-Driven (loose coupling):

Order    ──HTTP──► Inventory             Order    ──── OrderPlaced ────────────►
Service  ──HTTP──► Payment     vs.       Service               │
Service  ──HTTP──► Email                              ┌────────┼─────────┐
                                                      ▼        ▼         ▼
                                                 Inventory  Payment    Email
                                                  Service   Service   Service
```

## Event Types: Know the Difference

Confusing these leads to incorrect coupling. There are three distinct types:

**Domain Events (internal)**: Facts that happened within a bounded context. Used within the same service or module to trigger internal reactions. Not shared across service boundaries in their raw form.

Example: `InvoiceCreated`, `OrderStatusChanged` — meaningful within the domain that owns them.

**Integration Events (external)**: Events published across service boundaries. These are the public API of a service's event stream. They must be versioned, stable, and treated like a contract. Other services depend on them.

Example: `OrderShipped` published by Order Service, consumed by Notification Service and Fulfillment Service.

**Commands-as-Messages**: Messages that tell another service to do something specific. Technically a message, not a domain event (it represents intent, not fact). Used in choreography sagas. Example: `ReserveStock`, `ProcessRefund`.

**Why this matters**: Integration events are public contracts. Changing their schema without versioning breaks consumers. Domain events are internal and can change freely.

## When to Use

- Asynchronous workflows where services do not need to wait on each other
- Fan-out: one event triggers reactions in multiple independent services
- You want services to be independently deployable and loosely coupled
- High-throughput scenarios where buffering and backpressure handling is needed
- Building systems that need to be extensible (adding a new consumer should not require changing the producer)

## When to Avoid

- Operations that require immediate consistency (a payment authorization that must succeed before the next step proceeds)
- Simple systems where the added infrastructure complexity is not justified
- When debugging and tracing across async chains would be prohibitively complex

## Reliable Event Publishing: The Outbox Pattern

The naive implementation has a critical flaw:

```typescript
// WRONG — can lose events under failure
async function placeOrder({ order }: { order: Order }): Promise<void> {
  await db.save(order)          // step 1
  await eventBus.publish(...)   // step 2 — if this throws, order exists but no event published
}
```

Use the Outbox Pattern: write the event to the database in the same transaction as the state change. A relay process polls and publishes.

```typescript
// CORRECT — atomic
await withTransaction(async (tx) => {
  await db.save({ order }, { tx })
  await outbox.append({ event: new OrderPlaced({ orderId: order.id }) }, { tx })
})
// relay process publishes from outbox asynchronously
```

See `reliability-patterns.md` for the full Outbox Pattern.

## Choreography vs. Orchestration

**Choreography**: Each service reacts to events and publishes new events. No central coordinator. The flow emerges from the reactions.

```
Order Service ──OrderPlaced──► Inventory (reserves stock, publishes StockReserved)
                                         └──StockReserved──► Payment (charges, publishes PaymentCharged)
```

Good for: simple sequential flows, maximum decoupling, small number of services.
Risk: the overall flow is distributed across services — no single place to see the full picture. Debugging requires tracing events across services.

**Orchestration**: A saga orchestrator holds an explicit state machine and issues commands to services. See `reliability-patterns.md` for the Saga Pattern.

Good for: complex flows with explicit compensation, when you need a clear audit of saga state.

## Schema Versioning

Integration events are contracts. Handle schema changes carefully:

**Additive changes** (backward compatible): Add new optional fields. Old consumers ignore unknown fields. No breaking change.

**Breaking changes**: Rename a field, remove a field, change a field type. Requires a versioning strategy:

Option 1 — **Parallel versions**: Publish both v1 and v2 events during migration. Consumers migrate at their own pace. Retire v1 after all consumers have migrated.

Option 2 — **Version in event type**: `OrderPlaced.v1`, `OrderPlaced.v2`. Consumers subscribe to the versions they support.

Option 3 — **Schema registry**: Use a schema registry (Confluent, AWS Glue) to enforce compatibility rules and version schemas centrally.

**Rule**: Never remove a field or change a field type in an integration event without a migration plan and consumer notification.

## Dead Letter Queue (DLQ) Strategy

When a consumer fails to process an event (exception, validation error, downstream unavailability), the event must not be silently lost.

Dead letter queues capture events that could not be processed after exhausting retries:

1. Consumer attempts to process event
2. Processing fails → retry with backoff (3-5 attempts)
3. All retries exhausted → publish event to DLQ
4. Alert is triggered
5. Human or automated process investigates and resolves DLQ entries

DLQ entries must be replayable. Once the root cause is fixed, you must be able to replay DLQ events to the main queue.

**Required for**: any event-driven system in production. Not optional.

## Idempotent Consumers

Events can be delivered more than once (broker retries, network failures, reprocessing from DLQ). Consumers must handle duplicate delivery without producing incorrect side effects.

Patterns:
- Track processed event IDs in a store. Skip if already processed.
- Use upsert operations (insert or update) instead of insert-only.
- Design state transitions to be naturally idempotent (setting a field to a value is idempotent; incrementing is not).

## Detailed Example

Order lifecycle with event-driven fan-out:

```
1. Order Service:     Receives CreateOrder command
                      Validates and saves order
                      Publishes OrderPlaced (via Outbox)

2. Inventory Service: Consumes OrderPlaced
                      Reserves stock for each line item
                      Publishes StockReserved or StockInsufficient

3. Payment Service:   Consumes StockReserved
                      Charges payment method
                      Publishes PaymentCharged or PaymentFailed

4. Notification Svc:  Consumes OrderPlaced (independently)
                      Sends order confirmation email

5. Analytics Service: Consumes OrderPlaced (independently)
                      Updates real-time sales dashboard
```

Steps 4 and 5 happen in parallel with 2 and 3. No coupling. No waiting.

## Testing Strategy

- **Event schema contract tests**: Assert that published events conform to the defined schema. Run against every deployment.
- **Idempotency tests**: Deliver the same event twice. Assert no side effects are duplicated.
- **DLQ tests**: Simulate processing failure. Assert event lands in DLQ after max retries.
- **Replay tests**: Publish all events from DLQ back to main queue. Assert correct processing.
- **End-to-end saga simulation**: Publish trigger event, assert all downstream consumers react correctly within a timeout.

## Common Failure Modes

**Dual-write without Outbox**: Publishing events directly to the broker in the same code path as the database write. Events are lost when the service crashes between the two operations.

**Mutable events**: Editing or deleting published events. Events are facts. They cannot be un-happened. To correct an error, publish a correcting event.

**Unversioned integration events**: Adding a required field breaks all consumers immediately. Always version integration events.

**No DLQ configured**: Failed events are silently dropped. Inconsistencies accumulate invisibly.

**Choreography without observability**: A complex choreography saga spans 6 services. A failure in step 4 is invisible without distributed tracing. Instrument every service with correlation IDs from the triggering event.

**Consumer not idempotent + at-least-once delivery**: The message broker delivers the same event twice. Non-idempotent consumer charges a customer twice.

## Pairs Well With

- **CQRS** — events from the write side drive projection updates on the read side
- **Event Sourcing** — the event log is the canonical source; integration events are published from it
- **Reliability Patterns** — Outbox for reliable publishing, Saga for distributed transactions, Circuit Breaker for resilient consumers
- **Microservices** — the primary inter-service communication pattern
- **Modular Monolith** — domain events work within a monolith as in-process events; extract to async messaging when modules become services
