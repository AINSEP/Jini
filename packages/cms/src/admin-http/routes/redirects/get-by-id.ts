import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import type { RedirectRepoPort } from "../../../redirects/index.js";
import { toAdminRedirectResponse, type AdminRedirectResponse } from "../../http/redirects.js";
import { authorizeRedirectsManage, type RedirectRoutePrincipal } from "./shared.js";

/** The deps this route reads. */
export interface RedirectGetRouteDeps {
  workspaceId: string;
  redirectRepo: Pick<RedirectRepoPort, "findById">;
}

/** GET a single redirect rule by id (api.spec.md `GET_REDIRECT`). Gated by `admin.redirects.manage`. */
export const redirectGetRoute = defineJsonRoute<{ id: string }, AdminRedirectResponse, RedirectGetRouteDeps, RedirectRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/redirects/:id",
  parse: (raw) => ok({ value: { id: String(raw.params.id ?? "") } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeRedirectsManage({ authorize }, { entityId: input.id });
    const rule = await deps.redirectRepo.findById({ workspaceId: deps.workspaceId, id: input.id });
    if (!rule) rejectRoute({ status: 404, error: `redirect '${input.id}' was not found`, code: "REDIRECT_NOT_FOUND" });
    return ok({ value: toAdminRedirectResponse(rule) });
  },
});
