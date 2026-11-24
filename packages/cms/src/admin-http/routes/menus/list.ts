import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import type { MenuRepoPort } from "../../../navigation/index.js";
import type { AdminMenuListEnvelope } from "@jini-ai/core/contracts/site/cms-menus";
import { toAdminMenuListResponse } from "../../http/menus.js";
import { authorizeMenus, type MenuRoutePrincipal } from "./shared.js";

/** The deps this route reads. */
export interface MenuListRouteDeps {
  workspaceId: string;
  menuRepo: Pick<MenuRepoPort, "list">;
}

/**
 * GET the workspace's menus (admin list view, ADR-029). Gated by `admin.menus.read`, id-free.
 *
 * Reads go straight through `MenuRepoPort.list`: `navigation` ships no list service (only the
 * mutation slice: create/update-tree/assign/delete in `menu-service.ts`), so there is no business
 * rule to front this plain repo read with. This service-layer bypass (D-9) is unchanged by
 * ADR-PIPE-012, which only renamed the permission: `admin.menus.read` (D-1/D-2/D-9) replaced the
 * old flat navigation permission.
 */
export const menuListRoute = defineJsonRoute<Record<string, never>, AdminMenuListEnvelope, MenuListRouteDeps, MenuRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/menus",
  parse: () => ok({ value: {} }),
  handle: async ({ deps, authorize }) => {
    await authorizeMenus({ authorize, permission: "admin.menus.read" });
    const menus = await deps.menuRepo.list({ workspaceId: deps.workspaceId });
    return ok({ value: toAdminMenuListResponse({ menus }) });
  },
});
