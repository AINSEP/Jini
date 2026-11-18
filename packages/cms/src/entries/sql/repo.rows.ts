import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import type { Generated, Insertable, Kysely, Selectable } from "kysely";
import type { EntryRevisionInput } from "../write-service.js";
import type { EntryRecord, EntryStatus } from "../types.js";
import type { EntryJsonDialectPort } from "./json-dialect-port.js";

/**
 * @file Row mapping for `entries` / `entry_revisions`, shared by every dialect: the columns are copied from the
 * host's generated schema in the same key order (snake_case, JSON as text); the host's own type-level pin fails if a
 * later copy drifts from it. Neutral on purpose — no repo, no driver. The table NAMES, the JSON dialect helpers and
 * the write-settled hook are host-owned ({@link EntrySqlRequired}).
 */

export interface EntryTableRow {
  id: string;
  workspace_id: string;
  type: string;
  slug: string;
  status: string;
  title: string;
  body_json: string | null;
  fields_json: string;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  version: number;
  deleted_at: string | null;
}

export interface EntryRevisionTableRow {
  seq: Generated<number>;
  entry_id: string;
  workspace_id: string;
  op: string;
  state_json: string;
  actor_id: string;
  delegated_by_workspace_id: string | null;
  delegated_by_id: string | null;
  recorded_at: string;
}

/** Host-owned table names. No schema or product table defaults live in the adapter. */
export interface EntryTables { entries: string; revisions: string }

/**
 * Everything the host must bind; a missing binding is a compile error.
 * `onWriteSettled` is called with the repository itself, synchronously, after every `save` and every `transaction`
 * whether it succeeded or failed: the host drops whatever it derived from the repository's rows (its caches are keyed
 * by the repository object). No entry id is passed: a transaction has none.
 */
export interface EntrySqlRequired {
  kernel: StorageKernel<Kysely<unknown>, unknown>;
  tables: EntryTables;
  json: EntryJsonDialectPort;
  onWriteSettled: (event: { repo: object }) => void;
}

/** Type aliases of `Record<string, Row>`, not interfaces: Kysely's `withTables` needs the implicit index signature. */
export type EntryTableViews = Record<string, EntryTableRow>;
export type EntryRevisionTableViews = Record<string, EntryRevisionTableRow>;

/** One `entries` row as an {@link EntryRecord}. */
export function toRecord(row: Selectable<EntryTableRow>): EntryRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    type: row.type,
    slug: row.slug,
    status: row.status as EntryStatus,
    title: row.title,
    bodyJson: row.body_json == null ? null : (JSON.parse(row.body_json) as unknown),
    fieldsJson: JSON.parse(row.fields_json) as unknown,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

/** The insertable `entries` row for `record` (never sets `deleted_at`: only the Trash does). */
export function toRow(record: EntryRecord): Insertable<EntryTableRow> {
  return {
    id: record.id,
    workspace_id: record.workspaceId,
    type: record.type,
    slug: record.slug,
    status: record.status,
    title: record.title,
    body_json: record.bodyJson == null ? null : JSON.stringify(record.bodyJson),
    fields_json: JSON.stringify(record.fieldsJson),
    published_at: record.publishedAt,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    version: record.version,
  };
}

/** The `entry_revisions` row for one audit entry. */
export function toRevisionRow(revision: EntryRevisionInput): Insertable<EntryRevisionTableRow> {
  return {
    entry_id: revision.entryId,
    workspace_id: revision.workspaceId,
    op: revision.op,
    state_json: JSON.stringify(revision.stateJson),
    actor_id: revision.actorId,
    delegated_by_workspace_id: revision.delegatedByWorkspaceId,
    delegated_by_id: revision.delegatedById,
    recorded_at: revision.recordedAt,
  };
}
