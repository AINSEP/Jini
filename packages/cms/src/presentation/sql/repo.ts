import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import type { Kysely } from "kysely";
import type { PresentationSettingsRecord, PresentationSettingsRepoPort } from "../presentation.js";
import {
  type PresentationSettingsTableViews,
  type PresentationSqlRequired,
  type PresentationTables,
  toPresentationRecord,
  toPresentationRow,
} from "./repo.rows.js";

/**
 * @file THE presentation-settings repository: one Kysely query body for every database the storage
 * kernel drives (SQLite, PGlite, Postgres). One row per workspace; `save` upserts on `workspace_id`.
 * Every statement goes through `kernel.run` and is awaited. The table name is host-owned.
 */
export class SqlPresentationSettingsRepo implements PresentationSettingsRepoPort {
  protected readonly kernel: StorageKernel<Kysely<unknown>, unknown>;
  protected readonly tables: PresentationTables;
  constructor({ kernel, tables }: PresentationSqlRequired, _optional: Record<string, never> = {}) {
    this.kernel = kernel;
    this.tables = tables;
  }

  async findByWorkspaceId({ workspaceId }: { workspaceId: string }): Promise<PresentationSettingsRecord | null> {
    const row = await this.kernel.run((db) =>
      db
        .withTables<PresentationSettingsTableViews>()
        .selectFrom(this.tables.presentationSettings)
        .selectAll()
        .where("workspace_id", "=", workspaceId)
        .limit(1)
        .executeTakeFirst()
    );
    return row ? toPresentationRecord(row) : null;
  }

  async save(record: PresentationSettingsRecord): Promise<void> {
    const row = toPresentationRow(record);
    await this.kernel.run((db) =>
      db
        .withTables<PresentationSettingsTableViews>()
        .insertInto(this.tables.presentationSettings)
        .values(row)
        .onConflict((oc) =>
          oc.column("workspace_id").doUpdateSet({ active_theme_id: row.active_theme_id, updated_at: row.updated_at })
        )
        .execute()
    );
  }

  async listAll(): Promise<PresentationSettingsRecord[]> {
    const rows = await this.kernel.run((db) =>
      db.withTables<PresentationSettingsTableViews>().selectFrom(this.tables.presentationSettings).selectAll().execute()
    );
    return rows.map(toPresentationRecord);
  }
}
