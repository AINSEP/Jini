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
  /** A running site is always listed: no filter and no hide takes it out of sight (owner, 2026-11-06). */
  running?: boolean;
}

export const DEFAULT_SITE_LIST_PREFS: SiteListPrefs = { sort: "recent", pinned: [], hidden: [] };

/** How many of the newest sites the default view shows besides the pinned ones. */
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
 * Reads a stored value; anything malformed falls back to the defaults, so a damaged entry can never
 * blank the list.
 * @returns Valid preferences. @complexity O(n) stored ids.
 */
export function parseSiteListPrefs({ stored }: { stored: unknown }, _options = {}): SiteListPrefs {
  if (typeof stored !== "object" || stored === null) return DEFAULT_SITE_LIST_PREFS;
  const value = stored as Partial<Record<keyof SiteListPrefs, unknown>>;
  return {
    sort: SORTS.includes(value.sort as SiteListSort) ? (value.sort as SiteListSort) : DEFAULT_SITE_LIST_PREFS.sort,
    pinned: stringList(value.pinned),
    hidden: stringList(value.hidden),
  };
}

export interface SiteListView<Item> {
  visible: readonly Item[];
  /** Every site not hidden, the number on "All sites (n)". */
  allCount: number;
  /** The number on "Hidden (n)". */
  hiddenCount: number;
}

/**
 * The cards for one filter, pinned first and then in the chosen order.
 * @returns The visible items and both counts. @complexity O(n log n) in `items`.
 */
export function siteListView<Item extends SiteListItem>(
  { items, prefs, filter }: { items: readonly Item[]; prefs: SiteListPrefs; filter: SiteListFilter },
  _options = {},
): SiteListView<Item> {
  const hidden = new Set(items.filter((item) => !item.running).map((item) => item.id).filter((id) => prefs.hidden.includes(id)));
  const pinned = new Set(prefs.pinned);
  const compare = COMPARE[prefs.sort];
  const inOrder = (list: readonly Item[]) => [...list].sort((a, b) => Number(pinned.has(b.id)) - Number(pinned.has(a.id)) || compare(a, b));
  const shown = items.filter((item) => !hidden.has(item.id));
  const counts = { allCount: shown.length, hiddenCount: items.length - shown.length };
  if (filter === "hidden") return { visible: inOrder(items.filter((item) => hidden.has(item.id))), ...counts };
  if (filter === "all") return { visible: inOrder(shown), ...counts };
  const newest = new Set([...shown].sort(COMPARE.recent).slice(0, SITE_LIST_RECENT_COUNT).map((item) => item.id));
  return { visible: inOrder(shown.filter((item) => pinned.has(item.id) || newest.has(item.id) || item.running === true)), ...counts };
}

/** Adds or removes one id. @returns A new list. @complexity O(n). */
export function toggleListed({ list, id }: { list: readonly string[]; id: string }, _options = {}): readonly string[] {
  return list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id];
}
