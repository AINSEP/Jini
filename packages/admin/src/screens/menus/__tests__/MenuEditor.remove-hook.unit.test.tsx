// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import type { AdminMenuItem } from "../api/menus-api.types.js";
import { useMenuItemRemove } from "../MenuEditor.hooks.js";

afterEach(() => vi.restoreAllMocks());

it.each([false, true])("uses the unnamed-item fallback and singular count when confirmation is %s", (confirmed) => {
  // F2.5/F4.3: dropping the label fallback or forwarding a root path must fail.
  // The callback delivery is this hook's contract; the recursive descendant count is pinned below.
  const item: AdminMenuItem = {
    id: "unnamed", label: "", target: { kind: "url", href: "/draft" },
    children: [{ id: "nested", label: "Nested", target: { kind: "url", href: "/nested" } }],
  };
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(confirmed);
  const onRemove = vi.fn();
  const { result } = renderHook(() => useMenuItemRemove({ item: item, path: [2, 1], onRemove: onRemove }));

  act(() => result.current.handleRemoveClick());

  expect(confirm.mock.calls).toEqual([['Remove "this item"? This will also remove 1 nested item.']]);
  expect(onRemove.mock.calls).toEqual(confirmed ? [[[2, 1]]] : []);
});

it("uses the latest item, path and callback after a row changes", () => {
  // F6.2/F7.5: a stale memoized handler would remove the former row instead of the current leaf.
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const oldRemove = vi.fn();
  const currentRemove = vi.fn();
  const first: AdminMenuItem = {
    id: "parent", label: "Parent", target: { kind: "url", href: "/parent" },
    children: [{ id: "child", label: "Child", target: { kind: "url", href: "/child" } }],
  };
  const leaf: AdminMenuItem = { id: "leaf", label: "Leaf", target: { kind: "url", href: "/leaf" } };
  const { result, rerender } = renderHook(
    ({ item, path, remove }) => useMenuItemRemove({ item: item, path: path, onRemove: remove }),
    { initialProps: { item: first, path: [0], remove: oldRemove } },
  );
  act(() => result.current.handleRemoveClick());
  expect(confirm.mock.calls).toEqual([['Remove "Parent"? This will also remove 1 nested item.']]);
  expect(oldRemove.mock.calls).toEqual([]);

  rerender({ item: leaf, path: [1, 3], remove: currentRemove });
  act(() => result.current.handleRemoveClick());
  expect(confirm.mock.calls).toEqual([['Remove "Parent"? This will also remove 1 nested item.']]);
  expect(oldRemove.mock.calls).toEqual([]);
  expect(currentRemove.mock.calls).toEqual([[[1, 3]]]);
});

it("names every nested descendant, not just direct children, in the confirmation", () => {
  // A non-recursive count would say "2 nested items" here and undersell what Remove takes with it.
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const item: AdminMenuItem = {
    id: "top", label: "Top", target: { kind: "url", href: "/top" },
    children: [
      { id: "a", label: "A", target: { kind: "url", href: "/a" }, children: [{ id: "a1", label: "A1", target: { kind: "url", href: "/a1" } }] },
      { id: "b", label: "B", target: { kind: "url", href: "/b" } },
    ],
  };
  const { result } = renderHook(() => useMenuItemRemove({ item, path: [0], onRemove: vi.fn() }));
  act(() => result.current.handleRemoveClick());
  expect(confirm.mock.calls).toEqual([['Remove "Top"? This will also remove 3 nested items.']]);
});
