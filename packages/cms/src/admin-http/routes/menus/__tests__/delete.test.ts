import { describe, expect, it } from "vitest";
import { MenuConflictError, MenuNotFoundError } from "../../../../navigation/index.js";
import { menuDeleteRoute, type MenuTrashFn } from "../delete.js";
import { PRINCIPAL, raw, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

describe("menuDeleteRoute", () => {
  it("keeps the method and path and reads :menuId, falling back to an empty id", () => {
    expect(menuDeleteRoute.method).toBe("delete");
    expect(menuDeleteRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/menus/:menuId");
    expect(menuDeleteRoute.parse(raw({ menuId: "m1" }))).toEqual({ ok: true, value: { menuId: "m1" } });
    expect(menuDeleteRoute.parse(raw({}))).toEqual({ ok: true, value: { menuId: "" } });
  });

  it("authorizes admin.menus.delete for the menu, trashes it as the principal and answers the trash envelope", async () => {
    const asked: unknown[] = [];
    const trashMenu: MenuTrashFn = async (input) => { asked.push(input); return { id: "m1", version: 4 }; };
    const { authorize, calls } = recordingAuthorize();
    const result = await menuDeleteRoute.handle({ input: { menuId: "m1" }, deps: { workspaceId: WORKSPACE_ID, trashMenu }, context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([{ permission: "admin.menus.delete", entityType: "menu", entityId: "m1" }]);
    expect(asked).toEqual([{ workspaceId: WORKSPACE_ID, menuId: "m1", actor: { principalId: PRINCIPAL.id } }]);
    expect(result).toEqual({ ok: true, value: { trashed: true, id: "m1", version: 4 } });
  });

  for (const [error, status] of [[new MenuNotFoundError({ message: "menu 'm1' was not found" }), 404], [new MenuConflictError({ message: "menu 'm1' changed while it was being deleted" }), 409]] as const) {
    it(`maps ${error.name} to a code-less ${status}`, async () => {
      const { authorize } = recordingAuthorize();
      const trashMenu: MenuTrashFn = async () => { throw error; };
      expect(await refusalOf(() => menuDeleteRoute.handle({ input: { menuId: "m1" }, deps: { workspaceId: WORKSPACE_ID, trashMenu }, context: PRINCIPAL, authorize }))).toEqual({
        status, body: { error: error.message },
      });
    });
  }

  it("does not trash when authorization refuses, and fails closed without a principal", async () => {
    let trashed = 0;
    const trashMenu: MenuTrashFn = async () => { trashed += 1; return { id: "m1", version: 1 }; };
    const { authorize } = recordingAuthorize(["admin.menus.delete"]);
    await expect(menuDeleteRoute.handle({ input: { menuId: "m1" }, deps: { workspaceId: WORKSPACE_ID, trashMenu }, context: PRINCIPAL, authorize })).rejects.toThrow("denied");
    await expect(menuDeleteRoute.handle({ input: { menuId: "m1" }, deps: { workspaceId: WORKSPACE_ID, trashMenu }, authorize: recordingAuthorize().authorize })).rejects.toThrow(/no authenticated principal/);
    expect(trashed).toBe(0);
  });
});
