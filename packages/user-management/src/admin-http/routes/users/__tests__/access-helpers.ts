import { assertVersionedWrite } from "@jini-ai/core/optimistic-concurrency";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

import { deletePolicy, deleteRole, updatePolicy, updateRole, writePolicyPermission } from "../../../../server/admin-crud-service.js";
import type { AuthServiceDeps } from "../../../../server/auth-service.js";
import { createPolicy, createRole } from "../../../../server/grant-service.js";
import { createTransactionalInMemoryIdentityRepos } from "../../../../server/repo.memory-transactions.js";
import {
  InMemoryPolicyPermissionRepo, InMemoryPolicyRepo, InMemoryPrincipalPolicyRepo, InMemoryPrincipalRepo, InMemoryPrincipalRoleRepo,
  InMemoryRolePolicyRepo, InMemoryRoleRepo, InMemorySessionRepo, InMemoryUserRepo,
} from "../../../../server/repo.memory.js";
import { seedIdentity } from "../../../../server/seed.js";
import { NodeSessionTokens } from "../../../../server/session-tokens.js";
import {
  GrantExceedsIssuerError, IdentityConflictError, IdentityForbiddenError, IdentityNotFoundError, IdentityValidationError,
  OwnerRequiredError, PermissionUnknownError,
} from "../../../../core/types.js";

/** @file Shared fakes for the role/policy route-spec tests: real identity services over in-memory repos, a
 *  recording authorizer (these routes must never call it — the service owns the gate) and the refusal reader. */

export const WORKSPACE_ID = "ws-1";
export const signal = new AbortController().signal;

/** The real identity services each spec has injected (production binds the same ones from `./server`).
 *  Every spec reads only its own field; the rest ride along unused, so the test deps stay one shape. */
const ACCESS_SERVICES = { createRole, updateRole, deleteRole, createPolicy, updatePolicy, deletePolicy, writePolicyPermission };

/** A reversible fake: the specs never hash, but `seedIdentity` stores the owner's credential. */
const FAKE_HASHER = {
  hash: async ({ password }: { password: string }) => `hashed:${password}`,
  verify: async ({ hash, password }: { hash: string; password: string }) => hash === `hashed:${password}`,
};

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

/** A recording `authorize`: the role/policy write specs leave authorization to the identity service. */
export function recordingAuthorize(): { authorize: (r: { permission: string; entityType: string }) => Promise<void>; calls: string[] } {
  const calls: string[] = [];
  return { calls, authorize: async ({ permission }) => { calls.push(permission); } };
}

/** Real identity service deps over transactional in-memory repos, seeded with the owner. */
export async function makeAccessDeps() {
  let n = 0;
  const repos = createTransactionalInMemoryIdentityRepos({ repos: {
    principals: new InMemoryPrincipalRepo({}), users: new InMemoryUserRepo({ assertVersionedWrite }), sessions: new InMemorySessionRepo({}),
    roles: new InMemoryRoleRepo({ assertVersionedWrite }), policies: new InMemoryPolicyRepo({ assertVersionedWrite }), policyPermissions: new InMemoryPolicyPermissionRepo({}),
    rolePolicies: new InMemoryRolePolicyRepo({}), principalRoles: new InMemoryPrincipalRoleRepo({}), principalPolicies: new InMemoryPrincipalPolicyRepo({}),
  } });
  const serviceDeps: AuthServiceDeps = {
    repos, hasher: FAKE_HASHER, clock: { nowMs: () => Date.parse("2026-11-23T00:00:00.000Z") },
    idGen: { newId: () => `id-${++n}` }, tokens: new NodeSessionTokens({}),
  };
  const { ownerPrincipalId } = await seedIdentity({ deps: serviceDeps, input: { workspaceId: WORKSPACE_ID, ownerPassword: "seed-owner-pw", ownerUsername: "admin" } });
  await repos.principals.save({ id: "bare", workspaceId: WORKSPACE_ID, kind: "user", displayName: "bare", status: "active", createdAt: "2026-01-01T00:00:00.000Z" });
  let serviceCalls = 0;
  const routeDeps = { ...ACCESS_SERVICES, workspaceId: WORKSPACE_ID, identityServiceDeps: () => { serviceCalls++; return serviceDeps; } };
  return { repos, serviceDeps, routeDeps, OWNER: { id: ownerPrincipalId }, BARE: { id: "bare" }, serviceCalls: () => serviceCalls };
}

/** Deps whose service-deps assembly throws `err`, so each route's error ladder is pinned without staging the state. */
export function throwingDeps(err: unknown) {
  return { ...ACCESS_SERVICES, workspaceId: WORKSPACE_ID, identityServiceDeps: (): AuthServiceDeps => { throw err; } };
}

/** One instance of every identity error a ladder may map, keyed by its wire code. */
export const ERRORS = {
  forbidden: new IdentityForbiddenError({ message: "no role.manage", permission: "role.manage", reason: "no matching grant" }),
  validation: new IdentityValidationError({ message: "built-in target" }),
  notFound: new IdentityNotFoundError({ message: "role 'r' was not found" }),
  conflict: new IdentityConflictError({ message: "still referenced" }),
  grantExceeds: new GrantExceedsIssuerError({ message: "exceeds issuer", offendingPermissions: ["user.manage"] }),
  permissionUnknown: new PermissionUnknownError({ message: "unknown permission" }),
  ownerRequired: new OwnerRequiredError({ message: "only an owner can modify an owner principal" }),
} as const;

/** The exact flat bodies the hand-written routes wrote for {@link ERRORS}. */
export const BODIES = {
  forbidden: { status: 403, body: { error: "no role.manage", code: "FORBIDDEN", details: { permission: "role.manage", reason: "no matching grant" } } },
  validation: { status: 400, body: { error: "built-in target", code: "VALIDATION_ERROR" } },
  notFound: { status: 404, body: { error: "role 'r' was not found", code: "RESOURCE_NOT_FOUND" } },
  grantExceeds: { status: 403, body: { error: "exceeds issuer", code: "GRANT_EXCEEDS_ISSUER", details: { offendingPermissions: ["user.manage"] } } },
  ownerRequired: { status: 409, body: { error: "only an owner can modify an owner principal", code: "OWNER_REQUIRED" } },
  conflictOn: (field: string) => ({ status: 409, body: { error: "still referenced", code: "RESOURCE_CONFLICT", details: { field } } }),
  permissionUnknownFor: (permission: unknown) => ({ status: 400, body: { error: "unknown permission", code: "PERMISSION_UNKNOWN", details: { permission } } }),
} as const;
