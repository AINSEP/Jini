/**
 * @file The admin `menus` wire DTOs (ADR-029): the JSON bodies the menus admin routes answer with
 * and an admin client reads. Declared here, once, so the server serializer
 * (`@jini-ai/cms/admin-http/http/menus`) and any client mirror read the same shapes without the
 * client depending on CMS. Serialization and navigation rules stay in CMS; only the declarations
 * sit in Core.
 *
 * Core cannot import CMS, so the navigation unions are restated structurally here. CMS's
 * `admin-http/http/__tests__/menus.test.ts` pins them against `NavTarget`, `NavItemAttrs`,
 * `NavMenuMode` and `MenuStatus` in both directions; keep the two sides identical.
 */

import type { JsonObject } from '../../primitives/json.js';

/** A link to a content entry (navigation's `NavEntryTarget`). */
export interface AdminMenuEntryTargetDto {
  readonly kind: 'entryRef';
  readonly entryType?: string;
  readonly lastKnownHref?: string;
  readonly entryId: string;
}

/** A link to a taxonomy term (navigation's `NavTermTarget`). */
export interface AdminMenuTermTargetDto {
  readonly kind: 'termRef';
  readonly termId: string;
  readonly taxonomy: string;
}

/** An absolute or site-relative URL (navigation's `NavUrlTarget`). */
export interface AdminMenuUrlTargetDto {
  readonly kind: 'url';
  readonly href: string;
}

/** A named core route (navigation's `NavRouteTarget`) with its optional static params. */
export interface AdminMenuRouteTargetDto {
  readonly kind: 'route';
  readonly route: string;
  readonly params?: JsonObject | undefined;
}

/** Wire-format link target, as stored and answered — structurally identical to navigation's `NavTarget`. */
export type AdminMenuTargetDto = AdminMenuEntryTargetDto | AdminMenuTermTargetDto | AdminMenuUrlTargetDto | AdminMenuRouteTargetDto;

/** Presentational item attributes (navigation's `NavItemAttrs`), passed through uninterpreted. */
export interface AdminMenuAttrsDto {
  readonly openInNewTab?: boolean | undefined;
  readonly rel?: string | undefined;
  readonly cssClass?: string | undefined;
  readonly description?: string | undefined;
  readonly icon?: string | undefined;
}

/** `"items"` renders the item tree; `"html"` renders the author's own markup. */
export type AdminMenuMode = 'items' | 'html';

/** A menu's lifecycle state as answered. */
export type AdminMenuStatus = 'draft' | 'published' | 'trash';

/**
 * One tree node. `Target` defaults to the stored union; a client editor that builds targets field by
 * field may widen it to its own draft shape without restating the rest of the node.
 * `| undefined`: the serializer writes these keys even when empty (JSON drops them on the wire).
 */
export interface AdminMenuItemDto<Target = AdminMenuTargetDto> {
  id: string;
  label?: string | undefined;
  target: Target;
  attrs?: AdminMenuAttrsDto | undefined;
  children?: AdminMenuItemDto<Target>[] | undefined;
}

/** One menu as the admin reads it. `mode`/`html` are absent on a menu that never used HTML mode. */
export interface AdminMenuDto<Target = AdminMenuTargetDto> {
  id: string;
  workspaceId: string;
  slug: string;
  title: string;
  status: AdminMenuStatus;
  items: AdminMenuItemDto<Target>[];
  mode?: AdminMenuMode;
  html?: string;
  locations: string[];
  updatedAt: string;
  version: number;
}

/** The optional HTML-mode fields a create/update body sends; an omitted field keeps the stored value. */
export interface AdminMenuAuthoringDto {
  mode?: AdminMenuMode;
  html?: string;
}

/** `GET/POST/PUT …/menus[/:id]` body. */
export interface AdminMenuEnvelope { menu: AdminMenuDto }

/** `GET …/menus` body. */
export interface AdminMenuListEnvelope { menus: AdminMenuDto[] }

/** A location binding row as answered. */
export interface AdminMenuBindingDto {
  workspaceId: string;
  locationKey: string;
  menuId: string;
  boundAt: string;
}

/** `PUT …/menus/:id/location` body: the bound menu, its binding and the menu it displaced, if any. */
export interface AdminAssignLocationEnvelope {
  menu: AdminMenuDto;
  binding: AdminMenuBindingDto;
  displacedMenu: AdminMenuDto | null;
}

/** `DELETE …/menus/:id` body: the trash acknowledgement. */
export interface AdminTrashMenuEnvelope {
  trashed: true;
  id: string;
  version: number | null;
}
