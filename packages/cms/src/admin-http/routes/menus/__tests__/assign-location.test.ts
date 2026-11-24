import { describe, expect, it } from "vitest";
import { EntityNotLiveError } from "../../../../core/entity-liveness.js";
import { MenuConflictError, MenuNotFoundError, MenuVersionConflictError } from "../../../../navigation/index.js";
import { menuAssignLocationRoute } from "../assign-location.js";
import { makeWriteDeps, PRINCIPAL, raw, recordingAuthorize, refusalOf, signal } from "./helpers.js";

describe("menuAssignLocationRoute", () => {
  it("keeps the method and path and reads the trimmed locationKey", () => {
    expect(menuAssignLocationRoute.method).toBe("post");
    expect(menuAssignLocationRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/menus/:menuId/locations");
    expect(menuAssignLocationRoute.parse(raw({ menuId: "m1" }, { locationKey: " primary " }))).toEqual({ ok: true, value: { menuId: "m1", locationKey: "primary" } });
  });

  for (const body of [{}, { locationKey: "   " }, undefined]) {
    it(`refuses a missing or blank locationKey ${JSON.stringify(body)} with the code-less 400`, async () => {
      expect(await refusalOf(() => menuAssignLocationRoute.parse(raw({ menuId: "m1" }, body)))).toEqual({ status: 400, body: { error: "locationKey is required" } });
    });
  }

  it("authorizes admin.menus.assign for the menu, binds the location and answers menu, binding and displaced menu", async () => {
    const deps = await makeWriteDeps();
    const { authorize, calls } = recordingAuthorize();
    const result = await menuAssignLocationRoute.handle({ input: { menuId: "m1", locationKey: "primary" }, deps, context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([{ permission: "admin.menus.assign", entityType: "menu", entityId: "m1" }]);
    expect(result.ok && result.value.binding).toMatchObject({ locationKey: "primary", menuId: "m1" });
    expect(result.ok && result.value.displacedMenu).toBeNull();
  });

  const cases: Array<[string, Error, { status: number; body: unknown }]> = [
    ["trashed menu", new EntityNotLiveError({ entityType: "menu", entityId: "m1", state: "trashed" }), { status: 409, body: { error: new EntityNotLiveError({ entityType: "menu", entityId: "m1", state: "trashed" }).message, code: "ENTITY_IN_TRASH" } }],
    ["not found", new MenuNotFoundError({ message: "menu 'm1' was not found" }), { status: 404, body: { error: "menu 'm1' was not found" } }],
    ["lost compare-and-set", new MenuVersionConflictError({ message: "stale assignment" }), { status: 409, body: { error: "stale assignment", code: "VERSION_CONFLICT" } }],
    ["assignment conflict", new MenuConflictError({ message: "assignment conflict" }), { status: 409, body: { error: "assignment conflict" } }],
  ];
  for (const [name, error, expected] of cases) {
    it(`maps a ${name} failure to the host's exact refusal`, async () => {
      const deps = { ...(await makeWriteDeps()), menuRepo: { findById: async () => { throw error; } } as never };
      const { authorize } = recordingAuthorize();
      expect(await refusalOf(() => menuAssignLocationRoute.handle({ input: { menuId: "m1", locationKey: "primary" }, deps, context: PRINCIPAL, authorize }))).toEqual(expected);
    });
  }

  it("does not touch the repos when authorization refuses", async () => {
    let reads = 0;
    const deps = { ...(await makeWriteDeps()), menuRepo: { findById: async () => { reads += 1; return null; } } as never };
    const { authorize } = recordingAuthorize(["admin.menus.assign"]);
    await expect(menuAssignLocationRoute.handle({ input: { menuId: "m1", locationKey: "primary" }, deps, context: PRINCIPAL, authorize })).rejects.toThrow("denied");
    expect(reads).toBe(0);
  });
});
