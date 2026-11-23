import { describe, expect, it } from "vitest";
import { menuGetRoute } from "../get-by-id.js";
import { menuListRoute } from "../list.js";
import { menuCreateRoute } from "../create.js";
import { makeMenuDeps, PRINCIPAL, raw, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

async function seeded() {
  const deps = makeMenuDeps();
  await menuCreateRoute.handle({ input: { title: "Main", slug: "main", items: [], authoring: {} }, deps, context: PRINCIPAL, authorize: recordingAuthorize().authorize }, { signal });
  return deps;
}

describe("menuListRoute", () => {
  it("authorizes admin.menus.read with no entity id and lists the workspace's menus", async () => {
    expect(menuListRoute.method).toBe("get");
    expect(menuListRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/menus");
    expect(menuListRoute.parse(raw({}))).toEqual({ ok: true, value: {} });
    const { authorize, calls } = recordingAuthorize();
    const result = await menuListRoute.handle({ input: {}, deps: await seeded(), context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([{ permission: "admin.menus.read", entityType: "menu" }]);
    if (!result.ok) throw new Error("expected success");
    expect(result.value.menus.map((m) => [m.slug, m.workspaceId])).toEqual([["main", WORKSPACE_ID]]);
  });

  it("stops on a denial before reading", async () => {
    const deps = { workspaceId: WORKSPACE_ID, menuRepo: { list: async () => { throw new Error("read before auth"); } } };
    await expect(menuListRoute.handle({ input: {}, deps, context: PRINCIPAL, authorize: recordingAuthorize({ deny: "admin.menus.read" }).authorize }, { signal })).rejects.toThrow("denied admin.menus.read");
  });
});

describe("menuGetRoute", () => {
  it("parses the menu id, defaulting a missing one to the empty id", () => {
    expect(menuGetRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/menus/:menuId");
    expect(menuGetRoute.parse(raw({ menuId: "m-1" }))).toEqual({ ok: true, value: { menuId: "m-1" } });
    expect(menuGetRoute.parse(raw({}))).toEqual({ ok: true, value: { menuId: "" } });
  });

  it("resolves a slug (case/space-normalized) before the id and names the entity", async () => {
    const deps = await seeded();
    const { authorize, calls } = recordingAuthorize();
    const result = await menuGetRoute.handle({ input: { menuId: " MAIN " }, deps, context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([{ permission: "admin.menus.read", entityType: "menu", entityId: " MAIN " }]);
    if (!result.ok) throw new Error("expected success");
    expect(result.value.menu.slug).toBe("main");
    const byId = await menuGetRoute.handle({ input: { menuId: result.value.menu.id }, deps, context: PRINCIPAL, authorize }, { signal });
    expect(byId.ok && byId.value.menu.id).toBe(result.value.menu.id);
  });

  it("refuses a missing menu with the flat code-less 404", async () => {
    expect(await refusalOf(() => menuGetRoute.handle({ input: { menuId: "" }, deps: makeMenuDeps(), context: PRINCIPAL, authorize: recordingAuthorize().authorize }, { signal })))
      .toEqual({ status: 404, body: { error: "menu '' was not found" } });
  });
});
