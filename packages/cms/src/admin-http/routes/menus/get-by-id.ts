import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import type { MenuRepoPort } from "../../../navigation/index.js";
import type { AdminMenuEnvelope } from "@jini-ai/core/contracts/site/cms-menus";
import { toAdminMenuResponse } from "../../http/menus.js";
import { authorizeMenus, menuIdParam, type MenuRoutePrincipal } from "./shared.js";

/** The deps this route reads: the workspace it serves and the two menu lookups. */
export interface MenuGetRouteDeps {
  workspaceId: string;
  menuRepo: Pick<MenuRepoPort, "findBySlug" | "findById">;
}

/**
 * GET one menu by slug or id, including its full item tree (ADR-029). Gated by `admin.menus.read`
 * for that menu.
 *
 * Admin URLs use the slug when one resolves (readable slugs), so the route accepts either and an
 * old id-based bookmark keeps working. Slug first, id second: the slug is what a human typed into
 * the URL, the id the fallback for a stale link — the same precedent posts' by-id-or-slug read uses
 * (`getAdminPostByIdOrSlug`; readable-slugs S6b, 2026-09-23). `admin.menus.read` (ADR-PIPE-012
 * D-1/D-2/D-9) replaced the old flat navigation permission.
 */
export const menuGetRoute = defineJsonRoute<{ menuId: string }, AdminMenuEnvelope, MenuGetRouteDeps, MenuRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/menus/:menuId",
  parse: (raw) => ok({ value: { menuId: menuIdParam({ params: raw.params }) } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeMenus({ authorize, permission: "admin.menus.read" }, { entityId: input.menuId });
    const bySlug = await deps.menuRepo.findBySlug({ workspaceId: deps.workspaceId, slug: input.menuId.trim().toLowerCase() });
    const menu = bySlug ?? (await deps.menuRepo.findById({ workspaceId: deps.workspaceId, id: input.menuId }));
    if (!menu) rejectRoute({ status: 404, error: `menu '${input.menuId}' was not found` });
    return ok({ value: toAdminMenuResponse({ menu }) });
  },
});
