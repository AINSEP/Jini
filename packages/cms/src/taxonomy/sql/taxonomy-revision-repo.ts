import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import type { Kysely } from "kysely";
import type { TaxonomyRevisionRepoPort, TaxonomyRevisionRow } from "../write-service.js";
import { type RevisionTableViews, type TaxonomySqlRequired, type TaxonomyTables, toTaxonomyRevisionRow } from "./repo.rows.js";

/**
 * @file The append-only taxonomy revision ledger on the storage kernel; workspace-scoped at
 * construction like the other taxonomy repositories. Table names are host-owned.
 */
export class SqlTaxonomyRevisionRepo implements TaxonomyRevisionRepoPort {
  protected readonly kernel: StorageKernel<Kysely<unknown>, unknown>;
  protected readonly tables: TaxonomyTables;
  protected readonly workspaceId: string;
  constructor({ kernel, tables, workspaceId }: TaxonomySqlRequired, _optional: Record<string, never> = {}) {
    this.kernel = kernel;
    this.tables = tables;
    this.workspaceId = workspaceId;
  }

  async insert(row: TaxonomyRevisionRow): Promise<unknown> {
    await this.kernel.run((db) =>
      db
        .withTables<RevisionTableViews>()
        .insertInto(this.tables.taxonomyRevisions)
        .values(toTaxonomyRevisionRow({ workspaceId: this.workspaceId, row }))
        .execute()
    );
    return row;
  }

  /** Test-only helper: the append-only revision ledger for one taxonomy, in seq order. */
  async listForTests({ taxonomyId }: { taxonomyId: string }): Promise<TaxonomyRevisionRow[]> {
    const rows = await this.kernel.run((db) =>
      db
        .withTables<RevisionTableViews>()
        .selectFrom(this.tables.taxonomyRevisions)
        .selectAll()
        .where("workspace_id", "=", this.workspaceId)
        .where("taxonomy_id", "=", taxonomyId)
        .orderBy("seq", "asc")
        .execute()
    );
    return rows.map((r) => ({
      taxonomyId: r.taxonomy_id,
      op: r.op as TaxonomyRevisionRow["op"],
      previousState: r.previous_state_json == null ? null : (JSON.parse(r.previous_state_json) as Record<string, unknown>),
      actorId: r.actor_id,
      recordedAt: r.recorded_at,
    }));
  }
}
