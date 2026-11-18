import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import type { Kysely, Selectable } from "kysely";
import type { PresentationSettingsRecord } from "../presentation.js";

/**
 * @file Row mapping for `presentation_settings`, shared by every dialect (the generated
 * `ContentDatabase` snake_case columns). Neutral on purpose — no repo, no driver. The column set is copied from the
 * host's generated schema in the same key order; the host's own type-level pin fails if a later copy drifts from it.
 * The table NAME is host-owned ({@link PresentationTables}).
 */

export interface PresentationSettingsTableRow {
  workspace_id: string;
  active_theme_id: string;
  updated_at: string;
}

/** Host-owned table name. No schema or product table defaults live in the adapter. */
export interface PresentationTables { presentationSettings: string }
export interface PresentationSqlRequired { kernel: StorageKernel<Kysely<unknown>, unknown>; tables: PresentationTables }
/** Type alias of `Record<string, Row>`, not an interface: Kysely's `withTables` needs the implicit index signature. */
export type PresentationSettingsTableViews = Record<string, PresentationSettingsTableRow>;

/** One `presentation_settings` row as a {@link PresentationSettingsRecord}. */
export function toPresentationRecord(row: Selectable<PresentationSettingsTableRow>): PresentationSettingsRecord {
  return {
    workspaceId: row.workspace_id,
    activeThemeId: row.active_theme_id,
    updatedAt: row.updated_at,
  };
}

/** The `presentation_settings` row `save` upserts. */
export function toPresentationRow(record: PresentationSettingsRecord): PresentationSettingsTableRow {
  return {
    workspace_id: record.workspaceId,
    active_theme_id: record.activeThemeId,
    updated_at: record.updatedAt,
  };
}
