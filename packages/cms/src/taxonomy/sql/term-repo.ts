import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import type { Kysely } from "kysely";
import type { TermListPort } from "../list.js";
import type { TermPublishReadPort } from "../read-ports.js";
import type { ImportableTermRepoPort, Term, TermRepoPort } from "../write-service.js";
import { termIsLive } from "./liveness.js";
import { type LiveJoinTableViews, type TaxonomySqlRequired, type TaxonomyTables, type TermTableViews, toTerm, toTermRow } from "./repo.rows.js";

/**
 * @file THE term repository: one Kysely query body for every database the storage kernel drives.
 * `SqlTermRepo` satisfies the `taxonomy` package's write/list ports, workspace-scoped at construction.
 * A term is hidden by its own trash marker AND by its taxonomy's (`./liveness.ts`); every read that
 * must see through a trashed row is named on its method.
 */
export class SqlTermRepo implements TermRepoPort, TermListPort, ImportableTermRepoPort, TermPublishReadPort {
  protected readonly kernel: StorageKernel<Kysely<unknown>, unknown>;
  protected readonly tables: TaxonomyTables;
  protected readonly workspaceId: string;
  constructor({ kernel, tables, workspaceId }: TaxonomySqlRequired, _optional: Record<string, never> = {}) {
    this.kernel = kernel;
    this.tables = tables;
    this.workspaceId = workspaceId;
  }

  async insert(row: Term): Promise<unknown> {
    await this.kernel.run((db) =>
      db.withTables<TermTableViews>().insertInto(this.tables.terms).values(toTermRow({ workspaceId: this.workspaceId, row })).execute()
    );
    return row;
  }

  /** `where`-guarded: a stale rename can never write over an already-trashed row, so
   *  `renameTerm` (`@jini-ai/cms/taxonomy`) silently no-ops against a trashed term rather than
   *  reviving it with a new name. A 0-row update is not an error: `renameTerm`'s own `findById` (also
   *  trash-filtered) already turns a trashed term into a 404 before this runs; this is defense in
   *  depth against a race between that read and this write. */
  async update(row: Term): Promise<unknown> {
    await this.kernel.run((db) =>
      db
        .withTables<LiveJoinTableViews>()
        .updateTable(this.tables.terms)
        .set({
          taxonomy_id: row.taxonomyId,
          parent_id: row.parentId,
          name: row.name,
          status: row.status,
          updated_at: row.updatedAt,
          version: row.version,
        })
        .where("workspace_id", "=", this.workspaceId)
        .where("id", "=", row.id)
        .where(termIsLive({ tables: this.tables }))
        .execute()
    );
    return row;
  }

  async findById({ id }: { id: string }): Promise<{ id: string; taxonomyId: string; name?: string } | null> {
    const row = await this.findLive({ id });
    return row ? { id: row.id, taxonomyId: row.taxonomyId, name: row.name } : null;
  }

  /** `ImportableTermRepoPort` (`importTerm`'s CAS read) — the full live row. */
  async findByIdFull({ id }: { id: string }): Promise<Term | null> {
    return this.findLive({ id });
  }

  /** Publish-content's read: the full row even when trashed (see `SqlTaxonomyRepo.findAnyById`). */
  async findAnyById({ id }: { id: string }): Promise<Term | null> {
    const row = await this.kernel.run((db) =>
      db
        .withTables<TermTableViews>()
        .selectFrom(this.tables.terms)
        .selectAll()
        .where("workspace_id", "=", this.workspaceId)
        .where("id", "=", id)
        .limit(1)
        .executeTakeFirst()
    );
    return row ? toTerm(row) : null;
  }

  async listByTaxonomy(params: { taxonomyId: string }): Promise<Term[]> {
    const rows = await this.kernel.run((db) =>
      db
        .withTables<LiveJoinTableViews>()
        .selectFrom(this.tables.terms)
        .selectAll()
        .where("workspace_id", "=", this.workspaceId)
        .where("taxonomy_id", "=", params.taxonomyId)
        .where(termIsLive({ tables: this.tables }))
        .execute()
    );
    return rows.map(toTerm);
  }

  /** Trash display read for a host's trash-term flow — the term's own name plus its taxonomy's
   *  name, the same join a generic Trash listing uses for display. Excludes
   *  an already-trashed term (own marker or taxonomy trashed). @complexity O(1) plus the join's index. */
  async findForTrash(
    { id }: { id: string }
  ): Promise<{ id: string; name: string; taxonomyId: string; taxonomyName: string; version: number } | null> {
    const { terms, taxonomies } = this.tables;
    const row = await this.kernel.run((db) =>
      db
        .withTables<LiveJoinTableViews>()
        .selectFrom(terms)
        .innerJoin(taxonomies, `${taxonomies}.id` as const, `${terms}.taxonomy_id` as const)
        .select([
          `${terms}.id as id` as const,
          `${terms}.name as name` as const,
          `${terms}.taxonomy_id as taxonomyId` as const,
          `${taxonomies}.name as taxonomyName` as const,
          `${terms}.version as version` as const,
        ])
        .where(`${terms}.workspace_id` as const, "=", this.workspaceId)
        .where(`${terms}.id` as const, "=", id)
        .where(termIsLive({ tables: this.tables }))
        .limit(1)
        .executeTakeFirst()
    );
    return row ?? null;
  }

  /** Purge-audit read for a host's term `beforePurge` hook — deliberately
   *  trash-BLIND, unlike every other read on this class: a purge only ever runs on a row that is
   *  already hidden, so a live filter would return `null` exactly when the follow-up needs the term's
   *  name/taxonomy for the revision it is about to write. @complexity O(1). */
  async findForPurgeAudit({ id }: { id: string }): Promise<{ id: string; name: string; taxonomyId: string } | null> {
    const row = await this.findAnyById({ id });
    return row ? { id: row.id, name: row.name, taxonomyId: row.taxonomyId } : null;
  }

  /** Purge-audit read for the taxonomy `beforePurge` hook — the ids of EVERY member term regardless
   *  of status, because the taxonomy `purgeFirst` cascade physically deletes all of them, whether or
   *  not each carries its own trash marker. `listByTaxonomy` cannot serve this: it excludes rows under
   *  an already-trashed taxonomy, which is always true by the time a purge runs. */
  async listIdsForPurgeAudit({ taxonomyId }: { taxonomyId: string }): Promise<string[]> {
    const rows = await this.kernel.run((db) =>
      db
        .withTables<TermTableViews>()
        .selectFrom(this.tables.terms)
        .select("id")
        .where("workspace_id", "=", this.workspaceId)
        .where("taxonomy_id", "=", taxonomyId)
        .execute()
    );
    return rows.map((row) => row.id);
  }

  /** Ancestor-chain lookup for `wouldCreateCycle` (`@jini-ai/cms/taxonomy`) — mirrors
   *  `InMemoryTermRepo.getParentId`'s optional seam. Async since a query
   *  can no longer be a synchronous terminal. Trash-blind, like the original. */
  async getParentId({ termId }: { termId: string }): Promise<string | null> {
    const row = await this.findAnyById({ id: termId });
    return row?.parentId ?? null;
  }

  /** `DeletableTermRepoPort` (`@jini-ai/cms/taxonomy`) — additive capability behind `deleteTerm`. */
  async delete({ id }: { id: string }): Promise<void> {
    await this.kernel.run((db) =>
      db.withTables<TermTableViews>().deleteFrom(this.tables.terms).where("workspace_id", "=", this.workspaceId).where("id", "=", id).execute()
    );
  }

  /** `DeletableTermRepoPort.countChildren` — direct children only (one level), workspace-scoped. */
  async countChildren(params: { parentId: string }): Promise<number> {
    const row = await this.kernel.run((db) =>
      db
        .withTables<TermTableViews>()
        .selectFrom(this.tables.terms)
        .select((eb) => eb.fn.countAll().as("n"))
        .where("workspace_id", "=", this.workspaceId)
        .where("parent_id", "=", params.parentId)
        .executeTakeFirst()
    );
    return Number(row?.n ?? 0);
  }

  private async findLive({ id }: { id: string }): Promise<Term | null> {
    const row = await this.kernel.run((db) =>
      db
        .withTables<LiveJoinTableViews>()
        .selectFrom(this.tables.terms)
        .selectAll()
        .where("workspace_id", "=", this.workspaceId)
        .where("id", "=", id)
        .where(termIsLive({ tables: this.tables }))
        .limit(1)
        .executeTakeFirst()
    );
    return row ? toTerm(row) : null;
  }
}
