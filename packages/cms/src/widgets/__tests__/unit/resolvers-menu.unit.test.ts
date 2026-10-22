import { resolveMenuDoc } from "../../../navigation/index.js";
import assert from "node:assert/strict";
import test from "../support/test-runner.js";

import type { NavMenuEntry, NavMenuReadModel } from "../../../navigation/index.js";
import { createMenuResolver } from "../../resolvers/index.js";
import type { WidgetInstanceView, WidgetResolveContext } from "../../types.js";

/**
 * @file `menu` widget resolver href resolution (SPEC-043 REQ-09) — real hrefs for `url`-kind nav
 * targets, honest `available: false` for targets `src/platform/routing` (ADR-039) can't resolve yet.
 */

const WORKSPACE_ID = "ws-1";
const CTX: WidgetResolveContext = { workspaceId: WORKSPACE_ID, preview: false };

function instance(overrides: Partial<WidgetInstanceView> & Pick<WidgetInstanceView, "id">): WidgetInstanceView {
  return { widgetType: "menu", config: {}, ...overrides };
}

function fakeMenuReadModel(...menus: Array<NavMenuEntry | null>): NavMenuReadModel {
  const rows = menus.filter((menu): menu is NavMenuEntry => menu !== null);
  const byId = new Map(rows.map((menu) => [JSON.stringify([menu.workspaceId, menu.id]), menu]));
  const bySlug = new Map(rows.map((menu) => [JSON.stringify([menu.workspaceId, menu.slug]), menu]));
  return {
    async getMenu({ workspaceId, menuId }) {
      return byId.get(JSON.stringify([workspaceId, menuId])) ?? null;
    },
    async getMenuBySlug({ workspaceId, slug }) {
      return bySlug.get(JSON.stringify([workspaceId, slug])) ?? null;
    },
    async listMenus({ workspaceId }) {
      return rows.filter((menu) => menu.workspaceId === workspaceId);
    },
    async resolveForLocation() {
      return null;
    },
  };
}

test("REQ-09: a url-kind nav target resolves to a real href/available, not a raw target passthrough", async () => {
  const menu: NavMenuEntry = {
    id: "menu-1",
    workspaceId: WORKSPACE_ID,
    slug: "footer-menu",
    title: "Footer",
    status: "published",
    doc: {
      type: "menu",
      version: 1,
      items: [
        { id: "item-1", label: "Docs", target: { kind: "url", href: "https://example.com/docs" } },
      ],
    },
    locations: [],
    updatedAt: "2026-07-21T00:00:00.000Z",
    version: 1,
  };

  const otherMenu: NavMenuEntry = { ...menu, id: "menu-other", slug: "other-menu", title: "Other menu", doc: { type: "menu", version: 1, items: [] } };
  const foreignMenu: NavMenuEntry = { ...menu, id: "menu-foreign", workspaceId: "ws-other" };
  const resolver = createMenuResolver({ menus: { resolveMenuDoc }, navMenuReadModel: fakeMenuReadModel(otherMenu, foreignMenu, menu) });
  const results = await resolver.resolveMany([instance({ id: "w-1", config: { menuRef: "menu-1" } })], CTX);

  const result = results.get("w-1");
  assert.ok(result?.ok);
  if (!result.ok) return;
  const items = result.ir.props.items as unknown as Array<{ href: string | null; available: boolean }>;
  assert.equal(items.length, 1);
  assert.ok(items[0]);
  assert.equal(items[0].href, "https://example.com/docs", "a url-kind target must resolve to its real href, not a raw NavTarget object");
  assert.equal(items[0].available, true);
  assert.equal(result.ir.props.title, "Footer");
  assert.deepEqual(result.dependencyKeys, ["menu-1"]);

  const otherResults = await resolver.resolveMany([
    instance({ id: "w-other", config: { menuRef: "menu-other" } }),
    instance({ id: "w-foreign", config: { menuRef: "menu-foreign" } }),
  ], CTX);
  assert.deepEqual(otherResults.get("w-other"), {
    ok: true, ir: { componentId: "menu", props: { title: "Other menu", items: [] } }, dependencyKeys: ["menu-other"],
  });
  assert.deepEqual(otherResults.get("w-foreign"), { ok: false, reason: "target-disabled" });
});

test("REQ-09: an entryRef target resolves to available:false honestly (src/platform/routing not built yet), never throws", async () => {
  const menu: NavMenuEntry = {
    id: "menu-2",
    workspaceId: WORKSPACE_ID,
    slug: "primary-menu",
    title: "Primary",
    status: "published",
    doc: {
      type: "menu",
      version: 1,
      items: [
        { id: "item-1", label: "About", target: { kind: "entryRef", entryId: "entry-about" } },
      ],
    },
    locations: [],
    updatedAt: "2026-07-21T00:00:00.000Z",
    version: 1,
  };

  const resolver = createMenuResolver({ menus: { resolveMenuDoc }, navMenuReadModel: fakeMenuReadModel(menu) });
  const results = await resolver.resolveMany([instance({ id: "w-2", config: { menuRef: "menu-2" } })], CTX);

  const result = results.get("w-2");
  assert.ok(result?.ok);
  if (!result.ok) return;
  const items = result.ir.props.items as unknown as Array<{ href: string | null; available: boolean }>;
  assert.ok(items[0]);
  assert.equal(items[0].href, null);
  assert.equal(items[0].available, false);
});

test("REQ-09: a config with no menuRef resolves invalid-config, never calls the read model", async () => {
  const resolver = createMenuResolver({ menus: { resolveMenuDoc }, navMenuReadModel: fakeMenuReadModel(null) });
  const results = await resolver.resolveMany([instance({ id: "w-3", config: {} })], CTX);

  assert.deepEqual(results.get("w-3"), { ok: false, reason: "invalid-config" });
});

test("REQ-09: a non-string menuRef resolves invalid-config", async () => {
  const resolver = createMenuResolver({ menus: { resolveMenuDoc }, navMenuReadModel: fakeMenuReadModel(null) });
  const results = await resolver.resolveMany([instance({ id: "w-3", config: { menuRef: 42 } })], CTX);

  assert.deepEqual(results.get("w-3"), { ok: false, reason: "invalid-config" });
});

test("REQ-09: a menuRef that resolves to no menu at all (deleted/never existed) degrades to target-disabled, never throws", async () => {
  const resolver = createMenuResolver({ menus: { resolveMenuDoc }, navMenuReadModel: fakeMenuReadModel(null) });
  const results = await resolver.resolveMany([instance({ id: "w-4", config: { menuRef: "does-not-exist" } })], CTX);

  assert.deepEqual(results.get("w-4"), { ok: false, reason: "target-disabled" });
});
