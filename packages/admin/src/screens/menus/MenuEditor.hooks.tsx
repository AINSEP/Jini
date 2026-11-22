import type { AdminMenuItem } from "./api/menus-api.types.js";

/**
 * @file `ItemRow`'s Remove-button confirmation logic (audit Major finding: Remove previously
 * deleted a clicked item's entire subtree in one click, no confirmation, no indication children
 * existed) — split out of `MenuEditor.tsx`'s component body per the
 * `<Name>.tsx`/`<Name>.hooks.tsx` extraction pattern (admin TSX-logic-sweep, 2026-09-05).
 * `MenuEditor.tsx`'s own state/API calls all live in `hooks/use-menu-editor.hooks.ts`; this is a
 * second, LOCAL hook for markup-adjacent interaction logic that hook has no reason to own — same
 * split `Jini packages/admin/src/seo/react/hooks/SitemapModal.hooks.ts` uses for its own regenerate-then-refetch sequencing.
 *
 * `countDescendants` moves here too (rather than staying in `MenuEditor.tsx` and being imported
 * back, which would make the two files import each other): its one caller is
 * `useMenuItemRemove` below, so relocating both together avoids a cycle.
 */

/** Total nested descendant count (children, grandchildren, …) — used to name exactly how many
 *  items a Remove click would take with it. Recursive, not just `.children.length`, so a deep
 *  removal is described accurately rather than undercounted — the tree is depth/size-bounded
 *  (menu-service.ts caps depth at 5, item count at 500), so a plain recursive walk is cheap at
 *  this scale. */
function countDescendants(item: AdminMenuItem): number {
  const children = item.children ?? [];
  return children.length + children.reduce((sum, child) => sum + countDescendants(child), 0);
}

/**
 * A leaf item (no children) stays a bare click, matching this screen's own
 * `FormFieldsEditor`-sibling "Remove" convention for low-stakes removals; an item with
 * descendants asks for confirmation naming exactly how many nested items would go with it.
 *
 * @param required.item - The item the Remove button belongs to; only its own descendant count is read.
 * @param required.path - Forwarded to `onRemove` unchanged.
 * @param required.onRemove - Called with `path` once the removal is confirmed (or needed no confirmation).
 * @returns `handleRemoveClick`, wired directly to the Remove button's `onClick`.
 * @complexity O(n) in the item's own subtree size, via `countDescendants` — same cost the
 *   original inline call already paid.
 */
export function useMenuItemRemove(
  { item, path, onRemove }: { item: AdminMenuItem; path: number[]; onRemove: (path: number[]) => void },
  _optional = {},
): { handleRemoveClick: () => void } {
  function handleRemoveClick(): void {
    const descendantCount = countDescendants(item);
    if (
      descendantCount > 0 &&
      !window.confirm(
        `Remove "${item.label || "this item"}"? This will also remove ${descendantCount} nested item${descendantCount === 1 ? "" : "s"}.`
      )
    ) {
      return;
    }
    onRemove(path);
  }
  return { handleRemoveClick };
}
