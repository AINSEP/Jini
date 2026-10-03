/**
 * Pure logic shared by `ResourceBoard` and `ResourceRowList`. No React, no
 * transport, no DOM. See `packages/ui/archived provenance ledger` for full provenance.
 */
import { DEFAULT_STATUS_TONE, UNMATCHED_STATUS_BUCKET } from './constants.js';
import type { ResourceBoardItem, ResourceStatusTone, ResourceStatusToneMap } from './types.js';

// --- Shared: status tone + pending-action tracking ----------------------

/** Resolves a status value's visual tone from a host-supplied map, defaulting to `'neutral'` for any status the host didn't classify. */
export function statusToneFor(status: string, toneMap: ResourceStatusToneMap | undefined): ResourceStatusTone {
  return toneMap?.[status] ?? DEFAULT_STATUS_TONE;
}

/** Stable per-(id, kind) key used to track in-flight per-item actions independently, so one item's busy action never disables an unrelated item — same pattern already established by `features/source-config-list`'s `pendingActionKey`, re-derived fresh here (deliberately not imported cross-feature; see `packages/ui/archived provenance ledger`'s "share only what correctness forces" note). */
export function pendingActionKey(id: string, kind: string): string {
  return `${kind}:${id}`;
}

export function isActionPending(pendingKeys: ReadonlySet<string>, id: string, kind: string): boolean {
  return pendingKeys.has(pendingActionKey(id, kind));
}

export function withPendingAction(pendingKeys: ReadonlySet<string>, id: string, kind: string): ReadonlySet<string> {
  const next = new Set(pendingKeys);
  next.add(pendingActionKey(id, kind));
  return next;
}

export function withoutPendingAction(pendingKeys: ReadonlySet<string>, id: string, kind: string): ReadonlySet<string> {
  if (!pendingKeys.has(pendingActionKey(id, kind))) return pendingKeys;
  const next = new Set(pendingKeys);
  next.delete(pendingActionKey(id, kind));
  return next;
}

// --- ResourceBoard rules -------------------------------------------------

/**
 * Groups items into ordered status buckets for the kanban view, mirroring
 * DesignsTab's `STATUS_ORDER.map(status => ...)` column build. Returns a
 * `Map` with one entry per `statusOrder` value, in that order, each
 * initialized to `[]` so a column with no items still renders (matching the
 * origin's "empty column" UI) — plus, only when non-empty, a trailing
 * `UNMATCHED_STATUS_BUCKET` entry for any item whose (normalized) status
 * isn't in `statusOrder` at all, rather than silently dropping it.
 */
export function groupItemsByStatus<TItem extends { status?: string }>(
  items: readonly TItem[],
  statusOrder: readonly string[],
  options?: {
    defaultStatus?: string;
    normalizeStatus?: (status: string) => string;
  },
): Map<string, TItem[]> {
  const normalize = options?.normalizeStatus ?? ((status: string) => status);
  const fallback = options?.defaultStatus;
  const columns = new Map<string, TItem[]>();
  for (const status of statusOrder) columns.set(status, []);

  const unmatched: TItem[] = [];
  for (const item of items) {
    const raw = item.status ?? fallback;
    const normalized = raw === undefined ? undefined : normalize(raw);
    const bucket = normalized !== undefined && columns.has(normalized) ? columns.get(normalized) : undefined;
    if (bucket) {
      bucket.push(item);
    } else {
      unmatched.push(item);
    }
  }
  if (unmatched.length > 0) columns.set(UNMATCHED_STATUS_BUCKET, unmatched);
  return columns;
}

/** Case-insensitive substring match over an item's `title`/`subtitle` — mirrors DesignsTab's own `filter.trim().toLowerCase()` project-name (+ live-artifact title) search. An empty/whitespace-only query returns every item unchanged. */
export function filterBoardItemsByQuery<TItem extends ResourceBoardItem>(items: readonly TItem[], query: string): TItem[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return [...items];
  return items.filter((item) => {
    const haystacks = [item.title, item.subtitle ?? ''];
    return haystacks.some((text) => text.toLowerCase().includes(trimmed));
  });
}

/**
 * Sorts items descending by `item.sortValues[sortOptionValue]` (missing
 * values sort last, stable otherwise) — the generic stand-in for
 * DesignsTab's `sub === "recent" ? sort by updatedAt : sort by createdAt`.
 * A `sortOptionValue` with no matching key at all on any item is a no-op
 * (returns items in their original order) rather than an error, so a host
 * can safely add a sort option before wiring every item's `sortValues`.
 */
export function sortBoardItems<TItem extends ResourceBoardItem>(items: readonly TItem[], sortOptionValue: string | undefined): TItem[] {
  if (!sortOptionValue) return [...items];
  return [...items]
    .map((item, index) => ({ item, index, value: item.sortValues?.[sortOptionValue] }))
    .sort((a, b) => {
      if (a.value === undefined && b.value === undefined) return a.index - b.index;
      if (a.value === undefined) return 1;
      if (b.value === undefined) return -1;
      if (a.value !== b.value) return b.value - a.value;
      return a.index - b.index;
    })
    .map((entry) => entry.item);
}

/** Toggles one id in a selection set, returning a new `Set` (DesignsTab's `toggleSelected`). */
export function toggleSelectedId(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/**
 * Prunes a selection set down to only ids still present in `validIds`
 * (DesignsTab's "drop selected ids that no longer exist" effect). Returns
 * the SAME set instance when nothing needed pruning, so a caller can skip a
 * re-render via reference equality.
 */
export function pruneSelectedIds(selected: ReadonlySet<string>, validIds: ReadonlySet<string>): ReadonlySet<string> {
  let changed = false;
  const next = new Set<string>();
  for (const id of selected) {
    if (validIds.has(id)) next.add(id);
    else changed = true;
  }
  return changed ? next : selected;
}
