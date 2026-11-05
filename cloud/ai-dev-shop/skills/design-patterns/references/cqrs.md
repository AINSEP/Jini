# CQRS (Command Query Responsibility Segregation)

## What It Is

Separate the write model (commands that change state) from the read model (queries that return data). Commands and queries use different code paths, and usually different data models optimized for their respective workloads.

```
                        ┌──────────────────┐
  Command               │  WRITE MODEL     │     State
  (create, update) ────►│  Domain logic    │────► change
                        │  Validation      │      + event
                        │  Business rules  │
                        └──────────────────┘
                                │
                                │ event / projection
                                ▼
                        ┌──────────────────┐
  Query                 │  READ MODEL      │
  (fetch, list)  ──────►│  Denormalized    │────► Response
                        │  Pre-computed    │
                        │  Query-optimized │
                        └──────────────────┘
```

This is not always two separate databases. In simple CQRS it can be two code paths against the same database — a normalized write model and a denormalized view. The key is the separation of concerns, not the infrastructure.

## When to Use

- Read patterns differ significantly from write patterns (different shapes, different query needs)
- Reporting and dashboard views that require denormalized, pre-aggregated data
- High-read, low-write asymmetry where read performance needs independent optimization
- Combined with Event Sourcing where the event log is the write model and projections are the read models

## When Not to Use

- Simple CRUD where reads and writes have the same shape — the added complexity has no payoff
- Small applications where a single model serves all needs adequately
- Teams early in a product where the read/write asymmetry has not yet emerged

## The Write Side

Commands represent intent to change state. They are imperative (`CreateInvoice`, `ProcessPayment`, `CancelOrder`).

Command handlers:
1. Load the aggregate from the repository
2. Execute the command (apply business rules, validate invariants)
3. Persist the new state (or the new events, if using Event Sourcing)
4. Optionally publish domain events for projections and downstream consumers

```typescript
class CreateInvoiceCommandHandler {
  constructor(
    private readonly invoiceRepo: InvoiceRepository,
    private readonly outbox: Outbox
  ) {}

  async handle(
    { customerId, lineItems }: { customerId: string; lineItems: LineItem[] },
    { dueDate, currency = 'USD' }: { dueDate?: Date; currency?: string } = {}
  ): Promise<string> {
    const invoice = Invoice.create({ customerId, lineItems }, { dueDate, currency })
    // Write state change and outbox event atomically in one transaction
    await withTransaction(async (tx) => {
      await this.invoiceRepo.save({ invoice }, { tx })
      await this.outbox.append({ event: new InvoiceCreated({ invoiceId: invoice.id }) }, { tx })
    })
    return invoice.id
  }
}
```

Note the Outbox Pattern above — using a transactional outbox ensures the event is reliably published without dual-write risk. See `reliability-patterns.md`.

Note the Outbox Pattern above — using a transactional outbox ensures the event is reliably published without dual-write risk. See `reliability-patterns.md`.

## The Read Side

Queries return data shaped exactly for the consumer. There are no "find all and filter in code" queries. Read models are pre-computed for the specific views that need them.

```typescript
// Read model: pre-joined, denormalized for the invoice list dashboard
interface InvoiceListView {
  invoiceId: string
  invoiceNumber: string
  customerName: string  // denormalized — no join needed at query time
  total: number
  status: InvoiceStatus
  createdAt: Date
  daysOverdue: number   // pre-computed — no calculation needed at query time
}

// Query handler: thin, no business logic
class GetInvoiceListQueryHandler {
  async handle(
    { status }: { status: InvoiceStatus },
    { limit = 50, offset = 0, orderBy = 'created_at' }: { limit?: number; offset?: number; orderBy?: string } = {}
  ): Promise<InvoiceListView[]> {
    return this.db.query<InvoiceListView>(
      `SELECT * FROM invoice_list_view WHERE status = $1 ORDER BY ${orderBy} DESC LIMIT $2 OFFSET $3`,
      [status, limit, offset]
    )
  }
}
```

Read models are built by projections — processes that listen to domain events from the write side and update read model tables.

## Projection Strategies

### Synchronous Projections (Same Transaction)

The projection updates in the same database transaction as the command. The read model is always consistent with the write model.

```
BEGIN TRANSACTION
  UPDATE invoices SET status='paid' WHERE id=?
  UPDATE invoice_list_view SET status='paid', days_overdue=0 WHERE invoice_id=?
COMMIT
```

**Use when**: Read model consistency is critical. Simpler to implement. Suitable when read model update is cheap.

**Tradeoff**: Slower writes (more work per transaction). Tight coupling between write and read model updates.

### Asynchronous Projections (Event-Driven)

A separate projection process subscribes to domain events and updates read models independently.

```
Write side:   Command → Save Invoice → Publish InvoiceCreated event
Projection:   Consume InvoiceCreated → Update invoice_list_view
```

**Use when**: High write throughput is needed. Multiple read models need to be updated from the same events. Read models can tolerate slight staleness.

**Tradeoff**: Eventual consistency — there is a lag between write and read model update. The UI must handle the case where a just-created invoice does not immediately appear in the list. Rebuild projections by replaying events if they become corrupted.

### Projection Rebuilds

One of CQRS's most valuable capabilities: if a read model becomes corrupted or you need a new shape, replay all historical events to rebuild it from scratch.

Operational requirement: your event log must be queryable by event type and time range, and your projections must be idempotent (replaying the same event twice produces the same read model state).

## Event Sourcing Pairing

CQRS and Event Sourcing are frequently combined:

- **Write side**: Event-sourced aggregates. Commands produce events stored in the event log. No mutable state table.
- **Read side**: Projections consume events from the event log and maintain denormalized read model tables.

This combination is powerful:
- Full audit trail in the event log
- Any number of read models can be built from the same events
- Read models can be rebuilt from scratch at any time
- Write model is optimized for consistency; read models are optimized for query performance

See `event-sourcing.md` for the full Event Sourcing pattern.

## Eventual Consistency: Handling the Lag

When using async projections, the UI must handle eventual consistency gracefully:

1. **Optimistic update**: After a command succeeds, update the UI optimistically without waiting for the projection. If the projection later produces a different result, reconcile.
2. **Read-your-writes tokens**: The command returns a token (event ID or timestamp). The query layer accepts this token and waits until the projection has processed up to that position before returning.
3. **Polling**: After a command, the client polls until the new state appears in the read model. Simple but poor UX for slow projections.
4. **Stale data labeling**: Display a "data may be up to X seconds delayed" notice where appropriate.

## Testing Strategy

- **Command handler tests**: Test business rule enforcement. Use in-memory repositories. Assert correct events are emitted.
- **Projection tests**: Given a sequence of events, assert the read model is updated correctly. Test idempotency (same event twice produces same read model state).
- **Projection rebuild tests**: Replay full event history, assert read model matches known-correct state.
- **Query handler tests**: Assert correct SQL/query results. Test pagination, filtering, sorting.
- **Eventual consistency tests**: Assert that after a command and a configurable wait, the read model reflects the command's outcome.

## Common Failure Modes

**Commands containing queries**: A command should change state, not return data. If a command needs to check the read model before executing, restructure — the query belongs in the read side, the decision belongs in the write side's domain logic.

**Read model lag not accounted for in UX**: User creates a record, sees an empty list. "It didn't work." Always design UIs for eventual consistency when using async projections.

**Projections not idempotent**: Replaying events produces duplicate rows or incorrect aggregates. All projection handlers must be safe to run multiple times against the same event.

**Projection rebuild not tested**: Discovery in production that rebuilding a projection takes 6 hours and blocks a deploy. Test rebuild time early. Plan for incremental or background rebuilds.

**Business logic in query handlers**: Query handlers return data. Business rules belong in command handlers and domain entities.

## Pairs Well With

- **Event Sourcing** — the most common and powerful combination; event log is the write model, projections are the read models
- **Clean Architecture** — commands map to use cases; queries can bypass use cases and hit read models directly
- **Reliability Patterns** — use Outbox Pattern to guarantee reliable event publishing from command handlers
- **Domain-Driven Design** — commands correspond to domain operations; aggregates enforce business rules on the write side
