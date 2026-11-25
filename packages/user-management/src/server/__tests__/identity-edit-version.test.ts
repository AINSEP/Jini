import { assertVersionedWrite, RecordVersionConflictError } from "@jini-ai/core/optimistic-concurrency";
import assert from "node:assert/strict";
import { test } from "vitest";

import type { IdentityRepos } from "../../core/ports.js";
import type { AuthServiceDeps } from "../auth-service.js";
import { updatePolicy, updateRole, updateUser } from "../admin-crud-service.js";
import { Argon2PasswordHasher, loadArgon2Binding } from "../hasher.js";
import { createTransactionalInMemoryIdentityRepos } from "../repo.memory-transactions.js";
import {
  InMemoryPolicyPermissionRepo, InMemoryPolicyRepo, InMemoryPrincipalPolicyRepo, InMemoryPrincipalRepo,
  InMemoryPrincipalRoleRepo, InMemoryRolePolicyRepo, InMemoryRoleRepo, InMemorySessionRepo, InMemoryUserRepo,
} from "../repo.memory.js";
import { seedIdentity } from "../seed.js";
import { NodeSessionTokens } from "../session-tokens.js";

/**
 * @file Identity editors (role, policy, user profile) save against the version they opened.
 * Two people who open the same record at one version cannot both save: the second is refused
 * with the shared version conflict instead of silently overwriting the first.
 */

const WORKSPACE = "workspace-1";
const HASHER = new Argon2PasswordHasher({ loadBinding: loadArgon2Binding }, { memoryCost: 8, timeCost: 1, parallelism: 1 });

async function buildDeps(): Promise<{ deps: AuthServiceDeps; repos: IdentityRepos; ownerPrincipalId: string }> {
  const repos: IdentityRepos = createTransactionalInMemoryIdentityRepos({ repos: {
    principals: new InMemoryPrincipalRepo({}),
    users: new InMemoryUserRepo({ assertVersionedWrite }),
    sessions: new InMemorySessionRepo({}),
    roles: new InMemoryRoleRepo({ assertVersionedWrite }),
    policies: new InMemoryPolicyRepo({ assertVersionedWrite }),
    policyPermissions: new InMemoryPolicyPermissionRepo({}),
    rolePolicies: new InMemoryRolePolicyRepo({}),
    principalRoles: new InMemoryPrincipalRoleRepo({}),
    principalPolicies: new InMemoryPrincipalPolicyRepo({}),
  } });
  let n = 0;
  const deps: AuthServiceDeps = {
    repos, hasher: HASHER, clock: { nowMs: () => Date.parse("2026-07-21T00:00:00.000Z") },
    idGen: { newId: () => `id-${++n}` }, tokens: new NodeSessionTokens({}),
  };
  const { ownerPrincipalId } = await seedIdentity({ deps, input: { workspaceId: WORKSPACE, ownerPassword: "seed-owner-pw", ownerUsername: "admin" } });
  await repos.roles.save({ id: "role-x", workspaceId: WORKSPACE, name: "Editors", isBuiltin: false, version: 1 });
  await repos.policies.save({ id: "policy-x", workspaceId: WORKSPACE, name: "Review", isBuiltin: false, isFrozen: false, version: 1 });
  await repos.principals.save({ id: "user-x", workspaceId: WORKSPACE, kind: "user", displayName: "x", status: "active", createdAt: "2026-01-01T00:00:00.000Z" });
  await repos.users.save({ principalId: "user-x", workspaceId: WORKSPACE, username: "x", passwordHash: "hash-x", version: 1 });
  return { deps, repos, ownerPrincipalId };
}

const isConflict = (err: unknown): boolean => err instanceof RecordVersionConflictError && err.expectedVersion === 1 && err.currentVersion === 2;

test("two identity editors from one version cannot both save", async () => {
  const { deps, repos, ownerPrincipalId } = await buildDeps();
  const base = { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId };

  const role = await updateRole({ deps, input: { ...base, roleId: "role-x", name: "Writers" } }, { expectedVersion: 1 });
  assert.equal(role.role.version, 2);
  await assert.rejects(() => updateRole({ deps, input: { ...base, roleId: "role-x", name: "Authors" } }, { expectedVersion: 1 }), isConflict);
  assert.equal((await repos.roles.findById({ workspaceId: WORKSPACE, id: "role-x" }))?.name, "Writers");

  await updatePolicy({ deps, input: { ...base, policyId: "policy-x" } }, { name: "Approve", expectedVersion: 1 });
  await assert.rejects(() => updatePolicy({ deps, input: { ...base, policyId: "policy-x" } }, { description: "late", expectedVersion: 1 }), isConflict);
  assert.equal((await repos.policies.findById({ workspaceId: WORKSPACE, id: "policy-x" }))?.description, undefined);

  await updateUser({ deps, input: { ...base, principalId: "user-x" } }, { email: "first@example.test", expectedVersion: 1 });
  await assert.rejects(() => updateUser({ deps, input: { ...base, principalId: "user-x" } }, { email: "second@example.test", expectedVersion: 1 }), isConflict);
  const user = await repos.users.findByPrincipalId({ workspaceId: WORKSPACE, principalId: "user-x" });
  assert.equal(user?.email, "first@example.test");
  assert.equal(user?.passwordHash, "hash-x");
});

test("legacy identity editors without a basis still save and still advance the version", async () => {
  const { deps, repos, ownerPrincipalId } = await buildDeps();
  const base = { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId };

  await updateRole({ deps, input: { ...base, roleId: "role-x", name: "Writers" } });
  await updatePolicy({ deps, input: { ...base, policyId: "policy-x" } }, { name: "Approve" });
  await updateUser({ deps, input: { ...base, principalId: "user-x" } }, { email: "legacy@example.test" });

  assert.equal((await repos.roles.findById({ workspaceId: WORKSPACE, id: "role-x" }))?.version, 2);
  assert.equal((await repos.policies.findById({ workspaceId: WORKSPACE, id: "policy-x" }))?.version, 2);
  assert.equal((await repos.users.findByPrincipalId({ workspaceId: WORKSPACE, principalId: "user-x" }))?.version, 2);
  // A basis opened before the legacy save is now stale.
  await assert.rejects(() => updateRole({ deps, input: { ...base, roleId: "role-x", name: "Authors" } }, { expectedVersion: 1 }), isConflict);
});

test("built-in and frozen identity records stay refused whatever basis is supplied", async () => {
  const { deps, repos, ownerPrincipalId } = await buildDeps();
  const base = { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId };
  const builtin = (await repos.roles.list({ workspaceId: WORKSPACE })).find((r) => r.isBuiltin)!;
  await assert.rejects(() => updateRole({ deps, input: { ...base, roleId: builtin.id, name: "Mine" } }, { expectedVersion: builtin.version }), /built-in role cannot be renamed/);
});
