import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

import type { IdentityRepos } from "../../../../core/ports.js";
import type { AuthServiceDeps } from "../../../../server/auth-service.js";
import { createUser } from "../../../../server/grant-service.js";
import { Argon2PasswordHasher, loadArgon2Binding } from "../../../../server/hasher.js";
import { createTransactionalInMemoryIdentityRepos } from "../../../../server/repo.memory-transactions.js";
import {
  InMemoryPolicyPermissionRepo, InMemoryPolicyRepo, InMemoryPrincipalPolicyRepo, InMemoryPrincipalRepo, InMemoryPrincipalRoleRepo,
  InMemoryRolePolicyRepo, InMemoryRoleRepo, InMemorySessionRepo, InMemoryUserRepo,
} from "../../../../server/repo.memory.js";
import { seedIdentity } from "../../../../server/seed.js";
import { NodeSessionTokens } from "../../../../server/session-tokens.js";

/**
 * @file Shared fakes for the users (principal) route-spec tests: a seeded in-memory identity store
 * driven through the real Jini identity services, a recording permission decision and the refusal
 * reader. The specs are pinned against the real services so a mapping table that drifts from what
 * the services actually throw goes red here, not only at the host's wire.
 */

export const WORKSPACE_ID = "workspace-1";
export const signal = new AbortController().signal;
export const USER_PASSWORD = "user-p4ssw0rd!";
// Cheapest Argon2 cost the binding accepts: the specs only pass the hasher through to the services.
const HASHER = new Argon2PasswordHasher({ loadBinding: loadArgon2Binding }, { memoryCost: 8, timeCost: 1, parallelism: 1 });

/** The raw input a host adapter hands `parse`. */
export const raw = (params: Record<string, string>, body: unknown = {}) => ({ body, query: {}, params });

/** Run `fn` and return the refusal it throws (status + flat body); fails if it does not refuse. */
export async function refusalOf(fn: () => unknown): Promise<{ status: number; body: unknown }> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof RouteRefusalError) return error.response;
    throw error;
  }
  throw new Error("expected a route refusal");
}

/** A seeded identity store: the owner principal, the service deps over it and its repos. */
export async function seededIdentity(): Promise<{ services: AuthServiceDeps; repos: IdentityRepos; ownerId: string }> {
  let n = 0;
  const repos: IdentityRepos = createTransactionalInMemoryIdentityRepos({ repos: {
    principals: new InMemoryPrincipalRepo({}), users: new InMemoryUserRepo({}), sessions: new InMemorySessionRepo({}),
    roles: new InMemoryRoleRepo({}), policies: new InMemoryPolicyRepo({}), policyPermissions: new InMemoryPolicyPermissionRepo({}),
    rolePolicies: new InMemoryRolePolicyRepo({}), principalRoles: new InMemoryPrincipalRoleRepo({}), principalPolicies: new InMemoryPrincipalPolicyRepo({}),
  } });
  const services: AuthServiceDeps = {
    repos, hasher: HASHER, clock: { nowMs: () => Date.parse("2026-07-21T00:00:00.000Z") },
    idGen: { newId: () => `id-${++n}` }, tokens: new NodeSessionTokens({}),
  };
  const { ownerPrincipalId } = await seedIdentity({ deps: services, input: { workspaceId: WORKSPACE_ID, ownerPassword: "seed-owner-pw", ownerUsername: "admin" } });
  return { services, repos, ownerId: ownerPrincipalId };
}

/** Create one ordinary operator through the real `createUser`; returns its principal id. */
export async function addUser({ services, ownerId, username }: { services: AuthServiceDeps; ownerId: string; username: string }): Promise<string> {
  const { principal } = await createUser({ deps: services, input: { workspaceId: WORKSPACE_ID, callerPrincipalId: ownerId, username, password: USER_PASSWORD } }, { email: `${username}@example.test` });
  return principal.id;
}

/** A trash index the tests can fill; the host's real one is the Trash store. */
export function trashIndex(ids: readonly string[] = []): { isInTrash: (r: { principalId: string }) => Promise<boolean>; trashed: Set<string> } {
  const trashed = new Set(ids);
  return { trashed, isInTrash: async ({ principalId }) => trashed.has(principalId) };
}

/** A host error class the specs only ever see through an injected predicate. */
export class HostSelfDeleteError extends Error {}
export class HostUnsupportedError extends Error {}
