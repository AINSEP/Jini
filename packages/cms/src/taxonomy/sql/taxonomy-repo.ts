import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import type { Kysely } from "kysely";
import type { TaxonomyPublishReadPort } from "../read-ports.js";
import type { ImportableTaxonomyRepoPort } from "../import-service.js";
import type { Taxonomy, TaxonomyRepoPort } from "../write-contracts.js";
import type { TaxonomyListPort } from "../list.js";
import { TRASH_STATUS, taxonomyLockKey } from "./liveness.js";
import { type TaxonomySqlRequired, type TaxonomyTableViews, type TaxonomyTables, toTaxonomy, toTaxonomyRow } from "./repo.rows.js";

/**
 * @file THE taxonomy repository: one Kysely query body for every database the storage kernel drives
 * (SQLite, PGlite, Postgres). `SqlTaxonomyRepo` satisfies the `taxonomy` package's write/list ports.
 * Every statement goes through `kernel.run` and is awaited; table names are host-owned.
 *
 * The certified ports never thread a `workspaceId` through their method signatures, so the class is
 * constructed workspace-scoped instead. The trash rules are in `./liveness.ts`.
 */
export class SqlTaxonomyRepo
  implements TaxonomyRepoPort, TaxonomyListPort, ImportableTaxonomyRepoPort, TaxonomyPublishReadPort
{
  protected readonly kernel: StorageKernel<Kysely<unknown>, unknown>;
  protected readonly tables: TaxonomyTables;
  protected readonly workspaceId: string;
  constructor({ kernel, tables, workspaceId }: TaxonomySqlRequired, _optional: Record<string, never> = {}) {
    this.kernel = kernel;
    this.tables = tables;
    this.workspaceId = workspaceId;
  }

  async insert(row: Taxonomy): Promise<unknown> {
    await this.kernel.run((db) =>
      db.withTables<TaxonomyTableViews>().insertInto(this.tables.taxonomies).values(toTaxonomyRow({ workspaceId: this.workspaceId, row })).execute()
    );
    return row;
  }

  async findById({ id }: { id: string }): Promise<{ id: string; hierarchical: boolean; allowList?: string[] } | null> {
    const row = await this.findLive({ id });
    return row ? { id: row.id, hierarchical: row.hierarchical } : null;
  }

  /** `ImportableTaxonomyRepoPort` (`importTaxonomy`'s CAS read) — the full live row. */
  async findByIdFull({ id }: { id: string }): Promise<Taxonomy | null> {
    return this.findLive({ id });
  }

  /** Publish-content's read: the full row even when trashed (`status` = `"trash"`), so a precheck can
   *  refuse it instead of planning a create that would collide. */
  async findAnyById({ id }: { id: string }): Promise<Taxonomy | null> {
    const row = await this.kernel.run((db) =>
      db
        .withTables<TaxonomyTableViews>()
        .selectFrom(this.tables.taxonomies)
        .selectAll()
        .where("workspace_id", "=", this.workspaceId)
        .where("id", "=", id)
        .limit(1)
        .executeTakeFirst()
    );
    return row ? toTaxonomy(row) : null;
  }

  /** `ImportableTaxonomyRepoPort` — live rows only, same no-revive guard as `SqlTermRepo.update`. */
  async update(row: Taxonomy): Promise<unknown> {
    await this.kernel.run((db) =>
      db
        .withTables<TaxonomyTableViews>()
        .updateTable(this.tables.taxonomies)
        .set({
          name: row.name,
          hierarchical: row.hierarchical ? 1 : 0,
          status: row.status,
          updated_at: row.updatedAt,
          version: row.version,
        })
        .where("workspace_id", "=", this.workspaceId)
        .where("id", "=", row.id)
        .where("status", "!=", TRASH_STATUS)
        .execute()
    );
    return row;
  }

  async list(): Promise<Taxonomy[]> {
    const rows = await this.kernel.run((db) =>
      db
        .withTables<TaxonomyTableViews>()
        .selectFrom(this.tables.taxonomies)
        .selectAll()
        .where("workspace_id", "=", this.workspaceId)
        .where("status", "!=", TRASH_STATUS)
        .execute()
    );
    return rows.map(toTaxonomy);
  }

  /** Trash display read for a host's trash-taxonomy flow — additive, not part of the certified
   *  `TaxonomyRepoPort`. Excludes an already-trashed taxonomy, like every other read here.
   *  @complexity O(1) plus whatever index the workspace/id match uses. */
  async findForTrash({ id }: { id: string }): Promise<{ id: string; name: string; version: number } | null> {
    const row = await this.findLive({ id });
    return row ? { id: row.id, name: row.name, version: row.version } : null;
  }

  /** `DeletableTaxonomyRepoPort` (`@jini-ai/cms/taxonomy`) — additive capability behind
   *  `deleteTaxonomy`, workspace-scoped like every other method on this class. */
  async delete({ id }: { id: string }): Promise<void> {
    await this.kernel.run((db) =>
      db.withTables<TaxonomyTableViews>().deleteFrom(this.tables.taxonomies).where("workspace_id", "=", this.workspaceId).where("id", "=", id).execute()
    );
  }

  /**
   * `TransactionalRepoPort` (`@jini-ai/cms/taxonomy`) — backs `deleteTerm`/`deleteTaxonomy`'s
   * guard-and-cascade atomicity: there is no FK/CASCADE at the schema level, so the transaction is the
   * only thing that can undo a mid-cascade failure, and it wraps the guard reads too so they cannot go
   * stale. Runs on the connection's kernel, so every write `terms`/`entryTerms`/`taxonomyRevisions`
   * (or the outbox) makes while `fn` runs lands inside it; nested calls join, and the workspace's
   * taxonomy lock is held to the end.
   *
   * @complexity O(1) fixed overhead plus whatever `fn` itself costs.
   */
  async transaction<T>({ fn }: { fn: () => Promise<T> }): Promise<T> {
    return this.kernel.transaction(async () => {
      await this.kernel.lockKey(taxonomyLockKey({ workspaceId: this.workspaceId }));
      return fn();
    });
  }

  private async findLive({ id }: { id: string }): Promise<Taxonomy | null> {
    const row = await this.kernel.run((db) =>
      db
        .withTables<TaxonomyTableViews>()
        .selectFrom(this.tables.taxonomies)
        .selectAll()
        .where("workspace_id", "=", this.workspaceId)
        .where("id", "=", id)
        .where("status", "!=", TRASH_STATUS)
        .limit(1)
        .executeTakeFirst()
    );
    return row ? toTaxonomy(row) : null;
  }
}
