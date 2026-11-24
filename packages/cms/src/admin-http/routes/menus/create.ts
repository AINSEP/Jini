import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { createMenu, MenuConflictError, MenuValidationError, type CreateMenuDeps, type MenuHtmlAuthoring, type MenuHtmlNormalizer, type NavItemNode } from "../../../navigation/index.js";
import type { AdminMenuEnvelope } from "@jini-ai/core/contracts/site/cms-menus";
import { parseMenuHtmlAuthoring, toAdminMenuResponse } from "../../http/menus.js";
import type { OutwardErrorMessage } from "../../http/outward-error-message.js";
import { authorizeMenuHtml, authorizeMenus, mapMenuError, rejectMenuError, type MenuErrorMapping, type MenuRoutePrincipal } from "./shared.js";

/** The deps this route reads: the create service's collaborators plus the host's raw-HTML policy. */
export interface MenuCreateRouteDeps extends Pick<CreateMenuDeps, "clock" | "idGen" | "outbox"> {
  /** Words a classified error for the caller (see {@link OutwardErrorMessage}). */
  outwardErrorMessage: OutwardErrorMessage;
  workspaceId: string;
  menuRepo: CreateMenuDeps["repo"];
  /** The permission a write carrying HTML also needs; the host owns this policy. */
  rawHtmlPermission: string;
  /** Balances submitted HTML; the host binds its runtime's parser (Node: `@jini-ai/cms/navigation/node`).
   *  Required here (optional on the service) so a host cannot silently store submitted menu HTML
   *  unbalanced. */
  normalizeMenuHtml: MenuHtmlNormalizer;
}

/** The POST body's fields, read off the untyped body in one place. */
export interface MenuCreateInput { title: string; slug: string; items: NavItemNode[] | undefined; authoring: MenuHtmlAuthoring }

/** Unmapped failures go to the host; `create` never mapped a trashed menu or a missing one. */
const MENU_CREATE_ERROR_MAPPINGS: readonly MenuErrorMapping[] = [
  mapMenuError({ errorClass: MenuValidationError, status: 400 }),
  mapMenuError({ errorClass: MenuConflictError, status: 409 }),
];

/**
 * POST a new menu (ADR-029 `createMenu`). Gated by `admin.menus.create`, plus the raw-HTML
 * permission when the body carries HTML.
 *
 * `items` is optional (defaults to an empty menu); when supplied, `createMenu` validates the whole
 * tree end to end (`validateAndCloneTree`: id uniqueness, depth/count bounds, target-kind
 * allowlist, `url` scheme denylist). This spec only refuses a non-array `items` — in `parse`,
 * before any authorization, as the host did.
 *
 * `admin.menus.create` (ADR-PIPE-012 D-1/D-2/D-9) replaced the old flat navigation permission. It is
 * checked directly via `authorize()`: menu mutations are a direct feature call, not routed through
 * the SPEC-001 command gateway (see `update-tree.ts`'s doc for why).
 */
export const menuCreateRoute = defineJsonRoute<MenuCreateInput, AdminMenuEnvelope, MenuCreateRouteDeps, MenuRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/menus",
  parse: (raw) => {
    const body = (raw.body ?? {}) as Record<string, unknown>;
    if (body.items !== undefined && !Array.isArray(body.items)) rejectRoute({ status: 400, error: "items must be an array" });
    return ok({ value: { title: String(body.title ?? ""), slug: String(body.slug ?? ""), items: body.items as NavItemNode[] | undefined, authoring: parseMenuHtmlAuthoring({ body }) } });
  },
  handle: async ({ input, deps, authorize }) => {
    await authorizeMenus({ authorize, permission: "admin.menus.create" });
    await authorizeMenuHtml({ authorize, permission: deps.rawHtmlPermission, authoring: input.authoring });
    try {
      const { menu } = await createMenu({
        deps: { repo: deps.menuRepo, clock: deps.clock, idGen: deps.idGen, outbox: deps.outbox, normalizeMenuHtml: deps.normalizeMenuHtml },
        input: { workspaceId: deps.workspaceId, title: input.title, slug: input.slug, items: input.items, ...input.authoring },
      });
      return ok({ value: toAdminMenuResponse({ menu }) });
    } catch (err) {
      return rejectMenuError({ err, outwardErrorMessage: deps.outwardErrorMessage, mappings: MENU_CREATE_ERROR_MAPPINGS });
    }
  },
}, { successStatus: 201 });
