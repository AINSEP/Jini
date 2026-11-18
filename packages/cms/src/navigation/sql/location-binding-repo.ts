import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import type { Kysely } from "kysely";
import type { NavLocationBindingRepoPort } from "../ports.js";
import type { NavLocationBindingRow, NavLocationKey } from "../types.js";
import {
  type NavigationSqlRequired,
  type NavigationTables,
  type NavLocationBindingTableViews,
  toBindingRecord,
  toBindingRow,
} from "./repo.rows.js";

/**
 * @file THE durable `NavLocationBindingRepoPort`: one Kysely query body for every dialect the storage kernel
 * drives, over the host's derived location-binding index. It adds no method beyond what its port interface
 * declares — same contract as the in-memory adapter, certified by the shared contract-test suite.
 *
 * `upsert` targets the composite `UNIQUE(workspace_id, location_key)` index — a real strengthening over the
 * in-memory adapter's single-threaded-only guarantee (the DB enforces it even under a concurrent-process race).
 * Bindings are not filtered by the bound menu's trash state: that lives with the menu repo.
 */
export class SqlNavLocationBindingRepo implements NavLocationBindingRepoPort {
  protected readonly kernel: StorageKernel<Kysely<unknown>, unknown>;
  protected readonly tables: NavigationTables;
  constructor({ kernel, tables }: NavigationSqlRequired, _optional: Record<string, never> = {}) {
    this.kernel = kernel;
    this.tables = tables;
  }

  async findByLocation(required: {
    workspaceId: string;
    locationKey: NavLocationKey;
  }): Promise<NavLocationBindingRow | null> {
    const row = await this.kernel.run((db) =>
      db
        .withTables<NavLocationBindingTableViews>()
        .selectFrom(this.tables.navLocationBindings)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("location_key", "=", required.locationKey)
        .limit(1)
        .executeTakeFirst()
    );
    return row ? toBindingRecord(row) : null;
  }

  async listByMenu(required: { workspaceId: string; menuId: string }): Promise<NavLocationBindingRow[]> {
    const rows = await this.kernel.run((db) =>
      db
        .withTables<NavLocationBindingTableViews>()
        .selectFrom(this.tables.navLocationBindings)
        .selectAll()
        .where("workspace_id", "=", required.workspaceId)
        .where("menu_id", "=", required.menuId)
        .execute()
    );
    return rows.map(toBindingRecord);
  }

  async listByWorkspace(required: { workspaceId: string }): Promise<NavLocationBindingRow[]> {
    const rows = await this.kernel.run((db) =>
      db.withTables<NavLocationBindingTableViews>().selectFrom(this.tables.navLocationBindings).selectAll().where("workspace_id", "=", required.workspaceId).execute()
    );
    return rows.map(toBindingRecord);
  }

  async upsert(required: {
    workspaceId: string;
    locationKey: NavLocationKey;
    menuId: string;
    boundAt: string;
  }): Promise<NavLocationBindingRow> {
    const row = {
      workspaceId: required.workspaceId,
      locationKey: required.locationKey,
      menuId: required.menuId,
      boundAt: required.boundAt,
    };
    await this.kernel.run((db) =>
      db
        .withTables<NavLocationBindingTableViews>()
        .insertInto(this.tables.navLocationBindings)
        .values(toBindingRow(row))
        .onConflict((oc) => oc.columns(["workspace_id", "location_key"]).doUpdateSet({ menu_id: row.menuId, bound_at: row.boundAt }))
        .execute()
    );
    return row;
  }

  async remove(required: { workspaceId: string; locationKey: NavLocationKey }): Promise<void> {
    await this.kernel.run((db) =>
      db
        .withTables<NavLocationBindingTableViews>()
        .deleteFrom(this.tables.navLocationBindings)
        .where("workspace_id", "=", required.workspaceId)
        .where("location_key", "=", required.locationKey)
        .execute()
    );
  }

  async removeByMenu(required: { workspaceId: string; menuId: string }): Promise<void> {
    await this.kernel.run((db) =>
      db
        .withTables<NavLocationBindingTableViews>()
        .deleteFrom(this.tables.navLocationBindings)
        .where("workspace_id", "=", required.workspaceId)
        .where("menu_id", "=", required.menuId)
        .execute()
    );
  }

  /**
   * Replace-whole-workspace rebuild (the index is derived + rebuildable).
   * Deletes every existing row for the workspace, then inserts the full replacement set in one
   * statement, both in one kernel transaction (a reader never sees the index half rebuilt).
   */
  async rebuildForWorkspace(required: {
    workspaceId: string;
    bindings: readonly NavLocationBindingRow[];
  }): Promise<void> {
    const { navLocationBindings } = this.tables;
    await this.kernel.transaction(async () => {
      await this.kernel.run((db) =>
        db.withTables<NavLocationBindingTableViews>().deleteFrom(navLocationBindings).where("workspace_id", "=", required.workspaceId).execute()
      );
      if (required.bindings.length === 0) return;
      await this.kernel.run((db) =>
        db.withTables<NavLocationBindingTableViews>().insertInto(navLocationBindings).values(required.bindings.map(toBindingRow)).execute()
      );
    });
  }
}
