/**
 * Pure mention-autocomplete logic — no React, no i18n hook. Category
 * `label`s passed through here are plain English strings meant to be
 * translated via the caller's `useT()`, per this package's i18n convention.
 */
import { ALL_CATEGORY_FILTER, DEFAULT_MAX_RESULTS_PER_CATEGORY, DEFAULT_TRIGGER_CHAR } from './constants.js';
import type { MentionCategory, MentionCategoryFilter, MentionInsertResult, MentionItem, MentionTriggerMatch } from './types.js';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Detect an in-progress `@token` ending at `cursor` within `value` (e.g. a
 * textarea's current value + selection start). The trigger must be at the
 * start of the text or preceded by whitespace, and the token itself may not
 * contain whitespace or another trigger character. Returns `null` when the
 * cursor isn't inside a live trigger.
 */
export function readMentionTrigger(
  { value, cursor }: { value: string; cursor: number },
  { triggerChar = DEFAULT_TRIGGER_CHAR }: { triggerChar?: string | undefined } = {},
): MentionTriggerMatch | null {
  const beforeCursor = value.slice(0, cursor);
  const escaped = escapeRegExp(triggerChar);
  const pattern = new RegExp(`(^|\\s)${escaped}([^\\s${escaped}]*)$`);
  const match = pattern.exec(beforeCursor);
  if (!match) return null;
  // Both capture groups are mandatory (neither is inside a `?`-optional
  // alternation) — whenever `match` is non-null, both participated and are
  // real strings (possibly empty), never `undefined`. The non-null
  // assertions just satisfy `RegExpExecArray`'s generically-optional index
  // type; there's no runtime path where either is actually missing.
  const prefix = match[1]!;
  return {
    start: match.index + prefix.length,
    end: cursor,
    query: match[2]!,
  };
}

/** Prefix `label` with `triggerChar` unless it's already there. */
export function buildMentionToken({ label }: { label: string }, { triggerChar = DEFAULT_TRIGGER_CHAR }: { triggerChar?: string | undefined } = {}): string {
  return label.startsWith(triggerChar) ? label : `${triggerChar}${label}`;
}

/**
 * Splice `token` into `value` at the active trigger match (or append it, with
 * a leading newline separator when the existing text is non-empty, when
 * there's no active match — e.g. inserting context without having typed the
 * trigger first). Trims any whitespace immediately after a replaced trigger
 * so the result doesn't end up with a double space. Returns the next value
 * plus the cursor position to restore focus to.
 */
export function insertMentionToken(
  { value, match, token }: { value: string; match: MentionTriggerMatch | null; token: string }, _optional: Record<string, never> = {},
): MentionInsertResult {
  const tokenWithSpace = `${token} `;
  if (!match) {
    const spacer = value.trim().length > 0 ? '\n' : '';
    const nextValue = `${value}${spacer}${tokenWithSpace}`;
    return { nextValue, cursor: nextValue.length };
  }
  const before = value.slice(0, match.start);
  const after = value.slice(match.end).replace(/^\s+/, '');
  const nextValue = `${before}${tokenWithSpace}${after}`;
  return { nextValue, cursor: before.length + tokenWithSpace.length };
}

/** Case-insensitive substring filter, capped to `maxResults`. `getSearchText`
 *  defaults to `label` alone; pass a richer selector to also match on id/meta/
 *  other host fields (mirrors the vendored picker's per-kind search index). */
export function filterMentionItems<T extends MentionItem>(
  { items, query }: { items: T[]; query: string },
  { getSearchText = (item) => item.label, maxResults = DEFAULT_MAX_RESULTS_PER_CATEGORY }: { getSearchText?: ((item: T) => string) | undefined; maxResults?: number | undefined } = {},
): T[] {
  const q = query.trim().toLowerCase();
  const matched = q ? items.filter((item) => getSearchText(item).toLowerCase().includes(q)) : items;
  return matched.slice(0, maxResults);
}

export interface MentionResultGroup<T extends MentionItem> {
  category: MentionCategory;
  items: T[];
}

/**
 * Group already-filtered items by category, in the given category order,
 * omitting categories that end up with zero visible items (after applying
 * `activeFilter`). Each category's item list is capped to
 * `maxItemsPerCategory` independently — matching the vendored picker's
 * per-kind `.slice(0, 10)` (each capability kind got its own 10-result cap,
 * not one shared cap across every kind combined).
 */
export function groupItemsByCategory<T extends MentionItem>(
  { items, categories }: { items: T[]; categories: MentionCategory[] },
  { activeFilter = ALL_CATEGORY_FILTER, maxItemsPerCategory = DEFAULT_MAX_RESULTS_PER_CATEGORY }: { activeFilter?: MentionCategoryFilter | undefined; maxItemsPerCategory?: number | undefined } = {},
): MentionResultGroup<T>[] {
  const groups: MentionResultGroup<T>[] = [];
  for (const category of categories) {
    if (!isCategoryVisible({ activeFilter, categoryId: category.id })) continue;
    const categoryItems = items.filter((item) => item.category === category.id).slice(0, maxItemsPerCategory);
    if (categoryItems.length > 0) groups.push({ category, items: categoryItems });
  }
  return groups;
}

/** Is `categoryId` shown under the current tab filter? True when the filter
 *  is `'all'` or matches the category exactly. */
export function isCategoryVisible({ activeFilter, categoryId }: { activeFilter: MentionCategoryFilter; categoryId: string }, _optional: Record<string, never> = {}): boolean {
  return activeFilter === ALL_CATEGORY_FILTER || activeFilter === categoryId;
}

/**
 * A composite `category:id` selection key. Items are only guaranteed unique
 * within their own category (two different categories may reuse the same
 * raw id, e.g. a "general" skill and a "general" plugin), so selection
 * tracking keys on the pair rather than the bare id.
 */
export function mentionSelectionKey({ categoryId, itemId }: { categoryId: string; itemId: string }, _optional: Record<string, never> = {}): string {
  return `${categoryId}:${itemId}`;
}

/** Whether there's at least one visible group — drives the "no results"/
 *  empty state. `groupItemsByCategory` never returns an empty-items group
 *  (it filters those out itself), so this is equivalent to `groups.length >
 *  0` for groups produced that way; expressed as a named predicate so the
 *  call site reads as intent rather than an array-length check. */
export function hasAnyResults<T extends MentionItem>({ groups }: { groups: MentionResultGroup<T>[] }, _optional: Record<string, never> = {}): boolean {
  return groups.length > 0;
}
