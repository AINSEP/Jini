import assert from "node:assert/strict";
import { test } from "vitest";

import { authorize as authorizeCore } from "../../identity/authorize.js";
import type { AuthorizeDeps } from "../../identity/authorize.js";
import {
  InMemoryPolicyPermissionRepo,
  InMemoryPrincipalPolicyRepo,
  InMemoryPrincipalRepo,
  InMemoryPrincipalRoleRepo,
  InMemoryRolePolicyRepo,
} from "../../identity/repo.memory.js";
import { ForbiddenError } from "../errors.js";
import { deprecateContentType, reactivateContentType, tombstoneContentType } from "../lifecycle.js";
import { registerContentType, updateContentTypeFields } from "../write-service.js";
import type { AuthorizeFn } from "../write-service.js";

/**
 * @file Same divergence as `entries/__tests__/write-service.authorize-entitytype.integration.test.ts`
 * (see that file's header for the full chain), found by the same ITEM 1 sweep across
 * `content-types/write-service.ts` (`registerContentType`, `updateContentTypeFields`) and
 * `content-types/lifecycle.ts` (`deprecateContentType`, `reactivateContentType`,
 * `tombstoneContentType`) — every one of the five omitted `entityType`, while their fronting HTTP
 * routes (`admin-http/routes/content-types/{register,update-fields,lifecycle}.ts`) pre-check with
 * `entityType: "content-type"`. A principal holding ONLY a `resourceType: "content-type"`-scoped
 * grant passed the route and was denied at the chokepoint with `resource_scope_mismatch`.
 */

const WORKSPACE = "ws-1";
const NOW = "2026-07-15T00:00:00.000Z";
const clock = { nowIso: () => NOW };
let idCounter = 0;
const ids = { newId: () => `ct-${++idCounter}` };

function buildAuthDeps(): AuthorizeDeps {
  return {
    principals: new InMemoryPrincipalRepo(),
    principalRoles: new InMemoryPrincipalRoleRepo(),
    rolePolicies: new InMemoryRolePolicyRepo(),
    principalPolicies: new InMemoryPrincipalPolicyRepo(),
    policyPermissions: new InMemoryPolicyPermissionRepo(),
  };
}

async function seedPrincipal(deps: AuthorizeDeps, id: string): Promise<void> {
  await deps.principals.save({ id, workspaceId: WORKSPACE, kind: "user", displayName: id, status: "active", createdAt: NOW });
}

async function grantScoped(deps: AuthorizeDeps, principalId: string, permission: string, resourceType: string): Promise<void> {
  const policyId = `policy-${principalId}-${permission}-${resourceType}`;
  await deps.policyPermissions.save({ id: `pp-${policyId}`, workspaceId: WORKSPACE, policyId, permission, resourceType, constraintJson: null });
  await deps.principalPolicies.save({ id: `link-${policyId}`, workspaceId: WORKSPACE, principalId, policyId });
}

/** Mirrors `features/identity/wiring.ts`'s real `authorize()` closure — see the entries suite's identical helper for why this must forward `entityType`. */
function bindRealAuthorize(authDeps: AuthorizeDeps): AuthorizeFn {
  return (params) =>
    authorizeCore({
      deps: authDeps,
      principalId: params.principalId,
      permission: params.permission,
      // See the entries suite's identical helper for why this must conditionally spread rather
      // than always assign `entityType`/`entityId` under `exactOptionalPropertyTypes: true`.
      context: {
        workspaceId: params.workspaceId,
        ...(params.entityType !== undefined ? { entityType: params.entityType } : {}),
        ...(params.entityId !== undefined ? { entityId: params.entityId } : {}),
      },
    });
}

function fakeRepo() {
  const rows: unknown[] = [];
  return {
    rows,
    save: async (row: unknown) => {
      rows.push(row);
    },
    appendRevision: async () => undefined,
    findByKey: async () => null,
    transaction: async <T>(fn: () => Promise<T>) => fn(),
  };
}

function fakeIndexProvisioner() {
  return {
    provisionIndexesForNewContentType: async () => undefined,
    applyFieldIndexTransitions: async () => undefined,
    tearDownAllIndexesForContentType: async () => undefined,
  };
}

function fakeOutbox() {
  return { enqueue: async () => undefined };
}

function contentType(status: "active" | "deprecated" | "tombstone", version = 1) {
  return { workspaceId: WORKSPACE, key: "recipe", label: "Recipe", fields: [], status, version, tombstonedAt: null as string | null };
}

function fakeLifecycleRepo(seed: ReturnType<typeof contentType>) {
  let stored = seed;
  return {
    getStored: () => stored,
    findByKey: async () => stored,
    save: async (row: typeof seed) => {
      stored = row;
    },
    appendRevision: async () => undefined,
    transaction: async <T>(fn: () => Promise<T>) => fn(),
  };
}

test("registerContentType: a content-type-scoped grant is allowed to register a content type", async () => {
  const authDeps = buildAuthDeps();
  await seedPrincipal(authDeps, "scoped1");
  await grantScoped(authDeps, "scoped1", "admin.collections.manage", "content-type");
  const authorize = bindRealAuthorize(authDeps);

  const result = await registerContentType({
    deps: { repo: fakeRepo(), clock, ids, authorize, indexProvisioner: fakeIndexProvisioner(), outbox: fakeOutbox() },
    input: { workspaceId: WORKSPACE, actorId: "scoped1", key: "recipe", label: "Recipe", fields: [] },
  });

  assert.equal(result.ok, true, "a content-type-scoped grant must be sufficient, same as the HTTP route's own pre-check already allows");
});

test("updateContentTypeFields: a content-type-scoped grant is allowed to update fields", async () => {
  const authDeps = buildAuthDeps();
  await seedPrincipal(authDeps, "scoped1");
  await grantScoped(authDeps, "scoped1", "admin.collections.manage", "content-type");
  const authorize = bindRealAuthorize(authDeps);

  const repo = fakeRepo();
  repo.findByKey = async () => ({ workspaceId: WORKSPACE, key: "recipe", label: "Recipe", fields: [], status: "active", version: 1, tombstonedAt: null }) as never;

  const result = await updateContentTypeFields({
    deps: { repo, clock, ids, authorize, indexProvisioner: fakeIndexProvisioner(), outbox: fakeOutbox() },
    input: { workspaceId: WORKSPACE, actorId: "scoped1", key: "recipe", fields: [{ name: "title", kind: "text", required: true, queryable: false }], expectedVersion: 1 },
  });

  assert.equal(result.ok, true, "a content-type-scoped grant must be sufficient, same as the HTTP route's own pre-check already allows");
});

test("deprecateContentType/reactivateContentType/tombstoneContentType: a content-type-scoped grant is allowed through each lifecycle transition", async () => {
  const authDeps = buildAuthDeps();
  await seedPrincipal(authDeps, "scoped1");
  await grantScoped(authDeps, "scoped1", "admin.collections.manage", "content-type");
  const authorize = bindRealAuthorize(authDeps);

  // Each transition gets its own freshly-seeded repo (independent of the others' resulting
  // state) so this test exercises exactly one `deps.authorize()` call site per assertion,
  // rather than chaining deprecate -> reactivate -> tombstone through one repo instance (that
  // would land tombstoneContentType on an "active" row post-reactivate and fail on the
  // deprecated-only lifecycle guard, not on authorization — a different function's contract,
  // not what this suite is proving).
  const deprecateResult = await deprecateContentType({
    deps: { repo: fakeLifecycleRepo(contentType("active", 1)), clock, authorize, outbox: fakeOutbox() },
    input: { workspaceId: WORKSPACE, actorId: "scoped1", key: "recipe", expectedVersion: 1 },
  });
  assert.equal(deprecateResult.ok, true, "deprecate: a content-type-scoped grant must be sufficient");

  const reactivateResult = await reactivateContentType({
    deps: { repo: fakeLifecycleRepo(contentType("deprecated", 1)), clock, authorize },
    input: { workspaceId: WORKSPACE, actorId: "scoped1", key: "recipe", expectedVersion: 1 },
  });
  assert.equal(reactivateResult.ok, true, "reactivate: a content-type-scoped grant must be sufficient");

  const tombstoneResult = await tombstoneContentType({
    deps: { repo: fakeLifecycleRepo(contentType("deprecated", 1)), clock, authorize, outbox: fakeOutbox(), indexProvisioner: fakeIndexProvisioner() },
    input: { workspaceId: WORKSPACE, actorId: "scoped1", key: "recipe", expectedVersion: 1 },
  });
  assert.equal(tombstoneResult.ok, true, "tombstone: a content-type-scoped grant must be sufficient");
});

test("negative control: a principal holding ONLY an entry-scoped grant is still denied managing content types", async () => {
  const authDeps = buildAuthDeps();
  await seedPrincipal(authDeps, "scoped-wrong");
  await grantScoped(authDeps, "scoped-wrong", "admin.collections.manage", "entry");
  const authorize = bindRealAuthorize(authDeps);

  const result = await registerContentType({
    deps: { repo: fakeRepo(), clock, ids, authorize, indexProvisioner: fakeIndexProvisioner(), outbox: fakeOutbox() },
    input: { workspaceId: WORKSPACE, actorId: "scoped-wrong", key: "recipe", label: "Recipe", fields: [] },
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.error instanceof ForbiddenError, "a grant scoped to a different resourceType must still be denied");
});
