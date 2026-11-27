import { expect, it, vi } from "vitest";
import type { AdminMenuItem } from "../../api/menus-api.types.js";
import { addChildAtPath, mapAtPath, moveAtPath, newItem, removeAtPath, type MenuItemIdSource } from "../menu-tree.js";

const item = (id: string): AdminMenuItem => ({ id, label: id, target: { kind: "url", href: `/${id}` } });
const tree = (): AdminMenuItem[] => [
  item("outside"),
  { ...item("parent"), children: [
    { ...item("group"), children: [item("first"), item("middle"), item("last")] },
    item("sibling"),
  ] },
  item("after"),
];
const groupChildren = (items: AdminMenuItem[]) => items.find(({ id }) => id === "parent")
  ?.children?.find(({ id }) => id === "group")?.children;

it("uses browser UUIDs for otherwise identical blank draft items", () => {
  const randomUUID = vi.fn<Crypto["randomUUID"]>()
    .mockReturnValueOnce("00000000-0000-0000-0000-000000000001")
    .mockReturnValueOnce("00000000-0000-0000-0000-000000000002");
  const source = { crypto: { randomUUID }, nowMs: () => 135, random: () => 0.5 };
  expect([newItem({ source }), newItem({ source })]).toEqual([
    { id: "00000000-0000-0000-0000-000000000001", label: "", target: { kind: "url", href: "" } },
    { id: "00000000-0000-0000-0000-000000000002", label: "", target: { kind: "url", href: "" } },
  ]);
});

it.each(["missing crypto", "missing UUID method"])("combines the clock and entropy with %s", (capability) => {
  const source: MenuItemIdSource = { nowMs: () => 135, random: () => 0.5 };
  if (capability === "missing UUID method") source.crypto = {};
  expect(newItem({ source }).id).toBe("item-135-i");
});

it("changes only the selected nested leaf and leaves the previous draft intact", () => {
  const items = tree();
  const renamed = mapAtPath({ items, path: [1, 0, 1], fn: (old) => ({ ...old, label: "Changed" }) });
  expect(groupChildren(renamed)).toEqual([item("first"), { ...item("middle"), label: "Changed" }, item("last")]);
  expect(renamed.find(({ id }) => id === "outside")).toEqual(item("outside"));
  expect(items).toEqual(tree());
});

it("removes a nested leaf without deleting the root or its other descendants", () => {
  const items = tree();
  const result = removeAtPath({ items, path: [1, 0, 1] });
  expect(result).toEqual([
    item("outside"),
    { ...item("parent"), children: [{ ...item("group"), children: [item("first"), item("last")] }, item("sibling")] },
    item("after"),
  ]);
  expect(removeAtPath({ items, path: [1] })).toEqual([item("outside"), item("after")]);
  expect(items).toEqual(tree());
});

it("appends a root or a child without changing existing sibling order", () => {
  const items = tree();
  const createItem = () => item("new");
  expect(addChildAtPath({ items, path: [], createItem })).toEqual([...tree(), item("new")]);
  expect(groupChildren(addChildAtPath({ items, path: [1, 0], createItem }))).toEqual([
    item("first"), item("middle"), item("last"), item("new"),
  ]);
  expect(addChildAtPath({ items, path: [0], createItem }).find(({ id }) => id === "outside"))
    .toEqual({ ...item("outside"), children: [item("new")] });
  expect(items).toEqual(tree());
});

it("moves within a sibling group and refuses to cross its first or last boundary", () => {
  const items = tree();
  const moved = moveAtPath({ items, path: [1, 0, 1], direction: -1 });
  expect(groupChildren(moved)).toEqual([item("middle"), item("first"), item("last")]);
  expect(moved.map(({ id }) => id)).toEqual(["outside", "parent", "after"]);
  expect(moveAtPath({ items, path: [1, 0, 0], direction: -1 })).toBe(items);
  expect(moveAtPath({ items, path: [1, 0, 2], direction: 1 })).toBe(items);
  expect(moveAtPath({ items, path: [0, 0], direction: 1 })).toBe(items);
  expect(moveAtPath({ items, path: [9, 0], direction: -1 })).toBe(items);
  expect(moveAtPath({ items, path: [], direction: 1 })).toBe(items);
  expect(moveAtPath({ items, path: [1], direction: 1 }).map(({ id }) => id)).toEqual(["outside", "after", "parent"]);
  expect(items).toEqual(tree());
});

it("does not map or remove any item for an empty selection", () => {
  const items = tree();
  expect(mapAtPath({ items, path: [], fn: () => item("wrong") })).toBe(items);
  expect(removeAtPath({ items, path: [] })).toBe(items);
});

it("does not redirect edits in a nonexistent descendant to the nearest existing row", () => {
  const items = tree();
  const convert = vi.fn((row: AdminMenuItem) => ({ ...row, label: "Wrong row" }));
  const createItem = vi.fn(() => item("phantom"));
  const path = [0, 2, 1];
  const results = [
    mapAtPath({ items, path, fn: convert }),
    removeAtPath({ items, path }),
    addChildAtPath({ items, path, createItem }),
  ];
  for (const result of results) {
    expect(result).toMatchObject(items);
    expect(result.find(({ id }) => id === "outside")?.children ?? []).toEqual([]);
  }
  expect(convert.mock.calls).toEqual([]);
  expect(createItem.mock.calls).toEqual([]);
  expect(items).toEqual(tree());
});
