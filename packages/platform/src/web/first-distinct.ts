/** Items with distinct non-empty keys, in order, capped at `max`; `truncated` reports a further
 * distinct key beyond the cap (scanning stops there). @complexity O(items). */
export function firstDistinct<T>({ items, max, keyOf }: { items: readonly T[]; max: number; keyOf: (item: T) => string | null | undefined }): { picked: [string, T][]; truncated: boolean } {
  const picked = new Map<string, T>();
  const truncated = items.some((item) => {
    const key = keyOf(item);
    if (!key || picked.has(key)) return false;
    if (picked.size === max) return true;
    picked.set(key, item);
    return false;
  });
  return { picked: [...picked], truncated };
}
