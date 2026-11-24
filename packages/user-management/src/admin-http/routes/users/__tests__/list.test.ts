import { describe, expect, it } from "vitest";
import { userListRoute, type UserListRouteDeps } from "../list.js";
import { addUser, raw, refusalOf, seededIdentity, signal, trashIndex, WORKSPACE_ID } from "./helpers.js";

type Decision = { allowed: boolean; reason: string };
async function listDeps(decisions: Record<string, Decision> = {}) {
  const { services, ownerId } = await seededIdentity();
  const alice = await addUser({ services, ownerId, username: "alice" });
  const bob = await addUser({ services, ownerId, username: "bob" });
  const calls: unknown[] = [];
  const protections: string[] = [];
  const trash = trashIndex();
  const deps: UserListRouteDeps = {
    workspaceId: WORKSPACE_ID,
    decidePermission: async (params) => { calls.push(params); return decisions[params.permission] ?? { allowed: true, reason: "ok" }; },
    identityServices: () => services,
    isInTrash: trash.isInTrash,
    ownerPrincipalId: Promise.resolve(ownerId),
    // The host's protection rule is injected; a marker proves this one is used, not a default.
    userAccountProtection: async ({ principalId }) => { protections.push(principalId); return { isOwner: principalId === ownerId, isProtectedAccount: principalId === bob }; },
  };
  return { deps, services, ownerId, alice, bob, calls, protections, trash };
}

describe("userListRoute", () => {
  it("keeps the method, path and default success status", () => {
    expect(userListRoute.method).toBe("get");
    expect(userListRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/users");
    expect(userListRoute.successStatus).toBeUndefined();
    expect(userListRoute.maxBodyBytes).toBeUndefined();
    expect(userListRoute.parse(raw({}))).toEqual({ ok: true, value: {} });
  });

  it("asks both permissions exactly as the host decision port takes them and lists human users", async () => {
    const { deps, ownerId, alice, bob, calls, protections } = await listDeps();
    const result = await userListRoute.handle({ input: {}, deps, context: { id: alice } }, { signal });
    expect(calls).toEqual([
      { principalId: alice, permission: "user.manage", workspaceId: WORKSPACE_ID },
      { principalId: alice, permission: "member.manage", workspaceId: WORKSPACE_ID },
    ]);
    if (!result.ok) throw new Error("expected ok");
    const users = result.value.users;
    expect(users.map((user) => user.username).sort()).toEqual(["admin", "alice", "bob"]);
    expect(protections.sort()).toEqual([alice, bob, ownerId].sort());
    const owner = users.find((user) => user.principalId === ownerId)!;
    expect(Object.keys(owner).slice(0, 4)).toEqual(["isOwner", "isProtectedAccount", "canRename", "principalId"]);
    expect(owner).toMatchObject({ isOwner: true, canRename: false });
    expect(users.find((user) => user.principalId === bob)).toMatchObject({ isProtectedAccount: true, canRename: true, roleIds: [], policyIds: [] });
  });

  it("hides a disabled user who is in the Trash but keeps an intentionally disabled one", async () => {
    const { deps, services, alice, bob, trash } = await listDeps();
    for (const id of [alice, bob]) {
      const principal = await services.repos.principals.findById({ workspaceId: WORKSPACE_ID, id });
      await services.repos.principals.save({ ...principal!, status: "disabled" });
    }
    trash.trashed.add(alice);
    const result = await userListRoute.handle({ input: {}, deps, context: { id: bob } });
    expect(result.ok && result.value.users.map((user) => user.username).sort()).toEqual(["admin", "bob"]);
  });

  it("lets member.manage alone through", async () => {
    const { deps, alice } = await listDeps({ "user.manage": { allowed: false, reason: "no user" } });
    expect((await userListRoute.handle({ input: {}, deps, context: { id: alice } })).ok).toBe(true);
  });

  it("refuses with the combined 403 body (user.manage's reason) before reading any principal", async () => {
    const { deps, alice } = await listDeps({ "user.manage": { allowed: false, reason: "no user" }, "member.manage": { allowed: false, reason: "no member" } });
    let reads = 0;
    const services = deps.identityServices();
    const counting = { ...deps, identityServices: () => { reads += 1; return services; } };
    const refusal = await refusalOf(() => userListRoute.handle({ input: {}, deps: counting, context: { id: alice } }));
    expect(refusal).toEqual({ status: 403, body: {
      error: `principal '${alice}' is not authorized for 'user.manage' or 'member.manage' (no user)`,
      code: "FORBIDDEN", details: { permission: "user.manage", reason: "no user" },
    } });
    expect(reads).toBe(0);
  });

  it("rethrows a decision failure and fails closed without a principal", async () => {
    const { deps } = await listDeps();
    const failing = { ...deps, decidePermission: async () => { throw new Error("rbac down"); } };
    await expect(userListRoute.handle({ input: {}, deps: failing, context: { id: "x" } })).rejects.toThrow("rbac down");
    await expect(userListRoute.handle({ input: {}, deps, context: undefined })).rejects.toThrow(/no authenticated principal/);
  });
});
