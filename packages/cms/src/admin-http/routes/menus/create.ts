import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import type { MenuHtmlAuthoring, MenuHtmlNormalizer } from "../../../navigation/menu-html.js";
import { createMenu, MenuConflictError, MenuValidationError, type CreateMenuDeps } from "../../../navigation/menu-service.js";
import type { NavItemNode } from "../../../navigation/types.js";
import { authorizeMenuHtml, parseMenuHtmlAuthoring, toAdminMenuResponse, type AdminMenuEnvelope } from "../../http/menus.js";
import { authorizeMenus, mapMenuError, rejectMenuError, type MenuErrorMapping, type MenuRoutePrincipal } from "./shared.js";
import type { OutwardErrorMessage } from "../../http/outward-error-message.js";

const MENU_CREATE_ERROR_MAPPINGS: readonly MenuErrorMapping[] = [
  mapMenuError({ errorClass: MenuValidationError, status: 400 }),
  mapMenuError({ errorClass: MenuConflictError, status: 409 }),
];

/** The deps this route reads. `normalizeMenuHtml` is required here (optional on the service) so
 *  a host cannot silently store submitted menu HTML unbalanced; Node hosts pass
 *  `navigation/node`'s `normalizeMenuHtml`. */
export interface MenuCreateRouteDeps {
  /** Words a classified error for the caller (see {@link OutwardErrorMessage}). */
  outwardErrorMessage: OutwardErrorMessage;
  workspaceId: string;
  menuRepo: CreateMenuDeps["repo"];
  clock: CreateMenuDeps["clock"];
  idGen: CreateMenuDeps["idGen"];
  outbox: CreateMenuDeps["outbox"];
  normalizeMenuHtml: MenuHtmlNormalizer;
}

/** This route's three body fields plus the HTML-mode authoring fields. */
export interface MenuCreateInput { title: string; slug: string; items: NavItemNode[] | undefined; authoring: MenuHtmlAuthoring }

/** This route's three body fields, read off an untyped body in one place; a present `items` that
 *  isn't an array is refused with the route's flat (code-less) 400.
 *  @complexity O(1). */
function parseMenuCreateBody({ rawBody }: { rawBody: unknown }, _optional = {}): MenuCreateInput {
  const body = (rawBody ?? {}) as Record<string, unknown>;
  if (body.items !== undefined && !Array.isArray(body.items)) {
    rejectRoute({ status: 400, error: "items must be an array" });
  }
  return {
    title: String(body.title ?? ""),
    slug: String(body.slug ?? ""),
    items: body.items as NavItemNode[] | undefined,
    authoring: parseMenuHtmlAuthoring(body),
  };
}

/**
 * POST a new menu (ADR-029 `createMenu`).
 *
 * `items` is optional (defaults to an empty menu); when supplied it is
 * validated end-to-end by `validateAndCloneTree` inside `createMenu` (id
 * uniqueness, depth/count bounds, target-kind allowlist, `url` scheme
 * denylist) — this route only rejects a non-array `items` before handing off.
 *
 * Gated by `admin.menus.create` (ADR-PIPE-012 D-1/D-2/D-9 — renamed/split from the old flat navigation permission),
 * checked directly via `authorize()` since menu mutations
 * are a direct feature call, not routed through the SPEC-001 command gateway (see `update-tree.ts`'s
 * doc for why).
 */
export const menuCreateRoute = defineJsonRoute<MenuCreateInput, AdminMenuEnvelope, MenuCreateRouteDeps, MenuRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/menus",
  parse: (raw) => ok({ value: parseMenuCreateBody({ rawBody: raw.body }) }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeMenus({ authorize, permission: "admin.menus.create" });
    await authorizeMenuHtml({ authorize, authoring: input.authoring });
    try {
      const { menu } = await createMenu({
        deps: { repo: deps.menuRepo, clock: deps.clock, idGen: deps.idGen, outbox: deps.outbox, normalizeMenuHtml: deps.normalizeMenuHtml },
        input: { workspaceId: deps.workspaceId, title: input.title, slug: input.slug, items: input.items, ...input.authoring },
      });
      return ok({ value: toAdminMenuResponse(menu) });
    } catch (err) {
      return rejectMenuError({ err, outwardErrorMessage: deps.outwardErrorMessage, mappings: MENU_CREATE_ERROR_MAPPINGS });
    }
  },
}, { successStatus: 201 });
