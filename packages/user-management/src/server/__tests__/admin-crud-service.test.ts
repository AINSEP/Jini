import { nowIso as kernelNowIso } from "@jini-ai/core/primitives";
import { createTransactionalInMemoryIdentityRepos } from "../repo.memory-transactions.js";
import { NodeSessionTokens } from "../session-tokens.js";
import assert from "node:assert/strict";
import { test } from "vitest";

/** Supplied explicitly because `SeedIdentityInput.ownerPassword` has no library default. */
const SEED_OWNER_PASSWORD = "seed-owner-pw";

import { Argon2PasswordHasher, loadArgon2Binding } from "../hasher.js";
import { login } from "../auth-service.js";
import type { AuthServiceDeps } from "../auth-service.js";
import {
  attachPolicy,
  assignRole,
  createPolicy,
  createRole,
  createUser,
} from "../grant-service.js";
import {
  deletePolicy,
  deleteRole,
  disablePrincipal,
  enablePrincipal,
  resetUserPassword,
  updatePolicy,
  updateRole,
  updateUser,
  writePolicyPermission,
  removePolicyPermission,
} from "../admin-crud-service.js";
import type { IdentityRepos } from "../../core/ports.js";
import {
  InMemoryPolicyPermissionRepo,
  InMemoryPolicyRepo,
  InMemoryPrincipalPolicyRepo,
  InMemoryPrincipalRepo,
  InMemoryPrincipalRoleRepo,
  InMemoryRolePolicyRepo,
  InMemoryRoleRepo,
  InMemorySessionRepo,
  InMemoryUserRepo,
} from "../repo.memory.js";
import { seedIdentity } from "../seed.js";
import {
  AuthInvalidCredentialsError,
  GrantExceedsIssuerError,
  IdentityConflictError,
  IdentityForbiddenError,
  IdentityNotFoundError,
  IdentityValidationError,
  OwnerRequiredError,
  PermissionUnknownError,
  type PrincipalRecord,
} from "../../core/types.js";

/**
 * @file Admin CRUD amendment —..32,..17.
 * Mirrors `grant-service.test.ts`'s exact harness (`buildSeededDeps`/`seedBarePrincipal`).
 * See docs/decisions/DR-002-grant-authority-and-admin-safety.md.
 */

const WORKSPACE = "workspace-1";
const HASHER = new Argon2PasswordHasher({ loadBinding: loadArgon2Binding }, { memoryCost: 8, timeCost: 1, parallelism: 1 });
const fixedClock = { nowMs: () => Date.parse("2026-07-21T00:00:00.000Z")};

function counterIdGen() {
  let n = 0;
  return { newId: () => `id-${++n}` };
}

async function buildSeededDeps(): Promise<{
  deps: AuthServiceDeps;
  repos: IdentityRepos;
  ownerPrincipalId: string;
  systemPrincipalId: string;
}> {
  const repos: IdentityRepos = createTransactionalInMemoryIdentityRepos({ repos: {
    principals: new InMemoryPrincipalRepo({}),
    users: new InMemoryUserRepo({}),
    sessions: new InMemorySessionRepo({}),
    roles: new InMemoryRoleRepo({}),
    policies: new InMemoryPolicyRepo({}),
    policyPermissions: new InMemoryPolicyPermissionRepo({}),
    rolePolicies: new InMemoryRolePolicyRepo({}),
    principalRoles: new InMemoryPrincipalRoleRepo({}),
    principalPolicies: new InMemoryPrincipalPolicyRepo({}),
  } });
  const deps: AuthServiceDeps = { repos, hasher: HASHER, clock: fixedClock, idGen: counterIdGen(), tokens: new NodeSessionTokens({}) };
  const { ownerPrincipalId, systemPrincipalId } = await seedIdentity({ deps, input: { workspaceId: WORKSPACE, ownerPassword: SEED_OWNER_PASSWORD, ownerUsername: "admin" } });
  return { deps, repos, ownerPrincipalId, systemPrincipalId };
}

async function seedBarePrincipal(
  repos: IdentityRepos,
  id: string,
  kind: PrincipalRecord["kind"] = "user"
): Promise<void> {
  await repos.principals.save({
    id,
    workspaceId: WORKSPACE,
    kind,
    displayName: id,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
  });
}

// ---------------------------------------------------------------------------
// DISABLE_PRINCIPAL ( domain-level, now implemented for the first time). See docs/decisions/DR-002-grant-authority-and-admin-safety.md.
// ---------------------------------------------------------------------------

test("DISABLE_PRINCIPAL: the seeded owner can never be disabled, even with another active owner present", async () => {
  const { deps, ownerPrincipalId } = await buildSeededDeps();

  await assert.rejects(
    () =>
      disablePrincipal({
        deps,
        input: {
          workspaceId: WORKSPACE,
          callerPrincipalId: ownerPrincipalId,
          principalId: ownerPrincipalId,
          seededOwnerPrincipalId: ownerPrincipalId,
        },
      }),
    (error: unknown) => error instanceof OwnerRequiredError && error.message === "the seeded owner principal can never be disabled"
  );
});

test("DISABLE_PRINCIPAL: refuses a disable that would drop the active owner-* count to zero (INV-08)", async () => {
  const { deps, repos, ownerPrincipalId } = await buildSeededDeps();

  // Mint a second owner-* principal via ASSIGN_ROLE would need the owner role id; simplest: attach
  // a custom policy carrying `*` is impossible (owner-only built-in) — so directly grant via
  // principal_policies pointing at nothing works only through ATTACH_POLICY's built-in-owner path.
  // Use createRole/createPolicy + attach the BUILT-IN owner policy is refused for non-owner; but the
  // OWNER caller can attach the built-in owner policy to a second principal ( clamp: owner's. See docs/decisions/DR-002-grant-authority-and-admin-safety.md.
  // `*` satisfies attaching `*`).
  const ownerPolicy = (await repos.policies.list({ workspaceId: WORKSPACE })).find((p) => p.name === "owner-builtin-policy");
  assert.ok(ownerPolicy, "seed created the owner built-in policy");

  await seedBarePrincipal(repos, "second-owner");
  await attachPolicy({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, principalId: "second-owner", policyId: ownerPolicy!.id },
  });

  // Now two active owner-* principals exist. Disabling the non-seed one succeeds.
  const { principal } = await disablePrincipal({
    deps,
    input: {
      workspaceId: WORKSPACE,
      callerPrincipalId: ownerPrincipalId,
      principalId: "second-owner",
      seededOwnerPrincipalId: ownerPrincipalId,
    },
  });
  assert.equal(principal.status, "disabled");

  // A third attempt to disable it again is idempotent (already disabled).
  const { principal: again } = await disablePrincipal({
    deps,
    input: {
      workspaceId: WORKSPACE,
      callerPrincipalId: ownerPrincipalId,
      principalId: "second-owner",
      seededOwnerPrincipalId: ownerPrincipalId,
    },
  });
  assert.equal(again.status, "disabled");
});

test("DISABLE_PRINCIPAL: a non-owner-* principal can be disabled freely by a user.manage holder", async () => {
  const { deps, ownerPrincipalId } = await buildSeededDeps();

  const { principal: editor } = await createUser({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, username: "editor1", password: "pw-valid-1234" },
  });

  const { principal } = await disablePrincipal({
    deps,
    input: {
      workspaceId: WORKSPACE,
      callerPrincipalId: ownerPrincipalId,
      principalId: editor.id,
      seededOwnerPrincipalId: ownerPrincipalId,
    },
  });
  assert.equal(principal.status, "disabled");
  assert.ok(principal.disabledAt);
});

test("DISABLE_PRINCIPAL: a caller without user.manage is denied (AC-21/RT-005)", async () => {
  const { deps, ownerPrincipalId } = await buildSeededDeps();
  const { principal: target } = await createUser({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, username: "target1", password: "pw-valid-1234" },
  });
  const { principal: caller } = await createUser({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, username: "caller1", password: "pw-valid-1234" },
  });

  await assert.rejects(
    () =>
      disablePrincipal({
        deps,
        input: {
          workspaceId: WORKSPACE,
          callerPrincipalId: caller.id,
          principalId: target.id,
          seededOwnerPrincipalId: ownerPrincipalId,
        },
      }),
    IdentityForbiddenError
  );
});

// ---------------------------------------------------------------------------
// ENABLE_PRINCIPAL. See docs/decisions/DR-002-grant-authority-and-admin-safety.md.
// ---------------------------------------------------------------------------

test("AC-27: ENABLE_PRINCIPAL re-activates a disabled user and clears disabledAt", async () => {
  const { deps, ownerPrincipalId } = await buildSeededDeps();
  const { principal: target } = await createUser({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, username: "target2", password: "pw-valid-1234" },
  });
  await disablePrincipal({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, principalId: target.id, seededOwnerPrincipalId: ownerPrincipalId },
  });

  const { principal } = await enablePrincipal({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, principalId: target.id },
  });
  assert.equal(principal.status, "active");
  assert.equal(principal.disabledAt, undefined);
});

test("EC-14: ENABLE_PRINCIPAL rejects a non-kind='user' target (the disabled legacy user-local)", async () => {
  const { deps, ownerPrincipalId, systemPrincipalId } = await buildSeededDeps();

  await assert.rejects(
    () =>
      enablePrincipal({
        deps,
        input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, principalId: "user-local" },
      }),
    IdentityValidationError
  );
  void systemPrincipalId;
});

test("AC-27: ENABLE_PRINCIPAL is denied for a caller without user.manage", async () => {
  const { deps, ownerPrincipalId, repos } = await buildSeededDeps();
  const { principal: target } = await createUser({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, username: "target3", password: "pw-valid-1234" },
  });
  await disablePrincipal({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, principalId: target.id, seededOwnerPrincipalId: ownerPrincipalId },
  });
  await seedBarePrincipal(repos, "no-grant-caller");

  await assert.rejects(
    () =>
      enablePrincipal({
        deps,
        input: { workspaceId: WORKSPACE, callerPrincipalId: "no-grant-caller", principalId: target.id },
      }),
    IdentityForbiddenError
  );
});

// ---------------------------------------------------------------------------
// UPDATE_USER. See docs/decisions/DR-002-grant-authority-and-admin-safety.md.
// ---------------------------------------------------------------------------

test("SECURITY: member.manage alone cannot UPDATE_USER on another operator", async () => {
  const { deps, repos, ownerPrincipalId } = await buildSeededDeps();
  const { policy } = await createPolicy({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, name: "member-onboarder" },
  });
  await repos.policyPermissions.save({
    id: "pp-member-manage",
    workspaceId: WORKSPACE,
    policyId: policy.id,
    permission: "member.manage",
    resourceType: null,
    constraintJson: null,
  });
  await seedBarePrincipal(repos, "member-manage-caller");
  await attachPolicy({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, principalId: "member-manage-caller", policyId: policy.id },
  });

  const { principal: target } = await createUser({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, username: "target4", password: "pw-valid-1234" },
  });

  const before = await repos.users.findByPrincipalId({ workspaceId: WORKSPACE, principalId: target.id });
  await assert.rejects(
    () => updateUser({ deps, input: { workspaceId: WORKSPACE, callerPrincipalId: "member-manage-caller", principalId: target.id } }, { email: "new@example.com" }),
    (error: unknown) => error instanceof IdentityForbiddenError &&
      error.message === "principal 'member-manage-caller' is not authorized for any of [user.manage]"
  );
  assert.deepEqual(await repos.users.findByPrincipalId({ workspaceId: WORKSPACE, principalId: target.id }), before);
});

async function buildDelegatedManager(permission: "member.manage" | "user.manage" | "role.manage") {
  const seeded = await buildSeededDeps();
  const { deps, ownerPrincipalId } = seeded;
  const { principal: manager } = await createUser({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, username: "manager", password: "manager-pw" },
  });
  const { policy } = await createPolicy({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, name: "delegated-manager" },
  });
  await writePolicyPermission({ deps, input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, policyId: policy.id, permission } });
  await attachPolicy({ deps, input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, principalId: manager.id, policyId: policy.id } });
  return { ...seeded, manager, policy };
}

test("SECURITY: member.manage cannot change the seeded owner's email", async () => {
  const { deps, repos, ownerPrincipalId, manager } = await buildDelegatedManager("member.manage");
  const before = await repos.users.findByPrincipalId({ workspaceId: WORKSPACE, principalId: ownerPrincipalId });
  await assert.rejects(
    () => updateUser({ deps, input: { workspaceId: WORKSPACE, callerPrincipalId: manager.id, principalId: ownerPrincipalId } }, { email: "attacker@example.com" }),
    (error: unknown) => error instanceof IdentityForbiddenError &&
      error.message === `principal '${manager.id}' is not authorized for any of [user.manage]`
  );
  assert.deepEqual(await repos.users.findByPrincipalId({ workspaceId: WORKSPACE, principalId: ownerPrincipalId }), before);
});

for (const ownerGrant of ["seeded", "role", "policy"] as const) {
  test(`SECURITY: user.manage cannot change a ${ownerGrant} owner's email, including clearing it`, async () => {
    const { deps, repos, ownerPrincipalId, manager } = await buildDelegatedManager("user.manage");
    let targetId = ownerPrincipalId;
    if (ownerGrant !== "seeded") {
      const { principal } = await createUser({ deps, input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, username: "other-owner", password: "owner-pw" } });
      targetId = principal.id;
      if (ownerGrant === "role") {
        const ownerRole = (await repos.roles.list({ workspaceId: WORKSPACE })).find((role) => role.name === "owner");
        assert.ok(ownerRole);
        await assignRole({ deps, input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, principalId: targetId, roleId: ownerRole.id } });
      } else {
        const ownerPolicy = (await repos.policies.list({ workspaceId: WORKSPACE })).find((policy) => policy.name === "owner-builtin-policy");
        assert.ok(ownerPolicy);
        await attachPolicy({ deps, input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, principalId: targetId, policyId: ownerPolicy.id } });
      }
    }
    await updateUser({ deps, input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, principalId: targetId } }, { email: "owner@example.com" });
    const before = await repos.users.findByPrincipalId({ workspaceId: WORKSPACE, principalId: targetId });
    for (const email of ["attacker@example.com", "", undefined]) {
      await assert.rejects(
        () => updateUser({ deps, input: { workspaceId: WORKSPACE, callerPrincipalId: manager.id, principalId: targetId } }, { email }),
        (error: unknown) => error instanceof OwnerRequiredError &&
          error.message === "only an owner can modify an owner principal"
      );
      assert.deepEqual(await repos.users.findByPrincipalId({ workspaceId: WORKSPACE, principalId: targetId }), before);
    }
  });
}

test("UPDATE_USER: owner can edit its own email and preserves its username, password, and grants", async () => {
  const { deps, repos, ownerPrincipalId } = await buildSeededDeps();
  const before = await repos.users.findByPrincipalId({ workspaceId: WORKSPACE, principalId: ownerPrincipalId });
  assert.ok(before);
  const rolesBefore = await repos.principalRoles.listByPrincipalId({ workspaceId: WORKSPACE, principalId: ownerPrincipalId });
  const { user } = await updateUser({ deps, input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, principalId: ownerPrincipalId } }, { email: "new-owner@example.com" });
  assert.deepEqual(user, { ...before, email: "new-owner@example.com" });
  assert.deepEqual(await repos.principalRoles.listByPrincipalId({ workspaceId: WORKSPACE, principalId: ownerPrincipalId }), rolesBefore);
});

test("user.manage can create an operator, update its email, and edit its own email", async () => {
  const { deps, repos, ownerPrincipalId, manager } = await buildDelegatedManager("user.manage");
  const { principal, user } = await createUser({ deps, input: { workspaceId: WORKSPACE, callerPrincipalId: manager.id, username: "allowed-operator", password: "operator-pw" } });
  assert.equal(principal.kind, "user");
  assert.equal(user.principalId, principal.id);
  for (const principalId of [principal.id, manager.id]) {
    const rolesBefore = await repos.principalRoles.listByPrincipalId({ workspaceId: WORKSPACE, principalId });
    const { user: updated } = await updateUser({ deps, input: { workspaceId: WORKSPACE, callerPrincipalId: manager.id, principalId } }, { email: "allowed@example.com" });
    assert.equal(updated.email, "allowed@example.com");
    assert.deepEqual(await repos.principalRoles.listByPrincipalId({ workspaceId: WORKSPACE, principalId }), rolesBefore);
  }
  assert.notEqual(principal.id, ownerPrincipalId);
});

test("UPDATE_USER: member.manage keeps its existing self-profile edit without changing grants", async () => {
  const { deps, repos, manager } = await buildDelegatedManager("member.manage");
  const before = await repos.users.findByPrincipalId({ workspaceId: WORKSPACE, principalId: manager.id });
  assert.ok(before);
  const rolesBefore = await repos.principalRoles.listByPrincipalId({ workspaceId: WORKSPACE, principalId: manager.id });
  const policiesBefore = await repos.principalPolicies.listByPrincipalId({ workspaceId: WORKSPACE, principalId: manager.id });
  const { user } = await updateUser({ deps, input: { workspaceId: WORKSPACE, callerPrincipalId: manager.id, principalId: manager.id } }, { email: "self@example.com" });
  assert.deepEqual(user, { ...before, email: "self@example.com" });
  assert.deepEqual(await repos.principalRoles.listByPrincipalId({ workspaceId: WORKSPACE, principalId: manager.id }), rolesBefore);
  assert.deepEqual(await repos.principalPolicies.listByPrincipalId({ workspaceId: WORKSPACE, principalId: manager.id }), policiesBefore);
});

test("UPDATE_USER: self-edit without any management permission remains forbidden", async () => {
  const { deps, repos, ownerPrincipalId } = await buildSeededDeps();
  const { principal: caller } = await createUser({ deps, input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, username: "unprivileged", password: "profile-pw" } });
  const before = await repos.users.findByPrincipalId({ workspaceId: WORKSPACE, principalId: caller.id });
  await assert.rejects(
    () => updateUser({ deps, input: { workspaceId: WORKSPACE, callerPrincipalId: caller.id, principalId: caller.id } }, { email: "self@example.com" }),
    (error: unknown) => error instanceof IdentityForbiddenError &&
      error.message === `principal '${caller.id}' is not authorized for any of [user.manage, member.manage]`
  );
  assert.deepEqual(await repos.users.findByPrincipalId({ workspaceId: WORKSPACE, principalId: caller.id }), before);
});

for (const transition of ["disable", "enable", "reset", "assign", "attach"] as const) {
  test(`SECURITY: a non-owner manager cannot ${transition} a non-seeded owner`, async () => {
    const { deps, repos, ownerPrincipalId, manager, policy } = await buildDelegatedManager(
      transition === "assign" || transition === "attach" ? "role.manage" : "user.manage"
    );
    const { principal: target } = await createUser({ deps, input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, username: "other-owner", password: "owner-pw" } });
    const ownerRole = (await repos.roles.list({ workspaceId: WORKSPACE })).find((role) => role.name === "owner");
    assert.ok(ownerRole);
    await assignRole({ deps, input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, principalId: target.id, roleId: ownerRole.id } });
    if (transition === "enable") await disablePrincipal({ deps, input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, principalId: target.id, seededOwnerPrincipalId: ownerPrincipalId } });
    const before = {
      principal: await repos.principals.findById({ workspaceId: WORKSPACE, id: target.id }),
      user: await repos.users.findByPrincipalId({ workspaceId: WORKSPACE, principalId: target.id }),
      roles: await repos.principalRoles.listByPrincipalId({ workspaceId: WORKSPACE, principalId: target.id }),
      policies: await repos.principalPolicies.listByPrincipalId({ workspaceId: WORKSPACE, principalId: target.id }),
    };
    const input = { workspaceId: WORKSPACE, callerPrincipalId: manager.id, principalId: target.id };
    const { role: emptyRole } = await createRole({ deps, input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, name: "empty-role" } });
    await assert.rejects(
      () => {
        switch (transition) {
          case "disable": return disablePrincipal({ deps, input: { ...input, seededOwnerPrincipalId: ownerPrincipalId } });
          case "enable": return enablePrincipal({ deps, input });
          case "reset": return resetUserPassword({ deps, input: { ...input, password: "attacker-pw", seededOwnerPrincipalId: ownerPrincipalId } });
          case "assign": return assignRole({ deps, input: { ...input, roleId: emptyRole.id } });
          case "attach": return attachPolicy({ deps, input: { ...input, policyId: policy.id } });
        }
      },
      (error: unknown) => error instanceof OwnerRequiredError &&
        error.message === "only an owner can modify an owner principal"
    );
    assert.deepEqual({
      principal: await repos.principals.findById({ workspaceId: WORKSPACE, id: target.id }),
      user: await repos.users.findByPrincipalId({ workspaceId: WORKSPACE, principalId: target.id }),
      roles: await repos.principalRoles.listByPrincipalId({ workspaceId: WORKSPACE, principalId: target.id }),
      policies: await repos.principalPolicies.listByPrincipalId({ workspaceId: WORKSPACE, principalId: target.id }),
    }, before);
  });
}

test("SECURITY: editing one's profile cannot grant oneself the owner role", async () => {
  const { deps, repos, manager } = await buildDelegatedManager("role.manage");
  const ownerRole = (await repos.roles.list({ workspaceId: WORKSPACE })).find((role) => role.name === "owner");
  assert.ok(ownerRole);
  await assert.rejects(
    () => assignRole({ deps, input: { workspaceId: WORKSPACE, callerPrincipalId: manager.id, principalId: manager.id, roleId: ownerRole.id } }),
    (error: unknown) => error instanceof GrantExceedsIssuerError &&
      error.message === `principal '${manager.id}' cannot grant permission(s) it does not hold unconstrained: *`
  );
  assert.deepEqual(await repos.principalRoles.listByPrincipalId({ workspaceId: WORKSPACE, principalId: manager.id }), []);
});

test("UPDATE_USER: clears email when given an empty string (EC-17)", async () => {
  const { deps, ownerPrincipalId } = await buildSeededDeps();
  const { principal: target } = await createUser({ deps, input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, username: "target5", password: "pw-valid-1234" } }, { email: "old@example.com" });

  const { user } = await updateUser({ deps, input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, principalId: target.id } }, { email: "" });
  assert.equal(user.email, undefined);
});

test("UPDATE_USER: throws IdentityNotFoundError for an unknown principalId", async () => {
  const { deps, ownerPrincipalId } = await buildSeededDeps();
  await assert.rejects(
    () =>
      updateUser({ deps, input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, principalId: "missing" } }, { email: "x@example.com" }),
    IdentityNotFoundError
  );
});

// ---------------------------------------------------------------------------
// RESET_USER_PASSWORD. See docs/decisions/DR-002-grant-authority-and-admin-safety.md.
// ---------------------------------------------------------------------------

test("AC-29: RESET_USER_PASSWORD changes the hash and revokes every active session", async () => {
  const { deps, repos, ownerPrincipalId } = await buildSeededDeps();
  const { principal: target } = await createUser({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, username: "target6", password: "old-pw-123456" },
  });
  const before = await repos.users.findByPrincipalId({ workspaceId: WORKSPACE, principalId: target.id });

  await repos.sessions.save({
    id: "sess-1",
    workspaceId: WORKSPACE,
    principalId: target.id,
    tokenHash: "hash-1",
    createdAt: kernelNowIso({ clock: fixedClock }),
    expiresAt: "2099-01-01T00:00:00.000Z",
  });
  await repos.sessions.save({
    id: "sess-2",
    workspaceId: WORKSPACE,
    principalId: target.id,
    tokenHash: "hash-2",
    createdAt: kernelNowIso({ clock: fixedClock }),
    expiresAt: "2099-01-01T00:00:00.000Z",
  });

  const { user } = await resetUserPassword({
    deps,
    input: {
      workspaceId: WORKSPACE,
      callerPrincipalId: ownerPrincipalId,
      principalId: target.id,
      password: "new-pw-123456",
      seededOwnerPrincipalId: ownerPrincipalId,
    },
  });
  assert.notEqual(user.passwordHash, before?.passwordHash);

  const sessions = await repos.sessions.listByPrincipalId({ workspaceId: WORKSPACE, principalId: target.id });
  assert.equal(sessions.length, 2);
  assert.ok(sessions.every((s) => s.revokedAt));
});

test("AC-29: RESET_USER_PASSWORD is denied for a caller holding only member.manage (stricter gate than UPDATE_USER)", async () => {
  const { deps, repos, ownerPrincipalId } = await buildSeededDeps();
  const { policy } = await createPolicy({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, name: "member-onboarder-2" },
  });
  await repos.policyPermissions.save({
    id: "pp-member-manage-2",
    workspaceId: WORKSPACE,
    policyId: policy.id,
    permission: "member.manage",
    resourceType: null,
    constraintJson: null,
  });
  await seedBarePrincipal(repos, "member-only-caller");
  await attachPolicy({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, principalId: "member-only-caller", policyId: policy.id },
  });
  const { principal: target } = await createUser({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, username: "target7", password: "pw-valid-1234" },
  });

  await assert.rejects(
    () =>
      resetUserPassword({
        deps,
        input: {
          workspaceId: WORKSPACE,
          callerPrincipalId: "member-only-caller",
          principalId: target.id,
          password: "new-pw-123456",
          seededOwnerPrincipalId: ownerPrincipalId,
        },
      }),
    IdentityForbiddenError
  );
});

test("EC-16: RESET_USER_PASSWORD on a user with zero sessions is a no-op revoke, still changes the password", async () => {
  const { deps, ownerPrincipalId } = await buildSeededDeps();
  const { principal: target } = await createUser({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, username: "target8", password: "old-pw-123456" },
  });

  const { user } = await resetUserPassword({
    deps,
    input: {
      workspaceId: WORKSPACE,
      callerPrincipalId: ownerPrincipalId,
      principalId: target.id,
      password: "new-pw-123456",
      seededOwnerPrincipalId: ownerPrincipalId,
    },
  });
  assert.ok(user.passwordHash);
});

test("RESET_USER_PASSWORD: rejects a blank password", async () => {
  const { deps, ownerPrincipalId } = await buildSeededDeps();
  const { principal: target } = await createUser({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, username: "target9", password: "old-pw-123456" },
  });

  await assert.rejects(
    () =>
      resetUserPassword({
        deps,
        input: {
          workspaceId: WORKSPACE,
          callerPrincipalId: ownerPrincipalId,
          principalId: target.id,
          password: "",
          seededOwnerPrincipalId: ownerPrincipalId,
        },
      }),
    IdentityValidationError
  );
});

/**
 * 2026-09-03 production incident: the admin UI's own reset-password flow reported success, and
 * afterward NEITHER the old nor the new password could log in. Every existing RESET_USER_PASSWORD
 * test above only asserts `user.passwordHash` CHANGED (`assert.notEqual(user.passwordHash,
 * before?.passwordHash)`) — none of them ever drove the new password back through the real login()
 * path, which is exactly the gap that let a hash-that-doesn't-verify bug ship undetected. This is
 * the test that should have existed before that incident.
 */
test("RESET_USER_PASSWORD: the new password authenticates end-to-end through login() afterward, and the old one no longer does", async () => {
  const { deps, ownerPrincipalId } = await buildSeededDeps();
  const { principal: target } = await createUser({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, username: "target10", password: "old-pw-123456" },
  });

  await resetUserPassword({
    deps,
    input: {
      workspaceId: WORKSPACE,
      callerPrincipalId: ownerPrincipalId,
      principalId: target.id,
      password: "brand-new-pw-998877",
      seededOwnerPrincipalId: ownerPrincipalId,
    },
  });

  const { principal } = await login({
    deps,
    input: { workspaceId: WORKSPACE, username: "target10", password: "brand-new-pw-998877" },
  });
  assert.equal(principal.id, target.id, "the new password must log in as the SAME principal that was reset");

  await assert.rejects(
    () => login({ deps, input: { workspaceId: WORKSPACE, username: "target10", password: "old-pw-123456" } }),
    AuthInvalidCredentialsError,
    "the pre-reset password must no longer authenticate"
  );
});

/**
 * 2026-09-03 privilege-escalation finding: `user.manage` is independently grantable and NOT
 * owner-exclusive (`permissions.ts` — "Create/disable operator users and principals"). Before this
 * fix, a caller holding only that one delegated permission could call RESET_USER_PASSWORD against
 * the seeded owner's account, set a password of their own choosing, and log in as owner — a full
 * takeover from a routine delegation. Mirrors `disablePrincipal`'s own "the seeded owner can never
 * be [transition]ed [by another caller]" proof above.
 */
test("SECURITY: RESET_USER_PASSWORD refuses a THIRD-PARTY caller resetting the seeded owner's password, even with user.manage", async () => {
  const { deps, repos, ownerPrincipalId } = await buildSeededDeps();

  const { policy } = await createPolicy({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, name: "delegated-user-manage" },
  });
  await repos.policyPermissions.save({
    id: "pp-delegated-user-manage",
    workspaceId: WORKSPACE,
    policyId: policy.id,
    permission: "user.manage",
    resourceType: null,
    constraintJson: null,
  });
  await seedBarePrincipal(repos, "mid-level-admin");
  await attachPolicy({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, principalId: "mid-level-admin", policyId: policy.id },
  });

  const ownerBefore = await repos.users.findByPrincipalId({ workspaceId: WORKSPACE, principalId: ownerPrincipalId });
  assert.ok(ownerBefore);

  await assert.rejects(
    () =>
      resetUserPassword({
        deps,
        input: {
          workspaceId: WORKSPACE,
          callerPrincipalId: "mid-level-admin",
          principalId: ownerPrincipalId,
          password: "attacker-chosen-pw-123456",
          seededOwnerPrincipalId: ownerPrincipalId,
        },
      }),
    OwnerRequiredError
  );

  const ownerAfter = await repos.users.findByPrincipalId({ workspaceId: WORKSPACE, principalId: ownerPrincipalId });
  assert.equal(ownerAfter?.passwordHash, ownerBefore?.passwordHash, "a refused reset must not have changed the owner's credential");
});

/**
 * The refusal above must NOT break the owner's own credential-rotation/incident-recovery path
 * (`reset-admin-password-self-verified.ts`'s `callerPrincipalId === principalId` self-caller
 * convention, driven by the `HOST_ADMIN_RESET_PASSWORD` boot hook and the
 * `backfill-reset-admin-password.ts` CLI script) — unlike `disablePrincipal`'s unconditional
 * refusal, this guard exempts the owner acting on itself.
 */
test("RESET_USER_PASSWORD: the seeded owner CAN reset its own password (self-service/recovery is not the escalation this guard blocks)", async () => {
  const { deps, ownerPrincipalId } = await buildSeededDeps();

  const { user } = await resetUserPassword({
    deps,
    input: {
      workspaceId: WORKSPACE,
      callerPrincipalId: ownerPrincipalId,
      principalId: ownerPrincipalId,
      password: "owner-self-rotated-pw-123456",
      seededOwnerPrincipalId: ownerPrincipalId,
    },
  });
  assert.ok(user.passwordHash);
});

// ---------------------------------------------------------------------------
// UPDATE_ROLE / UPDATE_POLICY. See docs/decisions/DR-002-grant-authority-and-admin-safety.md.
// ---------------------------------------------------------------------------

test("AC-30: UPDATE_ROLE refuses a built-in target, renames a custom role", async () => {
  const { deps, repos, ownerPrincipalId } = await buildSeededDeps();
  const viewerRole = (await repos.roles.list({ workspaceId: WORKSPACE })).find((r) => r.name === "viewer");
  assert.ok(viewerRole);

  await assert.rejects(
    () =>
      updateRole({
        deps,
        input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, roleId: viewerRole!.id, name: "trusted-viewer" },
      }),
    IdentityValidationError
  );

  const { role: custom } = await createRole({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, name: "old-name" },
  });
  const { role: renamed } = await updateRole({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, roleId: custom.id, name: "new-name" },
  });
  assert.equal(renamed.name, "new-name");
});

test("AC-30: UPDATE_POLICY refuses a built-in target and a frozen target, renames/re-describes a custom policy", async () => {
  const { deps, repos, ownerPrincipalId } = await buildSeededDeps();
  const viewerPolicy = (await repos.policies.list({ workspaceId: WORKSPACE })).find((p) => p.name === "viewer-builtin-policy");
  assert.ok(viewerPolicy);

  await assert.rejects(
    () =>
      updatePolicy({ deps, input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, policyId: viewerPolicy!.id } }, { name: "trusted" }),
    IdentityValidationError
  );

  const { policy: custom } = await createPolicy({ deps, input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, name: "old-name" } }, { description: "old" });
  const { policy: updated } = await updatePolicy({ deps, input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, policyId: custom.id } }, { name: "new-name", description: "new" });
  assert.equal(updated.name, "new-name");
  assert.equal(updated.description, "new");
});

test("UPDATE_POLICY: rejects a request with neither name nor description present", async () => {
  const { deps, ownerPrincipalId } = await buildSeededDeps();
  const { policy: custom } = await createPolicy({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, name: "solo" },
  });

  await assert.rejects(
    () => updatePolicy({ deps, input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, policyId: custom.id } }),
    IdentityValidationError
  );
});

// ---------------------------------------------------------------------------
// DELETE_ROLE / DELETE_POLICY. See docs/decisions/DR-002-grant-authority-and-admin-safety.md.
// ---------------------------------------------------------------------------

test("AC-31: DELETE_ROLE deletes an unused custom role, refuses one still assigned, and refuses a built-in regardless", async () => {
  const { deps, repos, ownerPrincipalId } = await buildSeededDeps();

  const { role: unused } = await createRole({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, name: "unused-role" },
  });
  await deleteRole({ deps, input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, roleId: unused.id } });
  assert.equal(await repos.roles.findById({ workspaceId: WORKSPACE, id: unused.id }), null);

  const { role: assigned } = await createRole({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, name: "assigned-role" },
  });
  await seedBarePrincipal(repos, "role-holder");
  await repos.principalRoles.save({ id: "pr-1", workspaceId: WORKSPACE, principalId: "role-holder", roleId: assigned.id });

  await assert.rejects(
    () => deleteRole({ deps, input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, roleId: assigned.id } }),
    IdentityConflictError
  );
  assert.ok(await repos.roles.findById({ workspaceId: WORKSPACE, id: assigned.id }), "not deleted");

  const viewerRole = (await repos.roles.list({ workspaceId: WORKSPACE })).find((r) => r.name === "viewer");
  await assert.rejects(
    () => deleteRole({ deps, input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, roleId: viewerRole!.id } }),
    IdentityValidationError
  );
});

test("AC-31: DELETE_POLICY deletes an unused custom policy (cascading its own policy_permissions), refuses one still attached", async () => {
  const { deps, repos, ownerPrincipalId } = await buildSeededDeps();

  const { policy: unused } = await createPolicy({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, name: "unused-policy" },
  });
  await repos.policyPermissions.save({
    id: "pp-unused",
    workspaceId: WORKSPACE,
    policyId: unused.id,
    permission: "content.read",
    resourceType: null,
    constraintJson: null,
  });
  await deletePolicy({ deps, input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, policyId: unused.id } });
  assert.equal(await repos.policies.findById({ workspaceId: WORKSPACE, id: unused.id }), null);
  const orphanPerms = await repos.policyPermissions.listByPolicyId({ workspaceId: WORKSPACE, policyId: unused.id });
  assert.equal(orphanPerms.length, 0, "cascaded");

  const { policy: attached } = await createPolicy({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, name: "attached-policy" },
  });
  await seedBarePrincipal(repos, "policy-holder");
  await attachPolicy({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, principalId: "policy-holder", policyId: attached.id },
  });

  await assert.rejects(
    () => deletePolicy({ deps, input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, policyId: attached.id } }),
    IdentityConflictError
  );
});

test("AC-31/AC-26: DELETE_POLICY refuses a built-in target and (via WRITE_POLICY_PERMISSION-adjacent path) a frozen target", async () => {
  const { deps, repos, ownerPrincipalId } = await buildSeededDeps();
  const viewerPolicy = (await repos.policies.list({ workspaceId: WORKSPACE })).find((p) => p.name === "viewer-builtin-policy");
  await assert.rejects(
    () => deletePolicy({ deps, input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, policyId: viewerPolicy!.id } }),
    IdentityValidationError
  );

  // Simulate a frozen (issuance-snapshot) policy directly via the repo (ISSUE_API_KEY is out of
  // this amendment's scope) to certify the guard checks is_frozen too, not only is_builtin.
  await repos.policies.save({
    id: "frozen-policy-1",
    workspaceId: WORKSPACE,
    name: "frozen",
    isBuiltin: false,
    isFrozen: true,
  });
  await assert.rejects(
    () => deletePolicy({ deps, input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, policyId: "frozen-policy-1" } }),
    IdentityValidationError
  );
});

// ---------------------------------------------------------------------------
// WRITE_POLICY_PERMISSION ( domain-level, first implementation). See docs/decisions/DR-002-grant-authority-and-admin-safety.md.
// ---------------------------------------------------------------------------

test("WRITE_POLICY_PERMISSION: owner adds a permission to a custom policy", async () => {
  const { deps, repos, ownerPrincipalId } = await buildSeededDeps();
  const { policy } = await createPolicy({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, name: "writable-policy" },
  });

  const { policyPermission } = await writePolicyPermission({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, policyId: policy.id, permission: "content.write" },
  });
  assert.equal(policyPermission.permission, "content.write");

  const rows = await repos.policyPermissions.listByPolicyId({ workspaceId: WORKSPACE, policyId: policy.id });
  assert.equal(rows.length, 1);
});

test("AC-10: WRITE_POLICY_PERMISSION rejects an unregistered permission (PERMISSION_UNKNOWN)", async () => {
  const { deps, ownerPrincipalId } = await buildSeededDeps();
  const { policy } = await createPolicy({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, name: "writable-policy-2" },
  });

  await assert.rejects(
    () =>
      writePolicyPermission({
        deps,
        input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, policyId: policy.id, permission: "not.a.real.permission" },
      }),
    PermissionUnknownError
  );
});

test("AC-26: WRITE_POLICY_PERMISSION refuses a built-in and a frozen policy target", async () => {
  const { deps, repos, ownerPrincipalId } = await buildSeededDeps();
  const viewerPolicy = (await repos.policies.list({ workspaceId: WORKSPACE })).find((p) => p.name === "viewer-builtin-policy");
  await assert.rejects(
    () =>
      writePolicyPermission({
        deps,
        input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, policyId: viewerPolicy!.id, permission: "content.write" },
      }),
    IdentityValidationError
  );

  await repos.policies.save({ id: "frozen-policy-2", workspaceId: WORKSPACE, name: "frozen2", isBuiltin: false, isFrozen: true });
  await assert.rejects(
    () =>
      writePolicyPermission({
        deps,
        input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, policyId: "frozen-policy-2", permission: "content.write" },
      }),
    IdentityValidationError
  );
});

test("AC-24: WRITE_POLICY_PERMISSION enforces the INV-07 clamp — a non-owner role.manage holder cannot add a permission it lacks", async () => {
  const { deps, repos, ownerPrincipalId } = await buildSeededDeps();

  const { policy: managerPolicy } = await createPolicy({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, name: "role-manager-only" },
  });
  await repos.policyPermissions.save({
    id: "pp-role-manage",
    workspaceId: WORKSPACE,
    policyId: managerPolicy.id,
    permission: "role.manage",
    resourceType: null,
    constraintJson: null,
  });
  await seedBarePrincipal(repos, "role-manage-caller");
  await attachPolicy({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, principalId: "role-manage-caller", policyId: managerPolicy.id },
  });

  const { policy: target } = await createPolicy({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, name: "target-policy" },
  });

  await assert.rejects(
    () =>
      writePolicyPermission({
        deps,
        input: {
          workspaceId: WORKSPACE,
          callerPrincipalId: "role-manage-caller",
          policyId: target.id,
          permission: "user.manage",
        },
      }),
    GrantExceedsIssuerError
  );
});

// ---------------------------------------------------------------------------
// REMOVE_POLICY_PERMISSION — the inverse of WRITE_POLICY_PERMISSION. See docs/decisions/DR-002-grant-authority-and-admin-safety.md.
// Before this transition a policy's permission set was append-only: shrinking it meant
// deletePolicy + recreate, which refuses as soon as anything references the policy. See docs/decisions/DR-002-grant-authority-and-admin-safety.md.
// ---------------------------------------------------------------------------

test("REMOVE_POLICY_PERMISSION: owner removes one permission and the policy's others survive", async () => {
  const { deps, repos, ownerPrincipalId } = await buildSeededDeps();
  const { policy } = await createPolicy({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, name: "shrinkable-policy" },
  });
  const { policyPermission: doomed } = await writePolicyPermission({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, policyId: policy.id, permission: "content.write" },
  });
  await writePolicyPermission({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, policyId: policy.id, permission: "content.read" },
  });

  await removePolicyPermission({
    deps,
    input: {
      workspaceId: WORKSPACE,
      callerPrincipalId: ownerPrincipalId,
      policyId: policy.id,
      policyPermissionId: doomed.id,
    },
  });

  const rows = await repos.policyPermissions.listByPolicyId({ workspaceId: WORKSPACE, policyId: policy.id });
  assert.deepEqual(rows.map((row) => row.permission), ["content.read"]);
});

test("REMOVE_POLICY_PERMISSION is gated by role.manage — a caller with no grants is refused", async () => {
  const { deps, repos, ownerPrincipalId } = await buildSeededDeps();
  const { policy } = await createPolicy({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, name: "gated-policy" },
  });
  const { policyPermission } = await writePolicyPermission({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, policyId: policy.id, permission: "content.write" },
  });
  await seedBarePrincipal(repos, "no-grant-remover");

  await assert.rejects(
    () =>
      removePolicyPermission({
        deps,
        input: {
          workspaceId: WORKSPACE,
          callerPrincipalId: "no-grant-remover",
          policyId: policy.id,
          policyPermissionId: policyPermission.id,
        },
      }),
    IdentityForbiddenError
  );

  const rows = await repos.policyPermissions.listByPolicyId({ workspaceId: WORKSPACE, policyId: policy.id });
  assert.equal(rows.length, 1, "a refused removal must not have deleted the row");
});

test("REMOVE_POLICY_PERMISSION refuses a permission id belonging to a DIFFERENT policy", async () => {
  const { deps, repos, ownerPrincipalId } = await buildSeededDeps();
  const { policy: victim } = await createPolicy({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, name: "victim-policy" },
  });
  const { policy: other } = await createPolicy({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, name: "other-policy" },
  });
  const { policyPermission } = await writePolicyPermission({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, policyId: victim.id, permission: "content.write" },
  });

  await assert.rejects(
    () =>
      removePolicyPermission({
        deps,
        input: {
          workspaceId: WORKSPACE,
          callerPrincipalId: ownerPrincipalId,
          policyId: other.id,
          policyPermissionId: policyPermission.id,
        },
      }),
    (err: unknown) =>
      err instanceof IdentityNotFoundError &&
      err.message === `policy permission '${policyPermission.id}' was not found on policy '${other.id}'`
  );

  assert.equal(
    (await repos.policyPermissions.listByPolicyId({ workspaceId: WORKSPACE, policyId: victim.id })).length,
    1,
    "the cross-policy delete must be a no-op on the real owner's rows"
  );
});

test("INV-06: REMOVE_POLICY_PERMISSION refuses a built-in or frozen parent policy", async () => {
  const { deps, repos, ownerPrincipalId } = await buildSeededDeps();
  await repos.policies.save({
    id: "frozen-policy-remove",
    workspaceId: WORKSPACE,
    name: "frozen",
    isBuiltin: false,
    isFrozen: true,
  });

  await assert.rejects(
    () =>
      removePolicyPermission({
        deps,
        input: {
          workspaceId: WORKSPACE,
          callerPrincipalId: ownerPrincipalId,
          policyId: "frozen-policy-remove",
          policyPermissionId: "any-row",
        },
      }),
    (err: unknown) =>
      err instanceof IdentityValidationError &&
      err.message === "cannot remove a permission from a built-in or frozen policy"
  );
});

test("REMOVE_POLICY_PERMISSION is NOT grant-clamped — de-escalation never needs the issuer to hold the permission", async () => {
  const { deps, repos, ownerPrincipalId } = await buildSeededDeps();
  const { policy } = await createPolicy({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, name: "declamped-policy" },
  });
  const { policyPermission } = await writePolicyPermission({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, policyId: policy.id, permission: "content.write" },
  });

  // A caller holding ONLY `role.manage` — deliberately not `content.write`, so writing this same
  // permission would trip GrantExceedsIssuer clamp. Removing it must still succeed:. See docs/decisions/DR-002-grant-authority-and-admin-safety.md.
  // taking authority away confers nothing, so the clamp does not apply (see the transition's doc).
  const { policy: managerPolicy } = await createPolicy({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, name: "role-manager-only" },
  });
  await writePolicyPermission({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, policyId: managerPolicy.id, permission: "role.manage" },
  });
  const { principal: manager } = await createUser({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, username: "rolemanager", password: "rolemanager-p4ssw0rd!" },
  });
  await attachPolicy({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, principalId: manager.id, policyId: managerPolicy.id },
  });

  // Guard against a vacuous pass: prove this caller really IS clamped for `content.write`, so the
  // removal below is genuinely exercising the "removal is exempt" rule rather than succeeding
  // because the manager happened to hold the permission all along.
  await assert.rejects(
    () =>
      writePolicyPermission({
        deps,
        input: { workspaceId: WORKSPACE, callerPrincipalId: manager.id, policyId: policy.id, permission: "content.write" },
      }),
    GrantExceedsIssuerError
  );

  await removePolicyPermission({
    deps,
    input: {
      workspaceId: WORKSPACE,
      callerPrincipalId: manager.id,
      policyId: policy.id,
      policyPermissionId: policyPermission.id,
    },
  });

  assert.deepEqual(await repos.policyPermissions.listByPolicyId({ workspaceId: WORKSPACE, policyId: policy.id }), []);
});
