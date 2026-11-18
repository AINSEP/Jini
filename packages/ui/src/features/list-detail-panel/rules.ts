import type { ListDetailItem } from './types.js';

/**
 * Resolve the next valid selection as `items` changes.
 *
 * Mirrors `DesignSystemsTab.tsx`'s master-detail sync effect: an empty list
 * clears the selection; a current pick that's still present is kept as-is
 * (no flicker on unrelated list updates); otherwise the first item becomes
 * the new pick.
 */
export function resolveListDetailSelection<TItem extends ListDetailItem>(
  { items, currentId }: { items: readonly TItem[]; currentId: string | null },
  _optional: Record<string, never> = {},
): string | null {
  if (items.length === 0) return null;
  if (currentId !== null && items.some((item) => item.id === currentId)) return currentId;
  return items[0]!.id;
}

/** Find the summary item matching `selectedId`, or `null` if absent/unselected. */
export function findSelectedItem<TItem extends ListDetailItem>(
  { items, selectedId }: { items: readonly TItem[]; selectedId: string | null },
  _optional: Record<string, never> = {},
): TItem | null {
  if (selectedId === null) return null;
  return items.find((item) => item.id === selectedId) ?? null;
}
