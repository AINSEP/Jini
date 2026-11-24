import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { RouteRefusalError, rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { trashTerm, type RemoveTermFn, type TermTrashReadPort } from "../../../taxonomy/index.js";
import { authorizeTaxonomyManage, taxonomyPrincipal, type TaxonomyRoutePrincipal } from "./shared.js";

/** The deps this route reads. */
export interface TaxonomyDeleteTermRouteDeps {
  workspaceId: string;
  termRepo: TermTrashReadPort;
  removeTerm: RemoveTermFn;
  clock: { nowIso(): string };
}

/** What a successful move to the Trash answers. */
export interface TaxonomyDeleteTermOutput { trashed: true; id: string; version: number | null }

/**
 * `DELETE /api/admin/v1/taxonomy/terms/:id` moves a term to the Trash (T6, trash parallel
 * plan §2, owner decision 5) — this REPLACES the prior hard-delete call into the taxonomy module's
 * `deleteTerm` (see `../../../taxonomy/trash-term.ts`'s file header for why: an assigned term is
 * now trashable, only the child-term blocker survives, as the Trash's own generic
 * `TERM_HAS_CHILDREN`). Gated by `admin.taxonomy.manage`, same as every other taxonomy route, via
 * the host's guarded authorizer (`trashTerm` has no permission hook of its own — same
 * precedent as the menu delete route's `trashMenu` wiring).
 */
export const taxonomyDeleteTermRoute = defineJsonRoute<{ id: string }, TaxonomyDeleteTermOutput, TaxonomyDeleteTermRouteDeps, TaxonomyRoutePrincipal>({
  method: "delete",
  path: "/api/admin/v1/taxonomy/terms/:id",
  parse: (raw) => ok({ value: { id: String(raw.params.id) } }),
  handle: async ({ input, deps, context, authorize }) => {
    const principal = taxonomyPrincipal({ context });
    const termId = input.id;
    await authorizeTaxonomyManage({ authorize, entityType: "term" }, { entityId: termId });

    const outcome = await trashTerm(
      { workspaceId: deps.workspaceId, termId, actor: { principalId: principal.id, pluginId: null },
        termRepo: deps.termRepo, remove: deps.removeTerm, clock: deps.clock }
    );

    if (!outcome.ok && outcome.reason === "not-found") rejectRoute({ status: 404, error: `term '${termId}' was not found`, code: "TERM_NOT_FOUND" });
    if (!outcome.ok && outcome.reason === "blocked") {
      // The blocked body carries the child count beside `code`, which `rejectRoute` cannot express.
      throw new RouteRefusalError({ status: 409, body: { error: `term '${termId}' still has child terms`, code: outcome.code, count: outcome.count } });
    }
    if (!outcome.ok) rejectRoute({ status: 409, error: `term '${termId}' changed while it was being deleted`, code: "TRASH_VERSION_CHANGED" });
    return ok({ value: { trashed: true, id: termId, version: outcome.version } });
  },
});
