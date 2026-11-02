/**
 * @file Menu link `rel` policy (owner decision 2026-11-02). A menu item's `rel` keeps only standard
 * link-type tokens; anything else is dropped (not rejected, so an old or agent-written menu still
 * saves). A link that opens in a new tab always carries `noopener noreferrer`, so the opened page
 * cannot reach back through `window.opener` or learn the referring URL.
 *
 * Two callers, one rule: `validateAndCloneTree` (the write chokepoint) stores the clean value, and
 * `resolveMenuDoc` cleans rows stored before this policy, so every renderer of a resolved menu gets
 * the same `attrs.rel` without re-implementing the rule.
 */

/** Standard HTML link-type tokens a menu `<a>` may carry. */
export const MENU_REL_TOKENS: ReadonlySet<string> = new Set([
  "noopener", "noreferrer", "nofollow", "ugc", "sponsored", "external", "me",
  "author", "help", "license", "prev", "next", "tag", "bookmark",
]);

/**
 * The stored/rendered `rel` for one menu item.
 *
 * @param required.rel - Authored `rel` text; untrusted, so a non-string counts as absent.
 * @param optional.openInNewTab - When `true`, `noopener noreferrer` are always present.
 * @returns Lower-cased, de-duplicated allowed tokens in authored order (new-tab tokens appended),
 *   or `undefined` when none remain.
 * @complexity O(n) in the length of `rel`.
 */
export function normalizeMenuRel(
  { rel }: { rel: string | undefined },
  { openInNewTab }: { openInNewTab?: boolean | undefined } = {},
): string | undefined {
  const authored = typeof rel === "string" ? rel.toLowerCase().split(/[^a-z]+/) : [];
  const tokens = new Set(authored.filter((token) => MENU_REL_TOKENS.has(token)));
  if (openInNewTab === true) {
    tokens.add("noopener");
    tokens.add("noreferrer");
  }
  return tokens.size > 0 ? [...tokens].join(" ") : undefined;
}

/**
 * `attrs` with its `rel` replaced by {@link normalizeMenuRel}'s result (key omitted when nothing
 * remains). Returns a new object; `undefined` stays `undefined` (an item with no attrs gets none).
 *
 * @complexity O(n) in the length of `attrs.rel`.
 */
export function normalizeMenuItemAttrs<T extends { rel?: string | undefined; openInNewTab?: boolean | undefined }>(
  { attrs }: { attrs: T | undefined },
): T | undefined {
  if (!attrs || typeof attrs !== "object") return attrs;
  const { rel: authored, ...rest } = attrs;
  const rel = normalizeMenuRel({ rel: authored }, { openInNewTab: attrs.openInNewTab });
  return (rel === undefined ? rest : { ...rest, rel }) as T;
}
