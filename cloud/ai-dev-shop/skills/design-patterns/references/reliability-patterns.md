# Reliability Patterns: Outbox and Saga

Two patterns that solve the most common correctness failures in distributed and event-driven systems. Neither is optional if you are building systems where data consistency under failure matters.

---

## Part 1: The Outbox Pattern

### The Problem: Dual-Write

The most dangerous naive pattern in event-driven systems:

```typescript
// WRONG — can lose events under partial failure
async function createOrder({ orderData }: { orderData: OrderData }): Promise<void> {
  await db.save(orderData)        // step 1: persist to database
  await eventBus.publish(         // step 2: if this throws, order exists but event is never published
    new OrderCreated(orderData)
  )
}
```

This looks correct but fails under partial failure. If the application crashes between step 1 and step 2, the order exists in the database but the `OrderCreated` event is never published. Downstream services never know the order exists. State is permanently inconsistent.

Wrapping in a transaction does not fix this — you cannot include an external message broker in a database transaction.

### The Solution: Transactional Outbox

Write the event to a dedicated `outbox` table **in the same database transaction** as the state change. A separate relay process polls the outbox and publishes to the message broker.

```
+─────────────────────────────────────────────+
│ DATABASE TRANSACTION                        │
│  INSERT INTO orders VALUES (...)            │
│  INSERT INTO outbox VALUES (                │
│    type: 'OrderCreated',                    │
│    payload: {...},                          │
│    published: false                         │
│  )                                          │
│  COMMIT                                     │
+─────────────────────────────────────────────+
           │
           │ (separate process, polling)
           ▼
+─────────────────────────────────────────────+
│ RELAY PROCESS                               │
│  SELECT * FROM outbox WHERE published=false │
│  FOR EACH event:                            │
│    message_broker.publish(event)            │
│    UPDATE outbox SET published=true         │
+─────────────────────────────────────────────+
```

Guarantees: if the transaction commits, the event will eventually be published. If the transaction rolls back, neither the state change nor the event is persisted.

### Outbox Table Structure

```sql
CREATE TABLE outbox (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type  VARCHAR NOT NULL,
    aggregate_id VARCHAR NOT NULL,
    payload     JSONB NOT NULL,
    published   BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMP DEFAULT NOW(),
    published_at TIMESTAMP
);
```

### Change Data Capture (CDC) Alternative

Instead of polling the outbox table, use Change Data Capture to stream database changes directly to the message broker (Debezium + Kafka is the common stack). CDC is lower latency and eliminates the polling loop, but adds infrastructure complexity. Use polling for simpler systems; adopt CDC when polling latency or load is a problem.

### Idempotent Consumers

The relay process may publish the same event twice (retry after a failure between publish and marking as published). Consumers **must** be idempotent — processing the same event twice must produce the same result as processing it once.

Implementation patterns:
- Store processed event IDs and skip duplicates
- Use upsert operations instead of inserts where possible
- Design state transitions to be naturally idempotent (setting a status is idempotent; appending to a list is not)

### When to Use Outbox

Use whenever: a database write and a message broker publish must succeed or fail together. This is nearly all event-driven systems.

Do not use: if you are using an event-sourced system where the event log is the database — the events are already durably stored before projection.

---

## Part 2: The Saga Pattern

### The Problem: Distributed Transactions

In a microservices or multi-module system, a business operation often spans multiple services. Example: placing an order requires:
1. Reserve inventory (Inventory Service)
2. Charge payment (Payment Service)
3. Create shipment (Shipping Service)

You cannot use a database transaction across services. The classical solution (2-phase commit / distributed transactions) is too slow, too brittle, and unavailable in most cloud databases.

A Saga is a sequence of local transactions, each publishing an event or message that triggers the next step. If any step fails, compensating transactions undo the completed steps.

### Two Implementation Approaches

---

#### Choreography Saga

Services react to events and publish new events. No central coordinator.

```
Order Service          Inventory Service       Payment Service
     │                      │                       │
     │── OrderCreated ──────►│                       │
     │                      │── StockReserved ──────►│
     │                      │                       │── PaymentCharged ──► ...done
     │                      │                       │
     │                      │   (on failure)        │
     │◄── StockReservationFailed ──────────────────── │ (if payment fails)
     │                      │◄── StockReleased ──────│
```

**Benefits**: Loose coupling, no single point of failure, easy to add new participants.

**Tradeoffs**: Difficult to understand the full flow (it is distributed across service codebases). Harder to detect and handle saga-level failures. Risk of cyclic event chains if not designed carefully.

**Use when**: The saga is simple (2-3 steps), steps are naturally sequential, failure handling is straightforward.

---

#### Orchestration Saga

A dedicated saga orchestrator holds the state machine and issues explicit commands to services.

```
            Saga Orchestrator
                   │
     ┌─────────────┼─────────────┐
     │             │             │
     ▼             ▼             ▼
Inventory      Payment        Shipping
 Service        Service        Service

Orchestrator state machine:
  PENDING → RESERVING_STOCK → CHARGING_PAYMENT → CREATING_SHIPMENT → COMPLETE
                     │                  │
                     └── COMPENSATING ◄─┘  (on any failure)
```

The orchestrator:
1. Sends `ReserveStock` command to Inventory Service
2. Receives `StockReserved` reply
3. Sends `ChargePayment` command to Payment Service
4. Receives `PaymentFailed` reply
5. Sends `ReleaseStock` compensating command to Inventory Service
6. Marks saga as FAILED

**Benefits**: Full visibility of saga state in one place. Easier to add compensation logic. Explicit state machine is auditable.

**Tradeoffs**: The orchestrator is a central coordination point. More complex to implement and deploy than choreography.

**Use when**: The saga has 3+ steps, compensation logic is complex, or you need explicit saga state for observability or compliance.

---

### Compensating Transactions

Every step in a saga needs a defined compensating transaction — the operation that undoes it if the saga must roll back.

| Forward Step | Compensating Step |
|---|---|
| Reserve stock | Release stock |
| Charge payment | Issue refund |
| Create shipment | Cancel shipment |
| Send confirmation email | (cannot unsend — mark as "compensated, email may have been received") |

Not all operations are semantically reversible. Email sends, SMS messages, and external API calls may not be undoable. Design sagas to push irreversible steps to the end, or accept that compensation in these cases means recording that the event occurred rather than actually reversing it.

### Saga State Persistence

The saga orchestrator must persist its state between steps. Use a dedicated `sagas` table:

```sql
CREATE TABLE sagas (
    id           UUID PRIMARY KEY,
    saga_type    VARCHAR NOT NULL,
    current_step VARCHAR NOT NULL,
    status       VARCHAR NOT NULL,  -- PENDING, RUNNING, COMPENSATING, COMPLETE, FAILED
    payload      JSONB,
    created_at   TIMESTAMP DEFAULT NOW(),
    updated_at   TIMESTAMP DEFAULT NOW()
);
```

### Testing Strategy

- **Happy path test**: Assert that all steps complete in order and the saga reaches COMPLETE status
- **Compensation tests**: Simulate failure at each step, assert correct compensation chain executes
- **Idempotency tests**: Deliver the same event or reply twice, assert the saga does not double-process
- **Timeout tests**: Assert the saga handles step timeouts and triggers compensation
- **State persistence tests**: Crash the orchestrator mid-saga, restart, assert it resumes correctly

### Common Failure Modes

**Missing compensation for every step**: Every forward step must have a defined compensating action before the saga is implemented. Discovering you cannot compensate step 3 after building steps 1-5 requires redesign.

**Non-idempotent saga steps**: If a step processes twice due to a retry, the saga produces incorrect state (double charge, double reservation). All saga participants must be idempotent.

**Compensation failure**: The compensation for step 2 fails. Now you have a partially compensated saga. Implement retry-with-backoff on compensation steps. Log permanently compensable failures for manual resolution.

**Saga timeouts not handled**: A service never responds. The saga waits forever. Define explicit timeouts per step and trigger compensation on timeout.

**Choreography cycles**: Service A publishes event → Service B publishes event → Service A reacts and publishes again → infinite loop. Map the full event flow before implementing choreography sagas.

## Pairs Well With

- **Event-Driven Architecture** — sagas are naturally event-driven; each step publishes domain events
- **CQRS** — saga state is often maintained as a separate read model
- **Outbox Pattern** — use Outbox to guarantee reliable event publishing from each saga step
- **Microservices** — sagas are the primary mechanism for cross-service business transactions
- **Modular Monolith** — orchestration sagas work within a monolith as well; choreography via in-process events
