import type { NavItemNode, NavMenuEntry } from "../types.js";

/**
 * @file Pure tree helpers for R1 of `ADS-memory/.local-artifacts/plan-publish-repoint-menus-2026-09-24.md`
 * ("publish 'Overwrite on live' repoints live menu links"). Two read-only/pure functions:
 * {@link repointMenuItems} rewrites `entryRef` targets that point at a retired holder to the row
 * that replaced it; {@link menuHoldersReferencing} finds which live menus hold such a link in the
 * first place, for the plan-time warning. Neither writes anything — the `menu` publish handler's
 * `referencesTo`/`repointReferences` methods (a later slice) are the write/read-through-a-repo half
 * that calls these and persists the result.
 *
 * Deviation from the design doc, recorded rather than silently dropped: §2.1/§2.4 describe an
 * `entryRef.contentType` field this helper should keep-or-update alongside `entryId`. The installed
 * `@jini-ai/cms` `NavEntryTarget` (`node_modules/@jini-ai/cms/dist/navigation/types.d.ts:50-54`,
 * `readonly kind: "entryRef"; readonly entryId: UUID;`) has never carried that field — confirmed
 * against the Jini source (`Jini/packages/cms/src/navigation/types.ts`, both of its two commits
 * touching this file leave `NavEntryTarget` exactly this shape). There is nothing to keep or update,
 * so {@link repointMenuItems} only ever touches `entryId`.
 */

/** One `entryId -> newId` swap {@link repointMenuItems} applies to a matching `entryRef` target.
 *  `entityType` is carried for the caller's own bookkeeping (e.g. matching a `RetireTarget`'s kind)
 *  — this helper does not read it, per this file's header deviation note. */
export interface MenuRepointReplacement {
  readonly newId: string;
  readonly entityType: string;
}

/** A live menu holding at least one item that currently links to `referencedId`. */
export interface ReferenceHolder {
  readonly entityType: string;
  readonly entityId: string;
  readonly entityLabel: string | null;
  readonly referencedId: string;
}

/**
 * Rewrites every `entryRef` target whose `entryId` is a key of `replacements` to that
 * replacement's `newId`, recursively through `children`. Never mutates `items` or any node in it —
 * an unchanged node (and, if nothing under it changed, an unchanged array) is returned by the SAME
 * reference it was given, so a caller can tell "nothing changed" from `count === 0` without a second
 * deep-equality pass, and structural sharing keeps a no-match call's allocation cost independent of
 * how much of the tree it walked.
 *
 * `url`/`route`/`termRef` targets are never inspected beyond their `kind` discriminant — only
 * `entryRef` can go stale (see the plan's §1).
 *
 * @complexity O(n) over every item in the tree (n = total item count including descendants).
 */
export function repointMenuItems(
  { items, replacements }: { items: readonly NavItemNode[]; replacements: ReadonlyMap<string, MenuRepointReplacement> },
  _optional: Record<string, never> = {},
): { items: readonly NavItemNode[]; count: number } {
  let count = 0;
  const next = items.map((item) => {
    const repointed = repointItem(item, replacements);
    count += repointed.count;
    return repointed.item;
  });
  const changed = next.some((item, index) => item !== items[index]);
  return { items: changed ? next : items, count };
}

/** Repoints one node's own `entryRef` (if it matches) and recurses into its `children`. */
function repointItem(
  item: NavItemNode,
  replacements: ReadonlyMap<string, MenuRepointReplacement>
): { item: NavItemNode; count: number } {
  let count = 0;
  let target = item.target;
  if (target.kind === "entryRef") {
    const replacement = replacements.get(target.entryId);
    if (replacement) {
      target = { ...target, entryId: replacement.newId };
      count += 1;
    }
  }

  let children = item.children;
  if (children && children.length > 0) {
    const repointedChildren = repointMenuItems({ items: children, replacements });
    count += repointedChildren.count;
    children = repointedChildren.items;
  }

  if (target === item.target && children === item.children) {
    return { item, count };
  }
  return { item: { ...item, target, children }, count };
}

/**
 * Read-only scan of live menus for `entryRef` items linking to any id in `ids` — the plan-time
 * "which menus would this overwrite silently break" check. Walks each menu's `doc.items`
 * recursively (same tree shape {@link repointMenuItems} walks) and returns **one holder per
 * `(menu, referencedId)` pair**: a menu with two items pointing at the same retired id yields a
 * single entry for it, but a menu pointing at two different ids in `ids` yields two.
 *
 * @complexity O(n) over every item across every menu (n = total item count including descendants),
 * plus O(m) for the per-menu de-duplication set (m = menus).
 */
export function menuHoldersReferencing(
  { menus, ids }: { menus: readonly NavMenuEntry[]; ids: readonly string[] },
  _optional: Record<string, never> = {},
): readonly ReferenceHolder[] {
  const wanted = new Set(ids);
  const holders: ReferenceHolder[] = [];
  for (const menu of menus) {
    const referencedInThisMenu = new Set<string>();
    collectReferencedIds({ items: menu.doc.items, wanted, into: referencedInThisMenu });
    for (const referencedId of referencedInThisMenu) {
      holders.push({
        entityType: "menu",
        entityId: menu.id,
        entityLabel: menu.title,
        referencedId,
      });
    }
  }
  return holders;
}

/** Recursively collects every `entryRef.entryId` in `items` (and their `children`) that is a
 *  member of `wanted`, into `into`. */
function collectReferencedIds(
  { items, wanted, into }: { items: readonly NavItemNode[]; wanted: ReadonlySet<string>; into: Set<string> },
  _optional = {}
): void {
  for (const item of items) {
    if (item.target.kind === "entryRef" && wanted.has(item.target.entryId)) {
      into.add(item.target.entryId);
    }
    if (item.children && item.children.length > 0) {
      collectReferencedIds({ items: item.children, wanted, into });
    }
  }
}
