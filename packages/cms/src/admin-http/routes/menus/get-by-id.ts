import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import type { MenuRepoPort } from "../../../navigation/repo.memory.js";
import { toAdminMenuResponse, type AdminMenuEnvelope } from "../../http/menus.js";
import { authorizeMenus, menuIdParam, type MenuRoutePrincipal } from "./shared.js";

/** The deps this route reads. */
export interface MenuGetRouteDeps {
  workspaceId: string;
  menuRepo: Pick<MenuRepoPort, "findBySlug" | "findById">;
}

/** The requested menu, by slug or id. */
export interface MenuGetInput { menuId: string }

/**
 * GET one menu by id, including its full item tree (ADR-029).
 *
 * Gated by `admin.menus.read` (ADR-PIPE-012 D-1/D-2/D-9 — renamed/split from
 * the old flat navigation permission).
 */
export const menuGetRoute = defineJsonRoute<MenuGetInput, AdminMenuEnvelope, MenuGetRouteDeps, MenuRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/menus/:menuId",
  parse: (raw) => ok({ value: { menuId: menuIdParam({ params: raw.params }) } }),
  handle: async ({ input, deps, authorize }) => {
    const { menuId } = input;
    await authorizeMenus({ authorize, permission: "admin.menus.read" }, { entityId: menuId });
    // Admin URLs use the slug when one resolves (readable-slugs S6b, 2026-09-23) — this route
    // accepts either so an old id-based bookmark/link keeps working. Slug first, id second: same
    // precedent and rationale as posts' `getAdminPostByIdOrSlug` — the
    // slug is the handle a human typed into the URL; the id is the fallback for a stale link.
    const bySlug = await deps.menuRepo.findBySlug({ workspaceId: deps.workspaceId, slug: menuId.trim().toLowerCase() });
    const menu = bySlug ?? (await deps.menuRepo.findById({ workspaceId: deps.workspaceId, id: menuId }));
    if (!menu) rejectRoute({ status: 404, error: `menu '${menuId}' was not found` });
    return ok({ value: toAdminMenuResponse(menu) });
  },
});
