import { createTransactionalInMemoryIdentityRepos } from "../repo.memory-transactions.js";
import { InMemoryPrincipalRepo, InMemoryUserRepo, InMemorySessionRepo, InMemoryRoleRepo,
  InMemoryPolicyRepo, InMemoryPolicyPermissionRepo, InMemoryRolePolicyRepo,
  InMemoryPrincipalRoleRepo, InMemoryPrincipalPolicyRepo } from "../repo.memory.js";
import { seedIdentity } from "../seed.js";
import { createUser } from "../grant-service.js";
import { NodeSessionTokens } from "../session-tokens.js";
import type { AuthServiceDeps } from "../auth-service.js";
import type { IdentityToolDeps } from "../agent-tool-registrations.js";
import type { UsernameChangePort } from "../../core/runtime-ports.js";

export async function renameHarness() {
  const repos = createTransactionalInMemoryIdentityRepos({ repos: {
    principals: new InMemoryPrincipalRepo({}), users: new InMemoryUserRepo({}), sessions: new InMemorySessionRepo({}),
    roles: new InMemoryRoleRepo({}), policies: new InMemoryPolicyRepo({}), policyPermissions: new InMemoryPolicyPermissionRepo({}),
    rolePolicies: new InMemoryRolePolicyRepo({}), principalRoles: new InMemoryPrincipalRoleRepo({}), principalPolicies: new InMemoryPrincipalPolicyRepo({}),
  } });
  let id = 0;
  const audit: Parameters<UsernameChangePort["record"]>[0][] = [];
  const trash = new Set<string>();
  const deps: AuthServiceDeps = { repos, clock: { nowMs: () => Date.parse("2026-10-09T00:00:00Z") },
    idGen: { newId: () => `rename-${++id}` }, tokens: new NodeSessionTokens({}),
    hasher: { hash: async () => "test-hash", verify: async ({ password }) => password === "test-password" },
    usernameChanges: { isInTrash: async ({ principalId }) => trash.has(principalId), record: async event => { audit.push(event); } },
  };
  const { ownerPrincipalId } = await seedIdentity({ deps, input: { workspaceId: "w", ownerUsername: "admin", ownerPassword: "test-password" } });
  async function user(username: string) {
    return (await createUser({ deps, input: { workspaceId: "w", callerPrincipalId: ownerPrincipalId, username, password: "test-password" } }, { email: "kept@example.test" })).user;
  }
  async function grant(principalId: string, permission: string) {
    const policyId = deps.idGen.newId();
    await repos.policies.save({ id: policyId, workspaceId: "w", name: policyId, isBuiltin: false, isFrozen: false });
    await repos.policyPermissions.save({ id: deps.idGen.newId(), workspaceId: "w", policyId, permission, resourceType: null, constraintJson: null });
    await repos.principalPolicies.save({ id: deps.idGen.newId(), workspaceId: "w", principalId, policyId });
  }
  const tools: IdentityToolDeps = { workspaceId: "w", clock: deps.clock, idGen: deps.idGen,
    transactions: repos.transactions, tokens: deps.tokens, passwordHasher: deps.hasher,
    ownerPrincipalId: Promise.resolve(ownerPrincipalId), usernameChanges: deps.usernameChanges,
    principalRepo: repos.principals, userRepo: repos.users, sessionRepo: repos.sessions, roleRepo: repos.roles,
    policyRepo: repos.policies, policyPermissionRepo: repos.policyPermissions, rolePolicyRepo: repos.rolePolicies,
    principalRoleRepo: repos.principalRoles, principalPolicyRepo: repos.principalPolicies };
  return { deps, repos, ownerPrincipalId, audit, trash, user, grant, tools };
}
