import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import type { AdminTrashMenuEnvelope } from "@jini-ai/core/contracts/site/cms-menus";
import { toAdminTrashMenuResponse } from "../../http/menus.js";
import { authorizeMenus, MENU_CONFLICT, MENU_NOT_FOUND, menuActorId, menuIdParam, rejectMenuError, type MenuRoutePrincipal } from "./shared.js";

/**
 * Moves one menu to the Trash. Injected because the trash pipeline is the host's: it owns the
 * generic Trash store, the display row and the purge-time unassignment. It throws
 * `MenuNotFoundError` for a missing menu and `MenuConflictError` when the row changed mid-move.
 */
export type MenuTrashFn = (required: {
  workspaceId: string;
  menuId: string;
  actor: { principalId: string };
}) => Promise<{ id: string; version: number | null }>;

/** The deps this route reads. */
export interface MenuDeleteRouteDeps {
  workspaceId: string;
  trashMenu: MenuTrashFn;
}

const MENU_DELETE_ERRORS = [MENU_NOT_FOUND, MENU_CONFLICT] as const;

/**
 * DELETE a menu — moves it to the Trash (ADR-029 §6). Gated by `admin.menus.delete` for that menu.
 * Purging happens only through the generic Trash surface, so there is no force/purge ladder here;
 * a second call against an already-trashed menu is the ordinary 404.
 */
export const menuDeleteRoute = defineJsonRoute<{ menuId: string }, AdminTrashMenuEnvelope, MenuDeleteRouteDeps, MenuRoutePrincipal>({
  method: "delete",
  path: "/api/admin/v1/workspaces/:workspaceId/menus/:menuId",
  parse: (raw) => ok({ value: { menuId: menuIdParam({ params: raw.params }) } }),
  handle: async ({ input, deps, context, authorize }) => {
    const principalId = menuActorId({ context });
    await authorizeMenus({ authorize, permission: "admin.menus.delete" }, { entityId: input.menuId });
    try {
      const trashed = await deps.trashMenu({ workspaceId: deps.workspaceId, menuId: input.menuId, actor: { principalId } });
      return ok({ value: toAdminTrashMenuResponse(trashed) });
    } catch (err) {
      return rejectMenuError({ err, mappings: MENU_DELETE_ERRORS });
    }
  },
});
