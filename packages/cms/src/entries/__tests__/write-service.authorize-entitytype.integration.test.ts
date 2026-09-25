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
import { createEntry, publishEntry, unpublishEntry, updateEntry } from "../write-service.js";
import type { AuthorizeFn, EntryRevisionInput } from "../write-service.js";
import type { EntryRecord } from "../types.js";

/**
 * @file Regression coverage for the RBAC chokepoint divergence found in the ITEM 1 audit: every
 * `deps.authorize()` call in this file's write-service under test omitted `entityType`, while the
 * HTTP routes that front these same operations (`admin-http/routes/entries/{create,update,
 * lifecycle}.ts`) pre-check with `entityType: "entry"`. A principal holding ONLY a
 * `resourceType: "entry"`-scoped grant (no owner wildcard, no unscoped grant) therefore passed the
 * route's pre-check but was denied at the chokepoint with `resource_scope_mismatch` — a spurious
 * 403 for a correctly-scoped principal (confirmed against `identity/authorize.ts`'s real
 * `matchesRow`: a non-null `row.resourceType` that doesn't equal `context.entityType`, including
 * `undefined`, never matches — see `identity/__tests__/authorize.test.ts`'s own
 * "AC-14/EC-06" case for the same omitted-entityType-denies assertion in isolation).
 *
 * This suite composes the REAL `authorize()` evaluator (not a stub) with the REAL write-service
 * functions — the same composition the consuming app's `features/identity/wiring.ts` builds for its HTTP routes —
 * so it proves the end-to-end behavior a scoped principal actually experiences, not an assumption
 * about it. `agent-tools.ts`'s doc comment confirms this chokepoint is also the ONLY authorization
 * check the AI-agent tool surface ever sees for these four operations (it calls
 * create/update/publish/unpublishEntry directly, never through the HTTP route's pre-check), which
 * is why the chokepoint — not the route — must be at least as expressive as the route's check.
 */

const WORKSPACE = "ws-1";
const NOW = "2026-07-15T00:00:00.000Z";
const clock = { nowIso: () => NOW };
let idCounter = 0;
const ids = { newId: () => `entry-${++idCounter}` };

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

/** Grants `permission` scoped to `resourceType` only (never an owner wildcard, never unscoped) — the exact shape the audit named as affected. */
async function grantScoped(deps: AuthorizeDeps, principalId: string, permission: string, resourceType: string): Promise<void> {
  const policyId = `policy-${principalId}-${permission}-${resourceType}`;
  await deps.policyPermissions.save({ id: `pp-${policyId}`, workspaceId: WORKSPACE, policyId, permission, resourceType, constraintJson: null });
  await deps.principalPolicies.save({ id: `link-${policyId}`, workspaceId: WORKSPACE, principalId, policyId });
}

/**
 * Mirrors `features/identity/wiring.ts`'s real `authorize()` closure: forwards `entityType`/
 * `entityId` from the chokepoint's call into the evaluator's `AuthorizeContext`. Any call site
 * that omits `entityType` in its object literal (the bug under test) reaches this closure with
 * `params.entityType === undefined`, exactly as it would in production.
 */
function bindRealAuthorize(authDeps: AuthorizeDeps): AuthorizeFn {
  return (params) =>
    authorizeCore({
      deps: authDeps,
      principalId: params.principalId,
      permission: params.permission,
      // `identity/authorize.ts`'s `AuthorizeContext` (unlike `core/commands/command.ts`'s
      // `AuthorizeFn`) declares `entityType`/`entityId` without an explicit `| undefined`, so
      // under this package's `exactOptionalPropertyTypes: true` the keys must be OMITTED rather
      // than assigned `undefined` — conditional spread instead of always including them.
      context: {
        workspaceId: params.workspaceId,
        ...(params.entityType !== undefined ? { entityType: params.entityType } : {}),
        ...(params.entityId !== undefined ? { entityId: params.entityId } : {}),
      },
    });
}

function activeContentType() {
  return { workspaceId: WORKSPACE, key: "recipe", status: "active" as const, fields: [] as never[] };
}

function fakeCreateEntryRepo() {
  const rows: EntryRecord[] = [];
  return {
    rows,
    findBySlug: async () => null,
    findById: async (): Promise<never> => {
      throw new Error("not used by createEntry");
    },
    save: async (row: EntryRecord) => {
      rows.push(row);
    },
    appendRevision: async (_rev: EntryRevisionInput) => undefined,
    transaction: async <T>(fn: () => Promise<T>) => fn(),
  };
}

function entry(overrides: Partial<EntryRecord> = {}): EntryRecord {
  return {
    id: "entry-1",
    workspaceId: WORKSPACE,
    type: "recipe",
    slug: "chili",
    status: "draft" as const,
    title: "Chili",
    fieldsJson: { ext: { site: {} } },
    bodyJson: null,
    publishedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
    ...overrides,
  };
}

function fakeExistingEntryRepo(seed: EntryRecord) {
  let stored = seed;
  return {
    getStored: () => stored,
    findById: async () => stored,
    findBySlug: async (): Promise<never> => {
      throw new Error("not used by update/publish/unpublish");
    },
    save: async (row: EntryRecord) => {
      stored = row;
    },
    appendRevision: async () => undefined,
    transaction: async <T>(fn: () => Promise<T>) => fn(),
  };
}

const outbox = { enqueue: async () => undefined };

test("createEntry: a principal holding ONLY an entry-scoped admin.collections.manage grant is allowed to create an entry", async () => {
  const authDeps = buildAuthDeps();
  await seedPrincipal(authDeps, "scoped1");
  await grantScoped(authDeps, "scoped1", "admin.collections.manage", "entry");
  const authorize = bindRealAuthorize(authDeps);

  const entryRepo = fakeCreateEntryRepo();
  const contentTypeRepo = { findByKey: async () => activeContentType() };

  const result = await createEntry({
    deps: { entryRepo, contentTypeRepo, clock, ids, authorize, outbox },
    input: { workspaceId: WORKSPACE, actorId: "scoped1", type: "recipe", slug: "chili", title: "Chili", fieldsJson: { ext: { site: {} } } },
  });

  assert.equal(result.ok, true, "an entry-scoped grant must be sufficient to create an entry, same as the HTTP route's own pre-check already allows");
});

test("updateEntry: a principal holding ONLY an entry-scoped admin.collections.manage grant is allowed to update an entry", async () => {
  const authDeps = buildAuthDeps();
  await seedPrincipal(authDeps, "scoped1");
  await grantScoped(authDeps, "scoped1", "admin.collections.manage", "entry");
  const authorize = bindRealAuthorize(authDeps);

  const entryRepo = fakeExistingEntryRepo(entry());
  const contentTypeRepo = { findByKey: async () => activeContentType() };

  const result = await updateEntry({
    deps: { entryRepo, contentTypeRepo, clock, authorize, outbox },
    input: { workspaceId: WORKSPACE, actorId: "scoped1", id: "entry-1", title: "Updated", expectedVersion: 1 },
  });

  assert.equal(result.ok, true, "an entry-scoped grant must be sufficient to update an entry, same as the HTTP route's own pre-check already allows");
});

test("publishEntry/unpublishEntry: a principal holding ONLY an entry-scoped admin.collections.manage grant is allowed to transition status", async () => {
  for (const action of [publishEntry, unpublishEntry]) {
    const authDeps = buildAuthDeps();
    await seedPrincipal(authDeps, "scoped1");
    await grantScoped(authDeps, "scoped1", "admin.collections.manage", "entry");
    const authorize = bindRealAuthorize(authDeps);

    const seed = action === publishEntry ? entry({ status: "draft" }) : entry({ status: "published" });
    const entryRepo = fakeExistingEntryRepo(seed);
    const contentTypeRepo = { findByKey: async () => activeContentType() };

    const result = await action({
      deps: { entryRepo, contentTypeRepo, clock, authorize, outbox },
      input: { workspaceId: WORKSPACE, actorId: "scoped1", id: "entry-1", expectedVersion: 1 },
    });

    assert.equal(result.ok, true, `${action.name}: an entry-scoped grant must be sufficient, same as the HTTP route's own pre-check already allows`);
  }
});

test("negative control: a principal holding ONLY a post-scoped grant is still denied writing an entry (proves the fix does not simply drop the scope check)", async () => {
  const authDeps = buildAuthDeps();
  await seedPrincipal(authDeps, "scoped-wrong");
  await grantScoped(authDeps, "scoped-wrong", "admin.collections.manage", "post");
  const authorize = bindRealAuthorize(authDeps);

  const entryRepo = fakeCreateEntryRepo();
  const contentTypeRepo = { findByKey: async () => activeContentType() };

  const result = await createEntry({
    deps: { entryRepo, contentTypeRepo, clock, ids, authorize, outbox },
    input: { workspaceId: WORKSPACE, actorId: "scoped-wrong", type: "recipe", slug: "chili", title: "Chili", fieldsJson: { ext: { site: {} } } },
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.error instanceof ForbiddenError, "a grant scoped to a different resourceType must still be denied");
});
