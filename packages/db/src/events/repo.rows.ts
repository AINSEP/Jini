import type { Generated, Insertable, Selectable } from "kysely";
import type {
  ChangeSetItemRecord,
  ChangeSetOperation,
  ChangeSetRecord,
  ChangeSetStatus,
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

export function toRecord(row: Selectable<ChangeSetsTable>): ChangeSetRecord {
  return {
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

/** `toRecord`'s inverse: every absent optional field is written as SQL NULL. */
export function toRow(record: ChangeSetRecord): Insertable<ChangeSetsTable> {
  return {
    id: record.id,
    workspace_id: record.workspaceId,
    actor_id: record.actorId ?? null,
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
