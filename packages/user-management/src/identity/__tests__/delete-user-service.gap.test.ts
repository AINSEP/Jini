import { assertVersionedWrite } from "@jini-ai/core/optimistic-concurrency";
import { describe, expect, it } from "vitest";

import { IdentityNotFoundError, IdentityValidationError, OwnerRequiredError, type IdentityRepos } from "../../core/index.js";
import { NodeSessionTokens, InMemoryPolicyPermissionRepo, InMemoryPolicyRepo, InMemoryPrincipalPolicyRepo, InMemoryPrincipalRepo, InMemoryPrincipalRoleRepo, InMemoryRolePolicyRepo, InMemoryRoleRepo, InMemorySessionRepo, InMemoryUserRepo, type AuthServiceDeps } from "../../server/index.js";
import {
  assertActiveOwnerFloor, assertUserAccountAction, createTrashUserService, SelfDeleteError, userAccountProtection, type DeleteUserDeps, type RemoveUserFn,
} from "../delete-user-service.js";
import { UserDeleteUnsupportedError } from "../user-purge-types.js";

const WS = "ws-del";
const NOW = "2026-09-24T00:00:00.000Z";
const SEEDED = "seeded-owner";

async function harness() {
  const repos: IdentityRepos = {
    principals: new InMemoryPrincipalRepo({}), users: new InMemoryUserRepo({ assertVersionedWrite }), sessions: new InMemorySessionRepo({}),
    roles: new InMemoryRoleRepo({ assertVersionedWrite }), policies: new InMemoryPolicyRepo({ assertVersionedWrite }), policyPermissions: new InMemoryPolicyPermissionRepo({}),
    principalPolicies: new InMemoryPrincipalPolicyRepo({}), principalRoles: new InMemoryPrincipalRoleRepo({}), rolePolicies: new InMemoryRolePolicyRepo({}),
    transactions: { run: ({ execute }) => execute() },
  };
  const identity: AuthServiceDeps = {
    tokens: new NodeSessionTokens({}), repos, clock: { nowMs: () => Date.parse(NOW) }, idGen: { newId: () => "id-x" },
    hasher: { hash: async ({ password }) => `password:${password}`, verify: async () => false },
  };
  await repos.policies.save({ version: 1, id: "owner-policy", workspaceId: WS, name: "owner", isBuiltin: false, isFrozen: false });
  await repos.policyPermissions.save({ id: "owner-star", workspaceId: WS, policyId: "owner-policy", permission: "*", resourceType: null, constraintJson: null });
  const addPrincipal = async ({ id, kind = "user", status = "active", owner = false, user = true }: { id: string; kind?: "user" | "api_key" | "service"; status?: "active" | "disabled"; owner?: boolean; user?: boolean }) => {
    await repos.principals.save({ id, workspaceId: WS, kind: kind as "user", displayName: `${id}-display`, status, createdAt: NOW });
    if (kind === "user" && user) await repos.users.save({ version: 1, principalId: id, workspaceId: WS, username: `${id}-name`, email: `${id}@example.com`, passwordHash: "password:x" });
    if (owner) await repos.principalPolicies.save({ id: `${id}-link`, workspaceId: WS, principalId: id, policyId: "owner-policy" });
  };
  await addPrincipal({ id: SEEDED, status: "disabled", owner: true });
  await addPrincipal({ id: "owner-a", owner: true });
  const removals: Parameters<RemoveUserFn>[0][] = [];
  const trashed = new Set<string>();
  const deps: DeleteUserDeps = {
    identity,
    removeUser: async (input) => { removals.push(input); return { ok: true, version: null }; },
    isInTrash: async ({ principalId }) => trashed.has(principalId),
  };
  const input = (principalId: string, callerPrincipalId = SEEDED) => ({ workspaceId: WS, callerPrincipalId, principalId, seededOwnerPrincipalId: SEEDED });
  return { repos, identity, deps, input, removals, trashed, addPrincipal };
}

describe("trashUser target rules", () => {
  it("hands removeUser the user's username and email as the Trash display, stamped with the clock", async () => {
    const h = await harness();
    await h.addPrincipal({ id: "u-1" });
    await expect(createTrashUserService({}).trashUser({ deps: h.deps, input: h.input("u-1") })).resolves.toEqual({ ok: true, version: null });
    expect(h.removals).toEqual([{ workspaceId: WS, id: "u-1", display: { title: "u-1-name", subtitle: "u-1@example.com" }, at: NOW, expectedVersion: null, actor: { principalId: SEEDED } }]);
  });

  it("labels an api_key principal by its display name with an 'API key' subtitle", async () => {
    const h = await harness();
    await h.addPrincipal({ id: "runner", kind: "api_key" });
    await createTrashUserService({}).trashUser({ deps: h.deps, input: h.input("runner") });
    expect(h.removals[0]!.display).toEqual({ title: "runner-display", subtitle: "API key" });
  });

  it("is an idempotent no-op for a target already in the Trash", async () => {
    const h = await harness();
    await h.addPrincipal({ id: "u-1" });
    h.trashed.add("u-1");
    await expect(createTrashUserService({}).trashUser({ deps: h.deps, input: h.input("u-1") })).resolves.toEqual({ ok: true, version: null, noop: true });
    expect(h.removals).toEqual([]);
  });

  it("refuses a missing principal, a non-user kind, a user without a user row, and a self-trash", async () => {
    const h = await harness();
    const { trashUser } = createTrashUserService({});
    await h.addPrincipal({ id: "svc", kind: "service" });
    await h.addPrincipal({ id: "bare", user: false });
    await expect(trashUser({ deps: h.deps, input: h.input("nope") })).rejects.toThrow(new IdentityNotFoundError({ message: "principal 'nope' was not found" }));
    await expect(trashUser({ deps: h.deps, input: h.input("svc") })).rejects.toThrow(new IdentityValidationError({ message: "DELETE_USER target must be a user or api_key principal, got kind='service'" }));
    await expect(trashUser({ deps: h.deps, input: h.input("bare") })).rejects.toThrow(new IdentityNotFoundError({ message: "user 'bare' was not found" }));
    const self = trashUser({ deps: h.deps, input: h.input("owner-a", "owner-a") });
    await expect(self).rejects.toBeInstanceOf(SelfDeleteError);
    await expect(self).rejects.toThrow("you cannot delete your own account");
    expect(h.removals).toEqual([]);
  });

  it("refuses when the composition has no Trash wiring", async () => {
    const h = await harness();
    await h.addPrincipal({ id: "u-1" });
    const { identity, isInTrash } = h.deps;
    const attempt = createTrashUserService({}).trashUser({ deps: { identity, isInTrash }, input: h.input("u-1") });
    await expect(attempt).rejects.toBeInstanceOf(UserDeleteUnsupportedError);
    await expect(attempt).rejects.toThrow("this identity store has no Trash wiring; users cannot be deleted (composition-only limitation)");
  });
});

describe("account-action guards", () => {
  it("words self-disable and seeded-owner refusals for the action", async () => {
    const h = await harness();
    await expect(assertUserAccountAction({ deps: h.identity, workspaceId: WS, principalId: "owner-a", action: "disable" }, { callerPrincipalId: "owner-a" }))
      .rejects.toThrow(new SelfDeleteError("you cannot disable your own account"));
    await expect(assertUserAccountAction({ deps: h.identity, workspaceId: WS, principalId: SEEDED, action: "disable" }, { callerPrincipalId: "owner-a", seededOwnerPrincipalId: SEEDED }))
      .rejects.toThrow(new OwnerRequiredError({ message: "the seeded owner principal can never be disabled" }));
    await expect(assertUserAccountAction({ deps: h.identity, workspaceId: WS, principalId: SEEDED, action: "purge" }, { callerPrincipalId: "owner-a", seededOwnerPrincipalId: SEEDED }))
      .rejects.toThrow(new OwnerRequiredError({ message: "the seeded owner principal can never be deleted" }));
  });

  it("refuses an unknown target with a not-found error naming the principal", async () => {
    const h = await harness();
    const attempt = assertUserAccountAction({ deps: h.identity, workspaceId: WS, principalId: "ghost", action: "reset-password" }, { callerPrincipalId: "owner-a" });
    await expect(attempt).rejects.toBeInstanceOf(IdentityNotFoundError);
    await expect(attempt).rejects.toThrow("principal 'ghost' was not found");
  });

  it("a non-owner caller is refused on a protected account, with enable worded by whether the target is an owner", async () => {
    const h = await harness();
    await h.repos.roles.save({ version: 1, id: "admin-role", workspaceId: WS, name: "admin", isBuiltin: true });
    await h.addPrincipal({ id: "admin-1" });
    await h.repos.principalRoles.save({ id: "admin-1-grant", workspaceId: WS, principalId: "admin-1", roleId: "admin-role" });
    await h.addPrincipal({ id: "editor-1" });
    await h.addPrincipal({ id: "seed-plain" });
    const act = (principalId: string, action: "trash" | "enable" | "reset-password", callerPrincipalId: string, seededOwnerPrincipalId?: string) =>
      assertUserAccountAction({ deps: h.identity, workspaceId: WS, principalId, action }, { callerPrincipalId, ...(seededOwnerPrincipalId ? { seededOwnerPrincipalId } : {}) });
    const trash = act("admin-1", "trash", "editor-1");
    await expect(trash).rejects.toBeInstanceOf(OwnerRequiredError);
    await expect(trash).rejects.toThrow("only an owner can delete, trash, disable or reset the password of an admin or owner account");
    await expect(act("admin-1", "enable", "editor-1")).rejects.toThrow("only an owner can turn an admin account back on");
    await expect(act("owner-a", "enable", "editor-1")).rejects.toThrow("only an owner can modify an owner principal");
    // A seeded owner without the wildcard grant is still protected and still worded as an owner.
    await expect(act("seed-plain", "enable", "editor-1", "seed-plain")).rejects.toThrow("only an owner can modify an owner principal");
    // The gate is the caller's wildcard, not the target: an owner passes, and an unprotected target needs no owner.
    await expect(act("admin-1", "enable", "owner-a")).resolves.toBeUndefined();
    await expect(act("seed-plain", "reset-password", "editor-1")).resolves.toBeUndefined();
  });

  it("userAccountProtection protects only builtin admin/owner role holders and wildcard owners", async () => {
    const h = await harness();
    const grant = async (principalId: string, role: { id: string; name: string; isBuiltin: boolean } | null) => {
      await h.addPrincipal({ id: principalId });
      if (role) await h.repos.roles.save({ version: 1, workspaceId: WS, ...role });
      await h.repos.principalRoles.save({ id: `${principalId}-grant`, workspaceId: WS, principalId, roleId: role?.id ?? "deleted-role" });
    };
    await grant("builtin-owner", { id: "owner-role", name: "owner", isBuiltin: true });
    await grant("builtin-editor", { id: "editor-role", name: "editor", isBuiltin: true });
    await grant("custom-admin", { id: "custom-admin-role", name: "admin", isBuiltin: false });
    await grant("dangling", null);
    const protection = (principalId: string) => userAccountProtection({ deps: h.identity, workspaceId: WS, principalId });
    await expect(protection("builtin-owner")).resolves.toEqual({ isOwner: false, isProtectedAccount: true });
    await expect(protection("builtin-editor")).resolves.toEqual({ isOwner: false, isProtectedAccount: false });
    await expect(protection("custom-admin")).resolves.toEqual({ isOwner: false, isProtectedAccount: false });
    await expect(protection("dangling")).resolves.toEqual({ isOwner: false, isProtectedAccount: false });
    await expect(protection("owner-a")).resolves.toEqual({ isOwner: true, isProtectedAccount: true });
  });

  it("assertActiveOwnerFloor passes with one active owner and throws once none remain", async () => {
    const h = await harness();
    await expect(assertActiveOwnerFloor({ deps: h.identity, workspaceId: WS })).resolves.toBeUndefined();
    const owner = await h.repos.principals.findById({ workspaceId: WS, id: "owner-a" });
    await h.repos.principals.save({ ...owner!, status: "disabled" });
    await expect(assertActiveOwnerFloor({ deps: h.identity, workspaceId: WS }))
      .rejects.toThrow(new OwnerRequiredError({ message: "the workspace must keep at least one active owner-`*` principal" }));
  });
});
