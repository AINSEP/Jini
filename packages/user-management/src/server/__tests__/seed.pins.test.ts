import { describe, expect, test } from "vitest";

import { IdentityNotFoundError } from "../../core/types.js";
import { seedIdentity, type SeedIdentityDeps } from "../seed.js";
import { buildTraceHarness, WORKSPACE, type TraceHarness } from "./identity-call-trace.fixture.js";

/**
 * @file Characterization pins for `seed.ts` (L118b), written against the pre-refactor code.
 *
 * `seedIdentity` mints the first owner credential and its wildcard authority (SEC). Every branch is
 * pinned by its exact port-call trace and resulting rows, so a refactor that changes the write
 * order (which the resume design depends on — the owner user must stay the second-to-last write)
 * or adds/drops a write fails here.
 */

const INPUT = { workspaceId: WORKSPACE, ownerUsername: "  Admin ", ownerPassword: "pw" };

function depsOf(h: TraceHarness): SeedIdentityDeps {
  return { repos: h.repos, hasher: h.hasher, clock: h.clock, idGen: h.idGen };
}

async function freshSeed(h: TraceHarness, optional: { ownerEmail?: string } = {}): Promise<{ ownerPrincipalId: string; systemPrincipalId: string }> {
  const result = await seedIdentity({ deps: depsOf(h), input: INPUT }, optional);
  h.calls.length = 0;
  return result;
}

/** One built-in role converge pass on an empty workspace, for a role with `n` permissions. */
function rolePass(n: number): string[] {
  return [
    "roles.findByName",
    "roles.save",
    "policies.findByName",
    "policies.save",
    "rolePolicies.listByRoleId",
    "rolePolicies.save",
    "policyPermissions.listByPolicyId",
    ...Array.from({ length: n }, () => "policyPermissions.save"),
  ];
}

async function permsOfRole(h: TraceHarness, name: string): Promise<string[]> {
  const policy = await h.repos.policies.findByName({ workspaceId: WORKSPACE, name: `${name}-builtin-policy` });
  const rows = await h.repos.policyPermissions.listByPolicyId({ workspaceId: WORKSPACE, policyId: policy!.id });
  return rows.map((row) => row.permission);
}

describe("fresh seed", () => {
  test("exact write order: system, legacy, owner/admin/editor/viewer roles, hash, owner principal, user, role link", async () => {
    const h = buildTraceHarness();
    const result = await seedIdentity({ deps: depsOf(h), input: INPUT }, { ownerEmail: "o@example.test" });
    const adminCount = (await permsOfRole(h, "admin")).length;
    const editorCount = (await permsOfRole(h, "editor")).length;
    expect(adminCount).toBe(45);
    expect(editorCount).toBe(9);
    expect(h.calls).toEqual([
      "users.findByUsername",
      "principals.list",
      "principals.save",
      "principals.save",
      ...rolePass(1),
      ...rolePass(45),
      ...rolePass(9),
      ...rolePass(3),
      "hasher.hash",
      "principals.save",
      "users.save",
      "principalRoles.listByPrincipalId",
      "principalRoles.save",
      // trailing reads below are this test's own permsOfRole() calls
      "policies.findByName",
      "policyPermissions.listByPolicyId",
      "policies.findByName",
      "policyPermissions.listByPolicyId",
    ]);
    expect(result).toEqual({ ownerPrincipalId: expect.any(String), systemPrincipalId: "id-1" });

    const user = await h.repos.users.findByPrincipalId({ workspaceId: WORKSPACE, principalId: result.ownerPrincipalId });
    expect(user).toEqual({ principalId: result.ownerPrincipalId, workspaceId: WORKSPACE, username: "admin", email: "o@example.test", passwordHash: "hash:pw" });
    const principals = await h.repos.principals.list({ workspaceId: WORKSPACE });
    expect(principals.map((p) => [p.id, p.kind, p.status, p.displayName])).toEqual([
      ["id-1", "system", "active", "System"],
      ["user-local", "system", "disabled", "Legacy actor (pre-identity)"],
      [result.ownerPrincipalId, "user", "active", "Owner"],
    ]);
    expect(principals[1]?.disabledAt).toBe("2026-07-10T00:00:00.000Z");
    expect(await permsOfRole(h, "owner")).toEqual(["*"]);
    expect(await permsOfRole(h, "viewer")).toEqual(["content.read", "changeset.read", "plugin.read"]);
    expect(await permsOfRole(h, "admin")).not.toContain("user.manage");
    const roles = await h.repos.principalRoles.listByPrincipalId({ workspaceId: WORKSPACE, principalId: result.ownerPrincipalId });
    const ownerRole = await h.repos.roles.findByName({ workspaceId: WORKSPACE, name: "owner" });
    expect(roles.map((r) => r.roleId)).toEqual([ownerRole!.id]);
    expect(ownerRole?.isBuiltin).toBe(true);
  });

  test("an interrupted seed's system principal is reused, not duplicated", async () => {
    const h = buildTraceHarness();
    await h.repos.principals.save({ id: "sys-old", workspaceId: WORKSPACE, kind: "system", displayName: "Old System", status: "active", createdAt: "x" });
    const result = await seedIdentity({ deps: depsOf(h), input: INPUT });
    expect(result.systemPrincipalId).toBe("sys-old");
    const systems = (await h.repos.principals.list({ workspaceId: WORKSPACE })).filter((p) => p.kind === "system");
    expect(systems.map((p) => p.id)).toEqual(["sys-old", "user-local"]);
    // Reused as-is: the prior row is not rewritten.
    expect(systems[0]).toMatchObject({ displayName: "Old System", createdAt: "x" });
  });

  test("a legacy user-local row alone does not count as the system principal", async () => {
    const h = buildTraceHarness();
    await h.repos.principals.save({ id: "user-local", workspaceId: WORKSPACE, kind: "system", displayName: "L", status: "disabled", createdAt: "x" });
    const result = await seedIdentity({ deps: depsOf(h), input: INPUT });
    expect(result.systemPrincipalId).toBe("id-1");
  });

  test("an existing owner role link for the new principal is not duplicated", async () => {
    const probe = buildTraceHarness();
    const { ownerPrincipalId } = await seedIdentity({ deps: depsOf(probe), input: INPUT });
    const ownerRoleId = (await probe.repos.roles.findByName({ workspaceId: WORKSPACE, name: "owner" }))!.id;

    const h = buildTraceHarness();
    await h.repos.principalRoles.save({ id: "pre-link", workspaceId: WORKSPACE, principalId: ownerPrincipalId, roleId: ownerRoleId });
    await seedIdentity({ deps: depsOf(h), input: INPUT });
    const links = await h.repos.principalRoles.listByPrincipalId({ workspaceId: WORKSPACE, principalId: ownerPrincipalId });
    expect(links.map((l) => l.id)).toEqual(["pre-link"]);
  });
});

describe("resume onto partial built-in rows", () => {
  test("reuses built-in role/policy/link rows and only adds missing unscoped grants", async () => {
    const h = buildTraceHarness();
    await h.repos.roles.save({ id: "r-owner", workspaceId: WORKSPACE, name: "owner", isBuiltin: true });
    await h.repos.policies.save({ id: "pol-owner", workspaceId: WORKSPACE, name: "owner-builtin-policy", description: "d", isBuiltin: true, isFrozen: false });
    await h.repos.rolePolicies.save({ id: "rp", workspaceId: WORKSPACE, roleId: "r-owner", policyId: "pol-owner" });
    // A scoped and a constrained "*" must NOT satisfy the seed's unscoped wildcard grant.
    await h.repos.policyPermissions.save({ id: "scoped", workspaceId: WORKSPACE, policyId: "pol-owner", permission: "*", resourceType: "post", constraintJson: null });
    await h.repos.policyPermissions.save({ id: "constrained", workspaceId: WORKSPACE, policyId: "pol-owner", permission: "*", resourceType: null, constraintJson: "" });
    await h.repos.policies.save({ id: "pol-viewer", workspaceId: WORKSPACE, name: "viewer-builtin-policy", description: "d", isBuiltin: true, isFrozen: false });
    await h.repos.policyPermissions.save({ id: "v1", workspaceId: WORKSPACE, policyId: "pol-viewer", permission: "content.read" });
    h.calls.length = 0;

    await seedIdentity({ deps: depsOf(h), input: INPUT });

    expect((await h.repos.rolePolicies.listByRoleId({ workspaceId: WORKSPACE, roleId: "r-owner" })).map((l) => l.id)).toEqual(["rp"]);
    const ownerRows = await h.repos.policyPermissions.listByPolicyId({ workspaceId: WORKSPACE, policyId: "pol-owner" });
    expect(ownerRows.map((r) => r.id)).toEqual(["scoped", "constrained", expect.any(String)]);
    expect(await permsOfRole(h, "viewer")).toEqual(["content.read", "changeset.read", "plugin.read"]);
  });

  test("refuses to adopt a non-built-in role of a built-in name", async () => {
    const h = buildTraceHarness();
    await h.repos.roles.save({ id: "r", workspaceId: WORKSPACE, name: "owner", isBuiltin: false });
    await expect(seedIdentity({ deps: depsOf(h), input: INPUT })).rejects.toThrow(
      new Error(
        `seedIdentity: a non-built-in role named 'owner' already exists in workspace ${WORKSPACE}. Refusing to adopt it as the built-in 'owner' role — rename or remove it first.`,
      ),
    );
  });

  test("refuses to adopt a non-built-in policy of a built-in policy name", async () => {
    const h = buildTraceHarness();
    await h.repos.policies.save({ id: "p", workspaceId: WORKSPACE, name: "editor-builtin-policy", description: "d", isBuiltin: false, isFrozen: false });
    await expect(seedIdentity({ deps: depsOf(h), input: INPUT })).rejects.toThrow(
      new Error(
        `seedIdentity: a non-built-in policy named 'editor-builtin-policy' already exists in workspace ${WORKSPACE}. Refusing to adopt it as the built-in 'editor' policy — rename or remove it first.`,
      ),
    );
  });
});

describe("already-seeded workspace", () => {
  test("healthy owner (by username): one role read, one roster read, no writes", async () => {
    const h = buildTraceHarness();
    const first = await freshSeed(h);
    const again = await seedIdentity({ deps: depsOf(h), input: { ...INPUT, ownerPassword: "different" } });
    expect(again).toEqual(first);
    expect(h.calls).toEqual(["users.findByUsername", "principalRoles.listByPrincipalId", "principals.list"]);
  });

  test("no non-legacy system principal: falls back to the legacy user-local id", async () => {
    const h = buildTraceHarness();
    await h.repos.principals.save({ id: "user-local", workspaceId: WORKSPACE, kind: "system", displayName: "L", status: "disabled", createdAt: "x" });
    await h.repos.principals.save({ id: "p-own", workspaceId: WORKSPACE, kind: "user", displayName: "O", status: "active", createdAt: "x" });
    await h.repos.users.save({ principalId: "p-own", workspaceId: WORKSPACE, username: "admin", passwordHash: "h" });
    await h.repos.principalRoles.save({ id: "l", workspaceId: WORKSPACE, principalId: "p-own", roleId: "anything" });
    expect(await seedIdentity({ deps: depsOf(h), input: INPUT })).toEqual({ ownerPrincipalId: "p-own", systemPrincipalId: "user-local" });
  });

  test("owner holding NO role is repaired: owner role converged and linked", async () => {
    const h = buildTraceHarness();
    await h.repos.principals.save({ id: "p-own", workspaceId: WORKSPACE, kind: "user", displayName: "O", status: "active", createdAt: "x" });
    await h.repos.users.save({ principalId: "p-own", workspaceId: WORKSPACE, username: "admin", passwordHash: "h" });
    h.calls.length = 0;
    const result = await seedIdentity({ deps: depsOf(h), input: INPUT });
    expect(h.calls).toEqual(["users.findByUsername", "principalRoles.listByPrincipalId", ...rolePass(1), "principalRoles.save", "principals.list"]);
    expect(result).toEqual({ ownerPrincipalId: "p-own", systemPrincipalId: "user-local" });
    const links = await h.repos.principalRoles.listByPrincipalId({ workspaceId: WORKSPACE, principalId: "p-own" });
    const ownerRole = await h.repos.roles.findByName({ workspaceId: WORKSPACE, name: "owner" });
    expect(links.map((l) => l.roleId)).toEqual([ownerRole!.id]);
  });

  test("owner holding a lesser role is NOT re-escalated", async () => {
    const h = buildTraceHarness();
    await h.repos.users.save({ principalId: "p-own", workspaceId: WORKSPACE, username: "admin", passwordHash: "h" });
    await h.repos.principalRoles.save({ id: "l", workspaceId: WORKSPACE, principalId: "p-own", roleId: "viewer-role" });
    await seedIdentity({ deps: depsOf(h), input: INPUT });
    expect(await h.repos.roles.findByName({ workspaceId: WORKSPACE, name: "owner" })).toBeNull();
  });

  test("bound seededOwnerPrincipalId wins over the username, even when the username now belongs to someone else", async () => {
    const h = buildTraceHarness();
    await h.repos.users.save({ principalId: "p-bound", workspaceId: WORKSPACE, username: "renamed", passwordHash: "h" });
    await h.repos.principalRoles.save({ id: "l", workspaceId: WORKSPACE, principalId: "p-bound", roleId: "r" });
    await h.repos.users.save({ principalId: "p-squatter", workspaceId: WORKSPACE, username: "admin", passwordHash: "h" });
    h.calls.length = 0;
    const result = await seedIdentity({ deps: depsOf(h), input: INPUT }, { seededOwnerPrincipalId: "p-bound" });
    expect(result.ownerPrincipalId).toBe("p-bound");
    expect(h.calls).toEqual(["users.findByPrincipalId", "principalRoles.listByPrincipalId", "principals.list"]);
  });

  test("bound seededOwnerPrincipalId with no user row refuses and writes nothing", async () => {
    const h = buildTraceHarness();
    await h.repos.users.save({ principalId: "p-other", workspaceId: WORKSPACE, username: "admin", passwordHash: "h" });
    h.calls.length = 0;
    const error = await seedIdentity({ deps: depsOf(h), input: INPUT }, { seededOwnerPrincipalId: "p-missing" }).then(
      () => "resolved",
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(IdentityNotFoundError);
    expect((error as Error).message).toBe("the bound seeded owner user was not found; restore the owner identity before booting");
    expect(h.calls).toEqual(["users.findByPrincipalId"]);
  });
});
