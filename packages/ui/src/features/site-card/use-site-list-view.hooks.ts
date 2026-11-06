import { useCallback, useState } from "react";
import { parseSiteListPrefs, siteListView, toggleListed, type SiteListFilter, type SiteListItem, type SiteListPrefs, type SiteListSort, type SiteListView } from "./site-list-view.js";

/** Where the choices live. The host decides the key, which is what makes them per person. */
export interface SiteListStorage {
  read(): string | null;
  write(value: string): void;
}

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

/** `window.localStorage` under one key; a denied store only means the choices are not remembered. */
export function localSiteListStorage({ key }: { key: string }, _options = {}): SiteListStorage {
  return {
    read() {
      try { return window.localStorage.getItem(key); } catch { return null; }
    },
    write(value) {
      try { window.localStorage.setItem(key, value); } catch { /* Not remembered; the list still works. */ }
    },
  };
}

/**
 * Sort, pins and hidden sites for one list, written through at each change.
 * @returns The current view and its actions. @complexity O(n log n) per render in `items`.
 */
export function useSiteListView<Item extends SiteListItem>({ items, storage }: { items: readonly Item[]; storage: SiteListStorage }, _options = {}): SiteListController<Item> {
  const [prefs, setPrefs] = useState<SiteListPrefs>(() => parseSiteListPrefs({ stored: storage.read() }));
  const [filter, setFilterState] = useState<SiteListFilter>("pinned-recent");
  const [orderPins, setOrderPins] = useState<readonly string[]>(prefs.pinned);

  const update = useCallback((next: SiteListPrefs) => {
    setPrefs(next);
    storage.write(JSON.stringify(next));
  }, [storage]);

  return {
    ...siteListView({ items, prefs, filter }, { orderPins }),
    filter,
    setFilter(next) { setFilterState(next); setOrderPins(prefs.pinned); },
    sort: prefs.sort,
    setSort(sort) { update({ ...prefs, sort }); setOrderPins(prefs.pinned); },
    isPinned: (id) => prefs.pinned.includes(id),
    togglePin: (id) => update({ ...prefs, pinned: toggleListed({ list: prefs.pinned, id }) }),
    isHidden: (id) => prefs.hidden.includes(id),
    toggleHidden: (id) => update({ ...prefs, hidden: toggleListed({ list: prefs.hidden, id }) }),
  };
}
