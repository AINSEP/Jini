import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { createMenu, type CreateMenuDeps, type MenuHtmlAuthoring, type MenuHtmlNormalizer, type NavItemNode } from "../../../navigation/index.js";
import type { AdminMenuEnvelope } from "@jini-ai/core/contracts/site/cms-menus";
import { parseMenuHtmlAuthoring, toAdminMenuResponse } from "../../http/menus.js";
import { authorizeMenuHtml, authorizeMenus, MENU_CONFLICT, MENU_VALIDATION, rejectMenuError, type MenuRoutePrincipal } from "./shared.js";

/** The deps this route reads: the create service's collaborators plus the host's raw-HTML policy. */
export interface MenuCreateRouteDeps extends Pick<CreateMenuDeps, "clock" | "idGen" | "outbox"> {
  workspaceId: string;
  menuRepo: CreateMenuDeps["repo"];
  /** The permission a write carrying HTML also needs; the host owns this policy. */
  rawHtmlPermission: string;
  /** Balances submitted HTML; the host binds its runtime's parser (Node: `@jini-ai/cms/navigation/node`). */
  normalizeMenuHtml: MenuHtmlNormalizer;
}

/** The POST body's fields, read off the untyped body in one place. */
export interface MenuCreateInput { title: string; slug: string; items: NavItemNode[] | undefined; authoring: MenuHtmlAuthoring }

/** Unmapped failures go to the host; `create` never mapped a trashed menu or a missing one. */
const MENU_CREATE_ERRORS = [MENU_VALIDATION, MENU_CONFLICT] as const;

/**
 * POST a new menu (ADR-029 `createMenu`). Gated by `admin.menus.create`, plus the raw-HTML
 * permission when the body carries HTML.
 *
 * `items` is optional (an empty menu); when supplied, `createMenu` validates the whole tree. This
 * spec only refuses a non-array `items` — in `parse`, before any authorization, as the host did.
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
      return rejectMenuError({ err, mappings: MENU_CREATE_ERRORS });
    }
  },
}, { successStatus: 201 });
