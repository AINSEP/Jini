import type { CommandPaletteItem, CommandPaletteResult } from './types.js';
import { MAX_RESULTS } from './constants.js';

/**
 * Cheap fuzzy scorer: exact match beats prefix beats substring on `name`,
 * with a lower-tier substring match against the optional `keywords` field.
 * `query` must already be trimmed and lower-cased by the caller.
 */
export function scoreItemMatch({ item, query }: { item: CommandPaletteItem; query: string }, _optional: Record<string, never> = {}): number {
  const name = item.name.toLowerCase();
  if (name === query) return 1000;
  if (name.startsWith(query)) return 500;
  if (name.includes(query)) return 250;
  if (item.keywords && item.keywords.toLowerCase().includes(query)) return 100;
  return 0;
}

/**
 * Ranks `items` against `query`. With a query, returns score-sorted matches
 * (score > 0 only), capped at `MAX_RESULTS`. With an empty query, returns
 * still-extant recents first (in `recentIds` order), then the rest by
 * `mtime` descending — every entry scored 0 in this branch.
 */
export function rankItems(
  { items, query, recentIds }: { items: readonly CommandPaletteItem[]; query: string; recentIds: readonly string[] }, _optional: Record<string, never> = {},
): CommandPaletteResult[] {
  const q = query.trim().toLowerCase();
  if (q) {
    return items
      .map((item) => ({ item, score: scoreItemMatch({ item, query: q }) }))
      .filter((result) => result.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RESULTS);
  }

  const byId = new Map(items.map((item) => [item.id, item] as const));
  const seen = new Set<string>();
  const recentItems: CommandPaletteItem[] = [];
  for (const id of recentIds) {
    const hit = byId.get(id);
    if (hit && !seen.has(id)) {
      recentItems.push(hit);
      seen.add(id);
    }
  }
  const rest = items
    .filter((item) => !seen.has(item.id))
    .slice()
    .sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0));
  return [...recentItems, ...rest].slice(0, MAX_RESULTS).map((item) => ({ item, score: 0 }));
}

/** Cursor advance with wrap-around, extracted so boundary behavior is unit-testable without simulated keyboard events. */
export function nextCursor({ current, total, direction }: { current: number; total: number; direction: 1 | -1 }, _optional: Record<string, never> = {}): number {
  if (total <= 0) return 0;
  if (direction === 1) return (current + 1) % total;
  return (current - 1 + total) % total;
}

/** Parses a recents payload defensively — malformed/foreign localStorage content degrades to an empty list rather than throwing. */
export function parseRecentIds({ raw }: { raw: string }, _optional: Record<string, never> = {}): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Pushes `id` to the front of `previous`, de-duplicating and capping at `limit`. */
export function pushRecentId({ previous, id, limit }: { previous: readonly string[]; id: string; limit: number }, _optional: Record<string, never> = {}): string[] {
  return [id, ...previous.filter((existing) => existing !== id)].slice(0, limit);
}
