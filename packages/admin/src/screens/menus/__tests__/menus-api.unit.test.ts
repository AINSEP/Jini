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
