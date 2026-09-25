/**
 * @module list-handles
 *
 * How a host turns one namespace prefix (its own `agentHandle` base, e.g. `"mcp-server"`) plus a
 * list of items' own stable ids into a distinct, stable base handle per item — the shape every
 * repeated-row/repeated-card list needs, and that a per-host reimplementation risks getting
 * subtly wrong (see {@link buildAgentListHandles}'s own doc for the exact failure mode).
 *
 * The core problem: a `data-agent-element` handle is `[a-z0-9]+(-[a-z0-9]+)*` only (see
 * `element-handles.ts`), but the ids driving a real list (a form field's `id`, a content type's
 * `key`, a database row's numeric id, a configured source's own id, ...) are arbitrary strings.
 * Two different ids can also slugify to the SAME handle. Both are resolved here, once, so every
 * list surface in every host derives its handles the same way instead of each re-deriving (and
 * possibly getting wrong) the same two rules. Lives at this package's universal root — like
 * `handle.ts` and `element-handles.ts` — because it is pure data with no DOM or framework
 * involved, so any host (React, Vue, a server-rendered list) can use it identically.
 */

/**
 * Builds one distinct, stable base handle per id, positionally aligned with `ids`.
 *
 * Handles are derived from each id's own slug, not its position in the list — an agent reading
 * `page.find_elements` should see `<prefix>-about-us`, not `<prefix>-3`, so the same control keeps
 * the same handle even if rows are later reordered or filtered. An id with nothing sluggable left
 * in it (e.g. `"***"`) falls back to its 1-based position instead, so it still produces a
 * resolvable handle rather than an empty one.
 *
 * Uniqueness is enforced with a suffix SEARCH, not a single `-<index>` append: appending the index
 * alone is not collision-proof (`["x", "x-3", "x"]` would give the third entry the fallback
 * `<prefix>-x-3`, which the second entry already holds). A duplicate handle does not fail loudly —
 * it makes `page.click`/`page.fill` silently resolve to whichever element the DOM reaches first —
 * so this loop is the load-bearing part of the function, not a stylistic choice.
 *
 * @param prefix - The list's own handle namespace (e.g. `"mcp-server"`, `"form-field"`). Must
 *   already be a valid, non-empty handle segment — callers own that, same as every other
 *   `agentHandle()` base.
 * @param ids - The list items' own stable ids, in the order they are rendered.
 * @returns One base handle per id, positionally aligned with `ids`, all distinct.
 * @complexity Time O(n) typical, O(n²) worst case when every id slugifies identically (the suffix
 * search then walks the full used-set for each collision); n is a list's row/card count, which is
 * operator- or user-authored content and stays small in practice. Space O(n).
 */
export function buildAgentListHandles(prefix: string, ids: readonly string[]): string[] {
  const used = new Set<string>();
  return ids.map((id, index) => {
    const slug = id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const preferred = `${prefix}-${slug === '' ? index + 1 : slug}`;
    let handle = preferred;
    let suffix = 2;
    while (used.has(handle)) {
      handle = `${preferred}-${suffix}`;
      suffix += 1;
    }
    used.add(handle);
    return handle;
  });
}
