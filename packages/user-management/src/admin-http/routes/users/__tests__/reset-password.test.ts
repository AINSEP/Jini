import { describe, expect, it } from "vitest";
import { resetUserPassword } from "../../../../server/admin-crud-service.js";
import { userResetPasswordRoute } from "../reset-password.js";
import { addUser, HostSelfDeleteError, raw, refusalOf, seededIdentity, signal, trashIndex, WORKSPACE_ID, HostInTrashError } from "./helpers.js";

async function resetDeps(guard: () => Promise<void> = async () => {}) {
  const { services, ownerId } = await seededIdentity();
  const alice = await addUser({ services, ownerId, username: "alice" });
  const trash = trashIndex();
  const guardCalls: unknown[][] = [];
  const deps = {
    workspaceId: WORKSPACE_ID, resetUserPassword, identityServices: () => services, isInTrash: trash.isInTrash, isUserInTrashError: ({ err }: { err: unknown }) => err instanceof HostInTrashError, ownerPrincipalId: Promise.resolve(ownerId),
    assertUserAccountAction: async (...args: unknown[]) => { guardCalls.push(args); await guard(); },
    isSelfDeleteError: ({ err }: { err: unknown }) => err instanceof HostSelfDeleteError,
  };
  const hashOf = async () => (await services.repos.users.findByPrincipalId({ workspaceId: WORKSPACE_ID, principalId: alice }))?.passwordHash;
  return { deps, services, ownerId, alice, trash, guardCalls, hashOf };
}
const NEW_PASSWORD = "a-new-p4ssw0rd!";

describe("userResetPasswordRoute", () => {
  it("keeps the method, path and 204 success status", () => {
    expect(userResetPasswordRoute.method).toBe("post");
    expect(userResetPasswordRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/users/:principalId/reset-password");
    expect(userResetPasswordRoute.successStatus).toBe(204);
    expect(userResetPasswordRoute.maxBodyBytes).toBeUndefined();
  });

  it("parses the principal id and password with the host's fallbacks", () => {
    expect(userResetPasswordRoute.parse(raw({ principalId: "p1" }, { password: 12345 }))).toEqual({ ok: true, value: { principalId: "p1", password: "12345" } });
    expect(userResetPasswordRoute.parse(raw({}, undefined))).toEqual({ ok: true, value: { principalId: "", password: "" } });
  });

  it("runs the injected guard, resets the password and answers no body", async () => {
    const { deps, services, ownerId, alice, guardCalls, hashOf } = await resetDeps();
    const before = await hashOf();
    const result = await userResetPasswordRoute.handle({ input: { principalId: alice, password: NEW_PASSWORD }, deps, context: { id: ownerId } }, { signal });
    expect(result).toEqual({ ok: true, value: undefined });
    expect(guardCalls).toEqual([[{ deps: services, workspaceId: WORKSPACE_ID, principalId: alice, action: "reset-password" }, { callerPrincipalId: ownerId, seededOwnerPrincipalId: ownerId }]]);
    expect(await hashOf()).not.toBe(before);
  });

  it("refuses a trashed target with 409 USER_IN_TRASH before the guard runs", async () => {
    const { deps, ownerId, alice, trash, guardCalls, hashOf } = await resetDeps();
    const before = await hashOf();
    trash.trashed.add(alice);
    expect(await refusalOf(() => userResetPasswordRoute.handle({ input: { principalId: alice, password: NEW_PASSWORD }, deps, context: { id: ownerId } }))).toEqual({
      status: 409, body: { error: "this user is in the Trash; restore them first", code: "USER_IN_TRASH" },
    });
    expect(guardCalls).toEqual([]);
    expect(await hashOf()).toBe(before);
  });

  // No service path raises the self-target error for reset-password today (the host's guard exempts it so an
  // owner can reset its own password); the mapping is defence-in-depth, proven through the injected predicate.
  it("maps the host's self-target error to 409 SELF_DELETE", async () => {
    const { deps, ownerId, alice } = await resetDeps(async () => { throw new HostSelfDeleteError("you cannot reset your own password here"); });
    expect(await refusalOf(() => userResetPasswordRoute.handle({ input: { principalId: alice, password: NEW_PASSWORD }, deps, context: { id: ownerId } }))).toEqual({
      status: 409, body: { error: "you cannot reset your own password here", code: "SELF_DELETE" },
    });
  });

  it("maps a weak password to 400 and a missing target to 404", async () => {
    const { deps, ownerId, alice } = await resetDeps();
    const weak = await refusalOf(() => userResetPasswordRoute.handle({ input: { principalId: alice, password: "" }, deps, context: { id: ownerId } }));
    expect(weak.status).toBe(400);
    expect(weak.body).toMatchObject({ code: "VALIDATION_ERROR" });
    const missing = await refusalOf(() => userResetPasswordRoute.handle({ input: { principalId: "nobody", password: NEW_PASSWORD }, deps, context: { id: ownerId } }));
    expect(missing.status).toBe(404);
  });

  it("rethrows an unmapped failure and fails closed without a principal", async () => {
    const { deps, ownerId, alice } = await resetDeps(async () => { throw new Error("guard down"); });
    await expect(userResetPasswordRoute.handle({ input: { principalId: alice, password: NEW_PASSWORD }, deps, context: { id: ownerId } })).rejects.toThrow("guard down");
    await expect(userResetPasswordRoute.handle({ input: { principalId: alice, password: NEW_PASSWORD }, deps, context: undefined })).rejects.toThrow(/no authenticated principal/);
  });

  it("maps the host's own in-Trash error (thrown by its Trash index) to 409 USER_IN_TRASH with its message", async () => {
    const { deps, ownerId, alice } = await resetDeps();
    const throwing = { ...deps, isInTrash: async () => { throw new HostInTrashError("trashed"); } };
    expect(await refusalOf(() => userResetPasswordRoute.handle({ input: { principalId: alice, password: "a-new-p4ssw0rd!" }, deps: throwing, context: { id: ownerId } }))).toEqual({
      status: 409, body: { error: "trashed", code: "USER_IN_TRASH" },
    });
  });
});
