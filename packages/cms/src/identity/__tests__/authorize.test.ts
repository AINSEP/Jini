import assert from "node:assert/strict";
import { test } from "vitest";

import { authorize, resolveEffectivePermissions } from "../authorize.js";
import {
  InMemoryPolicyPermissionRepo,
  InMemoryPrincipalPolicyRepo,
  InMemoryPrincipalRepo,
  InMemoryPrincipalRoleRepo,
  InMemoryRolePolicyRepo,
} from "../repo.memory.js";
import type { AuthorizeDeps } from "../authorize.js";

/**
 * @file `authorize()` matcher precedence (behavior.spec §1.1, REQ-04, ADR-021 §8).
 *
 * Certifies, in isolation, each rule in precedence order: disabled short-
 * circuit > owner wildcard > exact matching row > fail-closed default — plus
 * the fail-closed extensibility seam (AC-09/AC-14/EC-04/EC-06) and the direct
 * `principal_policies` grant path (behavior.spec §1.2, AC-13-style).
 */

const WORKSPACE = "workspace-1";

function buildDeps(): AuthorizeDeps {
  return {
    principals: new InMemoryPrincipalRepo(),
    principalRoles: new InMemoryPrincipalRoleRepo(),
    rolePolicies: new InMemoryRolePolicyRepo(),
    principalPolicies: new InMemoryPrincipalPolicyRepo(),
    policyPermissions: new InMemoryPolicyPermissionRepo(),
  };
}

async function seedPrincipal(
  deps: AuthorizeDeps,
  overrides: { id: string; status?: "active" | "disabled" }
): Promise<void> {
  await deps.principals.save({
    id: overrides.id,
    workspaceId: WORKSPACE,
    kind: "user",
    displayName: overrides.id,
    status: overrides.status ?? "active",
    createdAt: "2026-01-01T00:00:00.000Z",
  });
}

/** Attach a permission directly to a principal via a fresh policy (skips roles). */
async function grantDirect(
  deps: AuthorizeDeps,
  principalId: string,
  permission: string,
  scope: { resourceType?: string | null; constraintJson?: string | null } = {}
): Promise<void> {
  const policyId = `policy-${principalId}-${permission}-${Math.random()}`;
  await deps.policyPermissions.save({
    id: `pp-${policyId}`,
    workspaceId: WORKSPACE,
    policyId,
    permission,
    resourceType: scope.resourceType ?? null,
    constraintJson: scope.constraintJson ?? null,
  });
  await deps.principalPolicies.save({
    id: `link-${policyId}`,
    workspaceId: WORKSPACE,
    principalId,
    policyId,
  });
}

test("rule 1: a disabled principal is denied regardless of an otherwise-matching grant", async () => {
  const deps = buildDeps();
  await seedPrincipal(deps, { id: "p1", status: "disabled" });
  await grantDirect(deps, "p1", "content.write");

  const result = await authorize({
    deps,
    principalId: "p1",
    permission: "content.write",
    context: { workspaceId: WORKSPACE },
  });

  assert.deepEqual(result, { allowed: false, reason: "principal_disabled" });
});

test("rule 2: an unconstrained owner '*' row allows any requested permission", async () => {
  const deps = buildDeps();
  await seedPrincipal(deps, { id: "owner1" });
  await grantDirect(deps, "owner1", "*");

  const result = await authorize({
    deps,
    principalId: "owner1",
    permission: "role.manage",
    context: { workspaceId: WORKSPACE },
  });

  assert.deepEqual(result, { allowed: true, reason: "owner_wildcard" });
});

test("rule 3: an unscoped exact match allows", async () => {
  const deps = buildDeps();
  await seedPrincipal(deps, { id: "editor1" });
  await grantDirect(deps, "editor1", "content.write");

  const result = await authorize({
    deps,
    principalId: "editor1",
    permission: "content.write",
    context: { workspaceId: WORKSPACE },
  });

  assert.deepEqual(result, { allowed: true, reason: "matched" });
});

test("AC-14/EC-06: a resource-scoped row matches the same entityType and denies a mismatched or missing one", async () => {
  const deps = buildDeps();
  await seedPrincipal(deps, { id: "scoped1" });
  await grantDirect(deps, "scoped1", "content.write", { resourceType: "post" });

  const matching = await authorize({
    deps,
    principalId: "scoped1",
    permission: "content.write",
    context: { workspaceId: WORKSPACE, entityType: "post" },
  });
  assert.deepEqual(matching, { allowed: true, reason: "matched" });

  const mismatched = await authorize({
    deps,
    principalId: "scoped1",
    permission: "content.write",
    context: { workspaceId: WORKSPACE, entityType: "page" },
  });
  assert.deepEqual(mismatched, { allowed: false, reason: "resource_scope_mismatch" });

  const missingEntityType = await authorize({
    deps,
    principalId: "scoped1",
    permission: "content.write",
    context: { workspaceId: WORKSPACE },
  });
  assert.deepEqual(missingEntityType, { allowed: false, reason: "resource_scope_mismatch" });
});

test("AC-09: a non-null constraint_json is never treated as unconstrained (fail-closed deny)", async () => {
  const deps = buildDeps();
  await seedPrincipal(deps, { id: "constrained1" });
  await grantDirect(deps, "constrained1", "content.write", { constraintJson: '{"field":"title"}' });

  const result = await authorize({
    deps,
    principalId: "constrained1",
    permission: "content.write",
    context: { workspaceId: WORKSPACE },
  });

  assert.deepEqual(result, { allowed: false, reason: "unconstrained_deny" });
});

test("EC-04: a permission in no held policy denies with no_grant", async () => {
  const deps = buildDeps();
  await seedPrincipal(deps, { id: "viewer1" });
  await grantDirect(deps, "viewer1", "content.read");

  const result = await authorize({
    deps,
    principalId: "viewer1",
    permission: "changeset.revert",
    context: { workspaceId: WORKSPACE },
  });

  assert.deepEqual(result, { allowed: false, reason: "no_grant" });
});

test("an unknown principal id fails closed (no_grant), never throws", async () => {
  const deps = buildDeps();

  const result = await authorize({
    deps,
    principalId: "ghost",
    permission: "content.write",
    context: { workspaceId: WORKSPACE },
  });

  assert.equal(result.allowed, false);
});

test("AC-13-style: a direct principal_policies grant works without any role, and doesn't imply management rights", async () => {
  const deps = buildDeps();
  await seedPrincipal(deps, { id: "keyPrincipal" });
  await grantDirect(deps, "keyPrincipal", "content.write");

  const writeAllowed = await authorize({
    deps,
    principalId: "keyPrincipal",
    permission: "content.write",
    context: { workspaceId: WORKSPACE },
  });
  assert.equal(writeAllowed.allowed, true);

  const roleManageDenied = await authorize({
    deps,
    principalId: "keyPrincipal",
    permission: "role.manage",
    context: { workspaceId: WORKSPACE },
  });
  assert.equal(roleManageDenied.allowed, false);

  const apikeyManageDenied = await authorize({
    deps,
    principalId: "keyPrincipal",
    permission: "apikey.manage",
    context: { workspaceId: WORKSPACE },
  });
  assert.equal(apikeyManageDenied.allowed, false);
});

test("resolveEffectivePermissions unions the role path and the direct-policy path", async () => {
  const deps = buildDeps();
  await seedPrincipal(deps, { id: "both1" });

  // Role path: principal -> role -> role_policies -> policy_permissions.
  await deps.policyPermissions.save({
    id: "pp-role",
    workspaceId: WORKSPACE,
    policyId: "policy-role",
    permission: "content.publish",
    resourceType: null,
    constraintJson: null,
  });
  await deps.rolePolicies.save({
    id: "rp-1",
    workspaceId: WORKSPACE,
    roleId: "role-1",
    policyId: "policy-role",
  });
  await deps.principalRoles.save({
    id: "pr-1",
    workspaceId: WORKSPACE,
    principalId: "both1",
    roleId: "role-1",
  });

  // Direct path.
  await grantDirect(deps, "both1", "media.write");

  const rows = await resolveEffectivePermissions({ deps, principalId: "both1", workspaceId: WORKSPACE });
  const permissions = rows.map((row) => row.permission).sort();
  assert.deepEqual(permissions, ["content.publish", "media.write"]);
});

test("a workspace boundary is respected: a grant in another workspace never matches", async () => {
  const deps = buildDeps();
  await seedPrincipal(deps, { id: "cross1" });
  await deps.policyPermissions.save({
    id: "pp-cross",
    workspaceId: "workspace-other",
    policyId: "policy-cross",
    permission: "content.write",
    resourceType: null,
    constraintJson: null,
  });
  await deps.principalPolicies.save({
    id: "link-cross",
    workspaceId: "workspace-other",
    principalId: "cross1",
    policyId: "policy-cross",
  });

  const result = await authorize({
    deps,
    principalId: "cross1",
    permission: "content.write",
    context: { workspaceId: WORKSPACE },
  });

  assert.equal(result.allowed, false);
});
