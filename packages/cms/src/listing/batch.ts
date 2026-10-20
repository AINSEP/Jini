/**
 * "See more" listing batches: the one read rule every progressive listing (posts, collections, a
 * future JSON endpoint) shares. `after`/`next` count SOURCE rows already consumed, not visible ones,
 * so visibility (member access included) is applied before items are taken and a hidden row is
 * never counted twice or shown out of order.
 */

/** Batch size a see-more listing uses when its config names none. */
export const LISTING_BATCH_DEFAULT = 12;
/** Ceiling on one batch, so neither an absent nor an adversarial config turns a listing into a scan. */
export const LISTING_BATCH_MAX = 24;
/** Ceiling on the source cursor: OFFSET cost is O(after), so a forged huge cursor is refused. */
export const LISTING_AFTER_MAX = 100_000;
/** Scan rounds before a batch is returned short; `hasMore` stays correct either way. */
const LISTING_SCAN_ROUNDS = 4;

/** Reads `limit` source rows starting `offset` rows in, in the listing's own stable order. */
export type ListingSource<T> = (page: { offset: number; limit: number }) => Promise<readonly T[]>;

export interface ListingBatch<T> {
  readonly items: readonly T[];
  /** A further visible item exists after `items`. */
  readonly hasMore: boolean;
  /** Source cursor for the next batch (pass back as `after`). */
  readonly next: number;
}

/**
 * A listing's batch size from its config: `config[limitKey]` floored and clamped into
 * `[1, LISTING_BATCH_MAX]`, else `fallback` when the key is absent or not a positive finite number.
 * @complexity O(1).
 */
export function parseListingBatchSize(
  { config }: { config: Readonly<Record<string, unknown>> },
  { limitKey = 'limit', fallback = LISTING_BATCH_DEFAULT }: { limitKey?: string; fallback?: number } = {},
): number {
  const raw = config[limitKey];
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.max(1, Math.min(Math.floor(raw), LISTING_BATCH_MAX));
}

/**
 * One batch of up to `size` visible items starting at source cursor `after`. Reads `size + 1` rows a
 * round (the extra row answers `hasMore` without a COUNT), at most {@link LISTING_SCAN_ROUNDS}
 * rounds, so a run of hidden rows can shorten a batch but never make it unbounded.
 * @complexity O(rounds) source reads of `size + 1` rows each, plus O(rows) `isVisible` calls.
 */
export async function readListingBatch<T>(
  { source, after, size }: { source: ListingSource<T>; after: number; size: number },
  { isVisible = () => true }: { isVisible?: (item: T) => boolean } = {},
): Promise<ListingBatch<T>> {
  const items: T[] = [];
  let cursor = Math.max(0, Math.min(Math.floor(after), LISTING_AFTER_MAX));
  for (let round = 0; round < LISTING_SCAN_ROUNDS; round += 1) {
    const rows = await source({ offset: cursor, limit: size + 1 });
    const taken = takeVisibleRows({ rows, items, cursor, size, isVisible });
    cursor = taken.next;
    if (taken.full) return { items, hasMore: true, next: cursor };
    if (rows.length < size + 1) return { items, hasMore: false, next: cursor };
  }
  return { items, hasMore: true, next: cursor };
}

/**
 * One scan round: appends `rows`' visible rows to `items` until it holds `size`, advancing the source
 * cursor past every row consumed (hidden ones included). `full` means a visible row was met with the
 * batch already full; that row is the proof of more and is not consumed.
 * @complexity O(rows) `isVisible` calls.
 */
function takeVisibleRows<T>(
  { rows, items, cursor, size, isVisible }: { rows: readonly T[]; items: T[]; cursor: number; size: number; isVisible: (item: T) => boolean },
  _optional: Record<string, never> = {},
): { next: number; full: boolean } {
  let next = cursor;
  for (const row of rows) {
    if (isVisible(row)) {
      // A visible row past a full batch only proves there is more; it stays unconsumed.
      if (items.length === size) return { next, full: true };
      items.push(row);
    }
    next += 1;
  }
  return { next, full: false };
}

/** An in-memory {@link ListingSource} over an already-ordered array. @complexity O(limit). */
export function arrayListingSource<T>({ rows }: { rows: readonly T[] }, _optional: Record<string, never> = {}): ListingSource<T> {
  return async ({ offset, limit }) => rows.slice(offset, offset + limit);
}
