import type { DomainEvent, ISODateTime, JsonObject, UUID } from "../ports.js";

/**
 * @file Change-set vocabulary and persistence contract.
 *
 * Purpose:
 * Defines the durable rows that make every mutation auditable and revertible,
 * for human and AI actors alike.
 *
 * How it relates to the project:
 * - `command.ts` records one change set per executed command.
 * - `revert.ts` walks items in reverse to undo an applied change set.
 * - `repo.memory.ts` provides the in-memory adapter for local dev/tests.
 *
 * Architectural role:
 * This is the storage shape required to land with the first persistent
 * schema. SQLite/Postgres adapters must satisfy `ChangeSetRepoPort` unchanged.
 *
 * `insert()`'s optional third argument lets the caller pass the fully-formed outbox event through
 * the SAME call, so a durable adapter can co-persist it inside the same transaction as the header
 * + items. This does NOT bring the domain write (`mutation.execute()`) into the transaction — that
 * remains covered by `executeCommand()`'s existing compensating-rollback path. See
 * `docs/decisions/change-set-outbox-transaction-boundary.md` for the full rationale, including why
 * this shape was chosen over threading a transaction handle through `OutboxPort`/`mutation.execute()`.
 */
export type ChangeSetStatus = "proposed" | "applied" | "reverted" | "discarded";

export type ChangeSetOperation = "create" | "update" | "delete" | "activate";

/** Durable header row for one reviewable, revertible unit of change. */
export interface ChangeSetRecord {
  id: UUID;
  workspaceId: UUID;
  /** Principal (user or agent) that caused the change. */
  actorId?: UUID;
  status: ChangeSetStatus;
  /** Human-readable description shown in audit/review UIs. */
  summary: string;
  /** Client-supplied key that makes retried commands safe to reject. */
  idempotencyKey?: string | undefined;
  /** Link back to the chat message / plan step that motivated the change. */
  intentRef?: string | undefined;
  createdAt: ISODateTime;
  appliedAt?: ISODateTime;
  revertedAt?: ISODateTime;
}

/** One entity mutation inside a change set. */
export interface ChangeSetItemRecord {
  id: UUID;
  changeSetId: UUID;
  /** Entity type key used to resolve an inverse applier, e.g. `post`. */
  entityType: string;
  entityId: UUID;
  operation: ChangeSetOperation;
  /** Revision pointers for revisioned entity types. */
  beforeRevisionId?: UUID | undefined;
  afterRevisionId?: UUID | undefined;
  /**
   * Inline inverse for non-revisioned entities. An item with neither revision
   * pointers nor an inverse payload cannot be reverted — and such
   * entities must not be mutated by agents.
   */
  inversePayload?: JsonObject | undefined;
  /**
   * Entity version *after* the mutation (REQ-08 guard input). Revert refuses
   * unless the entity's current version still equals this — otherwise the entity
   * has moved on since. Undefined for entity types without a version.
   */
  entityVersionAtApply?: number | undefined;
  /** Apply order; revert walks positions in reverse. */
  position: number;
}

/** Change set header plus its ordered items. */
export interface ChangeSetWithItems {
  changeSet: ChangeSetRecord;
  items: ChangeSetItemRecord[];
}

/** Persistence contract for change sets. */
export interface ChangeSetRepoPort {
  /**
   * `event`, when present, must be durably recorded atomically with `record`/`items` (BR-04 —
   * see this file's header). A SQLite adapter co-persists it inside the same transaction; the
   * in-memory adapter forwards it to its injected event bus/outbox. Omit `event` for a change set
   * that has no associated domain event to deliver.
   */
  insert(record: ChangeSetRecord, items: ChangeSetItemRecord[], event?: DomainEvent): Promise<void>;
  findById(required: { workspaceId: UUID; id: UUID }): Promise<ChangeSetWithItems | null>;
  findByIdempotencyKey(required: {
    workspaceId: UUID;
    idempotencyKey: string;
  }): Promise<ChangeSetRecord | null>;
  listByWorkspace(required: { workspaceId: UUID }): Promise<ChangeSetRecord[]>;
  /** Persist status transitions (applied -> reverted, proposed -> discarded, …). */
  save(record: ChangeSetRecord): Promise<void>;
}
