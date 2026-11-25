/**
 * @file Event, outbox and transaction-boundary port contracts.
 *
 * Purpose:
 * Defines the stable interfaces that domain/application code depends on to publish events and deliver them reliably.
 *
 * Architectural role:
 * This file is the dependency inversion seam. Hosts provide in-memory or durable implementations and compose them in
 * their composition root. Concrete infrastructure can change without changing feature logic as long as implementations
 * satisfy these types.
 *
 * Design goal:
 * Core/domain code depends on interfaces from this file only, never on concrete infrastructure SDKs or
 * framework-specific implementations.
 */
import type { UUID, ISODateTime } from "../../primitives/index.js";

/**
 * Who a recorded mutation or event is attributed to, as stamped by the trusted writer.
 * `kind` is never inferred from the shape of `id`; a historic record without provenance
 * carries no `MutationActor` at all rather than a guessed kind.
 */
export interface MutationActor {
  id: UUID;
  kind: "user" | "agent" | "system";
}

/**
 * The ONE code list of actor kinds a ledger row may record in its nullable `actor_kind` column (Trash,
 * revision ledgers). Wider than {@link MutationActor}'s `kind`: a ledger can name the owner apart
 * from a member, a plugin apart from an agent, and a public visitor. `unknown` is an explicit
 * "the writer could not tell"; a row written before the column existed stays NULL instead, and
 * neither is ever guessed from the shape of an id. Hosts import this list; they never copy it.
 */
export const RECORDED_ACTOR_KINDS = ["owner", "member", "agent", "plugin", "system", "visitor", "unknown"] as const;

/** One member of {@link RECORDED_ACTOR_KINDS}. */
export type RecordedActorKind = (typeof RECORDED_ACTOR_KINDS)[number];

/**
 * A typed attribution a writer persists as `actor_kind` + `actor_id` on a ledger row. `id` is null
 * when the kind has no stable id (an anonymous visitor). Separate from any principal/plugin
 * columns the same row already carries: those keep their meaning and are not derived from this.
 */
export interface RecordedActor {
  kind: RecordedActorKind;
  id: string | null;
}

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
   * Attribution stamped by the trusted writer. When both are present, `actor.id` must equal
   * `actorId` (writers refuse a mismatch); `actorId` stays as the compatibility field.
   * Optional for now: an event recorded before provenance existed has none.
   */
  actor?: MutationActor | undefined;
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

export type AttributedDomainEvent<T = Record<string, unknown>> =
  Omit<DomainEvent<T>, "actor" | "actorId"> & {
    actor: MutationActor;
    actorId: MutationActor["id"];
  };

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
  publishBatch<TPayload>(required: { events: Array<DomainEvent<TPayload>> }, optional?: Record<string, never>): Promise<void>;
  /**
   * Subscribe a handler to an event name.
   * Returns an async unsubscriber function.
   */
  subscribe<TPayload>(
    required: { eventName: string; handler: (event: DomainEvent<TPayload>) => Promise<void> },
    optional?: Record<string, never>
  ): Promise<() => Promise<void>>;
  /**
   * Subscribe a handler to every event published on this bus, regardless of name. Additive to
   * `subscribe` — existing per-name callers are unaffected.
   * The Integrations fan-out (`registerWebhookFanout`) is the first real consumer: it narrows
   * by topic itself rather than requiring a fixed list of event names up front.
   */
  subscribeAll(required: { handler: (event: DomainEvent) => Promise<void> }, optional?: Record<string, never>): Promise<() => Promise<void>>;
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
  lastError?: string | undefined;
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
  claimPending(required: { batchSize: number; nowIso: ISODateTime }, optional?: Record<string, never>): Promise<OutboxRecord[]>;
  /** Mark a row as delivered. */
  markDelivered(required: { id: UUID }, optional?: Record<string, never>): Promise<void>;
  /**
   * Mark a row as failed and set its next retry time.
   *
   * `nextStatus` is decided by the CALLER (the retry-policy owner, e.g. a worker that tracks an
   * attempt cap) — an implementation must persist exactly what it is told, not re-derive the
   * decision from the row's own stored `attempts` (2026-09-06: this parameter replaced that
   * adapter-side re-derivation, mirroring `WebhookDeliveryRepoPort.markFailed`'s `nextStatus`
   * shape in the host). `"pending"` re-enters the retry queue at `nextAttemptAt`; `"failed"`
   * is terminal — `claimPending` only ever selects `"pending"` rows, so a `"failed"` row is
   * permanently excluded from retry regardless of `nextAttemptAt`.
   */
  markFailed(
    required: {
      id: UUID;
      error: string;
      nextAttemptAt: ISODateTime;
      nextStatus: Extract<OutboxRecord["status"], "pending" | "failed">;
    },
    optional?: Record<string, never>
  ): Promise<void>;
}

/** Clock and ID generator contracts are owned by the shared kernel primitives. */

/**
 * Opens/commits/rolls back one transaction around `fn` — the same shape and contract as this
 * codebase's other write chokepoints that need one (`RedirectsWriteDeps.transaction`,
 * `SqliteSettingsRepo.transaction`).
 *
 * `deleteTerm`/`deleteTaxonomy` run their ENTIRE body — every guard read (`findById`,
 * `countChildren`, `countByTerm`) AND every write (`delete`, `revisions.insert`, `outbox.enqueue`)
 * — inside one call to this. Two failure modes this closes that a guard-then-transaction split
 * would not:
 *
 * 1. **TOCTOU on the guard.** A guard read taken BEFORE the transaction opens can go stale the
 *    instant it returns — content can be assigned to the term in the gap between the read and the
 *    delete, and the delete would proceed having checked a now-wrong count. Putting the read
 *    inside the same transaction as the delete is what makes the guard's answer still true at the
 *    moment the delete actually runs.
 * 2. **Partial cascade.** `deleteTaxonomy` deletes N member terms then the taxonomy row itself,
 *    with no FK/CASCADE at the schema level (the host schema — `taxonomies`/`terms`/`entry_terms`/
 *    `taxonomy_revisions` are plain columns, no foreign keys) to undo a mid-cascade failure. A
 *    real transaction is the only thing that can.
 *
 * A caller-supplied identity/no-op implementation is a valid choice for a backend that has no
 * separate transaction primitive to offer (see `repo.memory.ts`'s `InMemoryTaxonomyRepo` for the
 * disclosed rationale) — the port exists so `deleteTerm`/`deleteTaxonomy` never have to know which
 * kind of backend they're running against.
 */
export interface TransactionalRepoPort {
  transaction<T>({ fn }: { fn: () => Promise<T> }): Promise<T>;
}
