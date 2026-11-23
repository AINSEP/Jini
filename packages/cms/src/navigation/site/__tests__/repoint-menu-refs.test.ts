import assert from "node:assert/strict";
import { test } from "vitest";

import type { NavItemNode, NavMenuEntry } from "../../index.js";
import { menuHoldersReferencing, repointMenuItems, type MenuRepointReplacement } from "../repoint-menu-refs.js";

/**
 * @file R1 (`plan-publish-repoint-menus-2026-09-24.md` §3) — direct unit tests for the pure tree
 * helpers `repointMenuItems` and `menuHoldersReferencing`. Neither function writes anything or
 * touches a repo; both operate on plain `NavItemNode`/`NavMenuEntry` values.
 */

function entryRefItem(overrides: Partial<NavItemNode> & { entryId: string }): NavItemNode {
  const { entryId, ...rest } = overrides;
  return {
    id: "item-1",
    target: { kind: "entryRef", entryId },
    ...rest,
  };
}

function urlItem(overrides: Partial<NavItemNode> = {}): NavItemNode {
  return {
    id: "item-url",
    target: { kind: "url", href: "https://example.com" },
    ...overrides,
  };
}

function routeItem(overrides: Partial<NavItemNode> = {}): NavItemNode {
  return {
    id: "item-route",
    target: { kind: "route", route: "home" },
    ...overrides,
  };
}

function termRefItem(overrides: Partial<NavItemNode> = {}): NavItemNode {
  return {
    id: "item-term",
    target: { kind: "termRef", termId: "term-1", taxonomy: "category" },
    ...overrides,
  };
}

function replacementMap(entries: Record<string, MenuRepointReplacement>): ReadonlyMap<string, MenuRepointReplacement> {
  return new Map(Object.entries(entries));
}

function makeMenu(overrides: Partial<NavMenuEntry> & { id: string }): NavMenuEntry {
  return {
    workspaceId: "workspace-1",
    slug: "primary-nav",
    title: "Header",
    status: "published",
    doc: { type: "menu", version: 1, items: [] },
    locations: [],
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  } as NavMenuEntry;
}

// ---------------------------------------------------------------------------
// repointMenuItems()
// ---------------------------------------------------------------------------

test("repointMenuItems() repoints a top-level entryRef target", () => {
  const items = [entryRefItem({ id: "item-1", entryId: "post-old" })];
  const replacements = replacementMap({ "post-old": { newId: "post-new", entityType: "post" } });

  const result = repointMenuItems({ items, replacements });

  assert.equal(result.count, 1);
  assert.equal(result.items[0]!.target.kind, "entryRef");
  assert.equal((result.items[0]!.target as { entryId: string }).entryId, "post-new");
});

test("repointMenuItems() retains the page hint and last-known URL when ids change on import", () => {
  const target = { kind: "entryRef" as const, entryId: "page-old", entryType: "page", lastKnownHref: "/about" };
  const result = repointMenuItems({ items: [{ id: "about", target }], replacements: replacementMap({ "page-old": { newId: "page-new", entityType: "page" } }) });
  assert.deepEqual(result.items[0]!.target, { ...target, entryId: "page-new" });
});

test("repointMenuItems() repoints a nested children grandchild", () => {
  const items = [
    {
      id: "item-parent",
      target: { kind: "url", href: "/section" } as const,
      children: [
        {
          id: "item-child",
          target: { kind: "url", href: "/section/child" } as const,
          children: [entryRefItem({ id: "item-grandchild", entryId: "post-old" })],
        },
      ],
    },
  ] satisfies NavItemNode[];
  const replacements = replacementMap({ "post-old": { newId: "post-new", entityType: "post" } });

  const result = repointMenuItems({ items, replacements });

  assert.equal(result.count, 1);
  const grandchild = result.items[0]!.children![0]!.children![0]!;
  assert.equal((grandchild.target as { entryId: string }).entryId, "post-new");
});

test("repointMenuItems() leaves url/route/termRef targets untouched", () => {
  const items = [urlItem(), routeItem(), termRefItem()];
  const replacements = replacementMap({ "post-old": { newId: "post-new", entityType: "post" } });

  const result = repointMenuItems({ items, replacements });

  assert.equal(result.count, 0);
  assert.deepEqual(result.items, items);
});

test("repointMenuItems() leaves id/label/attrs byte-equal on a repointed item", () => {
  const items = [
    entryRefItem({
      id: "item-1",
      entryId: "post-old",
      label: "About",
      attrs: { openInNewTab: true, cssClass: "nav-link" },
    }),
  ];
  const replacements = replacementMap({ "post-old": { newId: "post-new", entityType: "post" } });

  const result = repointMenuItems({ items, replacements });

  assert.equal(result.items[0]!.id, "item-1");
  assert.equal(result.items[0]!.label, "About");
  assert.deepEqual(result.items[0]!.attrs, { openInNewTab: true, cssClass: "nav-link" });
});

test("repointMenuItems() with no match returns count 0 and the input items unchanged", () => {
  const items = [entryRefItem({ id: "item-1", entryId: "post-unrelated" }), urlItem()];
  const replacements = replacementMap({ "post-old": { newId: "post-new", entityType: "post" } });

  const result = repointMenuItems({ items, replacements });

  assert.equal(result.count, 0);
  assert.deepEqual(result.items, items);
  assert.equal(result.items, items, "an unchanged tree must be returned by the SAME reference, not just an equal one");
});

test("repointMenuItems() counts two items pointing at the same old id as count 2", () => {
  const items = [
    entryRefItem({ id: "item-1", entryId: "post-old" }),
    entryRefItem({ id: "item-2", entryId: "post-old" }),
  ];
  const replacements = replacementMap({ "post-old": { newId: "post-new", entityType: "post" } });

  const result = repointMenuItems({ items, replacements });

  assert.equal(result.count, 2);
  assert.equal((result.items[0]!.target as { entryId: string }).entryId, "post-new");
  assert.equal((result.items[1]!.target as { entryId: string }).entryId, "post-new");
});

test("repointMenuItems() never mutates its input array or items", () => {
  const original = entryRefItem({ id: "item-1", entryId: "post-old" });
  const items = [original];
  const replacements = replacementMap({ "post-old": { newId: "post-new", entityType: "post" } });

  repointMenuItems({ items, replacements });

  assert.equal((original.target as { entryId: string }).entryId, "post-old", "the original item must not be mutated");
  assert.equal(items[0], original, "the original array's slot must still hold the original item");
});

// ---------------------------------------------------------------------------
// menuHoldersReferencing()
// ---------------------------------------------------------------------------

test("menuHoldersReferencing() returns one holder per (menu, referencedId)", () => {
  const menus = [
    makeMenu({
      id: "menu-header",
      title: "Header",
      doc: { type: "menu", version: 1, items: [entryRefItem({ id: "item-1", entryId: "post-about" })] },
    }),
    makeMenu({
      id: "menu-footer",
      title: "Footer",
      doc: { type: "menu", version: 1, items: [entryRefItem({ id: "footer-1", entryId: "post-about" }), entryRefItem({ id: "footer-2", entryId: "post-about" }), urlItem()] },
    }),
  ];

  const holders = menuHoldersReferencing({ menus, ids: ["post-about"] });

  assert.deepEqual(holders, [
    { entityType: "menu", entityId: "menu-header", entityLabel: "Header", referencedId: "post-about" },
    { entityType: "menu", entityId: "menu-footer", entityLabel: "Footer", referencedId: "post-about" },
  ]);
});

test("menuHoldersReferencing() de-duplicates two items in the same menu pointing at the same id", () => {
  const menus = [
    makeMenu({
      id: "menu-header",
      title: "Header",
      doc: {
        type: "menu",
        version: 1,
        items: [
          entryRefItem({ id: "item-1", entryId: "post-about" }),
          entryRefItem({ id: "item-2", entryId: "post-about" }),
        ],
      },
    }),
  ];

  const holders = menuHoldersReferencing({ menus, ids: ["post-about"] });

  assert.equal(holders.length, 1);
});

test("menuHoldersReferencing() returns two holders for one menu linking to two different wanted ids", () => {
  const menus = [
    makeMenu({
      id: "menu-header",
      title: "Header",
      doc: {
        type: "menu",
        version: 1,
        items: [
          entryRefItem({ id: "item-1", entryId: "post-about" }),
          entryRefItem({ id: "item-2", entryId: "post-contact" }),
        ],
      },
    }),
  ];

  const holders = menuHoldersReferencing({ menus, ids: ["post-about", "post-contact"] });

  assert.equal(holders.length, 2);
  assert.deepEqual(
    holders.map((h) => h.referencedId).sort(),
    ["post-about", "post-contact"]
  );
});

test("menuHoldersReferencing() finds a nested children reference", () => {
  const menus = [
    makeMenu({
      id: "menu-header",
      title: "Header",
      doc: {
        type: "menu",
        version: 1,
        items: [
          {
            id: "item-parent",
            target: { kind: "url", href: "/section" },
            children: [entryRefItem({ id: "item-child", entryId: "post-about" })],
          },
        ],
      },
    }),
  ];

  const holders = menuHoldersReferencing({ menus, ids: ["post-about"] });

  assert.deepEqual(holders, [
    { entityType: "menu", entityId: "menu-header", entityLabel: "Header", referencedId: "post-about" },
  ]);
});

test("menuHoldersReferencing() returns nothing when no menu links to any wanted id", () => {
  const menus = [makeMenu({ id: "menu-header", title: "Header", doc: { type: "menu", version: 1, items: [urlItem()] } })];

  const holders = menuHoldersReferencing({ menus, ids: ["post-about"] });

  assert.deepEqual(holders, []);
});

test("menuHoldersReferencing() called with no ids returns nothing", () => {
  const menus = [
    makeMenu({
      id: "menu-header",
      title: "Header",
      doc: { type: "menu", version: 1, items: [entryRefItem({ id: "item-1", entryId: "post-about" })] },
    }),
  ];

  const holders = menuHoldersReferencing({ menus, ids: [] });

  assert.deepEqual(holders, []);
});

test("repointMenuItems() preserves empty children and shares an unchanged nested subtree", () => {
  const leaf = entryRefItem({ id: "unrelated", entryId: "keep", children: [] });
  const branch = urlItem({ children: [leaf] });
  const items = [branch];
  const result = repointMenuItems({ items, replacements: replacementMap({ old: { newId: "new", entityType: "page" } }) });
  assert.equal(result.count, 0);
  assert.equal(result.items, items);
  assert.equal(result.items[0], branch);
  assert.equal(result.items[0]!.children, branch.children);
  assert.equal(result.items[0]!.children![0], leaf);
});

test("repointMenuItems() changing only a parent shares its unchanged children", () => {
  const children = [urlItem()];
  const original = entryRefItem({ entryId: "old", children });
  const result = repointMenuItems({ items: [original], replacements: replacementMap({ old: { newId: "new", entityType: "page" } }) });
  assert.equal(result.count, 1);
  assert.deepEqual(result.items[0]!.target, { kind: "entryRef", entryId: "new" });
  assert.equal(result.items[0]!.children, children);
  assert.deepEqual(original.target, { kind: "entryRef", entryId: "old" });
});

test("menuHoldersReferencing() ignores unmatched entry refs and empty children alongside a nested match", () => {
  const menu = makeMenu({ id: "mixed", doc: { type: "menu", version: 1, items: [
    entryRefItem({ entryId: "other", children: [] }),
    urlItem({ children: [entryRefItem({ entryId: "wanted", children: [] })] }),
  ] } });
  assert.deepEqual(menuHoldersReferencing({ menus: [menu], ids: ["wanted"] }), [
    { entityType: "menu", entityId: "mixed", entityLabel: "Header", referencedId: "wanted" },
  ]);
});

test("empty menu collections and empty item arrays preserve the no-change contract", () => {
  const items: readonly NavItemNode[] = [];
  const result = repointMenuItems({ items, replacements: replacementMap({ old: { newId: "new", entityType: "page" } }) });
  assert.equal(result.count, 0);
  assert.equal(result.items, items);
  assert.deepEqual(menuHoldersReferencing({ menus: [], ids: ["old"] }), []);
  assert.deepEqual(menuHoldersReferencing({ menus: [makeMenu({ id: "empty" })], ids: ["old"] }), []);
});
