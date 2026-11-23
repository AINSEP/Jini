import { describe, expect, it } from "vitest";
import { userDisableRoute } from "../disable.js";
import { addUser, HostSelfDeleteError, raw, refusalOf, seededIdentity, signal, WORKSPACE_ID } from "./helpers.js";

async function disableDeps(guard: (args: unknown[]) => Promise<void> = async () => {}) {
  const { services, ownerId } = await seededIdentity();
  const alice = await addUser({ services, ownerId, username: "alice" });
  const guardCalls: unknown[][] = [];
  const deps = {
    workspaceId: WORKSPACE_ID, identityServices: () => services, ownerPrincipalId: Promise.resolve(ownerId),
    assertUserAccountAction: async (...args: unknown[]) => { guardCalls.push(args); await guard(args); },
    isSelfDeleteError: ({ err }: { err: unknown }) => err instanceof HostSelfDeleteError,
  };
  return { deps, services, ownerId, alice, guardCalls };
}

describe("userDisableRoute", () => {
  it("keeps the method, path, default success status and the principal id fallback", () => {
    expect(userDisableRoute.method).toBe("post");
    expect(userDisableRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/users/:principalId/disable");
    expect(userDisableRoute.successStatus).toBeUndefined();
    expect(userDisableRoute.maxBodyBytes).toBeUndefined();
    expect(userDisableRoute.parse(raw({}))).toEqual({ ok: true, value: { principalId: "" } });
  });

  it("runs the injected account guard, then disables and answers the full admin user", async () => {
    const { deps, services, ownerId, alice, guardCalls } = await disableDeps();
    const result = await userDisableRoute.handle({ input: { principalId: alice }, deps, context: { id: ownerId } }, { signal });
    expect(guardCalls).toEqual([[{ deps: services, workspaceId: WORKSPACE_ID, principalId: alice, action: "disable" }, { callerPrincipalId: ownerId, seededOwnerPrincipalId: ownerId }]]);
    expect(result.ok && result.value.user).toMatchObject({ principalId: alice, status: "disabled", username: "alice" });
  });

  it("maps the host's self-target error (through its injected predicate) to 409 SELF_DELETE and disables nothing", async () => {
    const { deps, services, ownerId, alice } = await disableDeps(async () => { throw new HostSelfDeleteError("you cannot disable your own account"); });
    expect(await refusalOf(() => userDisableRoute.handle({ input: { principalId: alice }, deps, context: { id: ownerId } }))).toEqual({
      status: 409, body: { error: "you cannot disable your own account", code: "SELF_DELETE" },
    });
    expect((await services.repos.principals.findById({ workspaceId: WORKSPACE_ID, id: alice }))?.status).toBe("active");
  });

  it("maps the seeded owner to 409 OWNER_REQUIRED and a missing target to 404", async () => {
    const { deps, ownerId } = await disableDeps();
    expect(await refusalOf(() => userDisableRoute.handle({ input: { principalId: ownerId }, deps, context: { id: ownerId } }))).toEqual({
      status: 409, body: { error: "the seeded owner principal can never be disabled", code: "OWNER_REQUIRED" },
    });
    const missing = await refusalOf(() => userDisableRoute.handle({ input: { principalId: "nobody" }, deps, context: { id: ownerId } }));
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ code: "RESOURCE_NOT_FOUND" });
  });

  it("rethrows an unmapped failure and fails closed without a principal", async () => {
    const { deps, alice, ownerId } = await disableDeps(async () => { throw new Error("guard down"); });
    await expect(userDisableRoute.handle({ input: { principalId: alice }, deps, context: { id: ownerId } })).rejects.toThrow("guard down");
    await expect(userDisableRoute.handle({ input: { principalId: alice }, deps, context: undefined })).rejects.toThrow(/no authenticated principal/);
  });
});
