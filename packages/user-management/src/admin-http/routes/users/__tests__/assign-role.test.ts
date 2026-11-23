import { describe, expect, it } from "vitest";
import { userAssignRoleRoute } from "../assign-role.js";
import { addUser, raw, refusalOf, seededIdentity, signal, WORKSPACE_ID } from "./helpers.js";

async function grantDeps() {
  const { services, ownerId } = await seededIdentity();
  const alice = await addUser({ services, ownerId, username: "alice" });
  const [grant] = await services.repos.roles.list({ workspaceId: WORKSPACE_ID });
  return { deps: { workspaceId: WORKSPACE_ID, identityServices: () => services }, services, ownerId, alice, grantId: grant!.id };
}

describe("userAssignRoleRoute", () => {
  it("keeps the method, path and 201 success status", () => {
    expect(userAssignRoleRoute.method).toBe("post");
    expect(userAssignRoleRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/users/:principalId/roles");
    expect(userAssignRoleRoute.successStatus).toBe(201);
    expect(userAssignRoleRoute.maxBodyBytes).toBeUndefined();
  });

  it("parses the principal id and roleId with the host's fallbacks, including a null or non-object body", () => {
    expect(userAssignRoleRoute.parse(raw({ principalId: "p1" }, { roleId: 9 }))).toEqual({ ok: true, value: { principalId: "p1", roleId: "9" } });
    for (const body of [undefined, null, "text"]) expect(userAssignRoleRoute.parse(raw({}, body))).toEqual({ ok: true, value: { principalId: "", roleId: "" } });
  });

  it("grants through the real service and answers the assignment record", async () => {
    const { deps, ownerId, alice, grantId } = await grantDeps();
    const result = await userAssignRoleRoute.handle({ input: { principalId: alice, roleId: grantId }, deps, context: { id: ownerId } }, { signal });
    expect(result.ok && result.value.assignment).toMatchObject({ principalId: alice, roleId: grantId });
  });

  it("maps a missing grant to the code-less 404 and an unauthorized caller to 403 FORBIDDEN", async () => {
    const { deps, services, ownerId, alice } = await grantDeps();
    const missing = await refusalOf(() => userAssignRoleRoute.handle({ input: { principalId: alice, roleId: "nope" }, deps, context: { id: ownerId } }));
    expect(missing.status).toBe(404);
    expect(Object.keys(missing.body as object)).toEqual(["error"]);
    const bob = await addUser({ services, ownerId, username: "bob" });
    const forbidden = await refusalOf(() => userAssignRoleRoute.handle({ input: { principalId: alice, roleId: "nope" }, deps, context: { id: bob } }));
    expect(forbidden.status).toBe(403);
    expect(forbidden.body).toMatchObject({ code: "FORBIDDEN" });
  });

  it("rethrows an unmapped failure and fails closed without a principal", async () => {
    const { deps, services, ownerId, alice, grantId } = await grantDeps();
    const broken = { ...services, repos: { ...services.repos, transactions: { run: async () => { throw new Error("db down"); } } } };
    await expect(userAssignRoleRoute.handle({ input: { principalId: alice, roleId: grantId }, deps: { ...deps, identityServices: () => broken }, context: { id: ownerId } })).rejects.toThrow("db down");
    await expect(userAssignRoleRoute.handle({ input: { principalId: alice, roleId: grantId }, deps, context: undefined })).rejects.toThrow(/no authenticated principal/);
  });
});
