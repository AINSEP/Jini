import assert from "node:assert/strict";
import { test } from "vitest";

import { InMemoryPolicyPermissionRepo, InMemoryPolicyRepo, InMemoryRolePolicyRepo, InMemoryRoleRepo } from "../../server/index.js";

import {
  applyBuiltinRoleGrants,
  createBuiltinRoleGrantRegistry,
  type BuiltinRoleGrantRegistry,
} from "../builtin-role-grants.js";

/**
 * @file The built-in-role grant mechanism itself, isolated from the Pages permission that uses it.
 *
 * `edit-html-permission.test.ts` and `wiring.test.ts` certify the effect end-to-end. This file
 * certifies the mechanism's own contract, and specifically the two properties a caller relies on
 * without being able to see them: that a grant reaches ONE policy (so a sibling built-in role
 * cannot be widened by accident), and that it is additive-only (so a rerun on every boot is safe).
 *
 * Each test creates its own registry and registers its own pairs rather than reading the real ones;
 * there is no module-scope registry for one test's registrations to leak into another's.
 */

const WORKSPACE = "ws-builtin-role-grants";

function counterIdGen(prefix: string) {
  let n = 0;
  return { newId: () => `${prefix}-${++n}` };
}

interface Fixture {
  roles: InMemoryRoleRepo;
  rolePolicies: InMemoryRolePolicyRepo;
  policies: InMemoryPolicyRepo;
  policyPermissions: InMemoryPolicyPermissionRepo;
}

/** Build one role bound 1:1 to one policy, shaped exactly as `seedIdentity` builds a built-in pair. */
async function seedRoleWithPolicy(
  fixture: Fixture,
  required: { role: string; roleIsBuiltin?: boolean; policyIsBuiltin?: boolean; permissions?: string[] }
): Promise<{ roleId: string; policyId: string }> {
  const roleId = `role-${required.role}`;
  const policyId = `policy-${required.role}`;

  await fixture.roles.save({
    id: roleId,
    workspaceId: WORKSPACE,
    name: required.role,
    isBuiltin: required.roleIsBuiltin ?? true,
  });
  await fixture.policies.save({
    id: policyId,
    workspaceId: WORKSPACE,
    name: `${required.role}-builtin-policy`,
    isBuiltin: required.policyIsBuiltin ?? true,
    isFrozen: false,
  });
  await fixture.rolePolicies.save({ id: `rp-${required.role}`, workspaceId: WORKSPACE, roleId, policyId });

  for (const [index, permission] of (required.permissions ?? []).entries()) {
    await fixture.policyPermissions.save({
      id: `${policyId}-perm-${index}`,
      workspaceId: WORKSPACE,
      policyId,
      permission,
      resourceType: null,
      constraintJson: null,
    });
  }

  return { roleId, policyId };
}

function newFixture(): Fixture {
  return {
    roles: new InMemoryRoleRepo({}),
    rolePolicies: new InMemoryRolePolicyRepo({}),
    policies: new InMemoryPolicyRepo({}),
    policyPermissions: new InMemoryPolicyPermissionRepo({}),
  };
}

const apply = (fixture: Fixture, prefix: string, registry: BuiltinRoleGrantRegistry) =>
  applyBuiltinRoleGrants({
    grants: registry.list({}),
    roles: fixture.roles,
    rolePolicies: fixture.rolePolicies,
    policies: fixture.policies,
    policyPermissions: fixture.policyPermissions,
    idGen: counterIdGen(prefix),
    workspaceId: WORKSPACE,
  });

const permissionsOf = async (fixture: Fixture, policyId: string) =>
  (await fixture.policyPermissions.listByPolicyId({ workspaceId: WORKSPACE, policyId })).map(
    (row) => row.permission
  );

test("registry.register is idempotent per {role, permission} — re-registering overwrites rather than duplicating", () => {
  const registry = createBuiltinRoleGrantRegistry({});
  registry.register({ role: "admin", permission: "test.dup", reason: "first" });
  registry.register({ role: "admin", permission: "test.dup", reason: "second" });

  const matching = registry.list({}).filter((g) => g.role === "admin" && g.permission === "test.dup");
  assert.equal(matching.length, 1);
  assert.equal(matching[0]?.reason, "second", "the later registration wins, matching PermissionCatalog.register");
});

/**
 * The property the Pages gate depends on. `editor` and `viewer` are refused `pages.edit_html`
 * because the grant is written onto ONE policy — not because of a filter or an ordering that a
 * later edit could weaken.
 */
test("a grant reaches only the named role's own built-in policy — a sibling built-in role is untouched", async () => {
  const registry = createBuiltinRoleGrantRegistry({});
  const fixture = newFixture();
  const admin = await seedRoleWithPolicy(fixture, { role: "admin-isolated", permissions: ["content.write"] });
  const editor = await seedRoleWithPolicy(fixture, { role: "editor-isolated", permissions: ["content.write"] });

  registry.register({ role: "admin-isolated", permission: "test.isolated", reason: "certifies isolation" });
  const result = await apply(fixture, "grant", registry);

  assert.equal(result.grantedCount, 1, "exactly one row written");
  assert.ok((await permissionsOf(fixture, admin.policyId)).includes("test.isolated"));
  assert.ok(
    !(await permissionsOf(fixture, editor.policyId)).includes("test.isolated"),
    "the sibling role's policy must not gain the permission"
  );
});

test("a grant is additive — the policy's existing permissions all survive it", async () => {
  const registry = createBuiltinRoleGrantRegistry({});
  const fixture = newFixture();
  const admin = await seedRoleWithPolicy(fixture, {
    role: "admin-additive",
    permissions: ["content.write", "media.read"],
  });

  registry.register({ role: "admin-additive", permission: "test.additive", reason: "certifies additivity" });
  await apply(fixture, "grant", registry);

  assert.deepEqual((await permissionsOf(fixture, admin.policyId)).sort(), [
    "content.write",
    "media.read",
    "test.additive",
  ]);
});

test("re-running is a no-op — grantedCount is 0 and no duplicate row is appended", async () => {
  const registry = createBuiltinRoleGrantRegistry({});
  const fixture = newFixture();
  const admin = await seedRoleWithPolicy(fixture, { role: "admin-rerun" });

  registry.register({ role: "admin-rerun", permission: "test.rerun", reason: "certifies idempotence" });
  const first = await apply(fixture, "first", registry);
  const second = await apply(fixture, "second", registry);

  assert.equal(first.grantedCount, 1);
  assert.equal(second.grantedCount, 0, "a boot with nothing to add must write nothing");
  assert.deepEqual(await permissionsOf(fixture, admin.policyId), ["test.rerun"]);
});

test("a registration whose role does not exist in this workspace is skipped, not an error", async () => {
  const registry = createBuiltinRoleGrantRegistry({});
  const fixture = newFixture();

  registry.register({ role: "role-that-does-not-exist", permission: "test.absent", reason: "certifies skip" });
  const result = await apply(fixture, "grant", registry);

  assert.equal(result.grantedCount, 0);
});

test("a NON-built-in role sharing a built-in's name is skipped — a registration names the seeded role, not any role", async () => {
  const registry = createBuiltinRoleGrantRegistry({});
  const fixture = newFixture();
  const impostor = await seedRoleWithPolicy(fixture, { role: "admin-impostor", roleIsBuiltin: false });

  registry.register({ role: "admin-impostor", permission: "test.impostor", reason: "certifies builtin check" });
  const result = await apply(fixture, "grant", registry);

  assert.equal(result.grantedCount, 0);
  assert.deepEqual(await permissionsOf(fixture, impostor.policyId), []);
});

test("a non-built-in policy attached to a built-in role is skipped — operator attachments are not the library's to reconcile", async () => {
  const registry = createBuiltinRoleGrantRegistry({});
  const fixture = newFixture();
  const role = await seedRoleWithPolicy(fixture, { role: "admin-attached" });

  await fixture.policies.save({
    id: "policy-operator-made",
    workspaceId: WORKSPACE,
    name: "operator-made-policy",
    isBuiltin: false,
    isFrozen: false,
  });
  await fixture.rolePolicies.save({
    id: "rp-operator-made",
    workspaceId: WORKSPACE,
    roleId: role.roleId,
    policyId: "policy-operator-made",
  });

  registry.register({ role: "admin-attached", permission: "test.attached", reason: "certifies builtin-policy check" });
  const result = await apply(fixture, "grant", registry);

  assert.equal(result.grantedCount, 1, "only the role's own built-in policy is written");
  assert.deepEqual(await permissionsOf(fixture, role.policyId), ["test.attached"]);
  assert.deepEqual(await permissionsOf(fixture, "policy-operator-made"), []);
});

test("a granted row is unscoped — resourceType and constraintJson are null, matching every seeded built-in grant", async () => {
  const registry = createBuiltinRoleGrantRegistry({});
  const fixture = newFixture();
  const admin = await seedRoleWithPolicy(fixture, { role: "admin-unscoped" });

  registry.register({ role: "admin-unscoped", permission: "test.unscoped", reason: "certifies row shape" });
  await apply(fixture, "grant", registry);

  const [row] = await fixture.policyPermissions.listByPolicyId({
    workspaceId: WORKSPACE,
    policyId: admin.policyId,
  });
  assert.ok(row);
  // A non-null resourceType would make the row match only one entityType, turning a missing grant
  // into a subtler one that only some call sites see.
  assert.equal(row.resourceType, null);
  assert.equal(row.constraintJson, null);
});

test("registries are independent — a grant registered on one is never listed by another", () => {
  const first = createBuiltinRoleGrantRegistry({});
  const second = createBuiltinRoleGrantRegistry({});
  first.register({ role: "admin", permission: "test.first-only", reason: "isolation" });

  assert.deepEqual(second.list({}), []);
  assert.deepEqual(createBuiltinRoleGrantRegistry({}, { grants: first.list({}) }).list({}), first.list({}));
});

test("an empty registry created with default arguments reconciles without altering existing permissions", async () => {
  const registry = createBuiltinRoleGrantRegistry();
  const fixture = newFixture();
  const role = await seedRoleWithPolicy(fixture, { role: "empty", permissions: ["content.read"] });
  assert.deepEqual(registry.list({}), []);
  assert.deepEqual(await apply(fixture, "empty", registry), { grantedCount: 0 });
  assert.deepEqual(await permissionsOf(fixture, role.policyId), ["content.read"]);
});

test("a dangling policy binding is skipped while a valid built-in binding still receives its grant", async () => {
  const fixture = newFixture();
  const role = await seedRoleWithPolicy(fixture, { role: "dangling" });
  await fixture.rolePolicies.save({ id: "dangling-binding", workspaceId: WORKSPACE,
    roleId: role.roleId, policyId: "deleted-policy" });
  const registry = createBuiltinRoleGrantRegistry({}, { grants: [
    { role: "dangling", permission: "test.dangling", reason: "skip a removed policy" },
  ] });
  assert.deepEqual(await apply(fixture, "grant", registry), { grantedCount: 1 });
  assert.deepEqual(await permissionsOf(fixture, role.policyId), ["test.dangling"]);
  assert.deepEqual(await permissionsOf(fixture, "deleted-policy"), []);
});

test("a built-in role with no policy bindings receives no permission rows", async () => {
  const fixture = newFixture();
  await fixture.roles.save({ id: "unbound", workspaceId: WORKSPACE, name: "unbound", isBuiltin: true });
  const registry = createBuiltinRoleGrantRegistry({}, { grants: [
    { role: "unbound", permission: "test.unbound", reason: "no implicit policy creation" },
  ] });
  assert.deepEqual(await apply(fixture, "grant", registry), { grantedCount: 0 });
  assert.deepEqual(await fixture.rolePolicies.listByRoleId({ workspaceId: WORKSPACE, roleId: "unbound" }), []);
});
