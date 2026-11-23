import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { updateMenuTree, type MenuHtmlAuthoring, type MenuHtmlNormalizer, type NavItemNode, type UpdateMenuTreeDeps } from "../../../navigation/index.js";
import { parseMenuHtmlAuthoring, toAdminMenuResponse, type AdminMenuEnvelope } from "../../http/menus.js";
import {
  authorizeMenuHtml, authorizeMenus, MENU_CONFLICT, MENU_NOT_FOUND, MENU_NOT_LIVE, MENU_VALIDATION, MENU_VERSION_CONFLICT,
  menuIdParam, rejectMenuError, type MenuRoutePrincipal,
} from "./shared.js";

/** The deps this route reads: the update service's collaborators plus the host's raw-HTML policy. */
export interface MenuUpdateTreeRouteDeps extends Pick<UpdateMenuTreeDeps, "clock" | "idGen" | "outbox"> {
  workspaceId: string;
  menuRepo: UpdateMenuTreeDeps["repo"];
  /** The permission a write carrying HTML also needs; the host owns this policy. */
  rawHtmlPermission: string;
  /** Balances submitted HTML; the host binds its runtime's parser (Node: `@jini-ai/cms/navigation/node`). */
  normalizeMenuHtml: MenuHtmlNormalizer;
}

/** The PUT body's fields plus the path id. `items` is absent only on an HTML-mode write. */
export interface MenuUpdateTreeInput {
  menuId: string;
  items: NavItemNode[] | undefined;
  expectedVersion: number;
  title: string | undefined;
  slug: string | undefined;
  authoring: MenuHtmlAuthoring;
}

/** The host's ladder, in order: liveness first, the compare-and-set loss before the conflict it extends. */
const MENU_UPDATE_ERRORS = [MENU_NOT_LIVE, MENU_VALIDATION, MENU_VERSION_CONFLICT, MENU_CONFLICT, MENU_NOT_FOUND] as const;

/**
 * The PUT body read off the untyped body. `items` may be omitted only by an HTML-mode write
 * (`mode`/`html` sent), which keeps the stored tree; anything else without an array is the 400.
 * @complexity O(1).
 */
function parseMenuTreeBody({ body, menuId }: { body: Record<string, unknown>; menuId: string }, _optional: Record<string, never> = {}): MenuUpdateTreeInput {
  const authoring = parseMenuHtmlAuthoring(body);
  const htmlOnly = body.items === undefined && (authoring.mode !== undefined || authoring.html !== undefined);
  if (!htmlOnly && !Array.isArray(body.items)) rejectRoute({ status: 400, error: "items must be an array" });
  return {
    menuId,
    items: body.items as NavItemNode[] | undefined,
    expectedVersion: Number(body.expectedVersion ?? 0),
    title: typeof body.title === "string" ? body.title : undefined,
    slug: typeof body.slug === "string" ? body.slug : undefined,
    authoring,
  };
}

/**
 * PUT a menu's whole item tree (ADR-029 `updateMenuTree`: whole-tree replace with OCC on
 * `expectedVersion`). Gated by `admin.menus.update` for that menu, plus the raw-HTML permission
 * (scoped to the same menu) when the body carries HTML.
 *
 * A direct feature call, not a command-gateway write: the gateway records change sets only for
 * entity types with a registered reverter, and menu trees have none, so routing through it would
 * record history nothing could revert.
 */
export const menuUpdateTreeRoute = defineJsonRoute<MenuUpdateTreeInput, AdminMenuEnvelope, MenuUpdateTreeRouteDeps, MenuRoutePrincipal>({
  method: "put",
  path: "/api/admin/v1/workspaces/:workspaceId/menus/:menuId",
  parse: (raw) => ok({ value: parseMenuTreeBody({ body: (raw.body ?? {}) as Record<string, unknown>, menuId: menuIdParam(raw.params) }) }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeMenus({ authorize, permission: "admin.menus.update" }, { entityId: input.menuId });
    await authorizeMenuHtml({ authorize, permission: deps.rawHtmlPermission, authoring: input.authoring }, { entityId: input.menuId });
    try {
      const { menu } = await updateMenuTree({
        deps: { repo: deps.menuRepo, clock: deps.clock, idGen: deps.idGen, outbox: deps.outbox, normalizeMenuHtml: deps.normalizeMenuHtml },
        input: {
          workspaceId: deps.workspaceId, id: input.menuId, expectedVersion: input.expectedVersion,
          title: input.title, slug: input.slug, items: input.items, ...input.authoring,
        },
      });
      return ok({ value: toAdminMenuResponse(menu) });
    } catch (err) {
      return rejectMenuError({ err, mappings: MENU_UPDATE_ERRORS });
    }
  },
});
