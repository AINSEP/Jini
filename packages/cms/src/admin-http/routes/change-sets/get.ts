import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";
import type { ChangeSetItemRecord, ChangeSetRecord, ChangeSetRepoPort } from "@jini-ai/core/contracts/events";

import { authorizeChangeSet, changeSetIdParam, type ChangeSetRoutePrincipal } from "./shared.js";

/** The deps this route reads. The two DTO functions are the host's change-set response serializers
 *  (the header one is shared with the host's agent tool, so both stay host-side and are injected). */
export interface ChangeSetGetRouteDeps {
  workspaceId: string;
  changeSets: Pick<ChangeSetRepoPort, "findById">;
  toChangeSetHeader: (required: { changeSet: ChangeSetRecord }) => object;
  toChangeSetItem: (required: { item: ChangeSetItemRecord }) => object;
}

/**
 * GET one change set with its items (SPEC-001 REQ-06).
 *
 * Gated by the existing `changeset.read` permission, checked directly via `authorize()`.
 */
export const changeSetGetRoute = defineJsonRoute<{ changeSetId: string }, { changeSet: object; items: readonly object[] }, ChangeSetGetRouteDeps, ChangeSetRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/change-sets/:changeSetId",
  parse: (raw) => ok({ value: { changeSetId: changeSetIdParam(raw.params) } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeChangeSet({ authorize, permission: "changeset.read" }, { entityId: input.changeSetId });
    const found = await deps.changeSets.findById({ workspaceId: deps.workspaceId, id: input.changeSetId });
    if (!found) rejectRoute({ status: 404, error: "change set was not found", code: "CHANGE_SET_NOT_FOUND" });
    return ok({
      value: {
        changeSet: deps.toChangeSetHeader({ changeSet: found.changeSet }),
        items: found.items.map((item) => deps.toChangeSetItem({ item })),
      },
    });
  },
});
