import type {
  AdminMenuAttrsDto, AdminMenuAuthoringDto, AdminMenuDto, AdminMenuItemDto, AdminMenuMode as CoreAdminMenuMode,
} from "@jini-ai/core/contracts/site/cms-menus";

export interface AdminMenuTarget {
  kind: "entryRef" | "termRef" | "url" | "route";
  entryId?: string;
  termId?: string;
  taxonomy?: string;
  href?: string;
  route?: string;
}

/** Item attributes, the menu, its node and the HTML-mode fields are the server's wire shapes, declared
 *  once in Jini Core (`@jini-ai/core/contracts/site/cms-menus`, rv1123e K1) — the serializer in
 *  `@jini-ai/cms` answers exactly these, so the client no longer restates them. Only the target stays
 *  editor-specific: {@link AdminMenuTarget} is the editor's draft shape (one record, every kind's
 *  fields optional) that a node carries while the author is still filling it in. */
/** Mirrors Jini `NavItemAttrs` (`packages/cms/src/navigation/types.ts:104-115`) — presentational,
 *  kept separate from `target` so the render model can pass them through without interpreting them. */
export type AdminMenuItemAttrs = AdminMenuAttrsDto;

export type AdminMenuItem = AdminMenuItemDto<AdminMenuTarget>;

/** Authoring mode (Jini `NavMenuDoc.mode`): `"html"` renders {@link AdminMenu.html} at the theme's
 *  menu marker instead of the item tree. Absent on a menu never switched, which means `"items"`. */
/** The author's own menu markup, stored parse5-balanced; kept while the menu is in items mode. */
export type AdminMenu = AdminMenuDto<AdminMenuTarget>;

export type AdminMenuMode = CoreAdminMenuMode;

/** The optional authoring fields a menu create/update sends — omitted fields keep the stored value. */
export type AdminMenuAuthoring = AdminMenuAuthoringDto;
