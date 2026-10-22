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
