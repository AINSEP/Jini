import { describe, expect, it } from "vitest";
import { menuGetRoute } from "../get-by-id.js";
import { fakeMenu, fakeMenuDto, PRINCIPAL, raw, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

/** @file The pilot K1 spec: GET one menu by slug or id. Every refusal body is pinned flat, as the host wrote it. */

type Lookup = { workspaceId: string; slug?: string; id?: string };

function repo(found: { bySlug?: boolean; byId?: boolean }, lookups: Lookup[] = []) {
  return {
    findBySlug: async (input: { workspaceId: string; slug: string }) => { lookups.push(input); return found.bySlug ? fakeMenu() : null; },
    findById: async (input: { workspaceId: string; id: string }) => { lookups.push(input); return found.byId ? fakeMenu() : null; },
  };
}

describe("menuGetRoute", () => {
  it("keeps the method and path and reads :menuId, falling back to an empty id", () => {
    expect(menuGetRoute.method).toBe("get");
    expect(menuGetRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/menus/:menuId");
    expect(menuGetRoute.parse(raw({ menuId: "m1" }))).toEqual({ ok: true, value: { menuId: "m1" } });
    expect(menuGetRoute.parse(raw({}))).toEqual({ ok: true, value: { menuId: "" } });
  });

  it("authorizes admin.menus.read for that menu and answers it in the `menu` envelope", async () => {
    const { authorize, calls } = recordingAuthorize();
    const result = await menuGetRoute.handle({ input: { menuId: "header-main" }, deps: { workspaceId: WORKSPACE_ID, menuRepo: repo({ bySlug: true }) }, context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([{ permission: "admin.menus.read", entityType: "menu", entityId: "header-main" }]);
    expect(result).toEqual({ ok: true, value: { menu: fakeMenuDto() } });
  });

  it("looks up the trimmed, lower-cased slug first and falls back to the id exactly as sent", async () => {
    const lookups: Lookup[] = [];
    const { authorize } = recordingAuthorize();
    const result = await menuGetRoute.handle({ input: { menuId: " M1 " }, deps: { workspaceId: WORKSPACE_ID, menuRepo: repo({ byId: true }, lookups) }, context: PRINCIPAL, authorize });
    expect(lookups).toEqual([{ workspaceId: WORKSPACE_ID, slug: "m1" }, { workspaceId: WORKSPACE_ID, id: " M1 " }]);
    expect(result.ok).toBe(true);
  });

  it("refuses an unknown menu with 404 and the host's code-less body", async () => {
    const { authorize } = recordingAuthorize();
    expect(await refusalOf(() => menuGetRoute.handle({ input: { menuId: "nope" }, deps: { workspaceId: WORKSPACE_ID, menuRepo: repo({}) }, context: PRINCIPAL, authorize }))).toEqual({
      status: 404, body: { error: "menu 'nope' was not found" },
    });
  });

  it("does not read the menu when authorization refuses", async () => {
    const lookups: Lookup[] = [];
    const { authorize } = recordingAuthorize(["admin.menus.read"]);
    await expect(menuGetRoute.handle({ input: { menuId: "m1" }, deps: { workspaceId: WORKSPACE_ID, menuRepo: repo({ byId: true }, lookups) }, context: PRINCIPAL, authorize })).rejects.toThrow("denied admin.menus.read");
    expect(lookups).toEqual([]);
  });

  it("rethrows a repository failure unchanged, so the host's error port answers the 500", async () => {
    const { authorize } = recordingAuthorize();
    const menuRepo = { findBySlug: async () => null, findById: async () => { throw new Error("private storage details"); } };
    await expect(menuGetRoute.handle({ input: { menuId: "m1" }, deps: { workspaceId: WORKSPACE_ID, menuRepo }, context: PRINCIPAL, authorize })).rejects.toThrow("private storage details");
  });

  it("fails closed when the host mounted it without an authorizer", async () => {
    await expect(menuGetRoute.handle({ input: { menuId: "m1" }, deps: { workspaceId: WORKSPACE_ID, menuRepo: repo({ byId: true }) }, context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
  });
});
