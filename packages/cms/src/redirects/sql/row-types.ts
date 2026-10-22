import type { Generated } from "kysely";

/** Stored column shapes copied without schema changes; table names are host-owned. */
export interface RedirectsTable {
  id: string;
  workspace_id: string;
  match_type: string;
  from_pattern: string;
  to_target: string;
  status_code: number;
  status: string;
  override: number;
  priority: number;
  source: string;
  source_entry_id: string | null;
  from_path_at_capture: string | null;
  to_path_at_capture: string | null;
  created_by_principal: string;
  created_by_plugin_id: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface RedirectRevisionsTable {
  id: Generated<number>;
  redirect_id: string;
  workspace_id: string;
  seq: number;
  state_json: string;
  tombstoned: number;
  actor_id: string;
  plugin_id: string | null;
  recorded_at: string;
}

