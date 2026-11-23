import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { RedirectNotFoundError, tombstoneRedirect, type RedirectsWriteDeps } from "../../../redirects/index.js";
import { toAdminRedirectResponse, type AdminRedirectResponse } from "../../http/redirects.js";
import { authorizeRedirectsManage, redirectActorId, type RedirectRoutePrincipal } from "./shared.js";

/** The deps this route reads. */
export interface RedirectTombstoneRouteDeps {
  workspaceId: string;
  redirectsWriteDeps: RedirectsWriteDeps;
}

/**
 * DELETE (soft-delete/tombstone) a redirect rule (api.spec.md
 * `TOMBSTONE_REDIRECT`). Returns the tombstoned rule (200), not 204, so the
 * admin UI can show the final state without a re-fetch. Gated by
 * `admin.redirects.manage`.
 */
export const redirectTombstoneRoute = defineJsonRoute<{ id: string }, AdminRedirectResponse, RedirectTombstoneRouteDeps, RedirectRoutePrincipal>({
  method: "delete",
  path: "/api/admin/v1/workspaces/:workspaceId/redirects/:id",
  parse: (raw) => ok({ value: { id: String(raw.params.id ?? "") } }),
  handle: async ({ input, deps, context, authorize }) => {
    const actorId = redirectActorId({ context });
    await authorizeRedirectsManage({ authorize }, { entityId: input.id });
    try {
      const { record } = await tombstoneRedirect({
        deps: deps.redirectsWriteDeps,
        input: { workspaceId: deps.workspaceId, id: input.id, actorId },
      });
      return ok({ value: toAdminRedirectResponse(record) });
    } catch (err) {
      // Fixed copy rebuilt from the requested id (same words the write path throws, and get-by-id's
      // 404), so no caught error text is copied into the client envelope.
      if (err instanceof RedirectNotFoundError) rejectRoute({ status: 404, error: `redirect '${input.id}' was not found`, code: "REDIRECT_NOT_FOUND" });
      throw err;
    }
  },
});
