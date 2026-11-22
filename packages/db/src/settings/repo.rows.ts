import type { Generated, Insertable, Selectable } from "kysely";
import type { JsonValue } from "@jini-ai/core/primitives";
import type {
  DefinitionStatus,
  RevisionEntityKind,
  RevisionOp,
  SettingDefinitionRecord,
  SettingRevisionRecord,
  SettingScope,
  SettingValueRecord,
  SettingValueSchema,
  ValueState,
} from "@jini-ai/core/settings";

/** Stored column shapes, copied without schema changes; table names are host-owned (see `SettingsTables`). */
export interface SettingDefinitionsTable {
  setting_id: string;
  version: Generated<number>;
  workspace_id: string | null;
  namespace: string;
  key: string;
  owner_kind: string;
  owner_id: string | null;
  schema_json: string;
  default_json: string | null;
  scopes: number;
  secret: Generated<number>;
  status: string;
  alias_of_key: string | null;
  alias_of_ns: string | null;
  coercion_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface SettingRevisionsTable {
  seq: Generated<number>;
  entity_kind: string;
  setting_id: string;
  scope: string | null;
  workspace_id: string | null;
  principal_id: string | null;
  op: string;
  before_json: string | null;
  after_json: string | null;
  def_version: number;
  actor: string;
  origin_plugin_id: string | null;
  change_set_id: string | null;
  created_at: string;
}

export interface SettingValuesGlobalTable {
  setting_id: string;
  value_json: string | null;
  state: Generated<string>;
  def_version: number;
  seq: number;
  updated_by: string;
  updated_at: string;
  origin_plugin_id: string | null;
}

export interface SettingValuesWorkspaceTable {
  setting_id: string;
  workspace_id: string;
  value_json: string | null;
  state: Generated<string>;
  def_version: number;
  seq: number;
  updated_by: string;
  updated_at: string;
  origin_plugin_id: string | null;
}

export interface SettingValuesUserTable {
  setting_id: string;
  workspace_id: string;
  principal_id: string;
  value_json: string | null;
  state: Generated<string>;
  def_version: number;
  seq: number;
  updated_by: string;
  updated_at: string;
  origin_plugin_id: string | null;
}

/** The columns every value table shares. */
export type ValueRow = Pick<
  Selectable<SettingValuesGlobalTable>,
  "setting_id" | "value_json" | "state" | "def_version" | "seq" | "updated_by" | "updated_at" | "origin_plugin_id"
>;

/**
 * `coercion_json` holds the coercer tag as a JSON string (`"identity"`): the column is jsonb on
 * Postgres, which rejects a bare tag. A SQLite row written before that holds the bare tag itself;
 * migration `0003_coercion_json_as_json` rewrites those, and this still reads one as-is.
 */
function decodeCoercionTag({ text }: { text: string | null }, _optional: Record<string, never> = {}): string | null {
  if (text == null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "string" ? parsed : text;
  } catch {
    return text;
  }
}

export function toDefinitionRecord(row: Selectable<SettingDefinitionsTable>): SettingDefinitionRecord {
  return {
    settingId: row.setting_id,
    version: row.version,
    workspaceId: row.workspace_id,
    namespace: row.namespace,
    key: row.key,
    ownerKind: row.owner_kind as SettingDefinitionRecord["ownerKind"],
    ownerId: row.owner_id,
    schema: JSON.parse(row.schema_json) as SettingValueSchema,
    defaultValue: row.default_json == null ? null : (JSON.parse(row.default_json) as JsonValue),
    scopes: row.scopes,
    secret: Number(row.secret) === 1,
    status: row.status as DefinitionStatus,
    aliasOfNamespace: row.alias_of_ns,
    aliasOfKey: row.alias_of_key,
    coercionTag: decodeCoercionTag({ text: row.coercion_json }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Every definition column an upsert may rewrite: all but the identity (`setting_id`, `version`) and `created_at`. */
export function toDefinitionUpdate({ record }: { record: SettingDefinitionRecord }, _optional: Record<string, never> = {}) {
  return {
    workspace_id: record.workspaceId,
    namespace: record.namespace,
    key: record.key,
    owner_kind: record.ownerKind,
    owner_id: record.ownerId,
    schema_json: JSON.stringify(record.schema),
    default_json: record.defaultValue == null ? null : JSON.stringify(record.defaultValue),
    scopes: record.scopes,
    secret: record.secret ? 1 : 0,
    status: record.status,
    alias_of_key: record.aliasOfKey,
    alias_of_ns: record.aliasOfNamespace,
    coercion_json: record.coercionTag == null ? null : JSON.stringify(record.coercionTag),
    updated_at: record.updatedAt,
  };
}

export function toDefinitionRow({ record }: { record: SettingDefinitionRecord }, _optional: Record<string, never> = {}): Insertable<SettingDefinitionsTable> {
  return { setting_id: record.settingId, version: record.version, created_at: record.createdAt, ...toDefinitionUpdate({ record }) };
}

export function toValueRecord(
  { row, scope, workspaceId, principalId }: { row: ValueRow; scope: SettingScope; workspaceId: string | null; principalId: string | null },
  _optional: Record<string, never> = {},
): SettingValueRecord {
  return {
    settingId: row.setting_id,
    scope,
    workspaceId,
    principalId,
    valueJson: row.value_json == null ? null : (JSON.parse(row.value_json) as JsonValue),
    state: row.state as ValueState,
    defVersion: row.def_version,
    seq: row.seq,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
    originPluginId: row.origin_plugin_id,
  };
}

/** The columns every value table shares, as written. `state='set'` always serializes the value (even
 *  JSON `null`) as text so it's distinguishable from a SQL-NULL 'cleared' row. */
export function valueColumns({ record }: { record: SettingValueRecord }, _optional: Record<string, never> = {}) {
  return {
    value_json: record.state === "cleared" ? null : JSON.stringify(record.valueJson),
    state: record.state,
    def_version: record.defVersion,
    seq: record.seq,
    updated_by: record.updatedBy,
    updated_at: record.updatedAt,
    origin_plugin_id: record.originPluginId,
  };
}

export function toRevisionRecord(row: Selectable<SettingRevisionsTable>): SettingRevisionRecord {
  return {
    seq: row.seq,
    entityKind: row.entity_kind as RevisionEntityKind,
    settingId: row.setting_id,
    scope: row.scope as SettingScope | null,
    workspaceId: row.workspace_id,
    principalId: row.principal_id,
    op: row.op as RevisionOp,
    beforeJson: row.before_json == null ? null : (JSON.parse(row.before_json) as JsonValue),
    afterJson: row.after_json == null ? null : (JSON.parse(row.after_json) as JsonValue),
    defVersion: row.def_version,
    actor: row.actor,
    originPluginId: row.origin_plugin_id,
    changeSetId: row.change_set_id,
    createdAt: row.created_at,
  };
}
