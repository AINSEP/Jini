/**
 * @file What the Websites list shows, as plain functions (owner, 2026-11-04): newest first by default,
 * a remembered "Sort by", pinned and recent sites by default with the rest one click away, and a
 * "Hidden" filter. Hiding only leaves the list; the site stays on disk.
 */

export type SiteListSort = "recent" | "oldest" | "name";
export type SiteListFilter = "pinned-recent" | "all" | "hidden";

/** What is remembered per person. */
export interface SiteListPrefs {
  sort: SiteListSort;
  pinned: readonly string[];
  hidden: readonly string[];
}

export interface SiteListItem {
  id: string;
  name: string;
  createdAt: string;
  /** A running site is never tucked away behind "All sites". */
  running?: boolean | undefined;
}

export const DEFAULT_SITE_LIST_PREFS: SiteListPrefs = { sort: "recent", pinned: [], hidden: [] };

/** How many of the newest sites the default view shows besides the pinned and running ones. */
export const SITE_LIST_RECENT_COUNT = 6;

const SORTS: readonly SiteListSort[] = ["recent", "oldest", "name"];

function createdTime(item: SiteListItem): number {
  const time = Date.parse(item.createdAt);
  return Number.isNaN(time) ? 0 : time;
}

function byName(a: SiteListItem, b: SiteListItem): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.id.localeCompare(b.id);
}

const COMPARE: Record<SiteListSort, (a: SiteListItem, b: SiteListItem) => number> = {
  recent: (a, b) => createdTime(b) - createdTime(a) || byName(a, b),
  oldest: (a, b) => createdTime(a) - createdTime(b) || byName(a, b),
  name: byName,
};

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

/**
 * Reads a stored value; anything unreadable falls back to the defaults, so a damaged entry can never
 * blank the list.
 * @returns Valid preferences. @complexity O(n) stored ids.
 */
export function parseSiteListPrefs({ stored }: { stored: string | null }, _options = {}): SiteListPrefs {
  if (!stored) return DEFAULT_SITE_LIST_PREFS;
  try {
    const value = JSON.parse(stored) as Partial<Record<keyof SiteListPrefs, unknown>> | null;
    return {
      sort: SORTS.includes(value?.sort as SiteListSort) ? (value?.sort as SiteListSort) : DEFAULT_SITE_LIST_PREFS.sort,
      pinned: stringList(value?.pinned),
      hidden: stringList(value?.hidden),
    };
  } catch {
    return DEFAULT_SITE_LIST_PREFS;
  }
}

export interface SiteListView<Item> {
  visible: readonly Item[];
  /** Every site not hidden, the number on "All sites (n)". */
  allCount: number;
  /** The number on "Hidden (n)". */
  hiddenCount: number;
}

/**
 * The cards for one filter, pinned first and then in the chosen order. `orderPins` is the pin set
 * when the view last opened: pinning or unpinning does not move a card until the view changes, so
 * nothing slides under the pointer (a double-click must never reach a second card).
 * @returns The visible items and both counts. @complexity O(n log n) in `items`.
 */
export function siteListView<Item extends SiteListItem>(
  { items, prefs, filter }: { items: readonly Item[]; prefs: SiteListPrefs; filter: SiteListFilter },
  { orderPins = prefs.pinned }: { orderPins?: readonly string[] } = {},
): SiteListView<Item> {
  const hidden = new Set(prefs.hidden);
  const kept = new Set([...prefs.pinned, ...orderPins]);
  const pinnedFirst = new Set(orderPins);
  const compare = COMPARE[prefs.sort];
  const inOrder = (list: readonly Item[]) => [...list].sort((a, b) => Number(pinnedFirst.has(b.id)) - Number(pinnedFirst.has(a.id)) || compare(a, b));
  const shown = items.filter((item) => !hidden.has(item.id));
  const counts = { allCount: shown.length, hiddenCount: items.length - shown.length };
  if (filter === "hidden") return { visible: inOrder(items.filter((item) => hidden.has(item.id))), ...counts };
  if (filter === "all") return { visible: inOrder(shown), ...counts };
  const newest = new Set([...shown].sort(COMPARE.recent).slice(0, SITE_LIST_RECENT_COUNT).map((item) => item.id));
  return { visible: inOrder(shown.filter((item) => kept.has(item.id) || newest.has(item.id) || item.running)), ...counts };
}

/** Adds or removes one id. @returns A new list. @complexity O(n). */
export function toggleListed({ list, id }: { list: readonly string[]; id: string }, _options = {}): readonly string[] {
  return list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id];
}
