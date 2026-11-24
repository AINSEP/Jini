import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { trashTaxonomy, type RemoveTaxonomyFn, type TaxonomyTrashReadPort } from "../../../taxonomy/index.js";
import { authorizeTaxonomyManage, taxonomyPrincipal, type TaxonomyRoutePrincipal } from "./shared.js";

/** The deps this route reads. */
export interface TaxonomyDeleteRouteDeps {
  workspaceId: string;
  taxonomyRepo: TaxonomyTrashReadPort;
  removeTaxonomy: RemoveTaxonomyFn;
  clock: { nowIso(): string };
}

/** What a successful move to the Trash answers. */
export interface TaxonomyDeleteOutput { trashed: true; id: string; version: number | null }

/**
 * `DELETE /api/admin/v1/taxonomy/:id` moves a taxonomy to the Trash (T6, trash parallel
 * plan §2, owner decision 5) — this REPLACES the prior hard-delete call into the taxonomy module's
 * `deleteTaxonomy` (see `../../../taxonomy/trash-term.ts`'s file header). A taxonomy declares no
 * blocker (`RemoveTaxonomyFn` is narrowed, unlike `RemoveTermFn`) — its member terms read as
 * trashed the instant the taxonomy does (`hiddenWithParent`), no separate cascade write. Gated by
 * `admin.taxonomy.manage`, same as every other taxonomy route, via the host's guarded authorizer —
 * same precedent as the term and menu delete routes.
 */
export const taxonomyDeleteRoute = defineJsonRoute<{ id: string }, TaxonomyDeleteOutput, TaxonomyDeleteRouteDeps, TaxonomyRoutePrincipal>({
  method: "delete",
  path: "/api/admin/v1/taxonomy/:id",
  parse: (raw) => ok({ value: { id: String(raw.params.id) } }),
  handle: async ({ input, deps, context, authorize }) => {
    const principal = taxonomyPrincipal({ context });
    const taxonomyId = input.id;
    await authorizeTaxonomyManage({ authorize, entityType: "taxonomy" }, { entityId: taxonomyId });

    const outcome = await trashTaxonomy(
      { workspaceId: deps.workspaceId, taxonomyId, actor: { principalId: principal.id, pluginId: null },
        taxonomyRepo: deps.taxonomyRepo, remove: deps.removeTaxonomy, clock: deps.clock }
    );

    if (!outcome.ok && outcome.reason === "not-found") rejectRoute({ status: 404, error: `taxonomy '${taxonomyId}' was not found`, code: "TAXONOMY_NOT_FOUND" });
    if (!outcome.ok) rejectRoute({ status: 409, error: `taxonomy '${taxonomyId}' changed while it was being deleted`, code: "TRASH_VERSION_CHANGED" });
    return ok({ value: { trashed: true, id: taxonomyId, version: outcome.version } });
  },
});
