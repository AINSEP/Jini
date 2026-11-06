import { useState } from "react";
import { siteListView, toggleListed, type SiteListFilter, type SiteListItem, type SiteListPrefs, type SiteListSort, type SiteListView } from "./site-list-view.js";

export interface SiteListController<Item> extends SiteListView<Item> {
  filter: SiteListFilter;
  setFilter(filter: SiteListFilter): void;
  sort: SiteListSort;
  setSort(sort: SiteListSort): void;
  isPinned(id: string): boolean;
  togglePin(id: string): void;
  isHidden(id: string): boolean;
  toggleHidden(id: string): void;
}

/**
 * The list's current view and its actions. The host owns storing `prefs`, which is what makes them
 * per person; the open filter lasts as long as the page. A "Hidden" filter with nothing left to show
 * falls back to the default view, so showing the last hidden site never strands the person on an
 * empty list.
 * @returns The view and its actions. @complexity O(n log n) per render in `items`.
 */
export function useSiteListView<Item extends SiteListItem>(
  { items, prefs, onPrefsChange }: { items: readonly Item[]; prefs: SiteListPrefs; onPrefsChange: (next: SiteListPrefs) => void },
  _options = {},
): SiteListController<Item> {
  const [chosenFilter, setFilter] = useState<SiteListFilter>("pinned-recent");
  const hiddenLeft = items.some((item) => prefs.hidden.includes(item.id));
  const filter = chosenFilter === "hidden" && !hiddenLeft ? "pinned-recent" : chosenFilter;
  return {
    ...siteListView({ items, prefs, filter }),
    filter,
    setFilter,
    sort: prefs.sort,
    setSort: (sort) => onPrefsChange({ ...prefs, sort }),
    isPinned: (id) => prefs.pinned.includes(id),
    togglePin: (id) => onPrefsChange({ ...prefs, pinned: toggleListed({ list: prefs.pinned, id }) }),
    isHidden: (id) => prefs.hidden.includes(id),
    toggleHidden: (id) => onPrefsChange({ ...prefs, hidden: toggleListed({ list: prefs.hidden, id }) }),
  };
}
