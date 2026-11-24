import type { AccessTokenRowCategoryId } from "./access-token-rows.js";

/** The category filter row's own ids — `"all"` plus one bucket per real row category. Every provider
 *  and every other credential store lands in exactly one of the non-`"all"` ids. */
export type AccessTokenCategoryId = "all" | AccessTokenRowCategoryId;

/** One entry of the host's ordered category table: the id and the host-owned display label. The
 *  host injects the whole table (REQUIRED by every function here that reads a label or an order),
 *  because the labels are product copy and the order is the chip row's own order. */
export interface AccessTokenCategoryInfo {
  readonly id: AccessTokenCategoryId;
  readonly label: string;
}

/** The minimal shape {@link sortAccessTokenGroups} needs from a provider group — a structural
 *  subset of the host hook's own group state so this pure sort depends on none of that hook's
 *  types. `rows` is read only for its `.length` (is there at least one saved token for this group),
 *  never its contents. */
export interface AccessTokenGroupSortInput {
  readonly info: { readonly category: AccessTokenRowCategoryId; readonly label: string };
  readonly rows: readonly unknown[];
}

/** A category id's own display label from the host's table — the row-heading counterpart to a
 *  provider's `purposeLabel` for a custom row, which has no catalog entry to read one from. A
 *  category the host's table omits reads as its own id rather than throwing mid-render.
 *  @complexity O(k) in the host's category count (a handful). */
export function accessTokenCategoryLabel({ id, categories }: { id: AccessTokenRowCategoryId; categories: readonly AccessTokenCategoryInfo[] }, _optional = {}): string {
  return categories.find((c) => c.id === id)?.label ?? id;
}

/** Whether `rowCategory` should show under the active category filter — `"all"` matches everything,
 *  every other id matches only its own bucket. @complexity O(1). */
export function accessTokenCategoryMatches({ rowCategory, activeCategory }: { rowCategory: AccessTokenRowCategoryId; activeCategory: AccessTokenCategoryId }, _optional = {}): boolean {
  return activeCategory === "all" || rowCategory === activeCategory;
}

/**
 * The Secrets page's provider-group order. Two tiers: every group with at least one saved row
 * (`rows.length > 0`) first, every "Not connected" group after. Within each tier, grouped by
 * category in the SAME order the host's category table lists them (`"all"` skipped — it is the chip
 * row's own "show everything" option and never a row's real category), then alphabetical by the
 * provider's own `label`, locale-aware and case-insensitive (`toLocaleLowerCase()` before
 * `localeCompare()`, so it reads like a human alphabetizing a shelf).
 *
 * A provider moving from zero saved rows to one needs no special case: `rows.length` IS the tier
 * a caller feeds in on every render, so a provider crossing that boundary simply sorts into the
 * other tier the next time this runs. Applies equally to the full catalog, a single-category
 * narrowing or a search narrowing — this reads only each entry's own category/label/saved-count,
 * never the set's size or the active filter. A category absent from `categories` sorts after every
 * listed one.
 *
 * Returns a NEW array — never mutates `groups` (a caller may still need the unsorted list).
 *
 * @complexity Time O(n log n + k) in the group count and category count, space O(n + k).
 */
export function sortAccessTokenGroups<T extends AccessTokenGroupSortInput>({ groups, categories }: { groups: readonly T[]; categories: readonly AccessTokenCategoryInfo[] }, _optional = {}): T[] {
  const order = categories.filter((c) => c.id !== "all").map((c) => c.id);
  const rankOf = (category: AccessTokenRowCategoryId): number => {
    const index = order.indexOf(category);
    return index === -1 ? order.length : index;
  };
  const sorted = [...groups];
  sorted.sort((a, b) => {
    const savedDiff = Number(b.rows.length > 0) - Number(a.rows.length > 0);
    if (savedDiff !== 0) return savedDiff;
    const categoryDiff = rankOf(a.info.category) - rankOf(b.info.category);
    if (categoryDiff !== 0) return categoryDiff;
    return a.info.label.trim().toLocaleLowerCase().localeCompare(b.info.label.trim().toLocaleLowerCase());
  });
  return sorted;
}
