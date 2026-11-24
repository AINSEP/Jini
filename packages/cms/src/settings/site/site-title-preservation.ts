import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import type { UUID } from "@jini-ai/core/primitives";
import type { Kysely } from "kysely";

/**
 * @file SPEC-050 (NC-3 = A): THE `SiteTitlePreservationStorePort` adapter over the host's
 * pre-existing-workspace marker table, one Kysely query body for every dialect (storage plan §4).
 * The marker migration inserts one row per workspace that existed when it ran, with `preserved_at`
 * NULL. Nothing else inserts. A row is pending until the pin sets `preserved_at`.
 * The host composes it directly from its composed storage kernel and names the table.
 */

/**
 * The pre-existing-workspace marker (REQ-06, NC-3 = A). A workspace is recorded once, by the schema
 * migration, and stays pending until the pin writes or skips it. The SQL adapter reads the
 * migration's table; the in-memory composition root has no pre-existing workspaces (EC-03).
 */
export interface SiteTitlePreservationStorePort {
  /** Recorded workspaces whose pin has not landed yet, sorted by id. */
  listPendingWorkspaceIds(): Promise<UUID[]>;
  /** True only for a recorded workspace whose pin has not landed yet. */
  isPending(required: { workspaceId: UUID }, optional?: Record<string, never>): Promise<boolean>;
  /** Resolves one pending workspace. A no-op for an unrecorded or already resolved id. */
  markPreserved(required: { workspaceId: UUID; preservedAt: string }): Promise<void>;
}

/** Row shape the adapter reads and writes in the host's marker table. */
export interface SiteTitlePreexistingWorkspaceRow { workspace_id: string; preserved_at: string | null }

/** Host-owned table name, quoted by Kysely; no product table default lives in the adapter. */
export interface SiteTitlePreservationTables { preexistingWorkspaces: string }
export interface SiteTitlePreservationSqlRequired {
  kernel: StorageKernel<Kysely<unknown>, unknown>;
  tables: SiteTitlePreservationTables;
}

export class SqlSiteTitlePreservationStore implements SiteTitlePreservationStorePort {
  protected readonly kernel: StorageKernel<Kysely<unknown>, unknown>;
  protected readonly tables: SiteTitlePreservationTables;

  /** Binds a storage kernel to the host's marker table; the table name has no default. */
  constructor({ kernel, tables }: SiteTitlePreservationSqlRequired, _optional: Record<string, never> = {}) {
    this.kernel = kernel;
    this.tables = tables;
  }

  /** @complexity O(p log p) for p recorded workspaces (one per workspace that existed at migration time). */
  async listPendingWorkspaceIds(): Promise<string[]> {
    const rows = await this.kernel.run((db) =>
      db
        .withTables<Record<string, SiteTitlePreexistingWorkspaceRow>>()
        .selectFrom(this.tables.preexistingWorkspaces)
        .select("workspace_id")
        .where("preserved_at", "is", null)
        .orderBy("workspace_id")
        .execute()
    );
    return rows.map((row) => row.workspace_id);
  }

  /** @complexity O(log n), one primary-key lookup. */
  async isPending({ workspaceId }: { workspaceId: string }, _optional: Record<string, never> = {}): Promise<boolean> {
    const row = await this.kernel.run((db) =>
      db
        .withTables<Record<string, SiteTitlePreexistingWorkspaceRow>>()
        .selectFrom(this.tables.preexistingWorkspaces)
        .select("workspace_id")
        .where("workspace_id", "=", workspaceId)
        .where("preserved_at", "is", null)
        .limit(1)
        .executeTakeFirst()
    );
    return row !== undefined;
  }

  /** @complexity O(log n), one primary-key update. */
  async markPreserved(required: { workspaceId: string; preservedAt: string }): Promise<void> {
    await this.kernel.run((db) =>
      db
        .withTables<Record<string, SiteTitlePreexistingWorkspaceRow>>()
        .updateTable(this.tables.preexistingWorkspaces)
        .set({ preserved_at: required.preservedAt })
        .where("workspace_id", "=", required.workspaceId)
        .where("preserved_at", "is", null)
        .execute()
    );
  }
}
