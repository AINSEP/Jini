import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import type { RedirectHitSink, RedirectRepoPort } from "../../../redirects/index.js";
import { toAdminRedirectHitStatsResponse, type AdminRedirectHitStatsResponse } from "../../http/redirects.js";
import { authorizeRedirectsManage, type RedirectRoutePrincipal } from "./shared.js";

/** The deps this route reads. */
export interface RedirectHitsRouteDeps {
  workspaceId: string;
  redirectRepo: Pick<RedirectRepoPort, "findById">;
  redirectHitSink: Pick<RedirectHitSink, "getStats">;
}

/**
 * GET aggregate hit stats for a redirect rule (api.spec.md
 * `LIST_REDIRECT_HITS`, via `RedirectHitSink.getStats`). Gated by
 * `admin.redirects.manage`. 404s if the rule itself doesn't exist (distinct
 * from "no hits recorded yet", which still 200s with `hitCount: 0`).
 */
export const redirectHitsRoute = defineJsonRoute<{ id: string }, AdminRedirectHitStatsResponse, RedirectHitsRouteDeps, RedirectRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/redirects/:id/hits",
  parse: (raw) => ok({ value: { id: String(raw.params.id ?? "") } }),
  handle: async ({ input, deps, authorize }) => {
    const { id } = input;
    await authorizeRedirectsManage({ authorize });
    const rule = await deps.redirectRepo.findById({ workspaceId: deps.workspaceId, id });
    if (!rule) rejectRoute({ status: 404, error: `redirect '${id}' was not found`, code: "REDIRECT_NOT_FOUND" });

    const stats = await deps.redirectHitSink.getStats({ workspaceId: deps.workspaceId, redirectId: id });
    const effective = stats ?? { redirectId: id, workspaceId: deps.workspaceId, hitCount: 0, lastHitAt: undefined };
    return ok({ value: toAdminRedirectHitStatsResponse(effective) });
  },
});
