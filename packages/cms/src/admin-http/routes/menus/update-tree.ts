import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import {
  MenuConflictError, MenuNotFoundError, MenuValidationError, MenuVersionConflictError, updateMenuTree, type MenuHtmlAuthoring, type MenuHtmlNormalizer, type NavItemNode, type UpdateMenuTreeDeps,
} from "../../../navigation/index.js";
import type { AdminMenuEnvelope } from "@jini-ai/core/contracts/site/cms-menus";
import { parseMenuHtmlAuthoring, toAdminMenuResponse } from "../../http/menus.js";
import type { OutwardErrorMessage } from "../../http/outward-error-message.js";
import {
  authorizeMenuHtml, authorizeMenus, mapMenuError, MENU_NOT_LIVE_MAPPING, menuIdParam, rejectMenuError, type MenuErrorMapping,
  type MenuRoutePrincipal,
} from "./shared.js";

/** The deps this route reads: the update service's collaborators plus the host's raw-HTML policy. */
export interface MenuUpdateTreeRouteDeps extends Pick<UpdateMenuTreeDeps, "clock" | "idGen" | "outbox"> {
  /** Words a classified error for the caller (see {@link OutwardErrorMessage}). */
  outwardErrorMessage: OutwardErrorMessage;
  workspaceId: string;
  menuRepo: UpdateMenuTreeDeps["repo"];
  /** The permission a write carrying HTML also needs; the host owns this policy. */
  rawHtmlPermission: string;
  /** Balances submitted HTML; the host binds its runtime's parser (Node: `@jini-ai/cms/navigation/node`).
   *  Required for the same reason as on `create.ts`'s deps. */
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

/** Maps `updateMenuTree`'s thrown error types onto the admin error envelope.
 *
 * The three typed cases, and a trashed menu (409 via `entityNotLiveResponse`), carry their own
 * message through to the caller (worded by the host's `outwardErrorMessage`). Anything else is a
 * genuine server fault and is flattened to an opaque "internal error" — but logged first (by the
 * host's error port, which receives it rethrown), matching `sendConnectorError`. Without that log
 * the flattening is total: an unmapped throw (the `TypeError` a missing menu-item `target` used to
 * raise before `@jini-ai/cms`'s `e467f5c4` guarded it) reached an operator as "something broke"
 * with no message, no stack, and no way to tell a client-shaped bug from a real outage. The
 * response body is deliberately unchanged — only the server-side diagnostic is added.
 *
 * Order: liveness first, then the compare-and-set loss before the `MenuConflictError` it extends —
 * a lost compare-and-set carries the same `VERSION_CONFLICT` code posts and entries send, which is
 * how the admin tells it from a slug 409. */
const MENU_UPDATE_TREE_ERROR_MAPPINGS: readonly MenuErrorMapping[] = [
  MENU_NOT_LIVE_MAPPING,
  mapMenuError({ errorClass: MenuValidationError, status: 400 }),
  mapMenuError({ errorClass: MenuVersionConflictError, status: 409, code: "VERSION_CONFLICT" }),
  mapMenuError({ errorClass: MenuConflictError, status: 409 }),
  mapMenuError({ errorClass: MenuNotFoundError, status: 404 }),
];

/**
 * The PUT body read off the untyped body. `items` may be omitted only by an HTML-mode write
 * (`mode`/`html` sent), which keeps the stored tree; anything else without an array is the 400.
 * @complexity O(1).
 */
function parseMenuTreeBody({ body, menuId }: { body: Record<string, unknown>; menuId: string }, _optional: Record<string, never> = {}): MenuUpdateTreeInput {
  const authoring = parseMenuHtmlAuthoring({ body });
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
 * A direct feature call (`authorize()` checked directly), not an ADR-018 command-gateway write
 * (`executeCommand`): the gateway records change sets only for entity types with a registered
 * reverter (today only `post/update` is in the revert registry), and menu trees have none, so
 * routing through it would record history nothing could revert. `admin.menus.update`
 * (ADR-PIPE-012 D-1/D-2/D-9) replaced the old flat navigation permission.
 */
export const menuUpdateTreeRoute = defineJsonRoute<MenuUpdateTreeInput, AdminMenuEnvelope, MenuUpdateTreeRouteDeps, MenuRoutePrincipal>({
  method: "put",
  path: "/api/admin/v1/workspaces/:workspaceId/menus/:menuId",
  parse: (raw) => ok({ value: parseMenuTreeBody({ body: (raw.body ?? {}) as Record<string, unknown>, menuId: menuIdParam({ params: raw.params }) }) }),
  handle: async ({ input, deps, authorize }) => {
    // Two separate decisions, never merged: a host may answer each from a different source (one
    // host answers `admin.menus.update` from RBAC only, the raw-HTML permission from a publishing grant
    // when present), so the spec must ask twice. The HTML check keeps the hand-written route's
    // `...(menuId ? { entityId } : {})`: an empty parsed id sends no `entityId` key at all there.
    await authorizeMenus({ authorize, permission: "admin.menus.update" }, { entityId: input.menuId });
    await authorizeMenuHtml({ authorize, permission: deps.rawHtmlPermission, authoring: input.authoring }, input.menuId ? { entityId: input.menuId } : {});
    try {
      const { menu } = await updateMenuTree({
        deps: { repo: deps.menuRepo, clock: deps.clock, idGen: deps.idGen, outbox: deps.outbox, normalizeMenuHtml: deps.normalizeMenuHtml },
        input: {
          workspaceId: deps.workspaceId, id: input.menuId, expectedVersion: input.expectedVersion,
          title: input.title, slug: input.slug, items: input.items, ...input.authoring,
        },
      });
      return ok({ value: toAdminMenuResponse({ menu }) });
    } catch (err) {
      return rejectMenuError({ err, outwardErrorMessage: deps.outwardErrorMessage, mappings: MENU_UPDATE_TREE_ERROR_MAPPINGS });
    }
  },
});
