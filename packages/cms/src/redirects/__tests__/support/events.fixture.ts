import type { DomainEvent, EventBusPort, OutboxPort, OutboxRecord } from "../../../core/index.js";

const DEFAULT_OUTBOX_CLAIM_LEASE_MS = 30 * 60 * 1000; // Same test-double lease as source outbox-worker.ts:63.

/**
 * @file In-memory implementations of the event bus and outbox contracts.
 *
 * Purpose:
 * Provides zero-infrastructure adapters so the project can run immediately
 * without a database, queue, or broker.
 *
 * How it relates to the project:
 * - Implements interfaces from `src/contracts/core/ports.ts`.
 * - Used by `src/server/app.ts` as the concrete runtime wiring in development.
 * - Works with `src/contracts/core/events/outbox-worker.ts` to demonstrate hybrid sync + async flow.
 * - Used by tests to validate behavior without external dependencies.
 *
 * Architectural role:
 * Local adapter implementations. Production adapters can replace these later
 * (Postgres outbox, Redis/Kafka/NATS bus, etc.) without touching feature logic.
 */
export class InMemoryEventBus implements EventBusPort {
  /** Map of event name -> subscribed handlers. */
  private handlers = new Map<string, Array<(event: DomainEvent) => Promise<void>>>();
  /** Handlers subscribed to every event regardless of name (C-009). */
  private allHandlers: Array<(event: DomainEvent) => Promise<void>> = [];

  /** Publish a single event to all handlers registered for `event.name`, then every `subscribeAll` handler. */
  async publish<TPayload>(event: DomainEvent<TPayload>): Promise<void> {
    const eventHandlers = this.handlers.get(event.name) ?? [];
    for (const handler of eventHandlers) {
      await handler(event as DomainEvent);
    }
    for (const handler of this.allHandlers) {
      await handler(event as DomainEvent);
    }
  }

  /** Publish events in order. */
  async publishBatch<TPayload>({ events }: { events: Array<DomainEvent<TPayload>> }): Promise<void> {
    for (const event of events) {
      await this.publish(event);
    }
  }

  /** Register a handler and return an async unsubscriber. */
  async subscribe<TPayload>(
    { eventName, handler }: { eventName: string; handler: (event: DomainEvent<TPayload>) => Promise<void> }
  ): Promise<() => Promise<void>> {
    const list = this.handlers.get(eventName) ?? [];
    list.push(handler as (event: DomainEvent) => Promise<void>);
    this.handlers.set(eventName, list);

    return async () => {
      const current = this.handlers.get(eventName) ?? [];
      this.handlers.set(
        eventName,
        current.filter((h) => h !== (handler as (event: DomainEvent) => Promise<void>))
      );
    };
  }

  /** Register a handler for every event; returns an async unsubscriber (C-009). */
  async subscribeAll({ handler }: { handler: (event: DomainEvent) => Promise<void> }): Promise<() => Promise<void>> {
    this.allHandlers.push(handler);

    return async () => {
      this.allHandlers = this.allHandlers.filter((h) => h !== handler);
    };
  }
}

/** A row is claimable when it is due and was either never claimed or is held by an expired claim lease. */
function isClaimable(row: OutboxRecord, nowIso: string): boolean {
  return (row.status === "pending" || row.status === "processing") && row.nextAttemptAt <= nowIso;
}

/**
 * In-memory outbox implementation.
 *
 * This mirrors outbox behavior for local execution without a database.
 */
export class InMemoryOutbox implements OutboxPort {
  /** Internal mutable storage for outbox rows. */
  private records: OutboxRecord[] = [];
  /** How long a claim holds a row before it may be claimed again. */
  private readonly claimLeaseMs: number;

  /** @param optional.claimLeaseMs claim lease length (default {@link DEFAULT_OUTBOX_CLAIM_LEASE_MS}). */
  constructor(optional: { claimLeaseMs?: number } = {}) {
    this.claimLeaseMs = optional.claimLeaseMs ?? DEFAULT_OUTBOX_CLAIM_LEASE_MS;
  }

  /** Enqueue a domain event as a pending outbox row, preserving the full envelope. */
  async enqueue(event: DomainEvent): Promise<void> {
    this.records.push({
      id: event.id,
      event,
      status: "pending",
      attempts: 0,
      nextAttemptAt: event.occurredAt,
      createdAt: event.occurredAt,
    });
  }

  /**
   * Claim up to `batchSize` rows due at `nowIso`: `"pending"` rows, and `"processing"` rows whose
   * claim lease has expired (2026-09-14: their claimer died before recording an outcome). Each claimed
   * row is marked `processing`, its `attempts` incremented and its stored `nextAttemptAt` set to the
   * new lease expiry. The returned records are copies that keep the due time they were claimed at,
   * the same shape `SqliteOutboxAdapter.claimPending` returns.
   *
   * @complexity O(stored rows) per claim.
   */
  async claimPending({ batchSize, nowIso }: { batchSize: number; nowIso: string }): Promise<OutboxRecord[]> {
    const leaseExpiresAt = new Date(Date.parse(nowIso) + this.claimLeaseMs).toISOString();
    const due = this.records.filter((row) => isClaimable(row, nowIso)).slice(0, batchSize);

    return due.map((row) => {
      const claimed: OutboxRecord = { ...row, status: "processing", attempts: row.attempts + 1 };
      row.status = "processing";
      row.attempts = claimed.attempts;
      row.nextAttemptAt = leaseExpiresAt;
      return claimed;
    });
  }

  /** Mark a claimed row as delivered. */
  async markDelivered({ id }: { id: string }): Promise<void> {
    const row = this.records.find((r) => r.id === id);
    if (row) row.status = "delivered";
  }

  /**
   * Mark a claimed row failed and persist whichever `nextStatus` the caller decided (2026-09-06:
   * `OutboxPort.markFailed` gained this parameter so the retry-cap decision lives with the worker,
   * not here — see `outbox-worker.ts`'s header doc). This method no longer reads `attempts` at all.
   */
  async markFailed(
    { id, error, nextAttemptAt, nextStatus }: {
      id: string;
      error: string;
      nextAttemptAt: string;
      nextStatus: Extract<OutboxRecord["status"], "pending" | "failed">;
    }
  ): Promise<void> {
    const row = this.records.find((r) => r.id === id);
    if (!row) return;
    row.status = nextStatus;
    row.lastError = error;
    row.nextAttemptAt = nextAttemptAt;
  }
}
