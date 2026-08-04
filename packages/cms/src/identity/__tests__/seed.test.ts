import assert from "node:assert/strict";
import { test } from "vitest";

/** Supplied explicitly because `SeedIdentityInput.ownerPassword` has no library default. */
const SEED_OWNER_PASSWORD = "seed-owner-pw";

import { authorize } from "../authorize.js";
import { Argon2PasswordHasher } from "../hasher.js";
import { migrateDeprecatedPermissionGrants } from "../permission-migrations.js";
// Side-effect import: registers the real BASE_CATALOG + the real integration.manage ->
// admin.integrations.manage migration pair before the T025 test below runs.
import "../permissions";
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
import { seedIdentity, type SeedIdentityDeps } from "../seed.js";
import type { IdentityRepos } from "../ports.js";

/**
 * @file First-boot identity seed (REQ-09, state.spec `SEED_FIRST_BOOT`, AC-01/AC-12).
 *
 * Fast test-only hasher cost params (still real argon2id, not a mock) so the
 * suite stays quick — see `hasher.test.ts` for the default-cost roundtrip.
 */

const WORKSPACE = "workspace-1";
const fixedClock = { nowIso: () => "2026-07-10T00:00:00.000Z" };

function counterIdGen() {
  let n = 0;
  return { newId: () => `id-${++n}` };
}

function buildDeps(): SeedIdentityDeps {
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
  return {
    repos,
    hasher: new Argon2PasswordHasher({ memoryCost: 8, timeCost: 1, parallelism: 1 }),
    clock: fixedClock,
    idGen: counterIdGen(),
  };
}

test("AC-01/REQ-09: seeds a system principal, a disabled legacy user-local principal, and an owner user", async () => {
  const deps = buildDeps();

  await seedIdentity({ deps, input: { workspaceId: WORKSPACE, ownerPassword: SEED_OWNER_PASSWORD } });

  const principals = await deps.repos.principals.list({ workspaceId: WORKSPACE });
  const system = principals.find((p) => p.kind === "system" && p.id !== "user-local");
  assert.ok(system, "a system principal was seeded");
  assert.equal(system?.status, "active");

  const legacy = await deps.repos.principals.findById({ workspaceId: WORKSPACE, id: "user-local" });
  assert.ok(legacy, "the legacy user-local principal exists (EC-09)");
  assert.equal(legacy?.status, "disabled");
  assert.ok(legacy?.disabledAt);

  const owner = await deps.repos.users.findByUsername({ workspaceId: WORKSPACE, username: "admin" });
  assert.ok(owner, "the owner user was seeded with the default username");
  assert.ok(owner?.passwordHash.startsWith("$argon2id$"), "the password is stored as an argon2id hash");
});

test("REQ-09/AC-12: four built-in roles map 1:1 to built-in policies with the documented permission sets", async () => {
  const deps = buildDeps();
  await seedIdentity({ deps, input: { workspaceId: WORKSPACE, ownerPassword: SEED_OWNER_PASSWORD } });

  const roles = await deps.repos.roles.list({ workspaceId: WORKSPACE });
  assert.equal(roles.length, 4);
  assert.ok(roles.every((role) => role.isBuiltin));

  const policies = await deps.repos.policies.list({ workspaceId: WORKSPACE });
  assert.equal(policies.length, 4);
  assert.ok(policies.every((policy) => policy.isBuiltin && !policy.isFrozen));

  async function permissionsFor(roleName: string): Promise<string[]> {
    const role = roles.find((r) => r.name === roleName);
    assert.ok(role, `${roleName} role exists`);
    const rolePolicyLinks = await deps.repos.rolePolicies.listByRoleId({
      workspaceId: WORKSPACE,
      roleId: role!.id,
    });
    assert.equal(rolePolicyLinks.length, 1, `${roleName} maps to exactly one policy`);
    const perms = await deps.repos.policyPermissions.listByPolicyId({
      workspaceId: WORKSPACE,
      policyId: rolePolicyLinks[0]!.policyId,
    });
    return perms.map((p) => p.permission).sort();
  }

  assert.deepEqual(await permissionsFor("owner"), ["*"]);

  const admin = await permissionsFor("admin");
  assert.ok(admin.includes("apikey.manage"));
  assert.ok(!admin.includes("user.manage"), "admin is not owner-tier (REQ-09)");
  assert.ok(!admin.includes("role.manage"), "admin is not owner-tier (REQ-09)");

  const editor = await permissionsFor("editor");
  assert.deepEqual(editor, [
    "content.delete",
    "content.publish",
    "content.read",
    "content.write",
    "media.delete",
    "media.read",
    "media.update",
    "media.upload",
    "theme.set",
  ]);
  // AC-12: owner ⊇ admin ⊇ editor on the content axis.
  assert.ok(editor.every((p) => admin.includes(p)));

  const viewer = await permissionsFor("viewer");
  assert.deepEqual(viewer, ["changeset.read", "content.read", "plugin.read"]);
  assert.ok(viewer.every((p) => p.endsWith(".read")), "viewer holds only *.read permissions (AC-12)");
});

test("seeding is idempotent: re-seeding an already-seeded workspace is a no-op", async () => {
  const deps = buildDeps();
  const first = await seedIdentity({ deps, input: { workspaceId: WORKSPACE, ownerPassword: SEED_OWNER_PASSWORD } });
  const second = await seedIdentity({ deps, input: { workspaceId: WORKSPACE, ownerPassword: SEED_OWNER_PASSWORD } });

  assert.equal(second.ownerPrincipalId, first.ownerPrincipalId);
  const principals = await deps.repos.principals.list({ workspaceId: WORKSPACE });
  // system + legacy user-local + owner = 3, unchanged by the second call.
  assert.equal(principals.length, 3);
  const roles = await deps.repos.roles.list({ workspaceId: WORKSPACE });
  assert.equal(roles.length, 4);
});

test("integration: the seeded owner is authorized for a permission a feature registers after seed (AC-16 owner-wildcard growth)", async () => {
  const deps = buildDeps();
  const { ownerPrincipalId } = await seedIdentity({ deps, input: { workspaceId: WORKSPACE, ownerPassword: SEED_OWNER_PASSWORD } });

  const result = await authorize({
    deps: {
      principals: deps.repos.principals,
      principalRoles: deps.repos.principalRoles,
      rolePolicies: deps.repos.rolePolicies,
      principalPolicies: deps.repos.principalPolicies,
      policyPermissions: deps.repos.policyPermissions,
    },
    principalId: ownerPrincipalId,
    // A permission that does not exist in the base catalog at seed time —
    // the owner's dynamically-evaluated wildcard still covers it (REQ-04/REQ-09).
    permission: "brand-new-feature.write",
    context: { workspaceId: WORKSPACE },
  });

  assert.deepEqual(result, { allowed: true, reason: "owner_wildcard" });
});

test("T025: a policy holding the deprecated integration.manage also gains admin.integrations.manage after migration, idempotently", async () => {
  const deps = buildDeps();
  await seedIdentity({ deps, input: { workspaceId: WORKSPACE, ownerPassword: SEED_OWNER_PASSWORD } });

  // Simulates a pre-existing policy from before the Phase 3 rename — fresh seeds no longer grant
  // the deprecated flat string directly (see seed.ts's BUILTIN_ADMIN_PERMISSIONS comment).
  const legacyPolicyId = "policy-legacy-integrations";
  await deps.repos.policies.save({
    id: legacyPolicyId,
    workspaceId: WORKSPACE,
    name: "legacy-integrations-policy",
    isBuiltin: false,
    isFrozen: false,
  });
  await deps.repos.policyPermissions.save({
    id: "grant-legacy-integration-manage",
    workspaceId: WORKSPACE,
    policyId: legacyPolicyId,
    permission: "integration.manage",
  });

  const first = await migrateDeprecatedPermissionGrants({
    policyPermissions: deps.repos.policyPermissions,
    policies: deps.repos.policies,
    idGen: deps.idGen,
    workspaceId: WORKSPACE,
  });
  assert.ok(first.migratedGrantCount >= 1);

  const grantsAfter = await deps.repos.policyPermissions.listByPolicyId({
    workspaceId: WORKSPACE,
    policyId: legacyPolicyId,
  });
  const permissionsAfter = grantsAfter.map((g) => g.permission);
  assert.ok(permissionsAfter.includes("integration.manage"), "the old grant is never removed");
  assert.ok(permissionsAfter.includes("admin.integrations.manage"), "the new string is granted");

  // Idempotent rerun: nothing left to migrate for this policy/pair.
  const second = await migrateDeprecatedPermissionGrants({
    policyPermissions: deps.repos.policyPermissions,
    policies: deps.repos.policies,
    idGen: deps.idGen,
    workspaceId: WORKSPACE,
  });
  const grantsAfterSecond = await deps.repos.policyPermissions.listByPolicyId({
    workspaceId: WORKSPACE,
    policyId: legacyPolicyId,
  });
  assert.equal(
    grantsAfterSecond.filter((g) => g.permission === "admin.integrations.manage").length,
    1,
    "rerunning must not duplicate the grant"
  );
  assert.equal(second.migratedGrantCount, 0);
});

test("internal audit F2: a policy holding settings.user.write also gains settings.user.read after migration, keeping the write grant, idempotently", async () => {
  const deps = buildDeps();
  await seedIdentity({ deps, input: { workspaceId: WORKSPACE, ownerPassword: SEED_OWNER_PASSWORD } });

  // Simulates an ALREADY-seeded installation: seedIdentity early-returns for these, so the
  // BUILTIN_ADMIN_PERMISSIONS addition cannot reach them — the fan-out is the only path.
  const preExistingPolicyId = "policy-pre-existing-settings-user-write";
  await deps.repos.policies.save({
    id: preExistingPolicyId,
    workspaceId: WORKSPACE,
    name: "pre-existing-settings-policy",
    isBuiltin: false,
    isFrozen: false,
  });
  await deps.repos.policyPermissions.save({
    id: "grant-pre-existing-settings-user-write",
    workspaceId: WORKSPACE,
    policyId: preExistingPolicyId,
    permission: "settings.user.write",
  });

  const first = await migrateDeprecatedPermissionGrants({
    policyPermissions: deps.repos.policyPermissions,
    policies: deps.repos.policies,
    idGen: deps.idGen,
    workspaceId: WORKSPACE,
  });
  assert.ok(first.migratedGrantCount >= 1);

  const permissionsAfter = (
    await deps.repos.policyPermissions.listByPolicyId({ workspaceId: WORKSPACE, policyId: preExistingPolicyId })
  ).map((g) => g.permission);
  assert.ok(
    permissionsAfter.includes("settings.user.write"),
    "settings.user.write stays live — unlike this mechanism's other pairs, it is NOT deprecated"
  );
  assert.ok(permissionsAfter.includes("settings.user.read"), "the new read grant is backfilled");

  const second = await migrateDeprecatedPermissionGrants({
    policyPermissions: deps.repos.policyPermissions,
    policies: deps.repos.policies,
    idGen: deps.idGen,
    workspaceId: WORKSPACE,
  });
  assert.equal(
    (await deps.repos.policyPermissions.listByPolicyId({ workspaceId: WORKSPACE, policyId: preExistingPolicyId }))
      .filter((g) => g.permission === "settings.user.read").length,
    1,
    "rerunning must not duplicate the grant"
  );
  assert.equal(second.migratedGrantCount, 0);
});

test("internal audit F2: a freshly-seeded built-in admin role holds settings.user.read directly, without depending on the fan-out", async () => {
  const deps = buildDeps();
  await seedIdentity({ deps, input: { workspaceId: WORKSPACE, ownerPassword: SEED_OWNER_PASSWORD } });

  const roles = await deps.repos.roles.list({ workspaceId: WORKSPACE });
  const adminRole = roles.find((r) => r.name === "admin");
  assert.ok(adminRole, "admin role exists");
  const links = await deps.repos.rolePolicies.listByRoleId({ workspaceId: WORKSPACE, roleId: adminRole!.id });
  const adminPermissions = (
    await deps.repos.policyPermissions.listByPolicyId({ workspaceId: WORKSPACE, policyId: links[0]!.policyId })
  ).map((p) => p.permission);

  assert.ok(adminPermissions.includes("settings.user.read"));
  assert.ok(adminPermissions.includes("settings.user.write"));
});
