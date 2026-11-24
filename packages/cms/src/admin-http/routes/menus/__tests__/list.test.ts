import { describe, expect, it } from "vitest";
import { menuListRoute } from "../list.js";
import { fakeMenu, fakeMenuDto, PRINCIPAL, raw, recordingAuthorize, signal, WORKSPACE_ID } from "./helpers.js";

describe("menuListRoute", () => {
  it("keeps the method and path and takes no input", () => {
    expect(menuListRoute.method).toBe("get");
    expect(menuListRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/menus");
    expect(menuListRoute.parse(raw({}))).toEqual({ ok: true, value: {} });
  });

  it("authorizes admin.menus.read with no entity id and answers the workspace's menus", async () => {
    const { authorize, calls } = recordingAuthorize();
    const asked: unknown[] = [];
    const menuRepo = { list: async (input: { workspaceId: string }) => { asked.push(input); return [fakeMenu()]; } };
    const result = await menuListRoute.handle({ input: {}, deps: { workspaceId: WORKSPACE_ID, menuRepo }, context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([{ permission: "admin.menus.read", entityType: "menu" }]);
    expect(asked).toEqual([{ workspaceId: WORKSPACE_ID }]);
    expect(result).toEqual({ ok: true, value: { menus: [fakeMenuDto()] } });
  });

  it("does not list when authorization refuses", async () => {
    let reads = 0;
    const { authorize } = recordingAuthorize(["admin.menus.read"]);
    const menuRepo = { list: async () => { reads += 1; return []; } };
    await expect(menuListRoute.handle({ input: {}, deps: { workspaceId: WORKSPACE_ID, menuRepo }, context: PRINCIPAL, authorize })).rejects.toThrow("denied");
    expect(reads).toBe(0);
  });
});
