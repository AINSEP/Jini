import { describe, expect, it } from "vitest";
import { createRole } from "../../../../server/grant-service.js";
import { roleDeleteRoute } from "../delete-role.js";
import { BODIES, ERRORS, makeAccessDeps, raw, refusalOf, throwingDeps, WORKSPACE_ID } from "./access-helpers.js";

describe("roleDeleteRoute", () => {
  it("keeps the method, path and 204 no-body success", () => {
    expect([roleDeleteRoute.method, roleDeleteRoute.path, roleDeleteRoute.successStatus, roleDeleteRoute.maxBodyBytes])
      .toEqual(["delete", "/api/admin/v1/workspaces/:workspaceId/roles/:roleId", 204, undefined]);
  });

  it("reads roleId with the `?? \"\"` fallback", () => {
    expect(roleDeleteRoute.parse(raw({ roleId: "r1" }))).toEqual({ ok: true, value: { roleId: "r1" } });
    expect(roleDeleteRoute.parse(raw({}))).toEqual({ ok: true, value: { roleId: "" } });
  });

  it("deletes an unreferenced custom role through the real service and answers no value", async () => {
    const { routeDeps, serviceDeps, OWNER, repos } = await makeAccessDeps();
    const { role } = await createRole({ deps: serviceDeps, input: { workspaceId: WORKSPACE_ID, callerPrincipalId: OWNER.id, name: "Gone" } });
    expect(await roleDeleteRoute.handle({ input: { roleId: role.id }, deps: routeDeps, context: OWNER })).toEqual({ ok: true, value: undefined });
    expect(await repos.roles.findById({ workspaceId: WORKSPACE_ID, id: role.id })).toBeNull();
  });

  const ladder = [["forbidden", BODIES.forbidden], ["conflict", BODIES.conflictOn("roleId")], ["validation", BODIES.validation], ["notFound", BODIES.notFound]] as const;
  for (const [name, expected] of ladder) {
    it(`maps ${name} to its exact flat body`, async () => {
      expect(await refusalOf(() => roleDeleteRoute.handle({ input: { roleId: "r" }, deps: throwingDeps(ERRORS[name]), context: { id: "p" } }))).toEqual(expected);
    });
  }

  it("rethrows an unmapped failure and fails closed without a principal", async () => {
    await expect(roleDeleteRoute.handle({ input: { roleId: "r" }, deps: throwingDeps(ERRORS.ownerRequired), context: { id: "p" } })).rejects.toBe(ERRORS.ownerRequired);
    await expect(roleDeleteRoute.handle({ input: { roleId: "r" }, deps: throwingDeps(new Error("x")) })).rejects.toThrow(/no authenticated principal/);
  });
});
