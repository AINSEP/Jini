import { describe, expect, it } from "vitest";

import type { MenusApi } from "../../api/menus-api.js";
import { createMenusPort, type MenusTrashClient } from "../menus-dependencies.hooks.js";

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
