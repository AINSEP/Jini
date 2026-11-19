import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import type { Kysely } from "kysely";
import type { AssignedTermView, EntryTermReadPort } from "../read-ports.js";
import type { EntryTermRepoPort } from "../write-contracts.js";
import type { UnassignableEntryTermRepoPort } from "../assignment-service.js";
import { taxonomyLockKey, termIsLive } from "./liveness.js";
import { type EntryTermTableViews, type LiveJoinTableViews, type TaxonomySqlRequired, type TaxonomyTables } from "./repo.rows.js";

/**
 * @file THE term-assignment repository: which terms are assigned to which content, on the storage
 * kernel. `SqlEntryTermRepo` satisfies the `taxonomy` package's assignment ports, workspace-scoped at
 * construction. Table names are host-owned. Trashing never touches these rows; the read path filters.
 */
export class SqlEntryTermRepo implements EntryTermRepoPort, EntryTermReadPort, UnassignableEntryTermRepoPort {
  protected readonly kernel: StorageKernel<Kysely<unknown>, unknown>;
  protected readonly tables: TaxonomyTables;
  protected readonly workspaceId: string;
  constructor({ kernel, tables, workspaceId }: TaxonomySqlRequired, _optional: Record<string, never> = {}) {
    this.kernel = kernel;
    this.tables = tables;
    this.workspaceId = workspaceId;
  }

  /** Idempotent upsert keyed by the table's unique (`workspace_id`, `content_type`, `content_id`,
   *  `term_id`) — mirrors `InMemoryEntryTermRepo.upsert`'s find-or-replace behavior. */
  async upsert(row: { contentType: string; contentId: string; termId: string; addedAt: string }): Promise<unknown> {
    await this.upsertRow(row);
    return row;
  }

  /** Removes every assignment of one piece of content, in the `workspaceId` the caller names (an
   *  assignment, not content). */
  async deleteByContent(params: { workspaceId: string; contentType: string; contentId: string }): Promise<number> {
    const result = await this.kernel.run((db) =>
      db
        .withTables<EntryTermTableViews>()
        .deleteFrom(this.tables.entryTerms)
        .where("workspace_id", "=", params.workspaceId)
        .where("content_type", "=", params.contentType)
        .where("content_id", "=", params.contentId)
        .executeTakeFirst()
    );
    return Number(result.numDeletedRows);
  }

  /** `UnassignableEntryTermRepoPort` (`@jini-ai/cms/taxonomy`) — additive capability for
   *  `unassignTerms`. Returns the number of rows actually removed (0 or 1, given the unique key)
   *  rather than throwing on a no-op, like `deleteByContent`. */
  async remove(row: { contentType: string; contentId: string; termId: string }): Promise<number> {
    const result = await this.kernel.run((db) =>
      db
        .withTables<EntryTermTableViews>()
        .deleteFrom(this.tables.entryTerms)
        .where("workspace_id", "=", this.workspaceId)
        .where("content_type", "=", row.contentType)
        .where("content_id", "=", row.contentId)
        .where("term_id", "=", row.termId)
        .executeTakeFirst()
    );
    return Number(result.numDeletedRows);
  }

  /**
   * `mergeTerm`'s plan-time overlap disclosure — counts content already assigned to
   * BOTH `fromTermId` and `intoTermId`. Bounded by taxonomy's own low-volume assumption (a site's
   * terms are few and their assignments modest).
   *
   * @complexity O(f + i) where f/i are the row counts for each term.
   */
  async countOverlap(params: { fromTermId: string; intoTermId: string }): Promise<number> {
    const fromRows = await this.contentOfTerm({ termId: params.fromTermId });
    const intoRows = await this.contentOfTerm({ termId: params.intoTermId });
    const intoKeys = new Set(intoRows.map((r) => `${r.content_type}::${r.content_id}`));
    return fromRows.filter((r) => intoKeys.has(`${r.content_type}::${r.content_id}`)).length;
  }

  /**
   * The actual merge execution: re-points every assignment row from `fromTermId`
   * to `intoTermId` (the upsert dedupes via the unique key, so content already assigned to both
   * collapses to one row — the disclosed loss mode `mergeTerm` names), then deletes
   * the now-empty `fromTermId` rows. One transaction under the taxonomy lock: a failure part-way
   * leaves nothing re-pointed.
   *
   * @complexity O(f) in the number of rows currently assigned to `fromTermId`.
   */
  async repointTerm(params: { fromTermId: string; intoTermId: string }): Promise<{ repointedCount: number }> {
    return this.kernel.transaction(async () => {
      await this.kernel.lockKey(taxonomyLockKey({ workspaceId: this.workspaceId }));
      const fromRows = await this.kernel.run((db) =>
        db
          .withTables<EntryTermTableViews>()
          .selectFrom(this.tables.entryTerms)
          .selectAll()
          .where("workspace_id", "=", this.workspaceId)
          .where("term_id", "=", params.fromTermId)
          .execute()
      );
      for (const row of fromRows) {
        await this.upsertRow({
          contentType: row.content_type,
          contentId: row.content_id,
          termId: params.intoTermId,
          addedAt: row.added_at,
        });
      }
      await this.kernel.run((db) =>
        db
          .withTables<EntryTermTableViews>()
          .deleteFrom(this.tables.entryTerms)
          .where("workspace_id", "=", this.workspaceId)
          .where("term_id", "=", params.fromTermId)
          .execute()
      );
      return { repointedCount: fromRows.length };
    });
  }

  /** `AssignmentCountEntryTermRepoPort` (`@jini-ai/cms/taxonomy`) — the guard `deleteTerm`/
   *  `deleteTaxonomy` use to refuse destroying a live content assignment.
   *  @complexity O(1) — one count. */
  async countByTerm(params: { termId: string }): Promise<number> {
    const row = await this.kernel.run((db) =>
      db
        .withTables<EntryTermTableViews>()
        .selectFrom(this.tables.entryTerms)
        .select((eb) => eb.fn.countAll().as("n"))
        .where("workspace_id", "=", this.workspaceId)
        .where("term_id", "=", params.termId)
        .executeTakeFirst()
    );
    return Number(row?.n ?? 0);
  }

  /**
   * `EntryTermReadPort` — the public-render read path: every term currently assigned to one
   * `(contentType, contentId)` pair, joined with its own name and its owning taxonomy's name in one
   * query, ordered by `added_at` so a page lists terms in the order they were assigned.
   *
   * Trashing never touches the assignment rows (a trashed term/taxonomy stays assigned), so the
   * assignment row survives and is filtered out HERE at read time. {@link termIsLive}'s `NOT EXISTS`
   * also covers a term whose taxonomy is trashed.
   *
   * @complexity O(n) in the number of terms assigned to this one piece of content (typically single
   * digits) — one join query.
   */
  async listForContent(params: { contentType: string; contentId: string }): Promise<readonly AssignedTermView[]> {
    const { entryTerms, terms, taxonomies } = this.tables;
    return this.kernel.run((db) =>
      db
        .withTables<LiveJoinTableViews>()
        .selectFrom(entryTerms)
        .innerJoin(terms, `${terms}.id` as const, `${entryTerms}.term_id` as const)
        .innerJoin(taxonomies, `${taxonomies}.id` as const, `${terms}.taxonomy_id` as const)
        .select([`${terms}.id as termId` as const, `${terms}.name as termName` as const, `${taxonomies}.name as taxonomyName` as const])
        .where(`${entryTerms}.workspace_id` as const, "=", this.workspaceId)
        .where(`${entryTerms}.content_type` as const, "=", params.contentType)
        .where(`${entryTerms}.content_id` as const, "=", params.contentId)
        .where(termIsLive({ tables: this.tables }))
        .orderBy(`${entryTerms}.added_at` as const)
        .execute()
    );
  }

  /** Every `(content_type, content_id)` assigned to one term in this workspace. */
  private contentOfTerm({ termId }: { termId: string }) {
    return this.kernel.run((db) =>
      db
        .withTables<EntryTermTableViews>()
        .selectFrom(this.tables.entryTerms)
        .select(["content_type", "content_id"])
        .where("workspace_id", "=", this.workspaceId)
        .where("term_id", "=", termId)
        .execute()
    );
  }

  private async upsertRow(row: { contentType: string; contentId: string; termId: string; addedAt: string }) {
    await this.kernel.run((db) =>
      db
        .withTables<EntryTermTableViews>()
        .insertInto(this.tables.entryTerms)
        .values({
          workspace_id: this.workspaceId,
          content_type: row.contentType,
          content_id: row.contentId,
          term_id: row.termId,
          added_at: row.addedAt,
        })
        .onConflict((oc) =>
          oc.columns(["workspace_id", "content_type", "content_id", "term_id"]).doUpdateSet({ added_at: row.addedAt })
        )
        .execute()
    );
  }
}
