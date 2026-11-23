import type { JsonRouteAuthorize } from "@jini-ai/core/contracts/server";

import { isMenuHtmlAuthoring, type MenuHtmlAuthoring } from "../../navigation/menu-html.js";
import { MENU_RAW_HTML_PERMISSION } from "../../navigation/site/menu-html-permission.js";
import type { NavItemNode, NavLocationBindingRow, NavMenuEntry, NavMenuMode } from "../../navigation/types.js";

/**
 * @file Response DTOs for the admin `menus` HTTP surface (ADR-029).
 *
 * Purpose:
 * Serializes `navigation` library read models (`NavMenuEntry`,
 * `NavLocationBindingRow`) into stable admin JSON envelopes, mirroring
 * `./redirects.ts`'s `toAdminRedirectResponse` pattern.
 *
 * The route-dependency shape these routes once declared here (a superset of the host's shared
 * route deps) stays with the host: each route spec in `../routes/menus/` declares only the fields
 * it reads.
 *
 * Architectural role:
 * HTTP-facing serialization only — no navigation
 * business logic lives here (that stays in `navigation/menu-service.ts`).
 */

/** Wire-format link target — structurally identical to `navigation`'s `NavTarget`. */
export type AdminMenuTargetDto = NavItemNode["target"];

export interface AdminMenuItemDto {
  id: string;
  label?: string | undefined;
  target: AdminMenuTargetDto;
  attrs?: NavItemNode["attrs"] | undefined;
  children?: AdminMenuItemDto[] | undefined;
}

export interface AdminMenuDto {
  id: string;
  workspaceId: string;
  slug: string;
  title: string;
  status: string;
  items: AdminMenuItemDto[];
  /** HTML mode (2026-10-08): absent on a menu that never used it. */
  mode?: NavMenuMode;
  html?: string;
  locations: string[];
  updatedAt: string;
  version: number;
}

export interface AdminMenuEnvelope {
  menu: AdminMenuDto;
}

export interface AdminMenuListEnvelope {
  menus: AdminMenuDto[];
}

export interface AdminMenuBindingDto {
  workspaceId: string;
  locationKey: string;
  menuId: string;
  boundAt: string;
}

export interface AdminAssignLocationEnvelope {
  menu: AdminMenuDto;
  binding: AdminMenuBindingDto;
  displacedMenu: AdminMenuDto | null;
}

export interface AdminTrashMenuEnvelope {
  trashed: true;
  id: string;
  version: number | null;
}

function toAdminMenuItemDto(node: NavItemNode): AdminMenuItemDto {
  return {
    id: node.id,
    label: node.label,
    target: node.target,
    attrs: node.attrs,
    children: node.children ? node.children.map(toAdminMenuItemDto) : undefined,
  };
}

export function toAdminMenuDto(menu: NavMenuEntry): AdminMenuDto {
  return {
    id: menu.id,
    workspaceId: menu.workspaceId,
    slug: menu.slug,
    title: menu.title,
    status: menu.status,
    items: menu.doc.items.map(toAdminMenuItemDto),
    ...(menu.doc.mode !== undefined ? { mode: menu.doc.mode } : {}),
    ...(menu.doc.html !== undefined ? { html: menu.doc.html } : {}),
    locations: [...menu.locations],
    updatedAt: menu.updatedAt,
    version: menu.version,
  };
}

export function toAdminMenuResponse(menu: NavMenuEntry): AdminMenuEnvelope {
  return { menu: toAdminMenuDto(menu) };
}

export function toAdminMenuListResponse({ menus }: { menus: NavMenuEntry[] }, _optional = {}): AdminMenuListEnvelope {
  return { menus: menus.map(toAdminMenuDto) };
}

export function toAdminMenuBindingDto(binding: NavLocationBindingRow): AdminMenuBindingDto {
  return {
    workspaceId: binding.workspaceId,
    locationKey: binding.locationKey,
    menuId: binding.menuId,
    boundAt: binding.boundAt,
  };
}

export function toAdminAssignLocationResponse(required: {
  menu: NavMenuEntry;
  binding: NavLocationBindingRow;
  displacedMenu: NavMenuEntry | null;
}): AdminAssignLocationEnvelope {
  return {
    menu: toAdminMenuDto(required.menu),
    binding: toAdminMenuBindingDto(required.binding),
    displacedMenu: required.displacedMenu ? toAdminMenuDto(required.displacedMenu) : null,
  };
}

export function toAdminTrashMenuResponse(required: { id: string; version: number | null }): AdminTrashMenuEnvelope {
  return { trashed: true, id: required.id, version: required.version };
}

/** A create/update body's HTML-mode fields as sent; `createMenu`/`updateMenuTree` validate the values. */
export function parseMenuHtmlAuthoring(body: Record<string, unknown>): MenuHtmlAuthoring {
  return {
    ...(body.mode !== undefined ? { mode: body.mode as NavMenuMode } : {}),
    ...(body.html !== undefined ? { html: body.html as string } : {}),
  };
}

/**
 * Menu HTML is trusted raw markup, so a write carrying it also needs {@link MENU_RAW_HTML_PERMISSION}
 * (the HTML-mode forms boundary). Switching back to items authors nothing and passes. A denial is
 * the injected authorizer's own refusal, thrown like the route's main permission check.
 *
 * @complexity O(1) plus the injected authorizer.
 */
export async function authorizeMenuHtml(
  { authorize, authoring }: { authorize: JsonRouteAuthorize | undefined; authoring: MenuHtmlAuthoring },
  { menuId }: { menuId?: string } = {},
): Promise<void> {
  if (!isMenuHtmlAuthoring(authoring)) return;
  if (!authorize) throw new Error("menus admin route has no authorizer");
  const required = { permission: MENU_RAW_HTML_PERMISSION, entityType: "menu" };
  await (menuId ? authorize(required, { entityId: menuId }) : authorize(required));
}
