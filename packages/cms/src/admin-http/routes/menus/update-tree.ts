import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import type { MenuHtmlAuthoring, MenuHtmlNormalizer } from "../../../navigation/menu-html.js";
import {
  MenuConflictError, MenuNotFoundError, MenuValidationError, MenuVersionConflictError, updateMenuTree, type UpdateMenuTreeDeps,
} from "../../../navigation/menu-service.js";
import type { NavItemNode } from "../../../navigation/types.js";
import { authorizeMenuHtml, parseMenuHtmlAuthoring, toAdminMenuResponse, type AdminMenuEnvelope } from "../../http/menus.js";
import {
  authorizeMenus, mapMenuError, MENU_NOT_LIVE_MAPPING, menuIdParam, rejectMenuError, type MenuErrorMapping, type MenuRoutePrincipal,
} from "./shared.js";

/** Maps `updateMenuTree`'s thrown error types onto the admin error envelope.
 *
 * The three typed cases, and a trashed menu (409 via `entityNotLiveResponse`), carry their own
 * message through to the caller. Anything else is a genuine
 * server fault and is flattened to an opaque "internal error" — but logged first (by the host's
 * error port, which receives it rethrown), matching `sendConnectorError`. Without that log the flattening is total:
 * an unmapped throw (the `TypeError` a missing menu-item `target` used to raise before
 * `@jini-ai/cms`'s `e467f5c4` guarded it) reached an operator as "something broke" with no
 * message, no stack, and no way to tell a client-shaped bug from a real outage. The response
 * body is deliberately unchanged — only the server-side diagnostic is added. */
const MENU_UPDATE_TREE_ERROR_MAPPINGS: readonly MenuErrorMapping[] = [
  MENU_NOT_LIVE_MAPPING,
  mapMenuError({ errorClass: MenuValidationError, status: 400 }),
  // Before the `MenuConflictError` entry it extends: a lost compare-and-set carries the same
  // `VERSION_CONFLICT` code posts and entries send, which is how the admin tells it from a slug 409.
  mapMenuError({ errorClass: MenuVersionConflictError, status: 409, code: "VERSION_CONFLICT" }),
  mapMenuError({ errorClass: MenuConflictError, status: 409 }),
  mapMenuError({ errorClass: MenuNotFoundError, status: 404 }),
];

/** The deps this route reads. `normalizeMenuHtml` is required for the same reason as on
 *  `create.ts`'s deps. */
export interface MenuUpdateTreeRouteDeps {
  workspaceId: string;
  menuRepo: UpdateMenuTreeDeps["repo"];
  clock: UpdateMenuTreeDeps["clock"];
  idGen: UpdateMenuTreeDeps["idGen"];
  outbox: UpdateMenuTreeDeps["outbox"];
  normalizeMenuHtml: MenuHtmlNormalizer;
}

/** The PUT body's fields plus the menu id. */
export interface MenuUpdateTreeInput {
  menuId: string;
  items: NavItemNode[] | undefined;
  expectedVersion: number;
  title: string | undefined;
  slug: string | undefined;
  authoring: MenuHtmlAuthoring;
}

/** The PUT body's fields, read off an untyped body; `items` that is not an array is the route's flat
 *  400. `items` may be omitted only by an HTML-mode write (`mode`/`html` sent), which keeps the stored tree.
 *  @complexity O(1). */
function parseMenuTreeRequestBody({ rawBody }: { rawBody: unknown }, _optional = {}): Omit<MenuUpdateTreeInput, "menuId"> {
  const body = (rawBody ?? {}) as Record<string, unknown>;
  const authoring = parseMenuHtmlAuthoring(body);
  const htmlOnly = body.items === undefined && (authoring.mode !== undefined || authoring.html !== undefined);
  if (!htmlOnly && !Array.isArray(body.items)) {
    rejectRoute({ status: 400, error: "items must be an array" });
  }
  return {
    items: body.items as NavItemNode[] | undefined,
    authoring,
    expectedVersion: Number(body.expectedVersion ?? 0),
    title: typeof body.title === "string" ? body.title : undefined,
    slug: typeof body.slug === "string" ? body.slug : undefined,
  };
}

/**
 * PUT a menu's whole item tree (ADR-029 `updateMenuTree`, whole-tree replace
 * with OCC on `expectedVersion`).
 *
 * Direct feature call, not the ADR-018 command gateway (`executeCommand`) —
 * see the handoff report: only `post/update` is registered in the revert
 * registry today, so routing menu writes
 * through the gateway would record change sets nothing can revert. Flagged
 * as a policy question for the coordinator rather than resolved unilaterally
 * here.
 *
 * Gated by `admin.menus.update` (ADR-PIPE-012 D-1/D-2/D-9 — renamed/split from the old flat navigation permission),
 * checked directly via `authorize()` (appropriate
 * here since this bypasses the gateway).
 */
export const menuUpdateTreeRoute = defineJsonRoute<MenuUpdateTreeInput, AdminMenuEnvelope, MenuUpdateTreeRouteDeps, MenuRoutePrincipal>({
  method: "put",
  path: "/api/admin/v1/workspaces/:workspaceId/menus/:menuId",
  parse: (raw) => {
    const body = parseMenuTreeRequestBody({ rawBody: raw.body });
    return ok({ value: { menuId: menuIdParam({ params: raw.params }), ...body } });
  },
  handle: async ({ input, deps, authorize }) => {
    const { menuId, authoring } = input;
    await authorizeMenus({ authorize, permission: "admin.menus.update" }, { entityId: menuId });
    await authorizeMenuHtml({ authorize, authoring }, { menuId });
    try {
      const { menu } = await updateMenuTree({
        deps: { repo: deps.menuRepo, clock: deps.clock, idGen: deps.idGen, outbox: deps.outbox, normalizeMenuHtml: deps.normalizeMenuHtml },
        input: {
          workspaceId: deps.workspaceId, id: menuId, expectedVersion: input.expectedVersion,
          title: input.title, slug: input.slug, items: input.items, ...authoring,
        },
      });
      return ok({ value: toAdminMenuResponse(menu) });
    } catch (err) {
      return rejectMenuError({ err, mappings: MENU_UPDATE_TREE_ERROR_MAPPINGS });
    }
  },
});
