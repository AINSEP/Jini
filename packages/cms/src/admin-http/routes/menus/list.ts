import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import type { MenuRepoPort } from "../../../navigation/repo.memory.js";
import { toAdminMenuListResponse, type AdminMenuListEnvelope } from "../../http/menus.js";
import { authorizeMenus, type MenuRoutePrincipal } from "./shared.js";

/** The deps this route reads. */
export interface MenuListRouteDeps {
  workspaceId: string;
  menuRepo: Pick<MenuRepoPort, "list">;
}

/**
 * GET the workspace's menus (admin list view, ADR-029).
 *
 * Reads go straight through `MenuRepoPort.list` — `navigation` ships no
 * `listMenus` service wrapper (only the mutation slice: create/update-tree/
 * assign/delete in `menu-service.ts`), so there is no business logic to
 * front this plain repo read with. See the handoff report's "interface
 * friction" note. This D-9 service-layer-bypass gap is unchanged by
 * ADR-PIPE-012 — only the permission naming below is in scope for this
 * remediation (see ADR-PIPE-012's "Note on D-9").
 *
 * Gated by `admin.menus.read` (ADR-PIPE-012 D-1/D-2/D-9 — renamed/split from
 * the old flat navigation permission).
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
