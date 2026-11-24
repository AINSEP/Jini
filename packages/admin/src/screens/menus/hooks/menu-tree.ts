import type { AdminMenuItem } from "../api/menus-api.types.js";

/**
 * @file The menu editor's draft-item factory and immutable tree operations, moved out of
 * `use-menu-editor.hooks.ts` with the state actions they implement (`changeAt`/`removeAt`/
 * `addChildAt`/`moveAt`/`addRootItem`). Pure: no React, no host module.
 */

/** Draft item IDs retain their browser UUID / timestamp fallback with controllable entropy. */
export interface MenuItemIdSource {
  crypto?: Partial<Pick<Crypto, "randomUUID">>;
  nowMs: () => number;
  random: () => number;
}

function newItemId({ source }: { source: MenuItemIdSource }): string {
  return source.crypto?.randomUUID?.() ?? `item-${source.nowMs()}-${source.random().toString(36).slice(2)}`;
}

/** A blank URL item with a fresh draft id. */
export function newItem({ source }: { source: MenuItemIdSource }, _optional = {}): AdminMenuItem {
  return { id: newItemId({ source }), label: "", target: { kind: "url", href: "" } };
}

// ---------------------------------------------------------------------------
// Immutable tree operations over a `path` (array of sibling indices from the
// root down to the target node). The tree is bounded (menu-service.ts caps
// depth at 5, item count at 500), so plain recursive rebuilds are fine —
// no need for an index/map structure at this scale.
// ---------------------------------------------------------------------------

export function mapAtPath(
  { items, path, fn }: { items: AdminMenuItem[]; path: number[]; fn: (item: AdminMenuItem) => AdminMenuItem },
  _optional = {},
): AdminMenuItem[] {
  if (path.length === 0) return items;
  const [index, ...rest] = path;
  return items.map((item, i) => {
    if (i !== index) return item;
    if (rest.length === 0) return fn(item);
    return { ...item, children: mapAtPath({ items: item.children ?? [], path: rest, fn: fn }) };
  });
}

export function removeAtPath({ items, path }: { items: AdminMenuItem[]; path: number[] }, _optional = {}): AdminMenuItem[] {
  if (path.length === 0) return items;
  const [index, ...rest] = path;
  if (rest.length === 0) return items.filter((_, i) => i !== index);
  return items.map((item, i) =>
    i === index ? { ...item, children: removeAtPath({ items: item.children ?? [], path: rest }) } : item
  );
}

export function addChildAtPath({ items, path, createItem }: { items: AdminMenuItem[]; path: number[]; createItem: () => AdminMenuItem }, _optional = {}): AdminMenuItem[] {
  if (path.length === 0) return [...items, createItem()];
  const [index, ...rest] = path;
  return items.map((item, i) => {
    if (i !== index) return item;
    if (rest.length === 0) return { ...item, children: [...(item.children ?? []), createItem()] };
    return { ...item, children: addChildAtPath({ items: item.children ?? [], path: rest, createItem: createItem }) };
  });
}

function getChildrenAtPath({ items, path }: { items: AdminMenuItem[]; path: number[] }, _optional = {}): AdminMenuItem[] {
  if (path.length === 0) return items;
  // The `= 0` default never applies (the empty path returned above); it only types `index`.
  const [index = 0, ...rest] = path;
  return getChildrenAtPath({ items: items[index]?.children ?? [], path: rest });
}

export function moveAtPath({ items, path, direction }: { items: AdminMenuItem[]; path: number[]; direction: -1 | 1 }, _optional = {}): AdminMenuItem[] {
  const parentPath = path.slice(0, -1);
  const index = path[path.length - 1];
  const siblings = getChildrenAtPath({ items: items, path: parentPath });
  // Every caller passes an item's own (non-empty) path; the guard only types `index`.
  if (index === undefined) return items;
  const target = index + direction;
  if (target < 0 || target >= siblings.length) return items;
  const reordered = [...siblings];
  [reordered[index], reordered[target]] = [reordered[target] as AdminMenuItem, reordered[index] as AdminMenuItem];
  // Root moves replace the list itself; nested moves replace one parent's children through
  // `mapAtPath`. (A dedicated `setChildrenAtPath` walker used to do this with its own
  // `item.children ?? []` fallback, which could never run: reaching here means `siblings` had
  // `target` in range, so every ancestor on `parentPath` already has a children array.)
  if (parentPath.length === 0) return reordered;
  return mapAtPath({ items: items, path: parentPath, fn: (parent) => ({ ...parent, children: reordered }) });
}
