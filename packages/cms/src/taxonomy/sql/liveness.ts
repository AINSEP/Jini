import type { ExpressionBuilder } from "kysely";
import type { LiveJoinTableViews, TaxonomyTables } from "./repo.rows.js";

/**
 * @file What "live" means across the taxonomy repositories, and the one lock key they share.
 *
 * Trash rules: tags/categories are trashable, but this domain never imports a trash module. A row is
 * hidden by its own `status` marker, and a term is ALSO hidden the instant its taxonomy is
 * ({@link termIsLive}): no second write cascades the hide onto every member term, so every term read
 * re-checks the parent taxonomy's status itself. Every read excludes trashed rows except the
 * publish-content and purge-audit reads, which are deliberately trash-blind (named on each).
 * `update` guards its `WHERE` so a stale write can never resurrect or edit an already-trashed row.
 */

export const TRASH_STATUS = "trash";

/**
 * `<terms>.status <> 'trash' AND NOT EXISTS (the term's own taxonomy is trashed)`. Correlated to the
 * terms row in scope, so it works bare and inside joins. Every table name comes from `tables`.
 * @complexity O(1) to build; the subquery costs the taxonomies primary key.
 */
export function termIsLive({ tables }: { tables: TaxonomyTables }, _optional: Record<string, never> = {}) {
  const { terms, taxonomies } = tables;
  return (eb: ExpressionBuilder<LiveJoinTableViews, string>) =>
    eb.and([
      eb(`${terms}.status` as const, "!=", TRASH_STATUS),
      eb.not(
        eb.exists(
          eb
            .selectFrom(taxonomies)
            .select(`${taxonomies}.id` as const)
            .whereRef(`${taxonomies}.id` as const, "=", `${terms}.taxonomy_id` as const)
            .where(`${taxonomies}.status` as const, "=", TRASH_STATUS)
        )
      ),
    ]);
}

/**
 * The advisory-lock key serializing every read-then-write sequence of one workspace's taxonomy: the
 * transaction of `TaxonomyRepoPort` and the term re-point both take this one key.
 */
export function taxonomyLockKey({ workspaceId }: { workspaceId: string }, _optional: Record<string, never> = {}): string {
  return `taxonomy:${workspaceId}`;
}
