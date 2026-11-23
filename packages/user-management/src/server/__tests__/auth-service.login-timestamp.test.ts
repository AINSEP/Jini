import assert from "node:assert/strict";
import { test } from "vitest";

import { login, type AuthServiceDeps } from "../auth-service.js";
import { Argon2PasswordHasher, loadArgon2Binding } from "../hasher.js";
import {
  InMemoryPolicyPermissionRepo, InMemoryPolicyRepo, InMemoryPrincipalPolicyRepo, InMemoryPrincipalRepo,
  InMemoryPrincipalRoleRepo, InMemoryRolePolicyRepo, InMemoryRoleRepo, InMemorySessionRepo, InMemoryUserRepo,
} from "../repo.memory.js";
import type { IdentityRepos } from "../../core/ports.js";
import { NodeSessionTokens } from "../session-tokens.js";
import { createTransactionalInMemoryIdentityRepos } from "../repo.memory-transactions.js";

/**
 * @file B262: recording a login time must not overwrite a concurrent write to the same user row.
 * The interleave is forced deterministically: a password reset lands right after login has read
 * the user row and before login records the timestamp.
 */

const WORKSPACE = "workspace-1";
const HASHER = new Argon2PasswordHasher({ loadBinding: loadArgon2Binding }, { memoryCost: 8, timeCost: 1, parallelism: 1 });

test("B262: a password reset landing between login's read and its timestamp write survives", async () => {
  const users = new InMemoryUserRepo({});
  const repos: IdentityRepos = createTransactionalInMemoryIdentityRepos({ repos: {
    principals: new InMemoryPrincipalRepo({}), users, sessions: new InMemorySessionRepo({}),
    roles: new InMemoryRoleRepo({}), policies: new InMemoryPolicyRepo({}), policyPermissions: new InMemoryPolicyPermissionRepo({}),
    rolePolicies: new InMemoryRolePolicyRepo({}), principalRoles: new InMemoryPrincipalRoleRepo({}), principalPolicies: new InMemoryPrincipalPolicyRepo({}),
  } });
  await repos.principals.save({ id: "p-1", workspaceId: WORKSPACE, kind: "user", displayName: "ed", status: "active", createdAt: "2026-01-01T00:00:00.000Z" });
  await repos.users.save({ principalId: "p-1", workspaceId: WORKSPACE, username: "ed", passwordHash: await HASHER.hash({ password: "old-pass" }) });

  const resetHash = await HASHER.hash({ password: "new-pass" });
  // Patched on the raw repo (beneath the transactional queue) so the interleaved write cannot deadlock it.
  const readUser = users.findByUsername.bind(users);
  users.findByUsername = async (args) => {
    const row = await readUser(args);
    // Another writer (password reset) commits after login read the row.
    if (row) await users.save({ ...row, passwordHash: resetHash });
    return row;
  };

  const deps: AuthServiceDeps = { repos, hasher: HASHER, clock: { nowMs: () => Date.parse("2026-07-10T00:00:00.000Z") }, idGen: { newId: (() => { let n = 0; return () => `id-${++n}`; })() }, tokens: new NodeSessionTokens({}) };
  await login({ deps, input: { workspaceId: WORKSPACE, username: "ed", password: "old-pass" } });

  const stored = await repos.users.findByPrincipalId({ workspaceId: WORKSPACE, principalId: "p-1" });
  assert.equal(stored?.passwordHash, resetHash, "the reset password must not be reverted by the login timestamp write");
  assert.equal(stored?.lastLoginAt, "2026-07-10T00:00:00.000Z");
});
