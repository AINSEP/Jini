import assert from "node:assert/strict";
import { test } from "vitest";
import { createTransactionalInMemoryIdentityRepos } from "../repo.memory-transactions.js";
import { NodeSessionTokens } from "../session-tokens.js";
import { createPolicy, createRole, createUser } from "../grant-service.js";
import { Argon2PasswordHasher, loadArgon2Binding } from "../hasher.js";
import { MAX_PASSWORD_LENGTH } from "../password-policy.js";
import type { IdentityRepos } from "../../core/ports.js";
import {
  InMemoryPolicyPermissionRepo, InMemoryPolicyRepo, InMemoryPrincipalPolicyRepo, InMemoryPrincipalRepo,
  InMemoryPrincipalRoleRepo, InMemoryRolePolicyRepo, InMemoryRoleRepo, InMemorySessionRepo, InMemoryUserRepo,
} from "../repo.memory.js";
import { seedIdentity } from "../seed.js";
import { IdentityValidationError } from "../../core/types.js";
import type { AuthServiceDeps } from "../auth-service.js";

// Input validation of the grant-writing service. The typed signatures require these fields, but
// the service is also the boundary for untyped JSON and tool callers, so absent values must be
// rejected as validation errors rather than crash or write a row.

const WORKSPACE = "workspace-validation";
const HASHER = new Argon2PasswordHasher({ loadBinding: loadArgon2Binding }, { memoryCost: 8, timeCost: 1, parallelism: 1 });

async function seeded(): Promise<{ deps: AuthServiceDeps; repos: IdentityRepos; ownerPrincipalId: string }> {
  const repos: IdentityRepos = createTransactionalInMemoryIdentityRepos({ repos: {
    principals: new InMemoryPrincipalRepo({}), users: new InMemoryUserRepo({}), sessions: new InMemorySessionRepo({}),
    roles: new InMemoryRoleRepo({}), policies: new InMemoryPolicyRepo({}), policyPermissions: new InMemoryPolicyPermissionRepo({}),
    rolePolicies: new InMemoryRolePolicyRepo({}), principalRoles: new InMemoryPrincipalRoleRepo({}), principalPolicies: new InMemoryPrincipalPolicyRepo({}),
  } });
  let n = 0;
  const deps: AuthServiceDeps = { repos, hasher: HASHER, clock: { nowMs: () => Date.parse("2026-07-10T00:00:00.000Z") },
    idGen: { newId: () => `id-${++n}` }, tokens: new NodeSessionTokens({}) };
  const { ownerPrincipalId } = await seedIdentity({ deps, input: { workspaceId: WORKSPACE, ownerPassword: "seed-owner-pw", ownerUsername: "admin" } });
  return { deps, repos, ownerPrincipalId };
}

/** Simulates an untyped caller that omitted a field the TypeScript signature requires. */
function omitted<T>(): T { return undefined as unknown as T; }

test("CREATE_USER rejects a password over the policy's upper bound and writes nothing", async () => {
  const { deps, repos, ownerPrincipalId } = await seeded();
  const before = await repos.principals.list({ workspaceId: WORKSPACE });
  await assert.rejects(
    () => createUser({ deps, input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, username: "carol", password: "x".repeat(MAX_PASSWORD_LENGTH + 1) } }),
    (error: unknown) => error instanceof IdentityValidationError && error.message === `Password must be no more than ${MAX_PASSWORD_LENGTH} characters.`,
  );
  assert.deepEqual(await repos.principals.list({ workspaceId: WORKSPACE }), before);
  assert.equal(await repos.users.findByUsername({ workspaceId: WORKSPACE, username: "carol" }), null);
});

test("CREATE_USER rejects an absent username from an untyped caller", async () => {
  const { deps, ownerPrincipalId } = await seeded();
  await assert.rejects(
    () => createUser({ deps, input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, username: omitted<string>(), password: "pw-valid-1234" } }),
    (error: unknown) => error instanceof IdentityValidationError && error.message === "username and password are required",
  );
});

test("CREATE_ROLE rejects blank and absent names without writing a role", async () => {
  const { deps, repos, ownerPrincipalId } = await seeded();
  const before = await repos.roles.list({ workspaceId: WORKSPACE });
  for (const name of ["   ", omitted<string>()]) {
    await assert.rejects(
      () => createRole({ deps, input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, name } }),
      (error: unknown) => error instanceof IdentityValidationError && error.message === "role name is required",
    );
  }
  assert.deepEqual(await repos.roles.list({ workspaceId: WORKSPACE }), before);
});

test("CREATE_POLICY rejects blank and absent names without writing a policy", async () => {
  const { deps, repos, ownerPrincipalId } = await seeded();
  const before = await repos.policies.list({ workspaceId: WORKSPACE });
  for (const name of ["\t", omitted<string>()]) {
    await assert.rejects(
      () => createPolicy({ deps, input: { workspaceId: WORKSPACE, callerPrincipalId: ownerPrincipalId, name } }),
      (error: unknown) => error instanceof IdentityValidationError && error.message === "policy name is required",
    );
  }
  assert.deepEqual(await repos.policies.list({ workspaceId: WORKSPACE }), before);
});
