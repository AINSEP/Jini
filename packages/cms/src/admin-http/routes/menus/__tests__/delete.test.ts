import { describe, expect, it } from "vitest";
import { InMemoryMenuRepo } from "../../../../navigation/index.js";
import { trashMenu } from "../../../../navigation/site/trash-menu.js";
import { menuDeleteRoute } from "../delete.js";
import { fakeMenu, makeMenuDeps, PRINCIPAL, raw, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

type RemoveOutcome = { ok: true; version: number | null } | { ok: false; reason: "not-found" | "version-changed" };

/** Delete deps over one stored menu `m1`, with a recording `removeMenu` that answers `outcome`. */
function deleteDeps(outcome: RemoveOutcome = { ok: true, version: 4 }) {
  const removals: unknown[] = [];
  const { workspaceId, outwardErrorMessage, clock } = makeMenuDeps();
  const menuRepo = new InMemoryMenuRepo({}, { initialRows: [fakeMenu()] });
  // The host's mount binds its repo, remove operation and clock into one `trashMenu` closure.
  const deps = {
    workspaceId, outwardErrorMessage,
    trashMenu: (input: Parameters<typeof trashMenu>[0]) => trashMenu(input, { menuRepo, remove: async (removal) => { removals.push(removal); return outcome; }, clock }),
  };
  return { deps, removals };
}

describe("menuDeleteRoute", () => {
  it("keeps the method and path and reads :menuId, falling back to an empty id", () => {
    expect(menuDeleteRoute.method).toBe("delete");
    expect(menuDeleteRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/menus/:menuId");
    expect(menuDeleteRoute.parse(raw({ menuId: "m1" }))).toEqual({ ok: true, value: { menuId: "m1" } });
    expect(menuDeleteRoute.parse(raw({}))).toEqual({ ok: true, value: { menuId: "" } });
  });

  it("authorizes admin.menus.delete for the menu, trashes it as the principal and answers the trash envelope", async () => {
    const { deps, removals } = deleteDeps();
    const { authorize, calls } = recordingAuthorize();
    const result = await menuDeleteRoute.handle({ input: { menuId: "m1" }, deps, context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([{ permission: "admin.menus.delete", entityType: "menu", entityId: "m1" }]);
    expect(removals).toMatchObject([{ id: "m1", expectedVersion: 1, actor: { principalId: PRINCIPAL.id } }]);
    expect(result).toEqual({ ok: true, value: { trashed: true, id: "m1", version: 4 } });
  });

  it("maps a missing menu to a code-less 404 and a concurrent change to a code-less 409", async () => {
    const { deps } = deleteDeps({ ok: false, reason: "version-changed" });
    const { authorize } = recordingAuthorize();
    expect(await refusalOf(() => menuDeleteRoute.handle({ input: { menuId: "nope" }, deps, context: PRINCIPAL, authorize }))).toEqual({
      status: 404, body: { error: "menu 'nope' was not found" },
    });
    const conflict = await refusalOf(() => menuDeleteRoute.handle({ input: { menuId: "m1" }, deps, context: PRINCIPAL, authorize }));
    expect(conflict.status).toBe(409);
    expect(Object.keys(conflict.body as object)).toEqual(["error"]);
  });

  it("does not trash when authorization refuses, and fails closed without a principal", async () => {
    const { deps, removals } = deleteDeps();
    const { authorize } = recordingAuthorize(["admin.menus.delete"]);
    await expect(menuDeleteRoute.handle({ input: { menuId: "m1" }, deps, context: PRINCIPAL, authorize })).rejects.toThrow("denied");
    await expect(menuDeleteRoute.handle({ input: { menuId: "m1" }, deps, authorize: recordingAuthorize().authorize })).rejects.toThrow(/no authenticated principal/);
    expect(removals).toEqual([]);
    expect(deps.workspaceId).toBe(WORKSPACE_ID);
  });
});
