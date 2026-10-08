import type { Insertable, Selectable } from "kysely";

import type { RedirectsTable, RedirectRevisionsTable } from "./row-types.js";
import { toBool } from "@jini-ai/db/kernel";
import type {
  RedirectMatchType,
  RedirectRecord,
  RedirectRevision,
  RedirectSource,
  RedirectStatus,
  RedirectStatusCode,
} from "../types.js";

/**
 * @file Row mapping for `redirects` / `redirect_revisions`, shared by every dialect: the columns are
 * the generated `ContentDatabase` types (snake_case, JSON as text, booleans as 0/1 integers). Neutral
 * on purpose — no repo, no driver.
 */

export type RedirectRow = Selectable<RedirectsTable>;
export type RedirectRevisionRow = Selectable<RedirectRevisionsTable>;

/** One `redirects` row as a {@link RedirectRecord}. */
export function toRecord({ row }: { row: RedirectRow }, _optional: Record<string, never> = {}): RedirectRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    matchType: row.match_type as RedirectMatchType,
    fromPattern: row.from_pattern,
    toTarget: row.to_target,
    statusCode: row.status_code as RedirectStatusCode,
    status: row.status as RedirectStatus,
    override: toBool(row.override) === true,
    priority: row.priority,
    source: row.source as RedirectSource,
    sourceEntryId: row.source_entry_id ?? undefined,
    fromPathAtCapture: row.from_path_at_capture ?? undefined,
    toPathAtCapture: row.to_path_at_capture ?? undefined,
    createdByPrincipal: row.created_by_principal,
    createdByPluginId: row.created_by_plugin_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

/** `toRecord`'s inverse: the exact column values one whole-row upsert persists. */
export function toRow({ record }: { record: RedirectRecord }, _optional: Record<string, never> = {}): Insertable<RedirectsTable> {
  return {
    id: record.id,
    workspace_id: record.workspaceId,
    match_type: record.matchType,
    from_pattern: record.fromPattern,
    to_target: record.toTarget,
    status_code: record.statusCode,
    status: record.status,
    override: record.override ? 1 : 0,
    priority: record.priority,
    source: record.source,
    source_entry_id: record.sourceEntryId ?? null,
    from_path_at_capture: record.fromPathAtCapture ?? null,
    to_path_at_capture: record.toPathAtCapture ?? null,
    created_by_principal: record.createdByPrincipal,
    created_by_plugin_id: record.createdByPluginId ?? null,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    version: record.version,
  };
}

/** The columns an existing row's upsert replaces — everything but the match key `id`. */
export function updatableColumns({ row }: { row: ReturnType<typeof toRow> }, _optional: Record<string, never> = {}) {
  const { id: _id, ...rest } = row;
  return rest;
}

/** The `redirect_revisions` row an append writes (compact JSON state; `id` is database-assigned). */
export function toRevisionRow({ revision }: { revision: RedirectRevision }, _optional: Record<string, never> = {}): Insertable<RedirectRevisionsTable> {
  return {
    redirect_id: revision.redirectId,
    workspace_id: revision.workspaceId,
    seq: revision.seq,
    state_json: JSON.stringify(revision.state),
    tombstoned: revision.tombstoned ? 1 : 0,
    actor_id: revision.actorId,
    plugin_id: revision.pluginId ?? null,
    recorded_at: revision.recordedAt,
  };
}

/** One `redirect_revisions` row as a {@link RedirectRevision}. */
export function toRevision({ row }: { row: RedirectRevisionRow }, _optional: Record<string, never> = {}): RedirectRevision {
  return {
    redirectId: row.redirect_id,
    workspaceId: row.workspace_id,
    seq: row.seq,
    state: JSON.parse(row.state_json) as RedirectRecord,
    tombstoned: toBool(row.tombstoned) === true,
    actorId: row.actor_id,
    pluginId: row.plugin_id ?? undefined,
    recordedAt: row.recorded_at,
  };
}
