import type {
  AdminAssignLocationEnvelope, AdminMenuBindingDto, AdminMenuDto, AdminMenuEnvelope, AdminMenuItemDto, AdminMenuListEnvelope,
  AdminTrashMenuEnvelope,
} from "@jini-ai/core/contracts/site/cms-menus";

import type { MenuHtmlAuthoring, NavItemNode, NavLocationBindingRow, NavMenuEntry, NavMenuMode } from "../../navigation/index.js";

/**
 * @file Response DTOs for the admin `menus` HTTP surface (ADR-029).
 *
 * Purpose:
 * Serializes `navigation` read models (`NavMenuEntry`, `NavLocationBindingRow`) into the stable
 * admin JSON envelopes (`{ menu }`, `{ menus }`, `{ menu, binding, displacedMenu }`, the trash
 * acknowledgement). The keys and the `undefined`-valued optional item fields are kept exactly as
 * the host's hand-written routes wrote them, because the admin client and the host's wire tests
 * read these bodies byte for byte.
 *
 * Architectural role:
 * HTTP-facing serialization only. The wire DTO declarations live in neutral Core
 * (`@jini-ai/core/contracts/site/cms-menus`) so an admin client reads the same shapes without
 * depending on CMS; navigation rules stay in `navigation/menu-service.ts`; the host's
 * route-dependency bag and registrar type stay with the host that mounts these specs.
 */

/** One tree node; recursion depth is bounded by the service's tree-depth limit. @complexity O(n) in the subtree size. */
function toAdminMenuItemDto({ node }: { node: NavItemNode }, _optional: Record<string, never> = {}): AdminMenuItemDto {
  return {
    id: node.id,
    label: node.label,
    target: node.target,
    attrs: node.attrs,
    children: node.children ? node.children.map((child) => toAdminMenuItemDto({ node: child })) : undefined,
  };
}

/** @complexity O(n) in the menu's item count. */
export function toAdminMenuDto({ menu }: { menu: NavMenuEntry }, _optional: Record<string, never> = {}): AdminMenuDto {
  return {
    id: menu.id,
    workspaceId: menu.workspaceId,
    slug: menu.slug,
    title: menu.title,
    status: menu.status,
    items: menu.doc.items.map((node) => toAdminMenuItemDto({ node })),
    ...(menu.doc.mode !== undefined ? { mode: menu.doc.mode } : {}),
    ...(menu.doc.html !== undefined ? { html: menu.doc.html } : {}),
    locations: [...menu.locations],
    updatedAt: menu.updatedAt,
    version: menu.version,
  };
}

/** @complexity O(n) in the menu's item count. */
export function toAdminMenuResponse({ menu }: { menu: NavMenuEntry }, _optional: Record<string, never> = {}): AdminMenuEnvelope {
  return { menu: toAdminMenuDto({ menu }) };
}

export function toAdminMenuListResponse({ menus }: { menus: NavMenuEntry[] }, _optional: Record<string, never> = {}): AdminMenuListEnvelope {
  return { menus: menus.map((menu) => toAdminMenuDto({ menu })) };
}

/** Only the four wire fields, whatever else the row carries. @complexity O(1). */
export function toAdminMenuBindingDto({ binding }: { binding: NavLocationBindingRow }, _optional: Record<string, never> = {}): AdminMenuBindingDto {
  return { workspaceId: binding.workspaceId, locationKey: binding.locationKey, menuId: binding.menuId, boundAt: binding.boundAt };
}

export function toAdminAssignLocationResponse(required: {
  menu: NavMenuEntry;
  binding: NavLocationBindingRow;
  displacedMenu: NavMenuEntry | null;
}, _optional: Record<string, never> = {}): AdminAssignLocationEnvelope {
  return {
    menu: toAdminMenuDto({ menu: required.menu }),
    binding: toAdminMenuBindingDto({ binding: required.binding }),
    displacedMenu: required.displacedMenu ? toAdminMenuDto({ menu: required.displacedMenu }) : null,
  };
}

export function toAdminTrashMenuResponse(required: { id: string; version: number | null }, _optional: Record<string, never> = {}): AdminTrashMenuEnvelope {
  return { trashed: true, id: required.id, version: required.version };
}

/** A create/update body's HTML-mode fields as sent; `createMenu`/`updateMenuTree` validate the values. @complexity O(1). */
export function parseMenuHtmlAuthoring({ body }: { body: Record<string, unknown> }, _optional: Record<string, never> = {}): MenuHtmlAuthoring {
  return {
    ...(body.mode !== undefined ? { mode: body.mode as NavMenuMode } : {}),
    ...(body.html !== undefined ? { html: body.html as string } : {}),
  };
}
