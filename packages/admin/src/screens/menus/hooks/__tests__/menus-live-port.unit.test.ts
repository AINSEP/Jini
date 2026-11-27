import { describe, expect, it } from "vitest";

import type { MenusApi } from "../../api/menus-api.js";
import { createFakeMenusPort, createMenusPort, type MenusTrashClient } from "../menus-dependencies.hooks.js";

/**
 * @file Pins the LIVE `createMenusPort` binding: every port method forwards to the host-injected
 * menus API client / Trash client / page reader with exactly the arguments it was given. Every
 * screen and hook test uses `createFakeMenusPort`, so without this file a wrong id or a swapped
 * argument in the live binding would ship unnoticed.
 */

function recordingApi(calls: unknown[][]): MenusApi {
  const record = (name: string) => async (...args: unknown[]) => { calls.push([name, ...args]); return { name }; };
  return {
    listMenus: record("listMenus"),
    getMenu: record("getMenu"),
    createMenu: record("createMenu"),
    updateMenuTree: record("updateMenuTree"),
  } as unknown as MenusApi;
}

describe("createMenusPort (live binding)", () => {
  it("forwards each menus method to the injected api with the caller's arguments", async () => {
    const calls: unknown[][] = [];
    const trash: MenusTrashClient = { trash: async (target) => { calls.push(["trash", target]); return { ok: true, version: 4 }; } };
    const listPages = async () => ({ pages: [] });
    const port = createMenusPort({ api: recordingApi(calls), trash, listPages });

    await port.listMenus();
    await port.getMenu({ id: "menu-7" });
    await port.createMenu({ input: { slug: "main", title: "Main" }, options: { mode: "html", html: "<nav/>" } });
    await port.updateMenuTree({ target: { id: "m1", expectedVersion: 3, items: [] }, options: { title: "Top" } });
    const trashed = await port.trash({ id: "m9" });

    expect(calls).toEqual([
      ["listMenus"],
      ["getMenu", { id: "menu-7" }],
      ["createMenu", { slug: "main", title: "Main" }, { mode: "html", html: "<nav/>" }],
      ["updateMenuTree", { id: "m1", expectedVersion: 3, items: [] }, { title: "Top" }],
      ["trash", { type: "menu", id: "m9" }],
    ]);
    expect(trashed).toEqual({ ok: true, version: 4 });
    expect(port.listPages).toBe(listPages);
  });

  it("returns the api's result unchanged", async () => {
    const port = createMenusPort({ api: recordingApi([]), trash: { trash: async () => ({ ok: true, version: null }) }, listPages: async () => ({ pages: [] }) });
    await expect(port.getMenu({ id: "x" })).resolves.toEqual({ name: "getMenu" });
  });
});

describe("in-memory menus port", () => {
  it("persists authored menus under both their generated ID and their requested slug", async () => {
    const port = createFakeMenusPort();
    const items = [{ id: "about", label: "About", target: { kind: "url" as const, href: "/about" } }];
    const { menu } = await port.createMenu({ input: { title: "Header", slug: "main-nav" }, options: {
      items, mode: "html", html: "<nav>Header</nav>",
    } });
    const expected = {
      id: "fake-1", workspaceId: "fake-ws", slug: "main-nav", title: "Header", status: "draft",
      items, mode: "html", html: "<nav>Header</nav>", locations: [], updatedAt: "1970-01-01T00:00:00.000Z", version: 1,
    };
    expect(menu).toEqual(expected);
    await expect(port.listMenus()).resolves.toEqual({ menus: [expected] });
    await expect(port.getMenu({ id: "main-nav" })).resolves.toEqual({ menu: expected });
    await expect(port.getMenu({ id: "fake-1" })).resolves.toEqual({ menu: expected });
    await expect(port.getMenu({ id: "wrong" })).rejects.toThrow("fake menu not found: wrong");
  });

  it("keeps HTML through an items edit, and rejects updates and trash of nonexistent IDs", async () => {
    const port = createFakeMenusPort();
    await port.createMenu({ input: { title: "Only menu", slug: "only" }, options: { mode: "html", html: "<nav/>" } });
    await port.updateMenuTree({ target: { id: "fake-1", expectedVersion: 1, items: [] }, options: { mode: "items", slug: "only-updated" } });
    const { menu } = await port.getMenu({ id: "only-updated" });
    expect({ title: menu.title, mode: menu.mode, html: menu.html, version: menu.version })
      .toEqual({ title: "Only menu", mode: "items", html: "<nav/>", version: 2 });
    await expect(port.updateMenuTree({ target: { id: "missing", expectedVersion: 1, items: [] }, options: {} }))
      .rejects.toThrow("fake menu not found: missing");
    await expect(port.trash({ id: "missing" })).rejects.toThrow("fake menu not found: missing");
    await expect(port.trash({ id: "fake-1" })).resolves.toEqual({ ok: true, version: 2 });
    await expect(port.getMenu({ id: "fake-1" })).resolves.toEqual({ menu: { ...menu, status: "trash" } });
  });
});
