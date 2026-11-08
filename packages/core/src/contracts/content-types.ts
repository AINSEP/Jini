/** @agent-note Types only. The runtime parts come from the host; this area usually from `@jini-ai/cms`. */



export type IndexableFieldKind = "text" | "integer" | "real" | "boolean" | "datetime" | "relation";


export type ContentTypeFieldKind = "text" | "integer" | "real" | "boolean" | "datetime" | "relation" | "json";


export interface ContentTypeFieldDef {
  name: string;
  kind: ContentTypeFieldKind;
  required: boolean;
  queryable: boolean;
}


export type ContentTypeStatus = "active" | "deprecated" | "tombstone";


/** Sample schema, expressed as the package's in-memory record shape (repo-agnostic). */
export interface ContentTypeRecord {
  workspaceId: string;
  key: string;
  label: string;
  fields: ContentTypeFieldDef[];
  status: ContentTypeStatus;
  version: number;
  tombstonedAt?: string | null;
  /**
   * The `fieldsJson.ext.<owner>` namespace every entry of this type is stored under. Absent means
   * `"site"`, so every type registered before this property existed keeps its envelope unchanged.
   * It belongs to the TYPE, not to whoever writes an entry: `entries/write-service.ts` reads it off
   * the owning type, so no caller can validate a payload under the wrong namespace and mint a row
   * the type's real reader can never parse (found 2026-09-19: the generic entries route passed no
   * owner and wrote `ext.site` rows into a widget-owned type). Set only by code that registers its
   * own type (`registerContentType`'s optional `owner`); the agent tool and HTTP surfaces never
   * pass it.
   */
  owner?: string;
}
