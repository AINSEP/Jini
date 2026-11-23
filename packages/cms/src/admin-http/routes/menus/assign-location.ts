import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { assignLocation, type AssignLocationDeps } from "../../../navigation/index.js";
import { toAdminAssignLocationResponse, type AdminAssignLocationEnvelope } from "../../http/menus.js";
import {
  authorizeMenus, MENU_CONFLICT, MENU_NOT_FOUND, MENU_NOT_LIVE, MENU_VERSION_CONFLICT, menuIdParam, rejectMenuError,
  type MenuRoutePrincipal,
} from "./shared.js";

/** The deps this route reads: the assignment service's collaborators. */
export interface MenuAssignLocationRouteDeps extends Pick<AssignLocationDeps, "clock" | "idGen" | "outbox"> {
  workspaceId: string;
  menuRepo: AssignLocationDeps["repo"];
  navLocationBindingRepo: AssignLocationDeps["bindingRepo"];
}

/** The host's ladder: liveness, not-found, then the compare-and-set loss before the conflict it extends. */
const MENU_ASSIGN_ERRORS = [MENU_NOT_LIVE, MENU_NOT_FOUND, MENU_VERSION_CONFLICT, MENU_CONFLICT] as const;

/**
 * POST assign a menu to a theme location (ADR-029 `assignLocation`). Gated by `admin.menus.assign`
 * for that menu.
 *
 * Last writer wins: a location already bound to another menu displaces it, and the response names
 * the displaced menu so the UI can show what changed. Either menu's save can lose its
 * compare-and-set (the whole assignment rolls back) — the same `VERSION_CONFLICT` code update-tree
 * sends, so the admin shows its "reload" copy.
 */
export const menuAssignLocationRoute = defineJsonRoute<{ menuId: string; locationKey: string }, AdminAssignLocationEnvelope, MenuAssignLocationRouteDeps, MenuRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/menus/:menuId/locations",
  parse: (raw) => {
    const locationKey = String(((raw.body ?? {}) as Record<string, unknown>).locationKey ?? "").trim();
    if (!locationKey) rejectRoute({ status: 400, error: "locationKey is required" });
    return ok({ value: { menuId: menuIdParam(raw.params), locationKey } });
  },
  handle: async ({ input, deps, authorize }) => {
    await authorizeMenus({ authorize, permission: "admin.menus.assign" }, { entityId: input.menuId });
    try {
      const assigned = await assignLocation({
        deps: { repo: deps.menuRepo, bindingRepo: deps.navLocationBindingRepo, clock: deps.clock, idGen: deps.idGen, outbox: deps.outbox },
        input: { workspaceId: deps.workspaceId, menuId: input.menuId, locationKey: input.locationKey },
      });
      return ok({ value: toAdminAssignLocationResponse(assigned) });
    } catch (err) {
      return rejectMenuError({ err, mappings: MENU_ASSIGN_ERRORS });
    }
  },
});
