/**
 * @file The Sites list's neutral rules: empty state, per-row agent handles, the list-view item
 * shape, the card's second line, and the Trash card's buttons. Pure functions over structural site
 * shapes; the host passes them to `AllSitesTab` / `SiteTrashTab` through its `AllSitesPolicy` /
 * `SiteTrashPolicy`, next to the product rules it keeps for itself.
 */
import { buildAgentListHandles } from "@jini-ai/core/agent-handles";

/** The fields of a listed site these rules read. */
export interface SitesListRuleSite { name: string; displayName: string; createdAt: string }

/** `Sites`'s own per-row agent handles. Folder names are unique under `sites/` (they ARE the
 *  directory entries), so they disambiguate one row's controls from another's — see the host's
 *  Sites screen history for this reasoning. */
export function resolveSitesRowHandles({ sites }: { sites: readonly Pick<SitesListRuleSite, "name">[] }, _optional: Record<string, never> = {}): string[] {
  return buildAgentListHandles({ prefix: "sites-row", ids: sites.map((site) => site.name) }
  );
}

/**
 * The card's second line, or `null` when there is nothing worth saying.
 *
 * `initSite` defaults `config.json.name` to the folder's own basename, so on most sites the display
 * name and the folder name are the same string — and rendering it twice is the kind of filler the
 * compact card has no room for. It appears only when an operator has actually given the site a
 * different display name.
 *
 * @complexity Time/space: O(1).
 */
export function resolveSiteSubtitle(site: Pick<SitesListRuleSite, "name" | "displayName">): string | null {
  return site.displayName === site.name ? null : site.displayName;
}

/** Whether the site list renders its empty state instead of the grid. Its own function rather than
 *  a `sites.length === 0` written in the JSX, per this file's header. */
export function resolveSitesEmpty({ sites }: { sites: readonly unknown[] }, _optional: Record<string, never> = {}): boolean {
  return sites.length === 0;
}

/** Trash rows must opt in to permanent deletion individually; restoration needs no checkbox. */
export function resolveTrashDeleteDisabled({ id, checked, busyName }: { id: string; checked: Record<string, boolean>; busyName: string | null }, _optional = {}) {
  return checked[id] !== true || busyName !== null;
}

/** Trash card controls: the permanent-delete button exists only once its row is selected. */
export function resolveTrashCardActions({ id, checked, busyName }: { id: string; checked: Record<string, boolean>; busyName: string | null }, _optional = {}) {
  return { selected: checked[id] === true, restoreDisabled: busyName !== null, deleteDisabled: resolveTrashDeleteDisabled({ id, checked, busyName }) };
}

/** The Sites page's cards in the shape the shared list view sorts: the folder name is the id, and
 *  `site` carries the rest through. @complexity O(n). */
export function resolveSiteListItems<TSite extends Pick<SitesListRuleSite, "name" | "createdAt">>({ sites }: { sites: readonly TSite[] }, _optional: Record<string, never> = {}): { id: string; name: string; createdAt: string; site: TSite }[] {
  return sites.map((site) => ({ id: site.name, name: site.name, createdAt: site.createdAt, site }));
}
