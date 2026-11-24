/** Grid card sizes (owner, 2026-11-01), relative to the original card width: Small 1/3, Medium 2/3,
 *  Large = unchanged, Extra large about 1.6x. Medium is the default. The choice only moves the grid's column minimum (CSS). */
export const MEDIA_GRID_SIZES = [
  { id: "small", label: "Small" },
  { id: "medium", label: "Medium" },
  { id: "large", label: "Large" },
  { id: "xl", label: "Extra large" },
] as const;
export type MediaGridSize = (typeof MEDIA_GRID_SIZES)[number]["id"];

/** A stored value back to a size id; anything unknown is the default, Medium (2/3 of today's width; owner, 2026-11-01). */
export function parseMediaGridSize({ value }: { value: string | null }, _optional: Record<string, never> = {}): MediaGridSize {
  return MEDIA_GRID_SIZES.some((size) => size.id === value) ? (value as MediaGridSize) : "medium";
}
