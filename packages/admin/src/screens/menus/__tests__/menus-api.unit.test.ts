import { describe, expect, it } from "vitest";

import { createMenusApi, type MenusRequestFn } from "../api/menus-api.js";

/** @file Pins the menus API client to the host-injected `request` and `workspaceId`. */
describe("createMenusApi", () => {
  it("scopes every path to the injected workspace and sends the route's method and body", async () => {
    const calls: unknown[][] = [];
    const request = (async (...args: unknown[]) => { calls.push(args); return {}; }) as MenusRequestFn;
    const api = createMenusApi({ request, workspaceId: "ws-9" });
    await api.listMenus();
    await api.getMenu({ id: "a/b" });
    await api.updateMenuTree({ id: "m1", expectedVersion: 3, items: [] }, { title: "Main" });
    expect(calls).toEqual([
      [{ path: "/workspaces/ws-9/menus" }],
      [{ path: "/workspaces/ws-9/menus/a%2Fb" }],
      [{ path: "/workspaces/ws-9/menus/m1" }, { init: { method: "PUT", body: JSON.stringify({ expectedVersion: 3, items: [], title: "Main" }) } }],
    ]);
  });
});

it("posts a menu with explicit authoring fields and omits them for an ordinary create", async () => {
  const calls: unknown[][] = [];
  const response = { menu: { id: "menu-42" } };
  const request: MenusRequestFn = async <T>(...args: Parameters<MenusRequestFn>) => {
    calls.push(args);
    return response as T;
  };
  const api = createMenusApi({ request, workspaceId: "author-ws" });
  const items = [{ id: "home", target: { kind: "url" as const, href: "/" } }];

  await expect(api.createMenu({ slug: "custom", title: "Custom" }, { items, mode: "html", html: "<nav>Custom</nav>" }))
    .resolves.toBe(response);
  await expect(api.createMenu({ slug: "plain", title: "Plain" })).resolves.toBe(response);
  expect(calls).toEqual([
    [{ path: "/workspaces/author-ws/menus" }, { init: { method: "POST", body: JSON.stringify({
      title: "Custom", slug: "custom", items, mode: "html", html: "<nav>Custom</nav>",
    }) } }],
    [{ path: "/workspaces/author-ws/menus" }, { init: { method: "POST", body: '{"title":"Plain","slug":"plain"}' } }],
  ]);
});

it("supports a tree-only write without inventing optional metadata or dropping its expected version", async () => {
  const calls: unknown[][] = [];
  const response = { menu: { version: 8 } };
  const request: MenusRequestFn = async <T>(...args: Parameters<MenusRequestFn>) => {
    calls.push(args);
    return response as T;
  };
  const api = createMenusApi({ request, workspaceId: "author-ws" });
  const items = [{ id: "docs", target: { kind: "url" as const, href: "/docs" } }];
  await expect(api.updateMenuTree({ id: "nav/7", expectedVersion: 7, items })).resolves.toBe(response);
  expect(calls).toEqual([[{ path: "/workspaces/author-ws/menus/nav%2F7" }, { init: {
    method: "PUT", body: JSON.stringify({ expectedVersion: 7, items }),
  } }]]);
});
