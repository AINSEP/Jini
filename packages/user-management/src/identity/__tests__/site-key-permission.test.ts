import { assertVersionedWrite } from "@jini-ai/core/optimistic-concurrency";
import assert from "node:assert/strict";
import { test } from "vitest";

import { InMemoryPolicyPermissionRepo, InMemoryPolicyRepo, InMemoryPrincipalPolicyRepo, InMemoryPrincipalRepo, InMemoryPrincipalRoleRepo, InMemoryRolePolicyRepo, InMemoryRoleRepo, InMemorySessionRepo, InMemoryUserRepo, authorize, createTransactionalInMemoryIdentityRepos, migrateDeprecatedPermissionGrants, seedIdentity } from "../../server/index.js";
import type { IdentityRepos } from "../../core/index.js";

import { applyBuiltinRoleGrants } from "../builtin-role-grants.js";
import { createPermissionGrantRegistry } from "../permission-grants.js";
import { registerSiteKeyPermissionGrants, SITE_KEY_MANAGE_PERMISSION } from "../site-key-permission.js";

// A registry holding only this module's grants: deleting `registerSiteKeyPermissionGrants` breaks this
// import rather than letting the tests below pass vacuously with nothing registered. The host's real
// registry (and its own site-key env var name) is pinned in the host's test.
const FIXTURE_SITE_KEY = "FIXTURE_SITE_KEY";
const APP_PERMISSION_GRANTS = createPermissionGrantRegistry({});
registerSiteKeyPermissionGrants({ registry: APP_PERMISSION_GRANTS, siteKeyName: FIXTURE_SITE_KEY });

/**
 * @file `admin.security.site-key.manage` is a REAL permission, and `editor`/`viewer` do not hold it.
 *
 * Same shape as `features/pages/__tests__/edit-html-permission.test.ts` (see that file's own
 * header for the full "why the whole chain is real" reasoning this mirrors) — the interesting
 * failure mode is not "does `authorize()` work", it is "does the permission row actually reach the
 * admin role, in a workspace seeded the way every real install is seeded", which spans
 * `seedIdentity`'s built-in grants, `migrateDeprecatedPermissionGrants`' fan-out, and
 * `applyBuiltinRoleGrants`' direct backfill — all three real here, over real in-memory adapters.
 *
 * Two vintages, same reasoning as `edit-html-permission.test.ts`'s `Vintage`: `"fresh"` is a
 * workspace whose admin policy holds `admin.integrations.manage` (current
 * `BUILTIN_ADMIN_PERMISSIONS`); `"pre-integrations-manage"` simulates a workspace seeded before
 * that permission existed, where the `admin.integrations.manage -> admin.security.site-key.manage`
 * migration's `from` row is absent and only the direct built-in-role grant reaches admin.
 */

const SITE_KEY_MANAGE = "admin.security.site-key.manage";
const INTEGRATIONS_MANAGE = "admin.integrations.manage";
const WORKSPACE = "ws-site-key-privilege";
const clock = { nowIso: () => "2026-09-09T00:00:00.000Z", nowMs: () => Date.parse("2026-09-09T00:00:00.000Z") };

function counterIdGen(prefix: string) {
  let n = 0;
  return { newId: () => `${prefix}-${++n}` };
}

const fakeHasher = {
  hash: async ({ password }: { password: string }) => `hashed:${password}`,
  verify: async ({ hash, password }: { hash: string; password: string }) => hash === `hashed:${password}`,
};

interface Chain {
  readonly repos: IdentityRepos;
  readonly principals: Record<"owner" | "admin" | "editor" | "viewer", string>;
  can(principalId: string, permission: string): Promise<{ allowed: boolean; reason: string }>;
}

type Vintage = "fresh" | "pre-integrations-manage";

async function buildChain(vintage: Vintage = "fresh"): Promise<Chain> {
  const repos: IdentityRepos = createTransactionalInMemoryIdentityRepos({ repos: {
    principals: new InMemoryPrincipalRepo({}),
    users: new InMemoryUserRepo({ assertVersionedWrite }),
    sessions: new InMemorySessionRepo({}),
    roles: new InMemoryRoleRepo({ assertVersionedWrite }),
    policies: new InMemoryPolicyRepo({ assertVersionedWrite }),
    policyPermissions: new InMemoryPolicyPermissionRepo({}),
    rolePolicies: new InMemoryRolePolicyRepo({}),
    principalRoles: new InMemoryPrincipalRoleRepo({}),
    principalPolicies: new InMemoryPrincipalPolicyRepo({}),
  } });
  const idGen = counterIdGen("seed");

  await seedIdentity({ deps: { repos, hasher: fakeHasher, clock, idGen }, input: { workspaceId: WORKSPACE, ownerUsername: "owner-under-test", ownerPassword: "irrelevant" } });

  if (vintage === "pre-integrations-manage") await dropAdminIntegrationsManage(repos);

  await migrateDeprecatedPermissionGrants({ migrations: APP_PERMISSION_GRANTS.migrations.list({}), transactions: repos.transactions,
    policyPermissions: repos.policyPermissions,
    policies: repos.policies,
    idGen: counterIdGen("mig"),
    workspaceId: WORKSPACE,
  });

  await applyBuiltinRoleGrants({
    grants: APP_PERMISSION_GRANTS.roleGrants.list({}),
    roles: repos.roles,
    rolePolicies: repos.rolePolicies,
    policies: repos.policies,
    policyPermissions: repos.policyPermissions,
    idGen: counterIdGen("backfill"),
    workspaceId: WORKSPACE,
  });

  const roles = await repos.roles.list({ workspaceId: WORKSPACE });
  const principals = {} as Chain["principals"];
  for (const name of ["owner", "admin", "editor", "viewer"] as const) {
    const role = roles.find((row) => row.name === name);
    assert.ok(role, `the built-in '${name}' role must exist after seeding`);

    const principalId = `principal-${name}`;
    await repos.principals.save({ id: principalId, workspaceId: WORKSPACE, kind: "user", displayName: name, status: "active", createdAt: clock.nowIso() });
    await repos.principalRoles.save({ id: `pr-${name}`, workspaceId: WORKSPACE, principalId, roleId: role.id });
    principals[name] = principalId;
  }

  const can = (principalId: string, permission: string) =>
    authorize({ deps: {
        principals: repos.principals,
        principalRoles: repos.principalRoles,
        rolePolicies: repos.rolePolicies,
        principalPolicies: repos.principalPolicies,
        policyPermissions: repos.policyPermissions,
      }, principalId, permission, context: { workspaceId: WORKSPACE } }, { entityType: "site-key" });

  return { repos, principals, can };
}

/** Rewind the seeded `admin` policy to a pre-`admin.integrations.manage` vintage, same technique
 *  `edit-html-permission.test.ts`'s `dropAdminThemeEdit` uses for its own anchor permission. */
async function dropAdminIntegrationsManage(repos: IdentityRepos): Promise<void> {
  const policy = await repos.policies.findByName({ workspaceId: WORKSPACE, name: "admin-builtin-policy" });
  assert.ok(policy, "seedIdentity must have created the built-in admin policy");

  const grants = await repos.policyPermissions.listByPolicyId({ workspaceId: WORKSPACE, policyId: policy.id });
  const anchor = grants.find((row) => row.permission === INTEGRATIONS_MANAGE);
  assert.ok(anchor, "the current admin seed list must still contain admin.integrations.manage for this rewind to mean anything");

  await repos.policyPermissions.delete({ workspaceId: WORKSPACE, id: anchor.id });
}

// ---------------------------------------------------------------------------
// The refusal — the primary certification.
// ---------------------------------------------------------------------------

test("an 'editor' principal does NOT hold admin.security.site-key.manage", async () => {
  const { principals, can } = await buildChain();
  const decision = await can(principals.editor, SITE_KEY_MANAGE);
  assert.equal(decision.allowed, false, "editor must not be able to view/generate the site key");
  assert.equal(decision.reason, "no_grant");
});

test("a 'viewer' principal does NOT hold admin.security.site-key.manage", async () => {
  const { principals, can } = await buildChain();
  const decision = await can(principals.viewer, SITE_KEY_MANAGE);
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "no_grant");
});

// ---------------------------------------------------------------------------
// The grant — present to prove the gate is a gate and not a wall.
// ---------------------------------------------------------------------------

test("an 'admin' principal in a freshly-seeded workspace holds admin.security.site-key.manage", async () => {
  const { principals, can } = await buildChain();
  const decision = await can(principals.admin, SITE_KEY_MANAGE);
  assert.equal(decision.allowed, true, "gating on a permission no role holds would break the feature instead of securing it");
  assert.equal(decision.reason, "matched");
});

test("the 'owner' principal is unaffected — it clears the gate on its '*' wildcard, not on a granted row", async () => {
  const { principals, can } = await buildChain();
  const decision = await can(principals.owner, SITE_KEY_MANAGE);
  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, "owner_wildcard");
});

// ---------------------------------------------------------------------------
// The vintage that actually ships: a workspace seeded before
// admin.integrations.manage existed. The migration's `from` row is absent
// there, so ONLY the direct built-in-role grant can reach admin.
// ---------------------------------------------------------------------------

test("an 'admin' principal in a pre-integrations-manage workspace ALSO holds admin.security.site-key.manage — the grant cannot depend on a seed row that workspace never got", async () => {
  const { principals, can } = await buildChain("pre-integrations-manage");
  const decision = await can(principals.admin, SITE_KEY_MANAGE);
  assert.equal(decision.allowed, true, "admin must hold this permission even in an already-seeded workspace missing the migration's anchor row");
  assert.equal(decision.reason, "matched");
});

test("that pre-integrations-manage backfill reaches ONLY admin — editor and viewer are still refused", async () => {
  const { principals, can } = await buildChain("pre-integrations-manage");

  const editorDecision = await can(principals.editor, SITE_KEY_MANAGE);
  assert.equal(editorDecision.allowed, false);
  assert.equal(editorDecision.reason, "no_grant");

  const viewerDecision = await can(principals.viewer, SITE_KEY_MANAGE);
  assert.equal(viewerDecision.allowed, false);
  assert.equal(viewerDecision.reason, "no_grant");
});

test("the pre-integrations-manage backfill is additive — it never invents an admin.integrations.manage row", async () => {
  const { repos } = await buildChain("pre-integrations-manage");

  const policy = await repos.policies.findByName({ workspaceId: WORKSPACE, name: "admin-builtin-policy" });
  assert.ok(policy);
  const held = (await repos.policyPermissions.listByPolicyId({ workspaceId: WORKSPACE, policyId: policy.id })).map((row) => row.permission);

  assert.ok(held.includes(SITE_KEY_MANAGE), "the one capability under discussion is granted");
  assert.ok(!held.includes(INTEGRATIONS_MANAGE), "restoring site key management must not also silently restore integration-connection management");
});

test("a custom policy holding only the integrations anchor inherits token management through migration", async () => {
  const { repos, can } = await buildChain();
  await repos.principals.save({ id: "custom-user", workspaceId: WORKSPACE, kind: "user", displayName: "Custom", status: "active", createdAt: clock.nowIso() });
  await repos.policies.save({ version: 1, id: "custom-policy", workspaceId: WORKSPACE, name: "custom-policy", isBuiltin: false, isFrozen: false });
  await repos.principalPolicies.save({ id: "custom-link", workspaceId: WORKSPACE, principalId: "custom-user", policyId: "custom-policy" });
  await repos.policyPermissions.save({ id: "custom-anchor", workspaceId: WORKSPACE, policyId: "custom-policy", permission: "admin.integrations.manage" });
  assert.equal((await can("custom-user", SITE_KEY_MANAGE)).allowed, false);
  await migrateDeprecatedPermissionGrants({ migrations: APP_PERMISSION_GRANTS.migrations.list({}), transactions: repos.transactions, policyPermissions: repos.policyPermissions, policies: repos.policies, idGen: counterIdGen("custom-mig"), workspaceId: WORKSPACE });
  assert.deepEqual(await can("custom-user", SITE_KEY_MANAGE), { allowed: true, reason: "matched" });
});

test("C2: a custom policy holding only the former site-key permission keeps access after migration, without broader grants", async () => {
  const { repos, can } = await buildChain();
  const oldPermission = "admin.security.tokens.manage";
  const newPermission = "admin.security.site-key.manage";
  await repos.principals.save({ id: "legacy-key-user", workspaceId: WORKSPACE, kind: "user", displayName: "Key manager", status: "active", createdAt: clock.nowIso() });
  await repos.policies.save({ version: 1, id: "legacy-key-policy", workspaceId: WORKSPACE, name: "legacy-key-policy", isBuiltin: false, isFrozen: false });
  await repos.principalPolicies.save({ id: "legacy-key-link", workspaceId: WORKSPACE, principalId: "legacy-key-user", policyId: "legacy-key-policy" });
  await repos.policyPermissions.save({ id: "legacy-key-grant", workspaceId: WORKSPACE, policyId: "legacy-key-policy", permission: oldPermission });
  assert.deepEqual(await can("legacy-key-user", newPermission), { allowed: false, reason: "no_grant" });
  const migrate = () => migrateDeprecatedPermissionGrants({ migrations: APP_PERMISSION_GRANTS.migrations.list({}), transactions: repos.transactions, policyPermissions: repos.policyPermissions, policies: repos.policies, idGen: counterIdGen("legacy-key-mig"), workspaceId: WORKSPACE });
  await migrate();
  await migrate(); // Every boot is additive and idempotent.
  assert.deepEqual(await can("legacy-key-user", newPermission), { allowed: true, reason: "matched" });
  const grants = await repos.policyPermissions.listByPolicyId({ workspaceId: WORKSPACE, policyId: "legacy-key-policy" });
  assert.deepEqual(grants.map(row => row.permission).sort(), [oldPermission, newPermission].sort());
  assert.equal((await can("legacy-key-user", INTEGRATIONS_MANAGE)).allowed, false);
});

test("K3: the migration reason names the host's injected site key, never a product default", () => {
  const migration = APP_PERMISSION_GRANTS.migrations.list({}).find((row) => row.from === INTEGRATIONS_MANAGE && row.to.includes(SITE_KEY_MANAGE));
  assert.equal(SITE_KEY_MANAGE_PERMISSION, SITE_KEY_MANAGE);
  assert.equal(migration?.reason,
    "The admin Security page's Site key tab reads/generates the FIXTURE_SITE_KEY " +
    "site key — the key that decrypts every sealed credential this install holds, including " +
    "every connection admin.integrations.manage already protects. Every principal already " +
    "trusted with integration connection config inherits site key management too.");
});
