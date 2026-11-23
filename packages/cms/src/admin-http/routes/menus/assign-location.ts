import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { assignLocation, MenuConflictError, MenuNotFoundError, MenuVersionConflictError, type AssignLocationDeps } from "../../../navigation/menu-service.js";
import { toAdminAssignLocationResponse, type AdminAssignLocationEnvelope } from "../../http/menus.js";
import {
  authorizeMenus, mapMenuError, MENU_NOT_LIVE_MAPPING, menuIdParam, rejectMenuError, type MenuErrorMapping, type MenuRoutePrincipal,
} from "./shared.js";
import type { OutwardErrorMessage } from "../../http/outward-error-message.js";

/** Maps assignment failures to the existing admin response envelope. @complexity O(1). */
const MENU_ASSIGN_ERROR_MAPPINGS: readonly MenuErrorMapping[] = [
  MENU_NOT_LIVE_MAPPING,
  mapMenuError({ errorClass: MenuNotFoundError, status: 404 }),
  // Either menu's save can lose its compare-and-set to another editor (the whole assignment rolled
  // back); same `VERSION_CONFLICT` code as update-tree, so the admin shows its "reload" copy.
  mapMenuError({ errorClass: MenuVersionConflictError, status: 409, code: "VERSION_CONFLICT" }),
  mapMenuError({ errorClass: MenuConflictError, status: 409 }),
];

/** The deps this route reads. */
export interface MenuAssignLocationRouteDeps {
  /** Words a classified error for the caller (see {@link OutwardErrorMessage}). */
  outwardErrorMessage: OutwardErrorMessage;
  workspaceId: string;
  menuRepo: AssignLocationDeps["repo"];
  navLocationBindingRepo: AssignLocationDeps["bindingRepo"];
  clock: AssignLocationDeps["clock"];
  idGen: AssignLocationDeps["idGen"];
  outbox: AssignLocationDeps["outbox"];
}

/** The menu to bind and the trimmed location key. */
export interface MenuAssignLocationInput { menuId: string; locationKey: string }

/** Reads+trims `locationKey` off the body in one place; missing or blank is the route's flat 400.
 *  @complexity O(1). */
function parseLocationKey({ rawBody }: { rawBody: unknown }, _optional = {}): string {
  const body = (rawBody ?? {}) as Record<string, unknown>;
  const locationKey = String(body.locationKey ?? "").trim();
  if (!locationKey) rejectRoute({ status: 400, error: "locationKey is required" });
  return locationKey;
}

/**
 * POST assign a menu to a theme location (ADR-029 `assignLocation`).
 *
 * Last-writer-wins: if the location was already bound to a different menu,
 * that menu is displaced (its `locations` field loses the key) and the
 * response includes it as `displacedMenu` so the UI can show what changed.
 *
 * Gated by `admin.menus.assign` (ADR-PIPE-012 D-1/D-2/D-9 — renamed/split from the old flat
 * navigation permission), checked directly via `authorize()` (same pattern as `create.ts`).
 */
export const menuAssignLocationRoute = defineJsonRoute<MenuAssignLocationInput, AdminAssignLocationEnvelope, MenuAssignLocationRouteDeps, MenuRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/menus/:menuId/locations",
  parse: (raw) => {
    const locationKey = parseLocationKey({ rawBody: raw.body });
    return ok({ value: { menuId: menuIdParam({ params: raw.params }), locationKey } });
  },
  handle: async ({ input, deps, authorize }) => {
    await authorizeMenus({ authorize, permission: "admin.menus.assign" }, { entityId: input.menuId });
    try {
      const { menu, binding, displacedMenu } = await assignLocation({
        deps: { repo: deps.menuRepo, bindingRepo: deps.navLocationBindingRepo, clock: deps.clock, idGen: deps.idGen, outbox: deps.outbox },
        input: { workspaceId: deps.workspaceId, menuId: input.menuId, locationKey: input.locationKey },
      });
      return ok({ value: toAdminAssignLocationResponse({ menu, binding, displacedMenu }) });
    } catch (err) {
      return rejectMenuError({ err, outwardErrorMessage: deps.outwardErrorMessage, mappings: MENU_ASSIGN_ERROR_MAPPINGS });
    }
  },
});
