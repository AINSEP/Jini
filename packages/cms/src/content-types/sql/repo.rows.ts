import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import type { Generated, Insertable, Kysely, Selectable } from "kysely";
import type { ContentTypeFieldDef, ContentTypeRecord, ContentTypeStatus } from "../types.js";
import type { ContentTypeRevisionInput } from "../write-service.js";

/**
 * @file Row mapping for the host's content-type and content-type-revision tables, shared by every dialect: the
 * columns are copied from the host's generated schema in the same key order (snake_case, JSON as text); the host's own
 * type-level pin fails if a later copy drifts from it. Neutral on purpose — no repo, no driver. The table NAMES and
 * the declared owners are host-owned ({@link ContentTypeSqlRequired}).
 */

export interface ContentTypeTableRow {
  id: string;
  workspace_id: string;
  key: string;
  label: string;
  fields_json: string;
  status: string;
  version: number;
  tombstoned_at: string | null;
}

export interface ContentTypeRevisionTableRow {
  seq: Generated<number>;
  content_type_key: string;
  workspace_id: string;
  op: string;
  state_json: string;
  actor_id: string;
  principal_kind: string | null;
  delegated_by_workspace_id: string | null;
  delegated_by_id: string | null;
  recorded_at: string;
}

/** Host-owned table names. No schema or product table defaults live in the adapter. */
export interface ContentTypeTables { contentTypes: string; revisions: string }

/**
 * The owner lookup is DATA, not a callback: the host chooses the table and the declared owners, never the rule.
 * `declaredOwners` maps a content-type key to the envelope owner of every type whose owner is not the default
 * `"site"`; a host that passes `{}` stores only `site`-owned types.
 */
export interface ContentTypeSqlRequired {
  kernel: StorageKernel<Kysely<unknown>, unknown>;
  tables: ContentTypeTables;
  declaredOwners: Readonly<Record<string, string>>;
}

/** Type aliases of `Record<string, Row>`, not interfaces: Kysely's `withTables` needs the implicit index signature. */
export type ContentTypeTableViews = Record<string, ContentTypeTableRow>;
export type ContentTypeRevisionTableViews = Record<string, ContentTypeRevisionTableRow>;

/** `ContentTypeRecord` has no surrogate id, so the row's primary key is `${workspaceId}::${key}`. */
export function syntheticId({ workspaceId, key }: { workspaceId: string; key: string }, _optional = {}): string {
  return `${workspaceId}::${key}`;
}

/** The columns an existing row's save replaces — everything but the match key `id`. */
export function updatableColumns(row: Insertable<ContentTypeTableRow>) {
  return {
    workspace_id: row.workspace_id,
    key: row.key,
    label: row.label,
    fields_json: row.fields_json,
    status: row.status,
    version: row.version,
    tombstoned_at: row.tombstoned_at,
  };
}

/** The `content_type_revisions` row `appendRevision` writes (`seq` is database-assigned). */
export function toRevisionRow(revision: ContentTypeRevisionInput, _optional: Record<string, never> = {}): Insertable<ContentTypeRevisionTableRow> {
  return {
    content_type_key: revision.contentTypeKey,
    workspace_id: revision.workspaceId,
    op: revision.op,
    state_json: JSON.stringify(revision.stateJson),
    actor_id: revision.actorId,
    principal_kind: revision.principalKind,
    delegated_by_workspace_id: revision.delegatedByWorkspaceId,
    delegated_by_id: revision.delegatedById,
    recorded_at: revision.recordedAt,
  };
}

/** The row mappers a repository needs; `toRecord` and `toRow` depend on the host's declared owners. */
export interface ContentTypeRowMapper {
  toRecord(row: Selectable<ContentTypeTableRow>): ContentTypeRecord;
  toRow(record: ContentTypeRecord): Insertable<ContentTypeTableRow>;
  toRevisionRow: typeof toRevisionRow;
  updatableColumns: typeof updatableColumns;
}

/**
 * The row mappers over `declaredOwners`. The lookup stays `Object.prototype.hasOwnProperty.call` (never
 * `declaredOwners[key]` alone: a type keyed `constructor` must have no owner).
 */
export function contentTypeRowMapper({ declaredOwners }: { declaredOwners: Readonly<Record<string, string>> }, _optional: Record<string, never> = {}): ContentTypeRowMapper {
  const declaredOwnerFor = (key: string): string | undefined => (Object.prototype.hasOwnProperty.call(declaredOwners, key) ? declaredOwners[key] : undefined);

  /**
   * One content-type row as a {@link ContentTypeRecord}. The envelope `owner` has no column: it is
   * restored from the declared owners (a code fact for code-registered types), and left off entirely
   * for every other type so those records stay byte-identical to before `owner` existed.
   */
  function toRecord(row: Selectable<ContentTypeTableRow>): ContentTypeRecord {
    const owner = declaredOwnerFor(row.key);
    return {
      workspaceId: row.workspace_id,
      key: row.key,
      label: row.label,
      fields: JSON.parse(row.fields_json) as ContentTypeFieldDef[],
      status: row.status as ContentTypeStatus,
      version: row.version,
      tombstonedAt: row.tombstoned_at,
      ...(owner !== undefined ? { owner } : {}),
    };
  }

  /**
   * `toRecord`'s inverse: the exact column values one whole-row save persists (compact JSON text).
   * Throws for an `owner` that the declared owners would not restore on read: with no column to hold
   * it, saving would drop it silently and the next read would validate that type's entries under the
   * wrong namespace.
   */
  function toRow(record: ContentTypeRecord): Insertable<ContentTypeTableRow> {
    if (record.owner !== undefined && record.owner !== declaredOwnerFor(record.key)) {
      const declared = Object.entries(declaredOwners).map(([key, owner]) => `${key}=${owner}`).join(", ");
      throw new Error(`content type '${record.key}' declares owner '${record.owner}', but only these code-declared owners can be stored: ${declared}`);
    }
    return {
      id: syntheticId({ workspaceId: record.workspaceId, key: record.key }),
      workspace_id: record.workspaceId,
      key: record.key,
      label: record.label,
      fields_json: JSON.stringify(record.fields),
      status: record.status,
      version: record.version,
      tombstoned_at: record.tombstonedAt ?? null,
    };
  }

  return { toRecord, toRow, toRevisionRow, updatableColumns };
}
