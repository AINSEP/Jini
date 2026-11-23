import { describe, expect, it } from "vitest";
import { userUpdateRoute } from "../update.js";
import { addUser, raw, refusalOf, seededIdentity, signal, trashIndex, WORKSPACE_ID } from "./helpers.js";

async function updateDeps() {
  const { services, ownerId } = await seededIdentity();
  const alice = await addUser({ services, ownerId, username: "alice" });
  const trash = trashIndex();
  return { deps: { workspaceId: WORKSPACE_ID, identityServices: () => services, isInTrash: trash.isInTrash }, services, ownerId, alice, trash };
}
const input = (principalId: string, overrides: Partial<{ email: string | undefined; username: string | undefined; usernameIsInvalid: boolean }> = {}) =>
  ({ principalId, email: undefined, username: undefined, usernameIsInvalid: false, ...overrides });

describe("userUpdateRoute", () => {
  it("keeps the method, path and default success status", () => {
    expect(userUpdateRoute.method).toBe("patch");
    expect(userUpdateRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/users/:principalId");
    expect(userUpdateRoute.successStatus).toBeUndefined();
    expect(userUpdateRoute.maxBodyBytes).toBeUndefined();
  });

  it("parses the PATCH fields, leaving omitted ones undefined, and flags a non-string username", () => {
    expect(userUpdateRoute.parse(raw({ principalId: "p1" }, { email: 7, username: "bo" }))).toEqual({ ok: true, value: input("p1", { email: "7", username: "bo" }) });
    expect(userUpdateRoute.parse(raw({}, undefined))).toEqual({ ok: true, value: input("") });
    for (const username of [5, null, {}]) {
      expect(userUpdateRoute.parse(raw({ principalId: "p1" }, { username }))).toEqual({ ok: true, value: input("p1", { usernameIsInvalid: true }) });
    }
  });

  it("refuses a non-string username with the host's 400 body", async () => {
    const { deps, ownerId, alice } = await updateDeps();
    expect(await refusalOf(() => userUpdateRoute.handle({ input: input(alice, { usernameIsInvalid: true }), deps, context: { id: ownerId } }))).toEqual({
      status: 400, body: { error: "username must be a string", code: "VALIDATION_ERROR" },
    });
  });

  it("refuses a trashed target with 409 USER_IN_TRASH before validating the body", async () => {
    const { deps, ownerId, alice, trash } = await updateDeps();
    trash.trashed.add(alice);
    expect(await refusalOf(() => userUpdateRoute.handle({ input: input(alice, { usernameIsInvalid: true }), deps, context: { id: ownerId } }))).toEqual({
      status: 409, body: { error: "this user is in the Trash; restore them first", code: "USER_IN_TRASH" },
    });
  });

  it("updates the email, keeps it when omitted, and answers the full admin user", async () => {
    const { deps, ownerId, alice } = await updateDeps();
    const changed = await userUpdateRoute.handle({ input: input(alice, { email: "new@example.test" }), deps, context: { id: ownerId } }, { signal });
    expect(changed.ok && changed.value.user).toMatchObject({ principalId: alice, email: "new@example.test", roleIds: [], policyIds: [] });
    const kept = await userUpdateRoute.handle({ input: input(alice), deps, context: { id: ownerId } });
    expect(kept.ok && kept.value.user.email).toBe("new@example.test");
  });

  it("maps a missing target to 404 and an unauthorized caller to 403", async () => {
    const { deps, services, ownerId, alice } = await updateDeps();
    const missing = await refusalOf(() => userUpdateRoute.handle({ input: input("nobody", { email: "x@example.test" }), deps, context: { id: ownerId } }));
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ code: "RESOURCE_NOT_FOUND" });
    const bob = await addUser({ services, ownerId, username: "bob" });
    const forbidden = await refusalOf(() => userUpdateRoute.handle({ input: input(alice, { email: "x@example.test" }), deps, context: { id: bob } }));
    expect(forbidden.status).toBe(403);
    expect(forbidden.body).toMatchObject({ code: "FORBIDDEN" });
  });

  it("rethrows an unmapped failure and fails closed without a principal", async () => {
    const { deps, alice } = await updateDeps();
    await expect(userUpdateRoute.handle({ input: input(alice), deps: { ...deps, isInTrash: async () => { throw new Error("trash down"); } }, context: { id: "x" } })).rejects.toThrow("trash down");
    await expect(userUpdateRoute.handle({ input: input(alice), deps, context: undefined })).rejects.toThrow(/no authenticated principal/);
  });
});
