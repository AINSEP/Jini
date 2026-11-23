import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { listRedirects, type ListRedirectsFilter, type RedirectRepoPort, type RedirectsWriteDeps } from "../../../redirects/index.js";
import { toAdminRedirectListResponse, type AdminRedirectListResponse } from "../../http/redirects.js";
import { authorizeRedirectsManage, type RedirectRoutePrincipal } from "./shared.js";

/** The deps this route reads. */
export interface RedirectListRouteDeps {
  workspaceId: string;
  redirectRepo: Pick<RedirectRepoPort, "list">;
  redirectsWriteDeps: Pick<RedirectsWriteDeps, "isInTrash">;
}

/** The optional list filters, as the query carries them (unchecked, same as before the move). */
export type RedirectListQuery = Omit<ListRedirectsFilter, "workspaceId">;

const queryString = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

/**
 * GET the workspace's redirect rules (admin list view, api.spec.md
 * `LIST_REDIRECTS`), optionally filtered by `status`/`source`/`matchType`. Rules in the
 * Trash are not listed.
 * Gated by `admin.redirects.manage` (REQ-12).
 */
export const redirectListRoute = defineJsonRoute<RedirectListQuery, AdminRedirectListResponse, RedirectListRouteDeps, RedirectRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/redirects",
  parse: (raw) => ok({ value: {
    status: queryString(raw.query.status) as RedirectListQuery["status"],
    source: queryString(raw.query.source) as RedirectListQuery["source"],
    matchType: queryString(raw.query.matchType) as RedirectListQuery["matchType"],
  } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeRedirectsManage({ authorize });
    // Rules in the Trash are left out (Bug B): removal moves a rule to the Trash, which is the
    // only screen that shows it until it is restored.
    const rules = await listRedirects({
      deps: { repo: deps.redirectRepo as RedirectRepoPort, isInTrash: deps.redirectsWriteDeps.isInTrash },
      filter: { workspaceId: deps.workspaceId, status: input.status, source: input.source, matchType: input.matchType },
    });
    return ok({ value: toAdminRedirectListResponse({ records: rules }) });
  },
});
