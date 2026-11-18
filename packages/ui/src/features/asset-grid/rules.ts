/**
 * Pure logic for the asset-grid feature. No React, no transport, no DOM
 * globals — `snapshotCardRects` takes an already-resolved `HTMLElement` and
 * reads only its DOM API surface (`querySelectorAll`/`getBoundingClientRect`),
 * so it stays unit-testable against a jsdom fixture without a mounted
 * component.
 */
import { ASSET_ID_ATTR, ASSET_ID_SELECTOR } from './constants.js';
import type { AssetGridDayGroup, AssetGridItem, AssetGridQuery, Band, CardRect } from './types.js';

// --- day bucketing ---------------------------------------------------------

/** Local `YYYY-MM-DD` for a Date. */
export function localDayKey({ date }: { date: Date }, _optional: Record<string, never> = {}): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** The day bucket an epoch-ms timestamp belongs to, in local time. */
export function dayKeyFromTimestamp({ timestampMs }: { timestampMs: number }, _optional: Record<string, never> = {}): string {
  return localDayKey({ date: new Date(timestampMs) });
}

export interface DayHeading {
  label: string;
  /** True for the "Today"/"Yesterday" labels — a fixed, i18n-key-worthy string. False for a locale-formatted date, which is already locale-aware and not a sensible translation key (it varies per bucket). */
  translatable: boolean;
}

/** Human heading for a `YYYY-MM-DD` day bucket — Today / Yesterday / a date. */
export function dayHeadingResult({ key }: { key: string }, { referenceDate = new Date() }: { referenceDate?: Date | undefined } = {}): DayHeading {
  const today = localDayKey({ date: referenceDate });
  const yesterday = localDayKey({ date: new Date(referenceDate.getTime() - 86_400_000) });
  if (key === today) return { label: 'Today', translatable: true };
  if (key === yesterday) return { label: 'Yesterday', translatable: true };
  const [y, m, d] = key.split('-').map(Number);
  if (!y || !m || !d) return { label: key, translatable: false };
  const label = new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return { label, translatable: false };
}

/** Convenience for callers that only need the display string (see `dayHeadingResult` for the i18n-aware form). */
export function dayHeading({ key }: { key: string }, { referenceDate = new Date() }: { referenceDate?: Date | undefined } = {}): string {
  return dayHeadingResult({ key }, { referenceDate }).label;
}

/** Groups items into day buckets (newest day first), keeping each item's flat index in `items`. */
export function groupByDay<TAsset>(
  { items, getDayKey }: { items: readonly TAsset[]; getDayKey: (asset: TAsset) => string },
  _optional: Record<string, never> = {},
): AssetGridDayGroup<TAsset>[] {
  const map = new Map<string, Array<{ asset: TAsset; index: number }>>();
  items.forEach((asset, index) => {
    const key = getDayKey(asset);
    const bucket = map.get(key);
    if (bucket) bucket.push({ asset, index });
    else map.set(key, [{ asset, index }]);
  });
  // Two-way compare, not three: `Map` entries have distinct keys by
  // construction, so `a[0] === b[0]` can never occur here — a third `: 0`
  // "equal" arm would be dead code asserting a tie that can't happen.
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, groupItems]) => ({ key, items: groupItems }));
}

// --- rubber-band multi-select ----------------------------------------------
// The cleanest generic core of this feature: operates purely on HTMLElement
// rects and Set<string> ids, with zero asset-type coupling.

/** Snapshot every rendered card's viewport rect (id + bounds) under `container`. */
export function snapshotCardRects({ container }: { container: HTMLElement | null }, _optional: Record<string, never> = {}): CardRect[] {
  const out: CardRect[] = [];
  if (!container) return out;
  container.querySelectorAll<HTMLElement>(ASSET_ID_SELECTOR).forEach((el) => {
    const id = el.getAttribute(ASSET_ID_ATTR);
    if (!id) return;
    const r = el.getBoundingClientRect();
    out.push({ id, left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  });
  return out;
}

/** Ids of cards whose snapshotted rect intersects the band rectangle. */
export function cardIdsInBand({ rects, band }: { rects: readonly CardRect[]; band: Band }, _optional: Record<string, never> = {}): string[] {
  const left = band.x;
  const top = band.y;
  const right = band.x + band.w;
  const bottom = band.y + band.h;
  const ids: string[] = [];
  for (const r of rects) {
    if (r.left < right && r.right > left && r.top < bottom && r.bottom > top) ids.push(r.id);
  }
  return ids;
}

// --- selection ---------------------------------------------------------

export function toggleSelection({ prev, id }: { prev: ReadonlySet<string>; id: string }, _optional: Record<string, never> = {}): Set<string> {
  const next = new Set(prev);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function rangeSelection<TAsset extends AssetGridItem>(
  { prev, items, anchorIndex, targetIndex }: { prev: ReadonlySet<string>; items: readonly TAsset[]; anchorIndex: number; targetIndex: number },
  _optional: Record<string, never> = {},
): Set<string> {
  const lo = Math.min(anchorIndex, targetIndex);
  const hi = Math.max(anchorIndex, targetIndex);
  const next = new Set(prev);
  for (let i = lo; i <= hi; i++) {
    const item = items[i];
    if (item) next.add(item.id);
  }
  return next;
}

export function selectAllIds<TAsset extends AssetGridItem>({ items }: { items: readonly TAsset[] }, _optional: Record<string, never> = {}): Set<string> {
  return new Set(items.map((item) => item.id));
}

/**
 * Drops selected ids that no longer exist in `items`. Returns `prev`
 * unchanged (the exact same `Set` reference) when nothing was dropped — the
 * original `LibrarySection.tsx` relied on this to let `setSelectedIds` bail
 * out of the state update via `Object.is` rather than re-rendering the whole
 * grid on every asset-list change that doesn't actually touch the selection
 * (its own comment: "Membership is a single Set lookup so a large grid +
 * large selection stays O(n)"). Always allocating a fresh `Set` here — even
 * when the filtered result is equal — would silently defeat that bail-out.
 */
export function pruneMissingSelection<TAsset extends AssetGridItem>(
  { prev, items }: { prev: Set<string>; items: readonly TAsset[] },
  _optional: Record<string, never> = {},
): Set<string> {
  if (prev.size === 0) return prev;
  const live = new Set(items.map((item) => item.id));
  const next = new Set([...prev].filter((id) => live.has(id)));
  return next.size === prev.size ? prev : next;
}

// --- live-update (SSE) merge -------------------------------------------

/**
 * Merge freshly-fetched assets into the current list for an incremental
 * live-update. Assets already present are refreshed in place (a re-ingest of
 * an existing id must not reorder the list); genuinely new assets are
 * prepended, matching a newest-first feed. Returns `prev` unchanged (the
 * exact same array reference) when `fetched` is empty, matching the original
 * `LibrarySection.tsx`'s `if (fetched.length === 0) return prev;` — allocating
 * a fresh copy here would defeat a `setAssets` caller's `Object.is` bail-out
 * for a no-op merge.
 */
export function mergeIngestedAssets<TAsset extends AssetGridItem>(
  { prev, fetched }: { prev: TAsset[]; fetched: readonly TAsset[] },
  _optional: Record<string, never> = {},
): TAsset[] {
  if (fetched.length === 0) return prev;
  const byId = new Map(fetched.map((a) => [a.id, a]));
  const present = new Set(prev.map((a) => a.id));
  const merged = prev.map((a) => byId.get(a.id) ?? a);
  const fresh = [...byId.values()].filter((a) => !present.has(a.id)).reverse();
  return fresh.length ? [...fresh, ...merged] : merged;
}

/** Parse an id out of a live-update event's `data:` payload (`{ "<idField>": "…" }`), or null. */
export function parseLiveUpdateAssetId({ data }: { data: unknown }, { idField = 'id' }: { idField?: string | undefined } = {}): string | null {
  if (typeof data !== 'string') return null;
  try {
    const parsed = JSON.parse(data) as Record<string, unknown>;
    const value = parsed[idField];
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

// --- query + filtering ---------------------------------------------------

export function buildAssetGridQuery(
  { kind, source, search }: { kind: string; source: string; search: string },
  { mapKindToQuery }: { mapKindToQuery?: ((kind: string) => string | undefined) | undefined } = {},
): AssetGridQuery {
  const q: AssetGridQuery = {};
  if (kind) {
    const mapped = mapKindToQuery ? mapKindToQuery(kind) : kind;
    if (mapped) q.kind = mapped;
  }
  if (source) q.source = source;
  const trimmed = search.trim();
  if (trimmed) q.search = trimmed;
  return q;
}

export function defaultMatchesKindFilter<TAsset>(
  { asset, filterValue, getKind }: { asset: TAsset; filterValue: string; getKind: (asset: TAsset) => string },
  _optional: Record<string, never> = {},
): boolean {
  return filterValue === '' || getKind(asset) === filterValue;
}

export function filterByKind<TAsset>(
  { items, filterValue, matches }: { items: readonly TAsset[]; filterValue: string; matches: (asset: TAsset, filterValue: string) => boolean },
  _optional: Record<string, never> = {},
): TAsset[] {
  if (!filterValue) return [...items];
  return items.filter((item) => matches(item, filterValue));
}

// --- card click dispatch ---------------------------------------------------
// Pure decision logic for the two click surfaces AssetCard exposes — kept
// here (not inline in JSX) so the branching is unit-testable in isolation
// and the component's click handlers stay one-line dispatches.

export type PreviewClickAction = 'toggle' | 'range' | 'preview';

/** What a click on the card's preview button should do, given its modifier keys. */
export function resolvePreviewClickAction(modifiers: {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}): PreviewClickAction {
  if (modifiers.metaKey || modifiers.ctrlKey) return 'toggle';
  if (modifiers.shiftKey) return 'range';
  return 'preview';
}

export type CheckboxClickAction = 'toggle' | 'range';

/** What a click on the card's select checkbox should do, given its modifier keys. */
export function resolveCheckboxClickAction(modifiers: { shiftKey: boolean }): CheckboxClickAction {
  return modifiers.shiftKey ? 'range' : 'toggle';
}

// --- facet labels ---------------------------------------------------------

/** Value -> label lookup built from a facet option list, for resolving a card's kind/source badge text. */
export function buildFacetLabelMap({ facets }: { facets: readonly { value: string; label: string }[] }, _optional: Record<string, never> = {}): Map<string, string> {
  return new Map(facets.map((f) => [f.value, f.label]));
}

/** The facet label for `value`, falling back to `value` itself when no facet option matches (e.g. no facets were configured at all). */
export function resolveFacetLabel({ value, labelsByValue }: { value: string; labelsByValue: ReadonlyMap<string, string> }, _optional: Record<string, never> = {}): string {
  return labelsByValue.get(value) ?? value;
}

// --- keyboard shortcuts ---------------------------------------------------

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** Whether `el` is a text-entry target that keyboard shortcuts should not hijack. */
export function isTypingTarget({ el }: { el: Element | null }, _optional: Record<string, never> = {}): boolean {
  if (!el) return false;
  if (el instanceof HTMLElement && (el.isContentEditable || el.getAttribute('contenteditable') === 'true')) {
    return true;
  }
  return TYPING_TAGS.has(el.tagName);
}
