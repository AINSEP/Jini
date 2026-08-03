import assert from "node:assert/strict";
import { test } from "vitest";

/** Supplied explicitly because `SeedIdentityInput.ownerPassword` has no library default. */
const SEED_OWNER_PASSWORD = "seed-owner-pw";

import { assignRole, attachPolicy, createPolicy, createRole, createUser } from "../grant-service.js";
import { Argon2PasswordHasher } from "../hasher.js";
import type { IdentityRepos } from "../ports.js";
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
  GrantExceedsIssuerError,
  IdentityConflictError,
  IdentityForbiddenError,
  IdentityNotFoundError,
  IdentityValidationError,
  type PrincipalRecord,
} from "../types.js";
import type { AuthServiceDeps } from "../auth-service.js";

/**
 * @file Human grant-writing transitions (state.spec.md §3, AC-19/AC-22/AC-24/AC-25).
 *
 * Fast test-only hasher cost params (still real argon2id, not a mock) so the
 * suite stays quick — see `hasher.test.ts` for the default-cost roundtrip.
 */

const WORKSPACE = "workspace-1";
const HASHER = new Argon2PasswordHasher({ memoryCost: 8, timeCost: 1, parallelism: 1 });
const fixedClock = { nowIso: () => "2026-07-10T00:00:00.000Z" };

function counterIdGen() {
  let n = 0;
  return { newId: () => `id-${++n}` };
}

/** Seeds a fresh workspace (owner + 4 built-in roles/policies) and returns ready-to-use deps. */
async function buildSeededDeps(): Promise<{
  deps: AuthServiceDeps;
  repos: IdentityRepos;
  ownerPrincipalId: string;
  systemPrincipalId: string;
}> {
  const repos: IdentityRepos = {
    principals: new InMemoryPrincipalRepo(),
    users: new InMemoryUserRepo(),
    sessions: new InMemorySessionRepo(),
    roles: new InMemoryRoleRepo(),
    policies: new InMemoryPolicyRepo(),
    policyPermissions: new InMemoryPolicyPermissionRepo(),
    rolePolicies: new InMemoryRolePolicyRepo(),
    principalRoles: new InMemoryPrincipalRoleRepo(),
    principalPolicies: new InMemoryPrincipalPolicyRepo(),
  };
  const deps: AuthServiceDeps = { repos, hasher: HASHER, clock: fixedClock, idGen: counterIdGen() };
  const { ownerPrincipalId, systemPrincipalId } = await seedIdentity({
    deps,
    input: { workspaceId: WORKSPACE, ownerPassword: SEED_OWNER_PASSWORD },
  });
  return { deps, repos, ownerPrincipalId, systemPrincipalId };
}

/** Mint a second human principal (no grants yet) directly via the repo, bypassing CREATE_USER's gate. */
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
// CREATE_USER
// ---------------------------------------------------------------------------

test("CREATE_USER: owner (holds user.manage via *) creates a brand-new user principal", async () => {
  const { deps, repos, ownerPrincipalId } = await buildSeededDeps();

  const { principal, user } = await createUser({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, username: "Ed", password: "pw-valid-1234" },
  });

  assert.equal(principal.kind, "user");
  assert.equal(principal.status, "active");
  assert.equal(user.principalId, principal.id);
  assert.equal(user.username, "ed"); // normalized

  const stored = await repos.users.findByUsername({ workspaceId: WORKSPACE, username: "ed" });
  assert.equal(stored?.principalId, principal.id);
});

test("MF-1: CREATE_USER always mints a NEW principal — never attaches a credential to a pre-existing one", async () => {
  const { deps, repos, ownerPrincipalId } = await buildSeededDeps();

  const { principal } = await createUser({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, username: "ed", password: "pw-valid-1234" },
  });

  // The new principal is a fresh row distinct from the caller/owner — CREATE_USER's input type
  // has no principalId field at all, so there is no code path to request attachment to an
  // existing principal; this asserts the observable consequence.
  assert.notEqual(principal.id, ownerPrincipalId);
  const allPrincipals = await repos.principals.list({ workspaceId: WORKSPACE });
  assert.equal(allPrincipals.filter((p) => p.id === principal.id).length, 1);

  // The owner's own user row is untouched (no credential swap on the pre-existing principal).
  const ownerUser = await repos.users.findByPrincipalId({ workspaceId: WORKSPACE, principalId: ownerPrincipalId });
  assert.ok(ownerUser);
  assert.notEqual(ownerUser?.principalId, principal.id);
});

test("AC-22: a caller holding only member.manage (not user.manage) can still CREATE_USER — admin onboarding", async () => {
  const { deps, repos, ownerPrincipalId } = await buildSeededDeps();

  // Construct a caller that holds member.manage only, via a custom policy (ATTACH_POLICY, owner-issued).
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
  await seedBarePrincipal(repos, "caller-member-manage");
  await attachPolicy({
    deps,
    input: {
      workspaceId: WORKSPACE,
      callerPrincipalId: ownerPrincipalId,
      principalId: "caller-member-manage",
      policyId: policy.id,
    },
  });

  const { principal } = await createUser({
    deps,
    input: {
      workspaceId: WORKSPACE,
      callerPrincipalId: "caller-member-manage",
      username: "onboarded",
      password: "pw-valid-1234",
    },
  });
  assert.equal(principal.kind, "user");
});

test("CREATE_USER: a caller holding neither user.manage nor member.manage is rejected FORBIDDEN, no row written", async () => {
  const { deps, repos } = await buildSeededDeps();
  await seedBarePrincipal(repos, "no-grants");

  await assert.rejects(
    () =>
      createUser({
        deps,
        input: { workspaceId: WORKSPACE, callerPrincipalId: "no-grants", username: "ed", password: "pw-valid-1234" },
      }),
    IdentityForbiddenError
  );

  assert.equal(await repos.users.findByUsername({ workspaceId: WORKSPACE, username: "ed" }), null);
});

test("AC-19: duplicate username within a workspace is rejected RESOURCE_CONFLICT, no row written", async () => {
  const { deps, repos, ownerPrincipalId } = await buildSeededDeps();
  await createUser({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, username: "ed", password: "pw-valid-1234" },
  });

  await assert.rejects(
    () =>
      createUser({
        deps,
        // Case/NFC-insensitive duplicate (behavior.spec §5.1).
        input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, username: "ED", password: "pw2-valid-1234" },
      }),
    IdentityConflictError
  );

  const allUsers = await repos.users.list({ workspaceId: WORKSPACE });
  assert.equal(allUsers.filter((u) => u.username === "ed").length, 1);
});

test("CREATE_USER: a blank username is rejected VALIDATION_ERROR, no row written", async () => {
  const { deps, repos, ownerPrincipalId } = await buildSeededDeps();

  await assert.rejects(
    () =>
      createUser({
        deps,
        input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, username: "   ", password: "pw-valid-1234" },
      }),
    IdentityValidationError
  );

  const before = await repos.principals.list({ workspaceId: WORKSPACE });
  const after = await repos.principals.list({ workspaceId: WORKSPACE });
  assert.deepEqual(before, after);
});

// ---------------------------------------------------------------------------
// CREATE_ROLE / CREATE_POLICY
// ---------------------------------------------------------------------------

test("CREATE_ROLE/CREATE_POLICY: role.manage holder creates non-builtin rows; a caller without role.manage is rejected", async () => {
  const { deps, repos, ownerPrincipalId } = await buildSeededDeps();

  const { role } = await createRole({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, name: "custom-role" },
  });
  assert.equal(role.isBuiltin, false);

  const { policy } = await createPolicy({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, name: "custom-policy", description: "d" },
  });
  assert.equal(policy.isBuiltin, false);
  assert.equal(policy.isFrozen, false);

  await seedBarePrincipal(repos, "no-role-manage");
  await assert.rejects(
    () =>
      createRole({
        deps,
        input: { workspaceId: WORKSPACE, callerPrincipalId: "no-role-manage", name: "x" },
      }),
    IdentityForbiddenError
  );
  await assert.rejects(
    () =>
      createPolicy({
        deps,
        input: { workspaceId: WORKSPACE, callerPrincipalId: "no-role-manage", name: "x" },
      }),
    IdentityForbiddenError
  );
});

// ---------------------------------------------------------------------------
// ASSIGN_ROLE / ATTACH_POLICY — human-target-only rule (AC-25b)
// ---------------------------------------------------------------------------

test("AC-25b: ASSIGN_ROLE/ATTACH_POLICY targeting a non-human (system) principal is rejected VALIDATION_ERROR", async () => {
  const { deps, repos, ownerPrincipalId, systemPrincipalId } = await buildSeededDeps();
  const editorRole = await repos.roles.findByName({ workspaceId: WORKSPACE, name: "editor" });
  assert.ok(editorRole);
  const editorPolicy = await repos.policies.findByName({ workspaceId: WORKSPACE, name: "editor-builtin-policy" });
  assert.ok(editorPolicy);

  await assert.rejects(
    () =>
      assignRole({
        deps,
        input: {
          workspaceId: WORKSPACE,
          callerPrincipalId: ownerPrincipalId,
          principalId: systemPrincipalId,
          roleId: editorRole!.id,
        },
      }),
    IdentityValidationError
  );
  await assert.rejects(
    () =>
      attachPolicy({
        deps,
        input: {
          workspaceId: WORKSPACE,
          callerPrincipalId: ownerPrincipalId,
          principalId: systemPrincipalId,
          policyId: editorPolicy!.id,
        },
      }),
    IdentityValidationError
  );

  assert.deepEqual(
    await repos.principalRoles.listByPrincipalId({ workspaceId: WORKSPACE, principalId: systemPrincipalId }),
    []
  );
  assert.deepEqual(
    await repos.principalPolicies.listByPrincipalId({ workspaceId: WORKSPACE, principalId: systemPrincipalId }),
    []
  );
});

test("ASSIGN_ROLE/ATTACH_POLICY targeting an api_key-kind principal is rejected VALIDATION_ERROR (not a 403 clamp failure)", async () => {
  const { deps, repos, ownerPrincipalId } = await buildSeededDeps();
  await seedBarePrincipal(repos, "machine-1", "api_key");
  const ownerRole = await repos.roles.findByName({ workspaceId: WORKSPACE, name: "owner" });
  assert.ok(ownerRole);

  await assert.rejects(
    () =>
      assignRole({
        deps,
        input: {
          workspaceId: WORKSPACE,
          callerPrincipalId: ownerPrincipalId,
          principalId: "machine-1",
          roleId: ownerRole!.id,
        },
      }),
    IdentityValidationError
  );
});

// ---------------------------------------------------------------------------
// ASSIGN_ROLE / ATTACH_POLICY — caller-permission gate + INV-07 clamp (AC-24)
// ---------------------------------------------------------------------------

test("ASSIGN_ROLE/ATTACH_POLICY: a caller without role.manage is rejected FORBIDDEN before the clamp runs", async () => {
  const { deps, repos, ownerPrincipalId } = await buildSeededDeps();
  await seedBarePrincipal(repos, "target-1");
  await seedBarePrincipal(repos, "no-role-manage");
  const viewerRole = await repos.roles.findByName({ workspaceId: WORKSPACE, name: "viewer" });
  assert.ok(viewerRole);

  await assert.rejects(
    () =>
      assignRole({
        deps,
        input: {
          workspaceId: WORKSPACE,
          callerPrincipalId: "no-role-manage",
          principalId: "target-1",
          roleId: viewerRole!.id,
        },
      }),
    IdentityForbiddenError
  );
  void ownerPrincipalId;
});

test("AC-24: a non-owner role.manage holder cannot ASSIGN_ROLE the built-in owner role — GRANT_EXCEEDS_ISSUER, no row written", async () => {
  const { deps, repos, ownerPrincipalId } = await buildSeededDeps();

  // Construct a caller holding role.manage only (not owner *) — an owner attaching a custom
  // policy carrying only role.manage, exactly the AC-24 scenario.
  const { policy: roleManageOnlyPolicy } = await createPolicy({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, name: "role-manage-only" },
  });
  await repos.policyPermissions.save({
    id: "pp-role-manage",
    workspaceId: WORKSPACE,
    policyId: roleManageOnlyPolicy.id,
    permission: "role.manage",
    resourceType: null,
    constraintJson: null,
  });
  await seedBarePrincipal(repos, "limited-admin");
  await attachPolicy({
    deps,
    input: {
      workspaceId: WORKSPACE,
      callerPrincipalId: ownerPrincipalId,
      principalId: "limited-admin",
      policyId: roleManageOnlyPolicy.id,
    },
  });

  await seedBarePrincipal(repos, "target-user");
  const ownerRole = await repos.roles.findByName({ workspaceId: WORKSPACE, name: "owner" });
  assert.ok(ownerRole);
  const ownerPolicy = await repos.policies.findByName({ workspaceId: WORKSPACE, name: "owner-builtin-policy" });
  assert.ok(ownerPolicy);

  await assert.rejects(
    () =>
      assignRole({
        deps,
        input: {
          workspaceId: WORKSPACE,
          callerPrincipalId: "limited-admin",
          principalId: "target-user",
          roleId: ownerRole!.id,
        },
      }),
    GrantExceedsIssuerError
  );
  await assert.rejects(
    () =>
      attachPolicy({
        deps,
        input: {
          workspaceId: WORKSPACE,
          callerPrincipalId: "limited-admin",
          principalId: "target-user",
          policyId: ownerPolicy!.id,
        },
      }),
    GrantExceedsIssuerError
  );

  assert.deepEqual(
    await repos.principalRoles.listByPrincipalId({ workspaceId: WORKSPACE, principalId: "target-user" }),
    []
  );
  assert.deepEqual(
    await repos.principalPolicies.listByPrincipalId({ workspaceId: WORKSPACE, principalId: "target-user" }),
    []
  );

  // The SAME grants succeed for the owner (effective *) — the clamp is caller-specific, not a
  // blanket rule against the owner role/policy.
  const { assignment } = await assignRole({
    deps,
    input: {
      workspaceId: WORKSPACE,
      callerPrincipalId: ownerPrincipalId,
      principalId: "target-user",
      roleId: ownerRole!.id,
    },
  });
  assert.equal(assignment.roleId, ownerRole!.id);
});

test("AC-24: the clamp also blocks a role.manage-only caller from assigning a built-in role it doesn't fully hold (editor)", async () => {
  const { deps, repos, ownerPrincipalId } = await buildSeededDeps();
  const { policy: roleManageOnlyPolicy } = await createPolicy({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, name: "role-manage-only-2" },
  });
  await repos.policyPermissions.save({
    id: "pp-role-manage-2",
    workspaceId: WORKSPACE,
    policyId: roleManageOnlyPolicy.id,
    permission: "role.manage",
    resourceType: null,
    constraintJson: null,
  });
  await seedBarePrincipal(repos, "limited-admin-2");
  await attachPolicy({
    deps,
    input: {
      workspaceId: WORKSPACE,
      callerPrincipalId: ownerPrincipalId,
      principalId: "limited-admin-2",
      policyId: roleManageOnlyPolicy.id,
    },
  });
  await seedBarePrincipal(repos, "target-user-2");
  const editorRole = await repos.roles.findByName({ workspaceId: WORKSPACE, name: "editor" });
  assert.ok(editorRole);

  // Editor's policy carries content.*/media.write/theme.set — none of which the limited caller holds.
  await assert.rejects(
    () =>
      assignRole({
        deps,
        input: {
          workspaceId: WORKSPACE,
          callerPrincipalId: "limited-admin-2",
          principalId: "target-user-2",
          roleId: editorRole!.id,
        },
      }),
    GrantExceedsIssuerError
  );
});

test("ASSIGN_ROLE: a freshly-created custom role has no policies (role_policies has no v1 writer) — clamp trivially passes for any role.manage holder", async () => {
  const { deps, repos, ownerPrincipalId } = await buildSeededDeps();
  const { role: emptyRole } = await createRole({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, name: "empty-role" },
  });
  const { policy: roleManageOnlyPolicy } = await createPolicy({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, name: "role-manage-only-3" },
  });
  await repos.policyPermissions.save({
    id: "pp-role-manage-3",
    workspaceId: WORKSPACE,
    policyId: roleManageOnlyPolicy.id,
    permission: "role.manage",
    resourceType: null,
    constraintJson: null,
  });
  await seedBarePrincipal(repos, "limited-admin-3");
  await attachPolicy({
    deps,
    input: {
      workspaceId: WORKSPACE,
      callerPrincipalId: ownerPrincipalId,
      principalId: "limited-admin-3",
      policyId: roleManageOnlyPolicy.id,
    },
  });
  await seedBarePrincipal(repos, "target-user-3");

  const { assignment } = await assignRole({
    deps,
    input: {
      workspaceId: WORKSPACE,
      callerPrincipalId: "limited-admin-3",
      principalId: "target-user-3",
      roleId: emptyRole.id,
    },
  });
  assert.equal(assignment.roleId, emptyRole.id);
});

test("ATTACH_POLICY: a caller holding a permission unconstrained can attach a policy carrying exactly that permission", async () => {
  const { deps, repos, ownerPrincipalId } = await buildSeededDeps();
  const { policy: contentWritePolicy } = await createPolicy({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, name: "content-writer" },
  });
  await repos.policyPermissions.save({
    id: "pp-content-write",
    workspaceId: WORKSPACE,
    policyId: contentWritePolicy.id,
    permission: "content.write",
    resourceType: null,
    constraintJson: null,
  });

  // Editor holds content.write unconstrained (built-in), so an editor-role holder can attach it.
  const { policy: editorGrantPolicy } = await createPolicy({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, name: "editor-grant-only" },
  });
  await repos.policyPermissions.save({
    id: "pp-role-manage-4",
    workspaceId: WORKSPACE,
    policyId: editorGrantPolicy.id,
    permission: "role.manage",
    resourceType: null,
    constraintJson: null,
  });
  await repos.policyPermissions.save({
    id: "pp-content-write-4",
    workspaceId: WORKSPACE,
    policyId: editorGrantPolicy.id,
    permission: "content.write",
    resourceType: null,
    constraintJson: null,
  });
  await seedBarePrincipal(repos, "content-admin");
  await attachPolicy({
    deps,
    input: {
      workspaceId: WORKSPACE,
      callerPrincipalId: ownerPrincipalId,
      principalId: "content-admin",
      policyId: editorGrantPolicy.id,
    },
  });

  await seedBarePrincipal(repos, "target-user-4");
  const { attachment } = await attachPolicy({
    deps,
    input: {
      workspaceId: WORKSPACE,
      callerPrincipalId: "content-admin",
      principalId: "target-user-4",
      policyId: contentWritePolicy.id,
    },
  });
  assert.equal(attachment.policyId, contentWritePolicy.id);
});

test("ATTACH_POLICY: a caller holding a permission only resource-scoped (constrained) cannot delegate it unconstrained", async () => {
  const { deps, repos, ownerPrincipalId } = await buildSeededDeps();

  // A caller holding content.write scoped to resourceType='post' only (not unconstrained).
  const { policy: scopedPolicy } = await createPolicy({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, name: "scoped-writer" },
  });
  await repos.policyPermissions.save({
    id: "pp-scoped",
    workspaceId: WORKSPACE,
    policyId: scopedPolicy.id,
    permission: "content.write",
    resourceType: "post",
    constraintJson: null,
  });
  const { policy: roleManageOnlyPolicy } = await createPolicy({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, name: "role-manage-only-5" },
  });
  await repos.policyPermissions.save({
    id: "pp-role-manage-5",
    workspaceId: WORKSPACE,
    policyId: roleManageOnlyPolicy.id,
    permission: "role.manage",
    resourceType: null,
    constraintJson: null,
  });
  await seedBarePrincipal(repos, "scoped-admin");
  await attachPolicy({
    deps,
    input: {
      workspaceId: WORKSPACE,
      callerPrincipalId: ownerPrincipalId,
      principalId: "scoped-admin",
      policyId: roleManageOnlyPolicy.id,
    },
  });
  await attachPolicy({
    deps,
    input: {
      workspaceId: WORKSPACE,
      callerPrincipalId: ownerPrincipalId,
      principalId: "scoped-admin",
      policyId: scopedPolicy.id,
    },
  });

  // Attempting to attach an UNCONSTRAINED content.write policy — the caller only holds a scoped
  // hold, which cannot be widened into an unconstrained grant (INV-07).
  const { policy: unconstrainedPolicy } = await createPolicy({
    deps,
    input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, name: "unconstrained-writer" },
  });
  await repos.policyPermissions.save({
    id: "pp-unconstrained",
    workspaceId: WORKSPACE,
    policyId: unconstrainedPolicy.id,
    permission: "content.write",
    resourceType: null,
    constraintJson: null,
  });
  await seedBarePrincipal(repos, "target-user-5");

  await assert.rejects(
    () =>
      attachPolicy({
        deps,
        input: {
          workspaceId: WORKSPACE,
          callerPrincipalId: "scoped-admin",
          principalId: "target-user-5",
          policyId: unconstrainedPolicy.id,
        },
      }),
    GrantExceedsIssuerError
  );
});

test("ASSIGN_ROLE/ATTACH_POLICY: a nonexistent role/policy id is rejected NOT_FOUND", async () => {
  const { deps, repos, ownerPrincipalId } = await buildSeededDeps();
  await seedBarePrincipal(repos, "target-user-6");

  await assert.rejects(
    () =>
      assignRole({
        deps,
        input: {
          workspaceId: WORKSPACE,
          callerPrincipalId: ownerPrincipalId,
          principalId: "target-user-6",
          roleId: "does-not-exist",
        },
      }),
    IdentityNotFoundError
  );
  await assert.rejects(
    () =>
      attachPolicy({
        deps,
        input: {
          workspaceId: WORKSPACE,
          callerPrincipalId: ownerPrincipalId,
          principalId: "target-user-6",
          policyId: "does-not-exist",
        },
      }),
    IdentityNotFoundError
  );
});
