import type { Insertable, Selectable } from "kysely";

/** Storage columns are the existing plugin_activations wire schema; no generated product DTO. */
export interface PluginActivationTable {
  workspace_id: string; plugin_id: string; version: string; enabled: boolean | number;
  updated_at: string; quarantined_at: string | null; quarantine_reason: string | null;
  quarantine_failure_count: number | null;
}
import { toBool } from "@jini-ai/db/kernel";
import type { PluginActivationRecord } from "../activation.js";

/**
 * @file Row mapping for `plugin_activations`, shared by every dialect (the generated
 * `ContentDatabase` snake_case columns; `enabled` is a boolean read through `toBool`). Neutral on
 * purpose — no repo, no driver.
 */

export type PluginActivationRow = Selectable<PluginActivationTable>;

/** One `plugin_activations` row as a {@link PluginActivationRecord}; NULL quarantine columns are omitted. */
export function toActivationRecord({ row }: { row: PluginActivationRow }, _optional: Record<string, never> = {}): PluginActivationRecord {
  return {
    pluginId: row.plugin_id,
    workspaceId: row.workspace_id,
    version: row.version,
    enabled: toBool(row.enabled) === true,
    updatedAt: row.updated_at,
    ...(row.quarantined_at === null ? {} : { quarantinedAt: row.quarantined_at }),
    ...(row.quarantine_reason === null ? {} : { quarantineReason: row.quarantine_reason }),
    ...(row.quarantine_failure_count === null ? {} : { quarantineFailureCount: row.quarantine_failure_count }),
  };
}

/** The `plugin_activations` row `save` upserts; absent quarantine fields are written as NULL. */
export function toActivationRow({ record }: { record: PluginActivationRecord }, _optional: Record<string, never> = {}): Insertable<PluginActivationTable> {
  return {
    workspace_id: record.workspaceId,
    plugin_id: record.pluginId,
    version: record.version,
    enabled: record.enabled,
    updated_at: record.updatedAt,
    quarantined_at: record.quarantinedAt ?? null,
    quarantine_reason: record.quarantineReason ?? null,
    quarantine_failure_count: record.quarantineFailureCount ?? null,
  };
}
