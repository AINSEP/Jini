import { describe, expect, it } from "vitest";
import { disablePrincipal } from "../../../../server/admin-crud-service.js";
import { userEnableRoute } from "../enable.js";
import { addUser, raw, refusalOf, seededIdentity, signal, trashIndex, WORKSPACE_ID } from "./helpers.js";

async function enableDeps() {
  const { services, ownerId } = await seededIdentity();
  const alice = await addUser({ services, ownerId, username: "alice" });
  await disablePrincipal({ deps: services, input: { workspaceId: WORKSPACE_ID, callerPrincipalId: ownerId, principalId: alice, seededOwnerPrincipalId: ownerId } });
  const trash = trashIndex();
  return { deps: { workspaceId: WORKSPACE_ID, identityServices: () => services, isInTrash: trash.isInTrash }, services, ownerId, alice, trash };
}

describe("userEnableRoute", () => {
  it("keeps the method, path, default success status and the principal id fallback", () => {
    expect(userEnableRoute.method).toBe("post");
    expect(userEnableRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/users/:principalId/enable");
    expect(userEnableRoute.successStatus).toBeUndefined();
    expect(userEnableRoute.maxBodyBytes).toBeUndefined();
    expect(userEnableRoute.parse(raw({}))).toEqual({ ok: true, value: { principalId: "" } });
  });

  it("re-enables the user and answers the full admin user", async () => {
    const { deps, ownerId, alice } = await enableDeps();
    const result = await userEnableRoute.handle({ input: { principalId: alice }, deps, context: { id: ownerId } }, { signal });
    expect(result.ok && result.value.user).toMatchObject({ principalId: alice, status: "active", roleIds: [], policyIds: [] });
  });

  it("refuses a trashed target with 409 USER_IN_TRASH, but only after the caller's user.manage gate", async () => {
    const { deps, services, ownerId, alice, trash } = await enableDeps();
    trash.trashed.add(alice);
    expect(await refusalOf(() => userEnableRoute.handle({ input: { principalId: alice }, deps, context: { id: ownerId } }))).toEqual({
      status: 409, body: { error: "this user is in the Trash; restore them first", code: "USER_IN_TRASH" },
    });
    // Trash membership is private: an unauthorized caller learns only the 403.
    const bob = await addUser({ services, ownerId, username: "bob" });
    const forbidden = await refusalOf(() => userEnableRoute.handle({ input: { principalId: alice }, deps, context: { id: bob } }));
    expect(forbidden.status).toBe(403);
    expect(forbidden.body).toMatchObject({ code: "FORBIDDEN", details: { permission: "user.manage" } });
  });

  it("maps a missing target to 404 RESOURCE_NOT_FOUND", async () => {
    const { deps, ownerId } = await enableDeps();
    const missing = await refusalOf(() => userEnableRoute.handle({ input: { principalId: "nobody" }, deps, context: { id: ownerId } }));
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ code: "RESOURCE_NOT_FOUND" });
  });

  it("rethrows an unmapped failure and fails closed without a principal", async () => {
    const { deps, ownerId, alice } = await enableDeps();
    await expect(userEnableRoute.handle({ input: { principalId: alice }, deps: { ...deps, isInTrash: async () => { throw new Error("trash down"); } }, context: { id: ownerId } })).rejects.toThrow("trash down");
    await expect(userEnableRoute.handle({ input: { principalId: alice }, deps, context: undefined })).rejects.toThrow(/no authenticated principal/);
  });
});
