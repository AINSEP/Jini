/**
 * @file Core port contracts for the CMS runtime.
 *
 * Purpose:
 * Defines the stable interfaces that domain/application code depends on.
 *
 * How it relates to the project:
 * - `features/*` import these contracts to stay framework/provider-agnostic.
 * - `core/memory-bus.ts` provides in-memory implementations for local dev/tests.
 * - `core/outbox-worker.ts` orchestrates reliable async delivery using these ports.
 * - `server/app.ts` composes concrete implementations and runs the slice.
 *
 * Architectural role:
 * This file is the dependency inversion seam. Concrete infrastructure can change
 * without changing feature logic as long as implementations satisfy these types.
 */
/**
 * Shared primitives and runtime ports used by the CMS core.
 *
 * Design goal:
 * Core/domain code depends on interfaces from this file only, never on concrete
 * infrastructure SDKs or framework-specific implementations.
 */
export type UUID = string;
export type ISODateTime = string;
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject {
  [key: string]: JsonValue;
}
export type JsonArray = JsonValue[];

/**
 * Immutable domain event emitted by synchronous command handlers and delivered
 * asynchronously via the outbox pipeline.
 */
export interface DomainEvent<TPayload = Record<string, unknown>> {
  /** Unique identifier for the event record. */
  id: UUID;
  /** Stable event name, e.g. `workspace.created`. */
  name: string;
  /** ISO timestamp describing when the event was produced. */
  occurredAt: ISODateTime;
  /** Optional aggregate root identifier related to this event. */
  aggregateId?: UUID;
  /**
   * Tenant/workspace boundary. Required: every domain event belongs to a
   * workspace. Platform-level events must be a deliberate future
   * decision, not an omission.
   */
  workspaceId: UUID;
  /**
   * Principal (user or AI agent) that caused this event. Reserved change-set
   * vocabulary; optional until the identity library lands.
   */
  actorId?: UUID;
  /**
   * Change set this event belongs to, enabling propose/preview/apply/revert
   * grouping. Reserved change-set vocabulary.
   */
  changeSetId?: UUID;
  /** Event-specific payload. */
  payload: TPayload;
  /** Free-form metadata (trace IDs, source, etc.). */
  metadata?: Record<string, unknown>;
}

/**
 * Event bus abstraction used by the application layer.
 *
 * This is intentionally generic so implementations can be in-memory, queue-based,
 * broker-based, or provider-managed without changing domain logic.
 */
export interface EventBusPort {
  /** Publish a single event to subscribers. */
  publish<TPayload>(event: DomainEvent<TPayload>): Promise<void>;
  /** Publish multiple events in order. */
  publishBatch<TPayload>(events: Array<DomainEvent<TPayload>>): Promise<void>;
  /**
   * Subscribe a handler to an event name.
   * Returns an async unsubscriber function.
   */
  subscribe<TPayload>(
    eventName: string,
    handler: (event: DomainEvent<TPayload>) => Promise<void>
  ): Promise<() => Promise<void>>;
  /**
   * Subscribe a handler to every event published on this bus, regardless of name. Additive to
   * `subscribe` — existing per-name callers are unaffected.
   * The Integrations fan-out (`registerWebhookFanout`) is the first real consumer: it narrows
   * by topic itself rather than requiring a fixed list of event names up front.
   */
  subscribeAll(handler: (event: DomainEvent) => Promise<void>): Promise<() => Promise<void>>;
}

/**
 * Persisted outbox row used for reliable async event delivery.
 */
export interface OutboxRecord {
  /** Primary key for the outbox row (same as `event.id`). */
  id: UUID;
  /**
   * The full event envelope. The outbox must preserve everything the producer
   * emitted (workspaceId, aggregateId, actorId, occurredAt, metadata) so
   * delivery replays the original event, not a reconstruction.
   */
  event: DomainEvent;
  /** Delivery lifecycle state. */
  status: "pending" | "processing" | "delivered" | "failed";
  /** Number of delivery attempts so far. */
  attempts: number;
  /** Retry eligibility timestamp. */
  nextAttemptAt: ISODateTime;
  /** Most recent delivery failure reason. */
  lastError?: string;
  /** Row creation timestamp. */
  createdAt: ISODateTime;
}

/**
 * Reliable outbox contract.
 *
 * Command handlers enqueue events here in the same unit of work as the write.
 * A worker later claims and delivers rows to the event bus.
 */
export interface OutboxPort {
  /** Append an event for later delivery. */
  enqueue(event: DomainEvent): Promise<void>;
  /** Claim pending rows for processing. */
  claimPending(batchSize: number, nowIso: ISODateTime): Promise<OutboxRecord[]>;
  /** Mark a row as delivered. */
  markDelivered(id: UUID): Promise<void>;
  /** Mark a row as failed and set next retry time. */
  markFailed(id: UUID, error: string, nextAttemptAt: ISODateTime): Promise<void>;
}

/** Clock abstraction to make time deterministic in tests. */
export interface ClockPort {
  /** Current wall-clock time as ISO string. */
  nowIso(): ISODateTime;
}

/** ID generator abstraction to keep ID strategy swappable and testable. */
export interface IdGeneratorPort {
  /** Create a new globally unique ID. */
  newId(): UUID;
}
