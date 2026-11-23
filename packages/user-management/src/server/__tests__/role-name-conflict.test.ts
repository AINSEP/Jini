import assert from "node:assert/strict";
import { test } from "vitest";

import { updateRole } from "../admin-crud-service.js";
import type { AuthServiceDeps } from "../auth-service.js";
import { createRole } from "../grant-service.js";
import { Argon2PasswordHasher, loadArgon2Binding } from "../hasher.js";
import { createTransactionalInMemoryIdentityRepos } from "../repo.memory-transactions.js";
import {
  InMemoryPolicyPermissionRepo, InMemoryPolicyRepo, InMemoryPrincipalPolicyRepo, InMemoryPrincipalRepo,
  InMemoryPrincipalRoleRepo, InMemoryRolePolicyRepo, InMemoryRoleRepo, InMemorySessionRepo, InMemoryUserRepo,
} from "../repo.memory.js";
import { seedIdentity } from "../seed.js";
import { NodeSessionTokens } from "../session-tokens.js";
import { IdentityConflictError } from "../../core/types.js";

/**
 * @file B227: a role name that already exists in the workspace is refused as a typed conflict with
 * a plain-words message, instead of reaching the storage unique index (a generic 500 on SQL hosts)
 * or silently minting a second role with the same name (in-memory hosts).
 */

const WORKSPACE = "workspace-1";
const HASHER = new Argon2PasswordHasher({ loadBinding: loadArgon2Binding }, { memoryCost: 8, timeCost: 1, parallelism: 1 });

async function seeded(): Promise<{ deps: AuthServiceDeps; ownerId: string }> {
  const repos = createTransactionalInMemoryIdentityRepos({ repos: {
    principals: new InMemoryPrincipalRepo({}), users: new InMemoryUserRepo({}), sessions: new InMemorySessionRepo({}),
    roles: new InMemoryRoleRepo({}), policies: new InMemoryPolicyRepo({}), policyPermissions: new InMemoryPolicyPermissionRepo({}),
    rolePolicies: new InMemoryRolePolicyRepo({}), principalRoles: new InMemoryPrincipalRoleRepo({}), principalPolicies: new InMemoryPrincipalPolicyRepo({}),
  } });
  let n = 0;
  const deps: AuthServiceDeps = { repos, hasher: HASHER, clock: { nowMs: () => Date.parse("2026-07-10T00:00:00.000Z") }, idGen: { newId: () => `id-${++n}` }, tokens: new NodeSessionTokens({}) };
  const { ownerPrincipalId } = await seedIdentity({ deps, input: { workspaceId: WORKSPACE, ownerPassword: "seed-owner-pw", ownerUsername: "admin" } });
  return { deps, ownerId: ownerPrincipalId };
}

function isNameConflict(name: string) {
  return (err: unknown) => err instanceof IdentityConflictError && err.code === "RESOURCE_CONFLICT"
    && err.message === `A role named "${name}" already exists. Pick another name.`;
}

test("B227: creating a role with a taken name is a typed conflict and writes nothing", async () => {
  const { deps, ownerId } = await seeded();
  await createRole({ deps, input: { workspaceId: WORKSPACE, callerPrincipalId: ownerId, name: "editors" } });
  const before = await deps.repos.roles.list({ workspaceId: WORKSPACE });
  await assert.rejects(createRole({ deps, input: { workspaceId: WORKSPACE, callerPrincipalId: ownerId, name: " editors " } }), isNameConflict("editors"));
  assert.equal((await deps.repos.roles.list({ workspaceId: WORKSPACE })).length, before.length);
});

test("B227: renaming a role onto another role's name is a typed conflict; keeping its own name is allowed", async () => {
  const { deps, ownerId } = await seeded();
  await createRole({ deps, input: { workspaceId: WORKSPACE, callerPrincipalId: ownerId, name: "editors" } });
  const { role } = await createRole({ deps, input: { workspaceId: WORKSPACE, callerPrincipalId: ownerId, name: "writers" } });
  await assert.rejects(updateRole({ deps, input: { workspaceId: WORKSPACE, callerPrincipalId: ownerId, roleId: role.id, name: "editors" } }), isNameConflict("editors"));
  assert.equal((await deps.repos.roles.findById({ workspaceId: WORKSPACE, id: role.id }))?.name, "writers");
  const same = await updateRole({ deps, input: { workspaceId: WORKSPACE, callerPrincipalId: ownerId, roleId: role.id, name: "writers" } });
  assert.equal(same.role.name, "writers");
});
