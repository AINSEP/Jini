import assert from "node:assert/strict";
import { test } from "vitest";

import type { OutboxPort } from "../../../core/ports.js";
import {
  createMenu, createNavMenuReadModel, InMemoryMenuRepo, InMemoryNavLocationBindingRepo,
  resolveMenuDoc, updateMenuTree,
} from "../../../navigation/index.js";
import type { NavMenuMode } from "../../../navigation/index.js";
import { createMenuResolver } from "../../resolvers/index.js";

/** Save through navigation's real HTML owner, then read through the widget's production ports. */
async function fixture(authoring: { mode?: NavMenuMode; html?: string }) {
  const repo = new InMemoryMenuRepo({});
  let nextId = 0;
  const outbox: OutboxPort = {
    enqueue: async () => {}, claimPending: async () => [],
    markDelivered: async () => {}, markFailed: async () => {},
  };
  const deps = {
    repo, outbox, idGen: { newId: () => `id-${++nextId}` },
    clock: { nowMs: () => Date.parse("2026-10-08T00:00:00.000Z") },
  };
  const { menu } = await createMenu({ deps, input: {
    workspaceId: "ws-1", title: "Header", slug: "header",
    items: [{ id: "home", label: "Home", target: { kind: "url", href: "/" } }],
    ...authoring,
  } });
  const navMenuReadModel = createNavMenuReadModel({ menuRepo: repo, bindingRepo: new InMemoryNavLocationBindingRepo({}) });
  const instance = { id: "widget-1", widgetType: "menu" as const, config: { menuRef: menu.id } };
  return { deps, menu, navMenuReadModel, instance };
}

test("HTML menu widgets forward navigation's balanced trusted markup without resolving the saved item tree", async () => {
  const f = await fixture({ mode: "html", html: '</nav><ul class="custom"><li><a href="/docs">Docs</a></ul><script>window.menuReady=true</script>' });
  const resolver = createMenuResolver({
    navMenuReadModel: f.navMenuReadModel, publicOnly: true,
    menus: { resolveMenuDoc: async () => { assert.fail("HTML mode must not resolve items"); } },
  });
  const before = structuredClone(f.menu);
  const results = await resolver.resolveMany([f.instance], { workspaceId: "ws-1", preview: false });
  assert.deepEqual(results.get("widget-1"), {
    ok: true,
    ir: { componentId: "menu", props: {
      title: "Header", mode: "html",
      html: '<ul class="custom"><li><a href="/docs">Docs</a></li></ul><script>window.menuReady=true</script>',
    } },
    dependencyKeys: [f.menu.id],
  });
  assert.deepEqual(f.menu, before);
});

for (const authoring of [{ mode: "html" as const, html: "" }, { mode: "html" as const }]) {
  test(`HTML menu widgets return empty markup when HTML is ${authoring.html === "" ? "empty" : "omitted"}`, async () => {
    const f = await fixture(authoring);
    const resolver = createMenuResolver({ menus: { resolveMenuDoc }, navMenuReadModel: f.navMenuReadModel });
    const results = await resolver.resolveMany([f.instance], { workspaceId: "ws-1", preview: false });
    assert.deepEqual(results.get("widget-1"), {
      ok: true, ir: { componentId: "menu", props: { title: "Header", mode: "html", html: "" } },
      dependencyKeys: [f.menu.id],
    });
  });
}

test("switching an HTML menu back to items retains HTML in storage but restores item widget output", async () => {
  const f = await fixture({ mode: "html", html: "<p>Custom</p>" });
  const resolver = createMenuResolver({ menus: { resolveMenuDoc }, navMenuReadModel: f.navMenuReadModel, publicOnly: true });
  const before = await resolver.resolveMany([f.instance], { workspaceId: "ws-1", preview: false });
  assert.deepEqual(before.get("widget-1"), {
    ok: true, ir: { componentId: "menu", props: { title: "Header", mode: "html", html: "<p>Custom</p>" } },
    dependencyKeys: [f.menu.id],
  });
  await updateMenuTree({ deps: f.deps, input: {
    workspaceId: "ws-1", id: f.menu.id, expectedVersion: 1, mode: "items",
  } });
  const results = await resolver.resolveMany([f.instance], { workspaceId: "ws-1", preview: false });
  assert.deepEqual(results.get("widget-1"), {
    ok: true, ir: { componentId: "menu", props: { title: "Header", items: [{
      id: "home", label: "Home", href: "/", available: true, isCurrent: false, isActive: false,
      attrs: undefined, children: [],
    }] } }, dependencyKeys: [f.menu.id],
  });
  assert.equal((await f.navMenuReadModel.getMenu({ workspaceId: "ws-1", menuId: f.menu.id }))?.doc.html, "<p>Custom</p>");
});

test("HTML menu widgets cannot read a different workspace's trusted markup", async () => {
  const f = await fixture({ mode: "html", html: "<p>Private menu</p>" });
  const resolver = createMenuResolver({ menus: { resolveMenuDoc }, navMenuReadModel: f.navMenuReadModel });
  const own = await resolver.resolveMany([f.instance], { workspaceId: "ws-1", preview: false });
  assert.deepEqual(own.get("widget-1"), {
    ok: true, ir: { componentId: "menu", props: { title: "Header", mode: "html", html: "<p>Private menu</p>" } },
    dependencyKeys: [f.menu.id],
  });
  const results = await resolver.resolveMany([f.instance], { workspaceId: "ws-other", preview: false });
  assert.deepEqual(results.get("widget-1"), { ok: false, reason: "target-disabled" });
});
