# Event Sourcing

## What It Is

Store every state change as an immutable event in an append-only log. Never update or delete records. The current state of any entity is derived by replaying its event history from the beginning (or from the last snapshot).

This is how double-entry bookkeeping has worked for 700 years. You never erase a ledger entry. You add a correcting entry. The complete history is always preserved.

```
Traditional approach:         Event Sourcing approach:
+----------------------+      +----------------------+
| account_balance: 850 |      | AccountOpened   +0   |
|  (just final state)  |      | Deposited    +1000   |
+----------------------+      | Withdrawn     -200   |
                              | Deposited      +50   |
                              | ─────────────────── |
                              | Derived:        850  |
                              +----------------------+
```

## When to Use

- Audit trail is a hard requirement (financial, medical, compliance, legal)
- You need to answer "what was the state at time X?" (time-travel queries)
- You need to debug production failures by replaying what happened
- You are building a system where events are the primary domain concept (orders, payments, inventory adjustments)
- You are pairing with CQRS and need a reliable event source for read model projections

## When to Avoid

- You only need current state and history is irrelevant
- Simple CRUD with no audit requirements — the overhead is not justified
- Small teams where the operational complexity exceeds the benefit
- Storage cost is a hard constraint (event logs grow forever)

## Event Store Structure

An event is an immutable record with:
- Aggregate ID (which entity this event belongs to)
- Event type (named in past tense: `InvoiceCreated`, `PaymentReceived`, `OrderCancelled`)
- Sequence number (position in this aggregate's history)
- Timestamp (when it occurred)
- Payload (the data describing what changed)
- Metadata (who caused it, correlation ID, causation ID)

```
events table:
| id   | aggregate_id | aggregate_type | sequence | event_type       | payload (JSON) | occurred_at         |
|------|--------------|----------------|----------|------------------|----------------|---------------------|
| 1    | INV-001      | Invoice        | 1        | InvoiceCreated   | {...}          | 2026-01-01T09:00:00 |
| 2    | INV-001      | Invoice        | 2        | LineItemAdded    | {...}          | 2026-01-01T09:00:01 |
| 3    | INV-001      | Invoice        | 3        | InvoiceSent      | {...}          | 2026-01-01T10:00:00 |
| 4    | INV-001      | Invoice        | 4        | PaymentReceived  | {...}          | 2026-01-15T14:23:00 |
```

Write path: append events only. Never UPDATE or DELETE rows.
Read path (aggregate reconstitution): SELECT WHERE aggregate_id = ? ORDER BY sequence ASC, then apply events in order.

## Aggregate Reconstitution

To get the current state of an aggregate, replay its events:

```typescript
class Invoice {
  id: string | null = null
  status: string | null = null
  lineItems: LineItem[] = []
  total: number = 0

  static fromEvents({ events }: { events: DomainEvent[] }): Invoice {
    const invoice = new Invoice()
    for (const event of events) {
      invoice.apply({ event })
    }
    return invoice
  }

  apply({ event }: { event: DomainEvent }): void {
    switch (event.type) {
      case 'InvoiceCreated':
        this.id = event.payload.id
        this.status = 'draft'
        break
      case 'LineItemAdded':
        this.lineItems.push(event.payload)
        this.total += event.payload.subtotal
        break
      case 'PaymentReceived':
        this.status = 'paid'
        break
    }
  }
}
```

## Snapshot Strategy

Replaying 10,000 events to load a single aggregate is slow. Snapshots solve this:

1. Periodically persist the current aggregate state as a snapshot (every N events, or on a schedule)
2. On load: fetch the latest snapshot, then replay only events after the snapshot's sequence number

```
Load sequence without snapshot:  replay all N events
Load sequence with snapshot:     load snapshot at seq 9800 + replay events 9801-9847
```

A good threshold: take a snapshot when an aggregate exceeds 100-500 events. Store snapshots in a separate table. Do not replace old snapshots — append new ones.

## Projections (Read Models)

Event sourcing on the write side naturally pairs with CQRS read models built from event streams.

**Synchronous (inline) projections**: Updated in the same transaction as the event write. Consistent immediately. Limits throughput.

**Asynchronous (catch-up) projections**: A separate process subscribes to the event stream and updates read models. Eventually consistent. Higher throughput. Projections can be rebuilt from scratch by replaying the full event log.

The ability to rebuild projections is one of Event Sourcing's most underappreciated capabilities: if you realize you need a new read model, build it by replaying all historical events. You get full history for free.

## Event Schema Versioning (Upcasting)

Events are immutable and stored forever. When your domain evolves, old events still exist in their original shape. Upcasting is the pattern for handling this:

1. Old event: `InvoiceCreated { customer_id: "123" }`
2. New requirement: also store `customer_name`
3. New event version: `InvoiceCreated { customer_id: "123", customer_name: "Acme Corp" }`
4. Upcaster: a function that transforms an old event to the new shape at read time

Never modify stored events. Write an upcaster that transforms them in memory when loading. Chain upcasters for multiple version jumps.

## Detailed Example

**Invoice management system:**

Commands (inputs) → Events (what happened) → State (derived):

```
CreateInvoice      → InvoiceCreated       → status: draft
AddLineItem        → LineItemAdded        → line_items += item
RemoveLineItem     → LineItemRemoved      → line_items -= item
SendInvoice        → InvoiceSent          → status: sent
RecordPayment      → PaymentReceived      → status: paid
CancelInvoice      → InvoiceCancelled     → status: cancelled
```

Time-travel query: "What was the state of invoice INV-001 on 2026-01-10?"
→ Load all events for INV-001 WHERE occurred_at ≤ 2026-01-10, replay, done.

Audit query: "Who modified invoice INV-001 and when?"
→ Read the event log directly. Full history, no special audit table needed.

## Testing Strategy

- **Aggregate behavior tests**: Given a sequence of events, apply a command, assert the correct new events are emitted
- **Reconstitution tests**: Given a known event sequence, assert the aggregate's derived state is correct
- **Snapshot tests**: Assert that saving and loading a snapshot produces identical state to full replay
- **Projection tests**: Given an event sequence, assert the projected read model is correct
- **Upcaster tests**: Assert that old event shapes are correctly transformed to current shapes

## Common Failure Modes

**Storing current state in event payload**: Events should describe what changed, not what the full state is. `InvoiceUpdated { full_invoice_json }` is not event sourcing — it's just change capture. Store deltas.

**Mutable events**: Never update or delete events. If an error was made, record a correcting event (`PaymentCorrected`, `LineItemAdjusted`). Immutability is the foundation.

**No snapshot strategy**: System becomes unusable as event count grows. Plan snapshots from day one.

**Breaking event schemas without upcasters**: Adding required fields to an existing event type breaks all historical events. Always write upcasters for schema changes, or introduce a new event type.

**Using event sourcing for non-aggregate data**: Config tables, lookup lists, and reference data do not benefit from event sourcing. Apply it only to aggregates with meaningful state history.

**Neglecting event ordering guarantees**: Ensure your event store guarantees per-aggregate ordering. Out-of-order events produce incorrect state.

## Pairs Well With

- **CQRS** — write side publishes events; read side maintains projections from event stream. This combination is nearly universal in production event-sourced systems.
- **Domain Events** (DDD) — events are the natural language of the domain, not a technical mechanism bolted on.
- **Outbox Pattern** — if projections are updated asynchronously via a message broker, use the Outbox Pattern to guarantee reliable event publishing.
- **Event-Driven Architecture** — integration events published from the event store connect the bounded context to external services.
