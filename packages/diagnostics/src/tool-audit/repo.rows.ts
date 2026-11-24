import type { Generated } from "kysely";

/**
 * @file Stored column shape of the tool-attempt audit table, copied without schema changes in the
 * generated key order of the host's content database types. The table name is host-owned (see
 * `ToolAttemptTables`).
 */
export interface AgentToolAttemptsTable {
  id: Generated<number>;
  attempt_id: string;
  execution_id: string | null;
  workspace_id: string;
  run_id: string;
  tool_id: string;
  principal_id: string;
  phase: string;
  at: string;
  detail: string | null;
}
