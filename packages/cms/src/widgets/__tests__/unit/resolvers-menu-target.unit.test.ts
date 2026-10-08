import { resolveMenuDoc } from "../../../navigation/index.js";
import assert from "node:assert/strict";
import test from "../support/test-runner.js";
import { createMenuResolver } from "../../resolvers/menu.js";
import type { NavMenuEntry, NavMenuReadModel } from "../../../navigation/index.js";
import type { WidgetInstanceView } from "../../types.js";

// F2.6/F3.6: the actual navigation resolver runs; only the lower read/routing ports are faked.
test("an injected target resolver supplies hrefs for non-URL items in the configured menu", async () => {
  const menu: NavMenuEntry = {
    id: "menu-footer", workspaceId: "ws-menu", slug: "footer", title: "Footer eight", status: "published", locations: [], updatedAt: "2026-09-29T00:00:00Z", version: 1,
    doc: { type: "menu", version: 1, items: [{ id: "about", label: "About eight", target: { kind: "entryRef", entryId: "entry-eight" } }] },
  };
  const reads: unknown[] = [];
  const targets: unknown[] = [];
  const reader = { getMenu: async (p: unknown) => { reads.push(p); assert.deepEqual(p, { workspaceId: "ws-menu", menuId: "menu-footer" }); return menu; } } as NavMenuReadModel;
  const resolver = createMenuResolver({ menus: { resolveMenuDoc }, navMenuReadModel: reader,
    resolveTargetHref: async ({ target, context }) => { targets.push([target, context]); assert.deepEqual(target, { kind: "entryRef", entryId: "entry-eight" }); assert.deepEqual(context, { workspaceId: "ws-menu" }); return { path: "/about-eight", available: true }; },
  });
  const result = await resolver.resolveMany([
    { id: "bad", widgetType: "menu", config: { menuRef: "" } },
    { id: "footer", widgetType: "menu", config: { menuRef: "menu-footer" } },
  ], { workspaceId: "ws-menu", preview: false });
  assert.deepEqual(result.get("bad"), { ok: false, reason: "invalid-config" });
  assert.deepEqual(result.get("footer"), {
    ok: true, ir: { componentId: "menu", props: { title: "Footer eight", items: [{ id: "about", label: "About eight", href: "/about-eight", available: true, isCurrent: false, isActive: false, attrs: undefined, children: [] }] } }, dependencyKeys: ["menu-footer"],
  });
  assert.deepEqual(reads, [{ workspaceId: "ws-menu", menuId: "menu-footer" }]);
  assert.deepEqual(targets, [[{ kind: "entryRef", entryId: "entry-eight" }, { workspaceId: "ws-menu" }]]);
});

test("menu read failures propagate and a later call uses recovered data", async () => {
  let fail = true;
  const resolver = createMenuResolver({ menus: { resolveMenuDoc }, navMenuReadModel: { getMenu: async (p) => { assert.deepEqual(p, { workspaceId: "ws-menu", menuId: "missing" }); if (fail) throw new Error("menu storage failed"); return null; } } as NavMenuReadModel });
  const instances: WidgetInstanceView[] = [{ id: "w", widgetType: "menu", config: { menuRef: "missing" } }];
  const context = { workspaceId: "ws-menu", preview: false };
  await assert.rejects(resolver.resolveMany(instances, context), { message: "menu storage failed" });
  fail = false;
  assert.deepEqual((await resolver.resolveMany(instances, context)).get("w"), { ok: false, reason: "target-disabled" });
});

// F2.6/F3.6: keep the navigation resolver real and pin the menu read request.
// F4.3/F5.2: both modes use the same tree, with a live grandchild under unavailable parents.
// Filtering only the top level, dropping every unavailable parent, or always filtering fails.
for (const publicOnly of [true, false]) {
  test(`${publicOnly ? "public" : "diagnostic"} menus preserve visible descendants and ${publicOnly ? "prune" : "retain"} unavailable leaves at every depth`, async () => {
    const menu: NavMenuEntry = {
      id: "nested-footer", workspaceId: "ws-nested", slug: "nested-footer", title: "Nested footer",
      status: "published", locations: [], updatedAt: "2026-10-04", version: 4,
      doc: { type: "menu", version: 1, items: [
        { id: "dead-top", label: "Dead top", target: { kind: "entryRef", entryId: "missing-top" } },
        { id: "group", label: "Group", target: { kind: "entryRef", entryId: "missing-group" }, children: [
          { id: "dead-child", label: "Dead child", target: { kind: "entryRef", entryId: "missing-child" } },
          { id: "subgroup", label: "Subgroup", target: { kind: "entryRef", entryId: "missing-subgroup" }, children: [
            { id: "docs", label: "Docs", target: { kind: "url", href: "/docs" } },
          ] },
          { id: "empty-group", label: "Empty group", target: { kind: "entryRef", entryId: "missing-empty-group" }, children: [
            { id: "dead-grandchild", label: "Dead grandchild", target: { kind: "entryRef", entryId: "missing-grandchild" } },
          ] },
        ] },
        { id: "home", label: "Home", target: { kind: "url", href: "/" }, children: [
          { id: "dead-leaf", label: "Dead leaf", target: { kind: "entryRef", entryId: "missing-leaf" } },
        ] },
      ] },
    };
    const originalDoc = structuredClone(menu.doc);
    const reads: unknown[] = [];
    const resolver = createMenuResolver({ menus: { resolveMenuDoc }, publicOnly, navMenuReadModel: {
      getMenu: async (params) => {
        assert.deepEqual(params, { workspaceId: "ws-nested", menuId: "nested-footer" });
        reads.push(params);
        return menu;
      },
    } as NavMenuReadModel });
    const results = await resolver.resolveMany([{ id: "footer-widget", widgetType: "menu", config: { menuRef: "nested-footer" } }], { workspaceId: "ws-nested", preview: false });
    // Literal caller-visible fields, independent of resolveMenuDoc's output.
    const item = (id: string, label: string, href: string | null, children: unknown[] = []) => ({
      id, label, href, available: href !== null, isCurrent: false, isActive: false, attrs: undefined, children,
    });
    const expected = publicOnly ? [
      item("group", "Group", null, [item("subgroup", "Subgroup", null, [item("docs", "Docs", "/docs")])]),
      item("home", "Home", "/"),
    ] : [
      item("dead-top", "Dead top", null),
      item("group", "Group", null, [
        item("dead-child", "Dead child", null),
        item("subgroup", "Subgroup", null, [item("docs", "Docs", "/docs")]),
        item("empty-group", "Empty group", null, [item("dead-grandchild", "Dead grandchild", null)]),
      ]),
      item("home", "Home", "/", [item("dead-leaf", "Dead leaf", null)]),
    ];
    assert.deepEqual(results.get("footer-widget"), {
      ok: true, ir: { componentId: "menu", props: { title: "Nested footer", items: expected } }, dependencyKeys: ["nested-footer"],
    });
    assert.deepEqual(reads, [{ workspaceId: "ws-nested", menuId: "nested-footer" }]);
    assert.deepEqual(menu.doc, originalDoc);
  });
}
