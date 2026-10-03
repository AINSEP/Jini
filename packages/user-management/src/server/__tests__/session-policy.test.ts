import { expect, test } from "vitest";
import { createSessionForPrincipal, login, validateSession, type AuthServiceDeps } from "../auth-service.js";
import { defaultUserManagementMessages } from "../messages.js";
import { createTransactionalInMemoryIdentityRepos } from "../repo.memory-transactions.js";
import { InMemoryPrincipalRepo, InMemoryUserRepo, InMemorySessionRepo, InMemoryRoleRepo,
  InMemoryPolicyRepo, InMemoryPolicyPermissionRepo, InMemoryRolePolicyRepo,
  InMemoryPrincipalRoleRepo, InMemoryPrincipalPolicyRepo } from "../repo.memory.js";
import { AuthInvalidCredentialsError } from "../../core/types.js";

const epochMs = Date.parse("2026-10-02T00:00:00.000Z");
function fixture(): AuthServiceDeps {
  let id = 0;
  return {
    repos: createTransactionalInMemoryIdentityRepos({ repos: {
      principals: new InMemoryPrincipalRepo({}), users: new InMemoryUserRepo({}),
      sessions: new InMemorySessionRepo({}), roles: new InMemoryRoleRepo({}),
      policies: new InMemoryPolicyRepo({}), policyPermissions: new InMemoryPolicyPermissionRepo({}),
      rolePolicies: new InMemoryRolePolicyRepo({}), principalRoles: new InMemoryPrincipalRoleRepo({}),
      principalPolicies: new InMemoryPrincipalPolicyRepo({}),
    } }),
    clock: { nowMs: () => epochMs }, idGen: { newId: () => `session-${++id}` },
    tokens: { newToken: () => "bearer", hashToken: ({ rawToken }) => `digest:${rawToken}` },
    hasher: { hash: async () => "hash", verify: async () => true },
  };
}
// PARITY: omission keeps the historical absolute 30-day lifetime.
test("sessions retain the default lifetime", async () => {
  const { session } = await createSessionForPrincipal({ deps: fixture(), input: { workspaceId: "scope", principalId: "p" } });
  expect(Date.parse(session.expiresAt) - Date.parse(session.createdAt)).toBe(30 * 24 * 60 * 60 * 1000);
});
// REGRESSION: fails if createSessionForPrincipal again always applies 30 days.
test("a host-supplied lifetime is stamped once", async () => {
  const { session } = await createSessionForPrincipal({ deps: fixture(), input: { workspaceId: "scope", principalId: "p" } }, { sessionTtlMs: 90_000 });
  expect(Date.parse(session.expiresAt) - Date.parse(session.createdAt)).toBe(90_000);
});
// REGRESSION: fails if the sessionTtlMs validation guard is removed.
test.each([0, -1, NaN, Infinity])("invalid session lifetime %s refuses persistence", async sessionTtlMs => {
  const deps = fixture();
  await expect(createSessionForPrincipal({ deps, input: { workspaceId: "scope", principalId: "p" } }, { sessionTtlMs })).rejects.toThrow(RangeError);
  expect(await deps.repos.sessions.findByTokenHash({ workspaceId: "scope", tokenHash: "digest:bearer" })).toBeNull();
});
// REGRESSION: fails if login ignores its messages option.
test("authentication copy is replaceable without changing the refusal class", async () => {
  const messages = { ...defaultUserManagementMessages, invalidCredentials: "Credentials rejected" };
  await expect(login({ deps: fixture(), input: { workspaceId: "scope", username: "", password: "" } }, { messages }))
    .rejects.toMatchObject({ constructor: AuthInvalidCredentialsError, message: messages.invalidCredentials });
});
// PARITY: a bearer minted in one tenant never validates in another tenant.
test("sessions retain repository tenant isolation", async () => {
  const deps = fixture();
  await deps.repos.principals.save({ id: "p", workspaceId: "scope-a", kind: "user", displayName: "P", status: "active", createdAt: new Date(epochMs).toISOString() });
  const { rawToken } = await createSessionForPrincipal({ deps, input: { workspaceId: "scope-a", principalId: "p" } });
  expect((await validateSession({ deps, input: { workspaceId: "scope-a", rawToken } }))?.principal.id).toBe("p");
  expect(await validateSession({ deps, input: { workspaceId: "scope-b", rawToken } })).toBeNull();
});
