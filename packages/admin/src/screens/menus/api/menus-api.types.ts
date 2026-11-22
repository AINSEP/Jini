export interface AdminMenuTarget {
  kind: "entryRef" | "termRef" | "url" | "route";
  entryId?: string;
  termId?: string;
  taxonomy?: string;
  href?: string;
  route?: string;
}

/** Mirrors Jini `NavItemAttrs` (`packages/cms/src/navigation/types.ts:104-115`) — presentational,
 *  kept separate from `target` so the render model can pass them through without interpreting them. */
export interface AdminMenuItemAttrs {
  openInNewTab?: boolean;
  rel?: string;
  cssClass?: string;
  description?: string;
  icon?: string;
}

export interface AdminMenuItem {
  id: string;
  label?: string;
  target: AdminMenuTarget;
  attrs?: AdminMenuItemAttrs;
  children?: AdminMenuItem[];
}

export interface AdminMenu {
  id: string;
  workspaceId: string;
  slug: string;
  title: string;
  status: "draft" | "published" | "trash";
  items: AdminMenuItem[];
  locations: string[];
  updatedAt: string;
  version: number;
  /** Authoring mode (Jini `NavMenuDoc.mode`): `"html"` renders {@link AdminMenu.html} at the theme's
   *  menu marker instead of the item tree. Absent on a menu never switched, which means `"items"`. */
  mode?: AdminMenuMode;
  /** The author's own menu markup, stored parse5-balanced; kept while the menu is in items mode. */
  html?: string;
}

export type AdminMenuMode = "items" | "html";

/** The optional authoring fields a menu create/update sends — omitted fields keep the stored value. */
export interface AdminMenuAuthoring {
  mode?: AdminMenuMode;
  html?: string;
}
