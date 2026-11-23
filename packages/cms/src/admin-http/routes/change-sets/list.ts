import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import type { ChangeSetRecord, ChangeSetRepoPort } from "@jini-ai/core/contracts/events";

import { authorizeChangeSet, type ChangeSetRoutePrincipal } from "./shared.js";

/** The deps this route reads. `toChangeSetHeader` is the host's change-set header DTO (it is shared with
 *  the host's agent tool, so it stays host-side and is injected). */
export interface ChangeSetListRouteDeps {
  workspaceId: string;
  changeSets: Pick<ChangeSetRepoPort, "listByWorkspace">;
  toChangeSetHeader: (required: { changeSet: ChangeSetRecord }) => object;
}

/**
 * GET change sets, newest-first, workspace-scoped (SPEC-001 REQ-06).
 *
 * Gated by the existing `changeset.read` permission, checked directly via `authorize()`.
 */
export const changeSetListRoute = defineJsonRoute<Record<string, never>, { changeSets: readonly object[] }, ChangeSetListRouteDeps, ChangeSetRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/change-sets",
  parse: () => ok({ value: {} }),
  handle: async ({ deps, authorize }) => {
    await authorizeChangeSet({ authorize, permission: "changeset.read" });
    const changeSets = await deps.changeSets.listByWorkspace({ workspaceId: deps.workspaceId });
    return ok({ value: { changeSets: changeSets.map((changeSet) => deps.toChangeSetHeader({ changeSet })) } });
  },
});
