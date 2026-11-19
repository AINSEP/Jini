import type { Generated } from "kysely";

/** Region-binding table names are a required host choice. */
export interface WidgetsTables { regionBindings: string; }
/** Local narrow SQL row; widgets never imports a host-generated database schema. */
export interface WidgetRegionBindingsTable {
  workspace_id: string;
  region_key: string;
  area_entry_id: string;
  updated_at: string;
}
export type WidgetsDatabase = Record<string, WidgetRegionBindingsTable>;

/** Host-owned name for the derived entry-reference index. */
export interface EntryRefsTables { entryRefs: string; }
/** Narrow persisted row; matches the host-generated seven-column schema. */
export interface EntryRefsSqlRow {
  id: Generated<number>;
  workspace_id: string;
  source_entry_id: string;
  source_kind: string;
  field_path: string;
  target_kind: string;
  target_id: string;
}
