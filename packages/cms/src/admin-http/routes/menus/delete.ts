import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { MenuConflictError, MenuNotFoundError } from "../../../navigation/menu-service.js";
import { trashMenu, type TrashMenuDeps } from "../../../navigation/site/trash-menu.js";
import { toAdminTrashMenuResponse, type AdminTrashMenuEnvelope } from "../../http/menus.js";
import { authorizeMenus, mapMenuError, menuActorId, menuIdParam, rejectMenuError, type MenuErrorMapping, type MenuRoutePrincipal } from "./shared.js";
import type { OutwardErrorMessage } from "../../http/outward-error-message.js";

const MENU_DELETE_ERROR_MAPPINGS: readonly MenuErrorMapping[] = [
  mapMenuError({ errorClass: MenuNotFoundError, status: 404 }),
  mapMenuError({ errorClass: MenuConflictError, status: 409 }),
];

/** The deps this route reads. */
export interface MenuDeleteRouteDeps {
  /** Words a classified error for the caller (see {@link OutwardErrorMessage}). */
  outwardErrorMessage: OutwardErrorMessage;
  workspaceId: string;
  menuRepo: TrashMenuDeps["menuRepo"];
  removeMenu: TrashMenuDeps["remove"];
  clock: TrashMenuDeps["clock"];
}

/** The menu to move to the Trash. */
export interface MenuDeleteInput { menuId: string }

/**
 * DELETE a menu — moves it to the Trash (ADR-029 §6 / trash pipeline). No more force/purge ladder:
 * purging (permanent deletion) happens only through the generic Trash surface, which already
 * unassigns a bound menu's locations at purge time (T1's registry `purgeFirst`). A second call
 * against an already-trashed menu 404s like any other not-found — there is no separate
 * `admin.menus.delete.force` permission or `?force=true` behavior left to gate.
 */
export const menuDeleteRoute = defineJsonRoute<MenuDeleteInput, AdminTrashMenuEnvelope, MenuDeleteRouteDeps, MenuRoutePrincipal>({
  method: "delete",
  path: "/api/admin/v1/workspaces/:workspaceId/menus/:menuId",
  parse: (raw) => ok({ value: { menuId: menuIdParam({ params: raw.params }) } }),
  handle: async ({ input, deps, context, authorize }) => {
    const principalId = menuActorId({ context });
    await authorizeMenus({ authorize, permission: "admin.menus.delete" }, { entityId: input.menuId });
    try {
      const trashed = await trashMenu(
        { workspaceId: deps.workspaceId, menuId: input.menuId, actor: { principalId } },
        { menuRepo: deps.menuRepo, remove: deps.removeMenu, clock: deps.clock },
      );
      return ok({ value: toAdminTrashMenuResponse(trashed) });
    } catch (err) {
      return rejectMenuError({ err, outwardErrorMessage: deps.outwardErrorMessage, mappings: MENU_DELETE_ERROR_MAPPINGS });
    }
  },
});
