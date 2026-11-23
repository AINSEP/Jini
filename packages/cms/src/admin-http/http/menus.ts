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
 * HTTP-facing serialization only. Navigation rules stay in `navigation/menu-service.ts`; the host's
 * route-dependency bag and registrar type stay with the host that mounts these specs.
 */

/** Wire-format link target — structurally identical to `navigation`'s `NavTarget`. */
export type AdminMenuTargetDto = NavItemNode["target"];

export interface AdminMenuItemDto {
  id: string;
  // `| undefined`: the serializer writes these keys even when empty (JSON drops them on the wire).
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

export interface AdminMenuEnvelope { menu: AdminMenuDto }
export interface AdminMenuListEnvelope { menus: AdminMenuDto[] }

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

/** One tree node; recursion depth is bounded by the service's tree-depth limit. @complexity O(n) in the subtree size. */
function toAdminMenuItemDto(node: NavItemNode): AdminMenuItemDto {
  return {
    id: node.id,
    label: node.label,
    target: node.target,
    attrs: node.attrs,
    children: node.children ? node.children.map(toAdminMenuItemDto) : undefined,
  };
}

/** @complexity O(n) in the menu's item count. */
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

export function toAdminMenuListResponse({ menus }: { menus: NavMenuEntry[] }, _optional: Record<string, never> = {}): AdminMenuListEnvelope {
  return { menus: menus.map(toAdminMenuDto) };
}

export function toAdminMenuBindingDto(binding: NavLocationBindingRow): AdminMenuBindingDto {
  return { workspaceId: binding.workspaceId, locationKey: binding.locationKey, menuId: binding.menuId, boundAt: binding.boundAt };
}

export function toAdminAssignLocationResponse(required: {
  menu: NavMenuEntry;
  binding: NavLocationBindingRow;
  displacedMenu: NavMenuEntry | null;
}, _optional: Record<string, never> = {}): AdminAssignLocationEnvelope {
  return {
    menu: toAdminMenuDto(required.menu),
    binding: toAdminMenuBindingDto(required.binding),
    displacedMenu: required.displacedMenu ? toAdminMenuDto(required.displacedMenu) : null,
  };
}

export function toAdminTrashMenuResponse(required: { id: string; version: number | null }, _optional: Record<string, never> = {}): AdminTrashMenuEnvelope {
  return { trashed: true, id: required.id, version: required.version };
}

/** A create/update body's HTML-mode fields as sent; `createMenu`/`updateMenuTree` validate the values. @complexity O(1). */
export function parseMenuHtmlAuthoring(body: Record<string, unknown>): MenuHtmlAuthoring {
  return {
    ...(body.mode !== undefined ? { mode: body.mode as NavMenuMode } : {}),
    ...(body.html !== undefined ? { html: body.html as string } : {}),
  };
}
