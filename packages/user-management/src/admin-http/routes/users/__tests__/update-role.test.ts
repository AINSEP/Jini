import { describe, expect, it } from "vitest";
import { createRole } from "../../../../server/grant-service.js";
import { roleUpdateRoute } from "../update-role.js";
import { BODIES, ERRORS, makeAccessDeps, raw, refusalOf, throwingDeps, WORKSPACE_ID } from "./access-helpers.js";

describe("roleUpdateRoute", () => {
  it("keeps the method, path and 200 success status", () => {
    expect([roleUpdateRoute.method, roleUpdateRoute.path, roleUpdateRoute.successStatus, roleUpdateRoute.maxBodyBytes])
      .toEqual(["patch", "/api/admin/v1/workspaces/:workspaceId/roles/:roleId", undefined, undefined]);
  });

  it("reads roleId and name with the `?? \"\"` fallbacks", () => {
    expect(roleUpdateRoute.parse(raw({ roleId: "r1" }, { name: "N" }))).toEqual({ ok: true, value: { roleId: "r1", name: "N" } });
    expect(roleUpdateRoute.parse(raw({}, null))).toEqual({ ok: true, value: { roleId: "", name: "" } });
  });

  it("renames a custom role through the real service", async () => {
    const { routeDeps, serviceDeps, OWNER } = await makeAccessDeps();
    const { role } = await createRole({ deps: serviceDeps, input: { workspaceId: WORKSPACE_ID, callerPrincipalId: OWNER.id, name: "Old" } });
    const result = await roleUpdateRoute.handle({ input: { roleId: role.id, name: "New" }, deps: routeDeps, context: OWNER });
    expect(result).toEqual({ ok: true, value: { role: { id: role.id, workspaceId: WORKSPACE_ID, name: "New", isBuiltin: false, version: 2 } } });
  });

  it("carries the client's basis unparsed and refuses a malformed one 400 before any write", async () => {
    expect(roleUpdateRoute.parse(raw({ roleId: "r1" }, { name: "N", expectedVersion: "3" }))).toEqual({ ok: true, value: { roleId: "r1", name: "N", expectedVersion: "3" } });
    const { routeDeps, serviceDeps, OWNER, repos } = await makeAccessDeps();
    const { role } = await createRole({ deps: serviceDeps, input: { workspaceId: WORKSPACE_ID, callerPrincipalId: OWNER.id, name: "Old" } });
    expect(await refusalOf(() => roleUpdateRoute.handle({ input: { roleId: role.id, name: "New", expectedVersion: "3" }, deps: routeDeps, context: OWNER })))
      .toEqual({ status: 400, body: { error: "'expectedVersion' must be a non-negative integer when present", code: "VALIDATION_ERROR" } });
    expect((await repos.roles.findById({ workspaceId: WORKSPACE_ID, id: role.id }))?.name).toBe("Old");
  });

  it("answers the second editor from the same version 409 VERSION_CONFLICT and keeps the first save", async () => {
    const { routeDeps, serviceDeps, OWNER, repos } = await makeAccessDeps();
    const { role } = await createRole({ deps: serviceDeps, input: { workspaceId: WORKSPACE_ID, callerPrincipalId: OWNER.id, name: "Old" } });
    await roleUpdateRoute.handle({ input: { roleId: role.id, name: "First", expectedVersion: role.version }, deps: routeDeps, context: OWNER });
    expect(await refusalOf(() => roleUpdateRoute.handle({ input: { roleId: role.id, name: "Second", expectedVersion: role.version }, deps: routeDeps, context: OWNER })))
      .toMatchObject({ status: 409, body: { code: "VERSION_CONFLICT" } });
    expect(await repos.roles.findById({ workspaceId: WORKSPACE_ID, id: role.id })).toMatchObject({ name: "First", version: 2 });
  });

  it("answers an absent role 404 RESOURCE_NOT_FOUND from the real service", async () => {
    const { routeDeps, OWNER } = await makeAccessDeps();
    expect(await refusalOf(() => roleUpdateRoute.handle({ input: { roleId: "", name: "N" }, deps: routeDeps, context: OWNER })))
      .toMatchObject({ status: 404, body: { code: "RESOURCE_NOT_FOUND" } });
  });

  for (const name of ["forbidden", "validation", "notFound"] as const) {
    it(`maps ${name} to its exact flat body`, async () => {
      expect(await refusalOf(() => roleUpdateRoute.handle({ input: { roleId: "r", name: "N" }, deps: throwingDeps(ERRORS[name]), context: { id: "p" } }))).toEqual(BODIES[name]);
    });
  }

  it("rethrows an unmapped failure and fails closed without a principal", async () => {
    await expect(roleUpdateRoute.handle({ input: { roleId: "r", name: "N" }, deps: throwingDeps(ERRORS.conflict), context: { id: "p" } })).rejects.toBe(ERRORS.conflict);
    await expect(roleUpdateRoute.handle({ input: { roleId: "r", name: "N" }, deps: throwingDeps(new Error("x")) })).rejects.toThrow(/no authenticated principal/);
  });
});
