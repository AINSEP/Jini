import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { assignLocation, MenuConflictError, MenuNotFoundError, MenuVersionConflictError, type AssignLocationDeps } from "../../../navigation/index.js";
import type { AdminAssignLocationEnvelope } from "@jini-ai/core/contracts/site/cms-menus";
import { toAdminAssignLocationResponse } from "../../http/menus.js";
import type { OutwardErrorMessage } from "../../http/outward-error-message.js";
import {
  authorizeMenus, mapMenuError, MENU_NOT_LIVE_MAPPING, menuIdParam, rejectMenuError, type MenuErrorMapping, type MenuRoutePrincipal,
} from "./shared.js";

/** The deps this route reads: the assignment service's collaborators. */
export interface MenuAssignLocationRouteDeps extends Pick<AssignLocationDeps, "clock" | "idGen" | "outbox"> {
  /** Words a classified error for the caller (see {@link OutwardErrorMessage}). */
  outwardErrorMessage: OutwardErrorMessage;
  workspaceId: string;
  menuRepo: AssignLocationDeps["repo"];
  navLocationBindingRepo: AssignLocationDeps["bindingRepo"];
}

/** Maps assignment failures to the existing admin response envelope: liveness, not-found, then the
 *  compare-and-set loss before the conflict it extends. @complexity O(1). */
const MENU_ASSIGN_ERROR_MAPPINGS: readonly MenuErrorMapping[] = [
  MENU_NOT_LIVE_MAPPING,
  mapMenuError({ errorClass: MenuNotFoundError, status: 404 }),
  // Either menu's save can lose its compare-and-set to another editor (the whole assignment rolled
  // back); same `VERSION_CONFLICT` code as update-tree, so the admin shows its "reload" copy.
  mapMenuError({ errorClass: MenuVersionConflictError, status: 409, code: "VERSION_CONFLICT" }),
  mapMenuError({ errorClass: MenuConflictError, status: 409 }),
];

/**
 * POST assign a menu to a theme location (ADR-029 `assignLocation`). Gated by `admin.menus.assign`
 * for that menu.
 *
 * Last writer wins: a location already bound to another menu displaces it, and the response names
 * the displaced menu so the UI can show what changed. Either menu's save can lose its
 * compare-and-set (the whole assignment rolls back) — the same `VERSION_CONFLICT` code update-tree
 * sends, so the admin shows its "reload" copy.
 *
 * `admin.menus.assign` (ADR-PIPE-012 D-1/D-2/D-9) replaced the old flat navigation permission; it is
 * checked directly via `authorize()` (same pattern as `create.ts`).
 */
export const menuAssignLocationRoute = defineJsonRoute<{ menuId: string; locationKey: string }, AdminAssignLocationEnvelope, MenuAssignLocationRouteDeps, MenuRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/menus/:menuId/locations",
  parse: (raw) => {
    const locationKey = String(((raw.body ?? {}) as Record<string, unknown>).locationKey ?? "").trim();
    if (!locationKey) rejectRoute({ status: 400, error: "locationKey is required" });
    return ok({ value: { menuId: menuIdParam({ params: raw.params }), locationKey } });
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
      return rejectMenuError({ err, outwardErrorMessage: deps.outwardErrorMessage, mappings: MENU_ASSIGN_ERROR_MAPPINGS });
    }
  },
});
