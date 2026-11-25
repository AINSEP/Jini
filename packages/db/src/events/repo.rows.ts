import type { Generated, Insertable, Selectable } from "kysely";
import type {
  ChangeSetItemRecord,
  ChangeSetOperation,
  ChangeSetRecord,
  ChangeSetStatus,
  MutationActor,
} from "@jini-ai/core/contracts/events";

/** Stored column shapes, copied without schema changes; the table names are host-owned (see `ChangeSetTables`, `OutboxTables`). */
export interface ChangeSetItemsTable {
  id: string;
  change_set_id: string;
  entity_type: string;
  entity_id: string;
  operation: string;
  before_revision_id: string | null;
  after_revision_id: string | null;
  inverse_payload_json: string | null;
  entity_version_at_apply: number | null;
  position: number;
}

export interface ChangeSetsTable {
  id: string;
  workspace_id: string;
  actor_id: string | null;
  /** Present only once the host has migrated; read and written only under `ActorKindColumn`. */
  actor_kind?: string | null;
  status: string;
  summary: string;
  idempotency_key: string | null;
  intent_ref: string | null;
  created_at: string;
  applied_at: string | null;
  reverted_at: string | null;
}

export interface OutboxEventsTable {
  id: string;
  workspace_id: string;
  event_json: string;
  status: string;
  attempts: Generated<number>;
  next_attempt_at: string;
  last_error: string | null;
  created_at: string;
}

/** Whether the host's `change_sets` table has the `actor_kind` column yet; off means it is never named. */
export interface ActorKindColumn { actorKindColumn?: boolean }

const ACTOR_KINDS: ReadonlySet<string> = new Set<MutationActor["kind"]>(["user", "agent", "system"]);

/**
 * Refuses a record or event whose compatibility `actorId` names someone other than its `actor`,
 * so the two attribution fields can never be persisted disagreeing.
 *
 * @param required - The record or event's `actorId` and `actor`.
 * @throws {Error} When both are present and the ids differ.
 * @complexity O(1).
 */
export function assertConsistentActor(
  { actorId, actor }: { actorId?: string | undefined; actor?: MutationActor | undefined },
  _optional: Record<string, never> = {},
): void {
  if (actor && actorId !== undefined && actorId !== actor.id) {
    throw new Error("The actor id does not match the recorded actor; refusing to write conflicting attribution.");
  }
}

/** The stored provenance as an actor, or nothing: a missing or unrecognised kind is unknown, never guessed. */
function storedActor(row: Selectable<ChangeSetsTable>, { actorKindColumn = false }: ActorKindColumn): { actor?: MutationActor } {
  const kind = actorKindColumn ? row.actor_kind : null;
  if (!row.actor_id || !kind || !ACTOR_KINDS.has(kind)) return {};
  return { actor: { id: row.actor_id, kind: kind as MutationActor["kind"] } };
}

export function toRecord(row: Selectable<ChangeSetsTable>, options: ActorKindColumn = {}): ChangeSetRecord {
  return {
    ...storedActor(row, options),
    id: row.id,
    workspaceId: row.workspace_id,
    actorId: row.actor_id ?? undefined,
    status: row.status as ChangeSetStatus,
    summary: row.summary,
    idempotencyKey: row.idempotency_key ?? undefined,
    intentRef: row.intent_ref ?? undefined,
    createdAt: row.created_at,
    appliedAt: row.applied_at ?? undefined,
    revertedAt: row.reverted_at ?? undefined,
  };
}

export function toItemRecord(row: Selectable<ChangeSetItemsTable>): ChangeSetItemRecord {
  return {
    id: row.id,
    changeSetId: row.change_set_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    operation: row.operation as ChangeSetOperation,
    beforeRevisionId: row.before_revision_id ?? undefined,
    afterRevisionId: row.after_revision_id ?? undefined,
    inversePayload: row.inverse_payload_json == null ? undefined : JSON.parse(row.inverse_payload_json),
    entityVersionAtApply: row.entity_version_at_apply ?? undefined,
    position: row.position,
  };
}

/** The attribution columns of a record, refusing conflicting ids; `actor_kind` is named only under `ActorKindColumn`. */
function actorColumns(record: ChangeSetRecord, { actorKindColumn = false }: ActorKindColumn): Pick<Insertable<ChangeSetsTable>, "actor_id" | "actor_kind"> {
  assertConsistentActor(record);
  const actorId = record.actorId ?? record.actor?.id ?? null;
  return actorKindColumn ? { actor_id: actorId, actor_kind: record.actor?.kind ?? null } : { actor_id: actorId };
}

/** `toRecord`'s inverse: every absent optional field is written as SQL NULL; `actor_kind` only under `ActorKindColumn`. */
export function toRow(record: ChangeSetRecord, options: ActorKindColumn = {}): Insertable<ChangeSetsTable> {
  return {
    ...actorColumns(record, options),
    id: record.id,
    workspace_id: record.workspaceId,
    status: record.status,
    summary: record.summary,
    idempotency_key: record.idempotencyKey ?? null,
    intent_ref: record.intentRef ?? null,
    created_at: record.createdAt,
    applied_at: record.appliedAt ?? null,
    reverted_at: record.revertedAt ?? null,
  };
}

/** `toItemRecord`'s inverse: absent optionals as SQL NULL, the inverse payload as JSON text. */
export function toItemRow(item: ChangeSetItemRecord): Insertable<ChangeSetItemsTable> {
  return {
    id: item.id,
    change_set_id: item.changeSetId,
    entity_type: item.entityType,
    entity_id: item.entityId,
    operation: item.operation,
    before_revision_id: item.beforeRevisionId ?? null,
    after_revision_id: item.afterRevisionId ?? null,
    inverse_payload_json: item.inversePayload === undefined ? null : JSON.stringify(item.inversePayload),
    entity_version_at_apply: item.entityVersionAtApply ?? null,
    position: item.position,
  };
}
