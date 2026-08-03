import assert from "node:assert/strict";
import { test } from "vitest";

import {
  getEffectivePermissions,
  login,
  logout,
  validateSession,
  type AuthServiceDeps,
} from "../auth-service.js";
import { Argon2PasswordHasher } from "../hasher.js";
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
import { AuthInvalidCredentialsError } from "../types.js";
import type { IdentityRepos } from "../ports.js";

/**
 * @file Login / logout / session validation (REQ-06, AC-02/AC-05/AC-20, EC-02/EC-03/EC-13).
 */

const WORKSPACE = "workspace-1";
const HASHER = new Argon2PasswordHasher({ memoryCost: 8, timeCost: 1, parallelism: 1 });

function buildDeps(nowIso: string): { deps: AuthServiceDeps; repos: IdentityRepos; setNow: (iso: string) => void } {
  let currentNow = nowIso;
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
  const clock = { nowIso: () => currentNow };
  let counter = 0;
  const idGen = { newId: () => `id-${++counter}` };
  return { deps: { repos, hasher: HASHER, clock, idGen }, repos, setNow: (iso) => (currentNow = iso) };
}

async function seedOneUser(
  repos: IdentityRepos,
  options: { id?: string; username?: string; password: string; status?: "active" | "disabled" }
): Promise<string> {
  const principalId = options.id ?? "principal-1";
  await repos.principals.save({
    id: principalId,
    workspaceId: WORKSPACE,
    kind: "user",
    displayName: principalId,
    status: options.status ?? "active",
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  await repos.users.save({
    principalId,
    workspaceId: WORKSPACE,
    username: options.username ?? "ed",
    passwordHash: await HASHER.hash(options.password),
  });
  return principalId;
}

test("AC-02: correct credentials create a session for an active principal", async () => {
  const { deps, repos } = buildDeps("2026-07-10T00:00:00.000Z");
  await seedOneUser(repos, { password: "correct-horse" });

  const { principal, session, rawToken } = await login({
    deps,
    input: { workspaceId: WORKSPACE, username: "ed", password: "correct-horse" },
  });

  assert.equal(principal.id, "principal-1");
  assert.ok(rawToken.length > 0);
  assert.equal(session.principalId, "principal-1");

  const updatedUser = await repos.users.findByPrincipalId({ workspaceId: WORKSPACE, principalId: "principal-1" });
  assert.equal(updatedUser?.lastLoginAt, "2026-07-10T00:00:00.000Z");
});

test("AC-02: wrong password, unknown username, and a disabled principal all reject with the same error, no session created", async () => {
  const { deps, repos } = buildDeps("2026-07-10T00:00:00.000Z");
  await seedOneUser(repos, { password: "correct-horse" });
  await seedOneUser(repos, { id: "disabled-1", username: "gone", password: "pw-valid-1234", status: "disabled" });

  await assert.rejects(
    () => login({ deps, input: { workspaceId: WORKSPACE, username: "ed", password: "wrong" } }),
    AuthInvalidCredentialsError
  );
  await assert.rejects(
    () => login({ deps, input: { workspaceId: WORKSPACE, username: "nobody", password: "whatever-1234" } }),
    AuthInvalidCredentialsError
  );
  await assert.rejects(
    () => login({ deps, input: { workspaceId: WORKSPACE, username: "gone", password: "pw-valid-1234" } }),
    AuthInvalidCredentialsError
  );
});

test("EC-02: a session whose principal is later disabled stops validating immediately", async () => {
  const { deps, repos } = buildDeps("2026-07-10T00:00:00.000Z");
  await seedOneUser(repos, { password: "pw-valid-1234" });
  const { rawToken } = await login({ deps, input: { workspaceId: WORKSPACE, username: "ed", password: "pw-valid-1234" } });

  const beforeDisable = await validateSession({ deps, input: { workspaceId: WORKSPACE, rawToken } });
  assert.ok(beforeDisable);

  await repos.principals.save({
    id: "principal-1",
    workspaceId: WORKSPACE,
    kind: "user",
    displayName: "principal-1",
    status: "disabled",
    disabledAt: "2026-07-10T00:00:01.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
  });

  const afterDisable = await validateSession({ deps, input: { workspaceId: WORKSPACE, rawToken } });
  assert.equal(afterDisable, null);
});

test("EC-13/AC-20: a session past its absolute expiry is treated as revoked (401), regardless of revokedAt", async () => {
  const { deps, repos, setNow } = buildDeps("2026-07-10T00:00:00.000Z");
  await seedOneUser(repos, { password: "pw-valid-1234" });
  const { rawToken, session } = await login({
    deps,
    input: { workspaceId: WORKSPACE, username: "ed", password: "pw-valid-1234" },
  });

  // Absolute 30-day expiry (behavior.spec §4).
  const justBeforeExpiry = new Date(new Date(session.expiresAt).getTime() - 1000).toISOString();
  setNow(justBeforeExpiry);
  assert.ok(await validateSession({ deps, input: { workspaceId: WORKSPACE, rawToken } }));

  const justAfterExpiry = new Date(new Date(session.expiresAt).getTime() + 1000).toISOString();
  setNow(justAfterExpiry);
  assert.equal(await validateSession({ deps, input: { workspaceId: WORKSPACE, rawToken } }), null);
});

test("AC-05: logout revokes the session; a revoked session stops validating; logout is idempotent", async () => {
  const { deps, repos } = buildDeps("2026-07-10T00:00:00.000Z");
  await seedOneUser(repos, { password: "pw-valid-1234" });
  const { rawToken } = await login({ deps, input: { workspaceId: WORKSPACE, username: "ed", password: "pw-valid-1234" } });

  await logout({ deps, input: { workspaceId: WORKSPACE, rawToken } });
  assert.equal(await validateSession({ deps, input: { workspaceId: WORKSPACE, rawToken } }), null);

  // Idempotent: a second logout on an already-revoked/consumed token must not throw.
  await logout({ deps, input: { workspaceId: WORKSPACE, rawToken } });
});

test("EC-05: concurrent sessions for one principal are independent — revoking one doesn't revoke the other", async () => {
  const { deps, repos } = buildDeps("2026-07-10T00:00:00.000Z");
  await seedOneUser(repos, { password: "pw-valid-1234" });

  const first = await login({ deps, input: { workspaceId: WORKSPACE, username: "ed", password: "pw-valid-1234" } });
  const second = await login({ deps, input: { workspaceId: WORKSPACE, username: "ed", password: "pw-valid-1234" } });

  await logout({ deps, input: { workspaceId: WORKSPACE, rawToken: first.rawToken } });

  assert.equal(await validateSession({ deps, input: { workspaceId: WORKSPACE, rawToken: first.rawToken } }), null);
  assert.ok(await validateSession({ deps, input: { workspaceId: WORKSPACE, rawToken: second.rawToken } }));
});

test("REQ-07: getEffectivePermissions resolves the union of role + direct grants; empty for a grant-less principal", async () => {
  const { deps, repos } = buildDeps("2026-07-10T00:00:00.000Z");
  await seedOneUser(repos, { password: "pw-valid-1234" });

  const noneYet = await getEffectivePermissions({
    deps: repos,
    input: { workspaceId: WORKSPACE, principalId: "principal-1" },
  });
  assert.deepEqual(noneYet, []);

  await repos.policyPermissions.save({
    id: "pp-1",
    workspaceId: WORKSPACE,
    policyId: "policy-1",
    permission: "content.write",
    resourceType: null,
    constraintJson: null,
  });
  await repos.principalPolicies.save({
    id: "link-1",
    workspaceId: WORKSPACE,
    principalId: "principal-1",
    policyId: "policy-1",
  });

  const withGrant = await getEffectivePermissions({
    deps: repos,
    input: { workspaceId: WORKSPACE, principalId: "principal-1" },
  });
  assert.deepEqual(withGrant, ["content.write"]);
});
