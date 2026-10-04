// PARITY: moved contracts preserve input refusals, independent risk gates and handler authorization.
import { NodeSessionTokens } from "../session-tokens.js";
import { createTransactionalInMemoryIdentityRepos } from "../repo.memory-transactions.js";
import assert from "node:assert/strict";
import { test } from "vitest";
import type { ToolExecutionContext, ToolRegistration } from "@jini-ai/core";
import { IdentityForbiddenError, GrantExceedsIssuerError, OwnerRequiredError, type IdentityRepos } from "../../core/index.js";
import {
  identityAgentToolCatalog, Argon2PasswordHasher, loadArgon2Binding,
  InMemoryPolicyPermissionRepo, InMemoryPolicyRepo, InMemoryPrincipalPolicyRepo,
  InMemoryPrincipalRepo, InMemoryPrincipalRoleRepo, InMemoryRolePolicyRepo,
  InMemoryRoleRepo, InMemorySessionRepo, InMemoryUserRepo, seedIdentity,
} from "../index.js";
import { buildIdentityRegistrations, type IdentityToolDeps } from "../index.js";

// Ported model-facing contracts. Host dialogs and content-read projections are composed by hosts;
// this suite calls the user-management registrations directly with an explicit password in its fixture.
const SEED_OWNER_PASSWORD = "seed-owner-pw";
const WORKSPACE_ID = "workspace-tools";
const HASHER = new Argon2PasswordHasher({ loadBinding: loadArgon2Binding }, { memoryCost: 8, timeCost: 1, parallelism: 1 });
interface Harness { deps: IdentityToolDeps; repos: IdentityRepos; ownerPrincipalId: string }
function counterIdGen() {
  let n = 0;
  return { newId: () => `id-${++n}` };
}

async function buildHarness(): Promise<Harness> {
  const repos: IdentityRepos = createTransactionalInMemoryIdentityRepos({ repos: {
    principals: new InMemoryPrincipalRepo({}),
    users: new InMemoryUserRepo({}),
    sessions: new InMemorySessionRepo({}),
    roles: new InMemoryRoleRepo({}),
    policies: new InMemoryPolicyRepo({}),
    policyPermissions: new InMemoryPolicyPermissionRepo({}),
    rolePolicies: new InMemoryRolePolicyRepo({}),
    principalRoles: new InMemoryPrincipalRoleRepo({}),
    principalPolicies: new InMemoryPrincipalPolicyRepo({}),
  } });
  const idGen = counterIdGen();
  const clock = { nowMs: () => Date.parse("2026-07-29T00:00:00.000Z")};

  const { ownerPrincipalId } = await seedIdentity({
    deps: { repos, hasher: HASHER, clock, idGen },
    input: { workspaceId: WORKSPACE_ID, ownerUsername: "owner", ownerPassword: SEED_OWNER_PASSWORD },
  });

  const deps = {
    workspaceId: WORKSPACE_ID,
    transactions: repos.transactions,
    tokens: new NodeSessionTokens({}),
    clock,
    idGen,
    passwordHasher: HASHER,
    ownerPrincipalId: Promise.resolve(ownerPrincipalId),
    principalRepo: repos.principals,
    userRepo: repos.users,
    sessionRepo: repos.sessions,
    roleRepo: repos.roles,
    policyRepo: repos.policies,
    policyPermissionRepo: repos.policyPermissions,
    rolePolicyRepo: repos.rolePolicies,
    principalRoleRepo: repos.principalRoles,
    principalPolicyRepo: repos.principalPolicies,
  } satisfies IdentityToolDeps;

  return { deps, repos, ownerPrincipalId };
}


function identityRegistrations(deps: IdentityToolDeps): Map<string, ToolRegistration> {
  return new Map(buildIdentityRegistrations(deps).map((registration) => [registration.descriptor.id, registration]));
}
function wired(deps: IdentityToolDeps, toolId: string): ToolRegistration {
  const found = identityRegistrations(deps).get(toolId);
  assert.ok(found, `expected '${toolId}' to be wired`);
  return found;
}
function asOwner(ownerPrincipalId: string, input: Record<string, unknown>): ToolExecutionContext {
  const directInput = typeof input.username === "string" && !("password" in input)
    ? { ...input, password: "pw-valid-1234" } : input;
  return { executionId: "exec-1", principal: { id: ownerPrincipalId }, run: { id: "run-1" },
    input: directInput, signal: new AbortController().signal };
}
test("requiresConfirmation is unset on every identity tool — setting it with no ExecutionDelegate would park the execution forever", async () => {
  const { deps } = await buildHarness();

  for (const [id, registration] of identityRegistrations(deps)) {
    assert.equal(registration.descriptor.requiresConfirmation, undefined, `${id} must not request confirmation until a transport exists`);
  }
});

test("a rejected input returns the tool's own schema plus an explicit non-retryable instruction, so the model can correct in one turn", async () => {
  const { deps, ownerPrincipalId } = await buildHarness();

  const error = await wired(deps, "identity_role_assign")
    .handler(asOwner(ownerPrincipalId, { principalId: "p-1" }))
    .then(() => null, (e: unknown) => e as Error);

  assert.ok(error, "a missing required key must reject");
  assert.match(error.message, /'roleId' is required/);
  assert.match(error.message, /will not resolve on retry without an input change/);
  assert.match(error.message, /"additionalProperties":false/, "the published schema must travel with the failure");
  assert.match(error.message, /"roleId"/, "the schema in the message must actually describe the key that failed");
});

test("the schema-bearing rejection names each tool's OWN schema, not a shared one", async () => {
  const { deps, ownerPrincipalId } = await buildHarness();

  const error = await wired(deps, "identity_user_create")
    .handler(asOwner(ownerPrincipalId, {}))
    .then(() => null, (e: unknown) => e as Error);

  assert.ok(error);
  assert.match(error.message, /'username' is required/);
  assert.match(error.message, /"username"/);
  assert.equal(/roleId/.test(error.message), false, "identity_user_create's schema must not mention another tool's keys");
});

test("no rejection message echoes the offending value — a username or email is operator content", async () => {
  const { deps, ownerPrincipalId } = await buildHarness();
  const secret = "s3cret-operator-content";

  const error = await wired(deps, "identity_user_create")
    .handler(asOwner(ownerPrincipalId, { username: secret, email: 7 }))
    .then(() => null, (e: unknown) => e as Error);

  assert.ok(error);
  assert.equal(error.message.includes(secret), false, `message leaked the value: ${error.message}`);
});

test("an unrecognized key is reported rather than ignored — the published schemas are closed and the parser honors that", async () => {
  const { deps, ownerPrincipalId } = await buildHarness();

  const error = await wired(deps, "identity_role_create")
    .handler(asOwner(ownerPrincipalId, { name: "Editors", isBuiltin: true }))
    .then(() => null, (e: unknown) => e as Error);

  assert.ok(error, "silently dropping 'isBuiltin' would let a model believe it had set it");
  assert.match(error.message, /'isBuiltin' is not a recognized input key/);
});

// ---------------------------------------------------------------------------
// 2. Output projection — above all. See docs/decisions/DR-007-workspace-and-owner-floors.md.
// ---------------------------------------------------------------------------

/** Every tool that returns a user view, with input that reaches a real result. */
async function userReturningResults(harness: Harness): Promise<Array<{ toolId: string; payload: unknown }>> {
  const { deps, ownerPrincipalId } = harness;

  const created = (await wired(deps, "identity_user_create").handler(
    asOwner(ownerPrincipalId, { username: "projection-subject", email: "a@b.test" }),
  )) as { user: { principalId: string } };
  const principalId = created.user.principalId;

  return [
    { toolId: "identity_user_create", payload: created },
    { toolId: "identity_user_update_email", payload: await wired(deps, "identity_user_update_email").handler(asOwner(ownerPrincipalId, { principalId, email: "c@d.test" })) },
    { toolId: "identity_user_disable", payload: await wired(deps, "identity_user_disable").handler(asOwner(ownerPrincipalId, { principalId })) },
    { toolId: "identity_user_enable", payload: await wired(deps, "identity_user_enable").handler(asOwner(ownerPrincipalId, { principalId })) },
    { toolId: "identity_user_list", payload: await wired(deps, "identity_user_list").handler(asOwner(ownerPrincipalId, {})) },
  ];
}

test("INV-05: no identity tool result contains a password hash, on any path that returns a user", async () => {
  const harness = await buildHarness();

  const results = await userReturningResults(harness);
  const owner = await harness.repos.users.findByPrincipalId({ workspaceId: WORKSPACE_ID, principalId: harness.ownerPrincipalId });
  assert.ok(owner);
  const principals = (await harness.repos.principals.list({ workspaceId: WORKSPACE_ID })).filter((principal) => principal.kind === "user");
  const users = await Promise.all(principals.map((principal) => harness.repos.users.findByPrincipalId({ workspaceId: WORKSPACE_ID, principalId: principal.id })));
  for (const { toolId, payload } of results) {
    const serialized = JSON.stringify(payload);
    assert.equal(/passwordHash/i.test(serialized), false, `${toolId} leaked a passwordHash key`);
    // Check values too: renaming a credential key must not evade the projection contract.
    for (const user of users) {
      assert.ok(user, "every seeded human must have a credential row for the hash-leak check");
      assert.equal(serialized.includes(user.passwordHash), false, `${toolId} leaked ${user.username}'s hash value`);
    }
    assert.equal(serialized.includes("pw-valid-1234"), false, `${toolId} leaked the human-typed password`);
  }
});

test("a user view drops workspaceId — the agent is already scoped to one workspace it cannot change", async () => {
  const harness = await buildHarness();

  for (const { toolId, payload } of await userReturningResults(harness)) {
    assert.equal(/workspaceId/.test(JSON.stringify(payload)), false, `${toolId} echoed the workspaceId back to the model`);
  }
});

test("a user view carries exactly the keys the model needs, and email only when set", async () => {
  const { deps, ownerPrincipalId } = await buildHarness();

  const withoutEmail = (await wired(deps, "identity_user_create").handler(asOwner(ownerPrincipalId, { username: "no-email" }))) as {
    user: Record<string, unknown>;
  };
  assert.deepEqual(Object.keys(withoutEmail.user).sort(), ["principalId", "roleIds", "status", "username"]);
  assert.equal("email" in withoutEmail.user, false, "a user without an email must carry no always-undefined key");

  const withEmail = (await wired(deps, "identity_user_create").handler(asOwner(ownerPrincipalId, { username: "with-email", email: "a@b.test" }))) as {
    user: Record<string, unknown>;
  };
  assert.equal(withEmail.user.email, "a@b.test");
  assert.equal(withEmail.user.status, "active");
  assert.deepEqual(withEmail.user.roleIds, [], "a newly created user holds no roles, which is what makes create-then-assign the required order");
});

test("a role view exposes isBuiltin — the flag that predicts whether rename/delete will be refused", async () => {
  const { deps, ownerPrincipalId } = await buildHarness();

  const { roles } = (await wired(deps, "identity_role_list").handler(asOwner(ownerPrincipalId, {}))) as {
    roles: Array<Record<string, unknown>>;
  };

  assert.ok(roles.length >= 4, "the seed provides four built-in roles");
  for (const role of roles) {
    assert.deepEqual(Object.keys(role).sort(), ["id", "isBuiltin", "name"]);
  }
  assert.equal(roles.every((role) => role.isBuiltin === true), true, "a freshly seeded workspace has only built-in roles");
});

test("a policy view carries exactly the keys the model needs, with description only when set — mirrors a role view's isBuiltin plus the second immutability flag policies alone carry", async () => {
  const { deps, ownerPrincipalId } = await buildHarness();

  const withoutDescription = (await wired(deps, "identity_policy_create").handler(asOwner(ownerPrincipalId, { name: "Bare Policy" }))) as {
    policy: Record<string, unknown>;
  };
  assert.deepEqual(Object.keys(withoutDescription.policy).sort(), ["id", "isBuiltin", "isFrozen", "name"]);
  assert.equal("description" in withoutDescription.policy, false, "a policy without a description must carry no always-undefined key");
  assert.equal(withoutDescription.policy.isBuiltin, false);
  assert.equal(withoutDescription.policy.isFrozen, false);

  const withDescription = (await wired(deps, "identity_policy_create").handler(asOwner(ownerPrincipalId, { name: "Described Policy", description: "for reviewers" }))) as {
    policy: Record<string, unknown>;
  };
  assert.equal(withDescription.policy.description, "for reviewers");
});

test("identity_policy_list surfaces the built-in seeded policies plus a freshly created custom one", async () => {
  const { deps, ownerPrincipalId } = await buildHarness();

  const before = (await wired(deps, "identity_policy_list").handler(asOwner(ownerPrincipalId, {}))) as {
    policies: Array<{ id: string; isBuiltin: boolean }>;
  };
  assert.ok(before.policies.length >= 4, "the seed provides at least four built-in policies");
  assert.equal(before.policies.every((policy) => policy.isBuiltin === true), true);

  const { policy: created } = (await wired(deps, "identity_policy_create").handler(asOwner(ownerPrincipalId, { name: "Custom" }))) as {
    policy: { id: string };
  };
  const after = (await wired(deps, "identity_policy_list").handler(asOwner(ownerPrincipalId, {}))) as {
    policies: Array<{ id: string; isBuiltin: boolean }>;
  };
  assert.ok(after.policies.some((policy) => policy.id === created.id && policy.isBuiltin === false));
});

test("identity_user_list caps its fan-out and SAYS so, rather than silently returning a partial roster", async () => {
  const { deps, repos, ownerPrincipalId } = await buildHarness();

  for (let i = 0; i < 205; i++) {
    await repos.principals.save({ id: `bulk-${i}`, workspaceId: WORKSPACE_ID, kind: "user", displayName: `bulk-${i}`, status: "active", createdAt: "2026-01-01T00:00:00.000Z" });
    await repos.users.save({ principalId: `bulk-${i}`, workspaceId: WORKSPACE_ID, username: `bulk-${i}`, passwordHash: "hash" });
  }

  const result = (await wired(deps, "identity_user_list").handler(asOwner(ownerPrincipalId, {}))) as {
    users: unknown[];
    truncated?: boolean;
    totalCount?: number;
  };

  assert.equal(result.users.length, 200, "the cap must actually bound the fan-out");
  assert.equal(result.truncated, true, "a truncated list that does not say so would be read as the complete roster");
  assert.ok((result.totalCount ?? 0) > 200, "the real total must be reported so the caller knows the size of what it did not get");
  const humans = (await repos.principals.list({ workspaceId: WORKSPACE_ID })).filter((principal) => principal.kind === "user");
  assert.equal(result.totalCount, humans.length, "the total must equal the complete seeded human roster");
});

test("an untruncated list carries no truncated/totalCount keys — the signal means something only when it is present", async () => {
  const { deps, ownerPrincipalId } = await buildHarness();

  const result = (await wired(deps, "identity_user_list").handler(asOwner(ownerPrincipalId, {}))) as Record<string, unknown>;

  assert.deepEqual(Object.keys(result), ["users"]);
});

// ---------------------------------------------------------------------------
// 3. Risk metadata is cross-checked, not trusted
// ---------------------------------------------------------------------------
test("END TO END: create a user, assign it a role, and see the assignment show up in the user list", async () => {
  const { deps, ownerPrincipalId } = await buildHarness();

  // 1. The role the new user will get. A model would use identity_role_list to find a built-in;
  //    creating one here also proves the create-then-assign chain works for custom roles.
  const { role } = (await wired(deps, "identity_role_create").handler(asOwner(ownerPrincipalId, { name: "Content Editor" }))) as {
    role: { id: string; name: string };
  };
  assert.equal(role.name, "Content Editor");

  // 2. The user. It comes back with no roles, which is what forces step 3 to exist.
  const { user } = (await wired(deps, "identity_user_create").handler(asOwner(ownerPrincipalId, { username: "Ada", email: "ada@example.test" }))) as {
    user: { principalId: string; username: string; roleIds: string[] };
  };
  assert.equal(user.username, "ada", "the username is normalized by the domain, and the tool reports what was actually stored");
  assert.deepEqual(user.roleIds, []);

  // 3. The grant.
  const assigned = (await wired(deps, "identity_role_assign").handler(asOwner(ownerPrincipalId, { principalId: user.principalId, roleId: role.id }))) as {
    assigned: { principalId: string; roleId: string };
  };
  assert.deepEqual(assigned.assigned, { principalId: user.principalId, roleId: role.id });

  // 4. "Show up elsewhere" — the assignment is durable and visible through a DIFFERENT tool.
  const { users } = (await wired(deps, "identity_user_list").handler(asOwner(ownerPrincipalId, {}))) as {
    users: Array<{ principalId: string; username: string; roleIds: string[]; email?: string }>;
  };
  const listed = users.find((candidate) => candidate.principalId === user.principalId);
  assert.ok(listed, "the newly created user must appear in the roster");
  assert.deepEqual(listed.roleIds, [role.id], "the role assignment must be visible from the read tool, not just echoed by the write tool");
  assert.equal(listed.email, "ada@example.test");

  // 5. And the role itself is discoverable, which is how a model would have found it without step 1.
  const { roles } = (await wired(deps, "identity_role_list").handler(asOwner(ownerPrincipalId, {}))) as { roles: Array<{ id: string; name: string }> };
  assert.ok(roles.some((candidate) => candidate.id === role.id && candidate.name === "Content Editor"));
});

test("END TO END: create a policy, see it in the list, attach it to a user, and confirm the attachment is durable", async () => {
  const { deps, repos, ownerPrincipalId } = await buildHarness();

  // 1. The policy. Starts with no permissions — attaching it grants nothing yet, which is exactly
  //    what makes identity_policy_write_permission's absence from this catalog a real, not merely
  //    theoretical, limitation (see identity/agent-tools.ts's file header).
  const { policy } = (await wired(deps, "identity_policy_create").handler(asOwner(ownerPrincipalId, { name: "Reviewer Bundle", description: "read-only reviewers" }))) as {
    policy: { id: string; name: string };
  };
  assert.equal(policy.name, "Reviewer Bundle");

  // 2. It shows up through the read tool a model would use to discover it.
  const { policies } = (await wired(deps, "identity_policy_list").handler(asOwner(ownerPrincipalId, {}))) as {
    policies: Array<{ id: string; name: string }>;
  };
  assert.ok(policies.some((candidate) => candidate.id === policy.id && candidate.name === "Reviewer Bundle"));

  // 3. The user.
  const { user } = (await wired(deps, "identity_user_create").handler(asOwner(ownerPrincipalId, { username: "Reviewer" }))) as {
    user: { principalId: string };
  };

  // 4. The grant.
  const attached = (await wired(deps, "identity_policy_attach").handler(asOwner(ownerPrincipalId, { principalId: user.principalId, policyId: policy.id }))) as {
    attached: { principalId: string; policyId: string };
  };
  assert.deepEqual(attached.attached, { principalId: user.principalId, policyId: policy.id });

  // 5. "Durable" — the attachment is visible through the repo directly (there is no
  //    "policies attached to a user" read tool, mirroring the existing gap the identity domain
  //    already accepts for role assignments read back only via identity_user_list's roleIds).
  const rows = await repos.principalPolicies.listByPrincipalId({ workspaceId: WORKSPACE_ID, principalId: user.principalId });
  assert.deepEqual(rows.map((row) => row.policyId), [policy.id]);

  // 6. A rename, then a delete-while-unattached-elsewhere is refused because it is STILL attached.
  const renamed = (await wired(deps, "identity_policy_update").handler(asOwner(ownerPrincipalId, { policyId: policy.id, name: "Reviewer Bundle (renamed)" }))) as {
    policy: { name: string };
  };
  assert.equal(renamed.policy.name, "Reviewer Bundle (renamed)");

  await assert.rejects(
    () => wired(deps, "identity_policy_delete").handler(asOwner(ownerPrincipalId, { policyId: policy.id })),
    /referenced/,
    "a policy still attached to a principal must not be deletable, mirroring identity_role_delete's INV-09 guard",
  );
});

test("the email round-trips: set, changed, then cleared by omitting it", async () => {
  const { deps, repos, ownerPrincipalId } = await buildHarness();

  const { user } = (await wired(deps, "identity_user_create").handler(asOwner(ownerPrincipalId, { username: "mailer", email: "first@example.test" }))) as {
    user: { principalId: string; email?: string };
  };
  assert.equal(user.email, "first@example.test");

  const changed = (await wired(deps, "identity_user_update_email").handler(asOwner(ownerPrincipalId, { principalId: user.principalId, email: "second@example.test" }))) as {
    user: { email?: string };
  };
  assert.equal(changed.user.email, "second@example.test");
  assert.equal((await repos.users.findByPrincipalId({ workspaceId: WORKSPACE_ID, principalId: user.principalId }))?.email, "second@example.test");

  const cleared = (await wired(deps, "identity_user_update_email").handler(asOwner(ownerPrincipalId, { principalId: user.principalId }))) as {
    user: Record<string, unknown>;
  };
  assert.equal("email" in cleared.user, false, "omitting email clears it, exactly as the tool description tells the model");
  const stored = await repos.users.findByPrincipalId({ workspaceId: WORKSPACE_ID, principalId: user.principalId });
  assert.ok(stored, "clearing the email must retain the user");
  assert.equal(stored.email, undefined);
});

test("disable then enable round-trips, and the status change is visible through the list tool", async () => {
  const { deps, ownerPrincipalId } = await buildHarness();

  const { user } = (await wired(deps, "identity_user_create").handler(asOwner(ownerPrincipalId, { username: "temp" }))) as {
    user: { principalId: string };
  };

  const disabled = (await wired(deps, "identity_user_disable").handler(asOwner(ownerPrincipalId, { principalId: user.principalId }))) as { user: { status: string } };
  assert.equal(disabled.user.status, "disabled");

  const afterDisable = (await wired(deps, "identity_user_list").handler(asOwner(ownerPrincipalId, {}))) as { users: Array<{ principalId: string; status: string }> };
  assert.equal(afterDisable.users.find((candidate) => candidate.principalId === user.principalId)?.status, "disabled");

  const enabled = (await wired(deps, "identity_user_enable").handler(asOwner(ownerPrincipalId, { principalId: user.principalId }))) as { user: { status: string } };
  assert.equal(enabled.user.status, "active");
  const afterEnable = (await wired(deps, "identity_user_list").handler(asOwner(ownerPrincipalId, {}))) as { users: Array<{ principalId: string; status: string }> };
  assert.equal(afterEnable.users.find((candidate) => candidate.principalId === user.principalId)?.status, "active");
});

test("a custom role can be renamed and then deleted while unassigned, but not once it is in use", async () => {
  const { deps, ownerPrincipalId } = await buildHarness();

  const { role } = (await wired(deps, "identity_role_create").handler(asOwner(ownerPrincipalId, { name: "Temp" }))) as { role: { id: string } };

  const renamed = (await wired(deps, "identity_role_rename").handler(asOwner(ownerPrincipalId, { roleId: role.id, name: "Temp Renamed" }))) as {
    role: { name: string; isBuiltin: boolean };
  };
  assert.equal(renamed.role.name, "Temp Renamed");
  assert.equal(renamed.role.isBuiltin, false);

  const { user } = (await wired(deps, "identity_user_create").handler(asOwner(ownerPrincipalId, { username: "holder" }))) as {
    user: { principalId: string };
  };
  await wired(deps, "identity_role_assign").handler(asOwner(ownerPrincipalId, { principalId: user.principalId, roleId: role.id }));

  await assert.rejects(
    () => wired(deps, "identity_role_delete").handler(asOwner(ownerPrincipalId, { roleId: role.id })),
    /still assigned to 1 principal/,
    "this system has no unassign operation, so a role in use is permanently undeletable — the tool must say so rather than orphan the grant",
  );

  const { role: spare } = (await wired(deps, "identity_role_create").handler(asOwner(ownerPrincipalId, { name: "Unused" }))) as { role: { id: string } };
  const deleted = (await wired(deps, "identity_role_delete").handler(asOwner(ownerPrincipalId, { roleId: spare.id }))) as { deleted: { roleId: string } };
  assert.deepEqual(deleted.deleted, { roleId: spare.id }, "a void-returning transition must still acknowledge what it did");

  const { roles } = (await wired(deps, "identity_role_list").handler(asOwner(ownerPrincipalId, {}))) as { roles: Array<{ id: string }> };
  assert.equal(roles.some((candidate) => candidate.id === spare.id), false);
});

test("a duplicate username is refused, so a model cannot quietly create a second account under an existing name", async () => {
  const { deps, ownerPrincipalId } = await buildHarness();

  await wired(deps, "identity_user_create").handler(asOwner(ownerPrincipalId, { username: "Dup" }));

  await assert.rejects(
    () => wired(deps, "identity_user_create").handler(asOwner(ownerPrincipalId, { username: "dup" })),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /already in use/);
      assert.equal(error.message.includes("pw-valid-1234"), false, "a create failure must not echo the human-typed password");
      return true;
    },
    "the domain compares usernames case-insensitively, and the tool inherits that rather than re-implementing it",
  );
});

// Permission-denial and grant-clamp cases ported from the source authorization suite.
async function addPrincipal(repos: IdentityRepos, id: string): Promise<string> {
  await repos.principals.save({
    id,
    workspaceId: WORKSPACE_ID,
    kind: "user",
    displayName: id,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  await repos.users.save({ principalId: id, workspaceId: WORKSPACE_ID, username: id, passwordHash: "hash" });
  return id;
}

/**
 * Give `principalId` exactly `permissions`, unconstrained, via a fresh non-built-in policy attached
 * directly. Written through the repos rather than through `createPolicy`/`attachPolicy` because
 * those transitions are themselves gated — this is test setup, not a transition under test.
 */
async function grant(repos: IdentityRepos, principalId: string, permissions: readonly string[]): Promise<void> {
  const policyId = `policy-for-${principalId}-${permissions.join("-")}`;
  await repos.policies.save({ id: policyId, workspaceId: WORKSPACE_ID, name: policyId, isBuiltin: false, isFrozen: false });
  for (const permission of permissions) {
    await repos.policyPermissions.save({
      id: `pp-${policyId}-${permission}`,
      workspaceId: WORKSPACE_ID,
      policyId,
      permission,
      resourceType: null,
      constraintJson: null,
    });
  }
  await repos.principalPolicies.save({ id: `pa-${policyId}`, workspaceId: WORKSPACE_ID, principalId, policyId });
}
const TOOL_INPUTS: Record<string, Record<string, unknown>> = {
  identity_user_list: {},
  identity_role_list: {},
  identity_policy_list: {},
  identity_user_create: { username: "newcomer" },
  identity_user_update_email: { principalId: "target-principal", email: "a@b.test" },
  identity_user_disable: { principalId: "target-principal" },
  identity_user_enable: { principalId: "target-principal" },
  identity_role_create: { name: "Custom Role" },
  identity_role_assign: { principalId: "target-principal", roleId: "target-role" },
  identity_role_rename: { roleId: "target-role", name: "Renamed" },
  identity_role_delete: { roleId: "target-role" },
  identity_policy_create: { name: "Custom Policy" },
  identity_policy_update: { policyId: "target-policy", name: "Renamed Policy" },
  identity_policy_delete: { policyId: "target-policy" },
  identity_policy_attach: { principalId: "target-principal", policyId: "target-policy" },
};

/** Seed the target principal, a custom role, and a custom policy the fixtures reference. */
async function seedTargets(repos: IdentityRepos): Promise<void> {
  await addPrincipal(repos, "target-principal");
  await repos.sessions.save({
    id: "target-session", workspaceId: WORKSPACE_ID, principalId: "target-principal",
    tokenHash: "target-token-hash", createdAt: "2026-07-29T00:00:00.000Z", expiresAt: "2026-07-30T00:00:00.000Z",
  });
  await repos.roles.save({ id: "target-role", workspaceId: WORKSPACE_ID, name: "Target Role", isBuiltin: false });
  await repos.policies.save({ id: "target-policy", workspaceId: WORKSPACE_ID, name: "Target Policy", isBuiltin: false, isFrozen: false });
}

/** A cheap durable-state fingerprint: every table these tools can write. */
async function stateFingerprint(repos: IdentityRepos): Promise<string> {
  const principals = await repos.principals.list({ workspaceId: WORKSPACE_ID });
  const roles = await repos.roles.list({ workspaceId: WORKSPACE_ID });
  const policies = await repos.policies.list({ workspaceId: WORKSPACE_ID });
  const assignments = await Promise.all(principals.map((p) => repos.principalRoles.listByPrincipalId({ workspaceId: WORKSPACE_ID, principalId: p.id })));
  const attachments = await Promise.all(principals.map((p) => repos.principalPolicies.listByPrincipalId({ workspaceId: WORKSPACE_ID, principalId: p.id })));
  const users = await Promise.all(principals.map((p) => repos.users.findByPrincipalId({ workspaceId: WORKSPACE_ID, principalId: p.id })));
  const sessions = await Promise.all(principals.map((p) => repos.sessions.listByPrincipalId({ workspaceId: WORKSPACE_ID, principalId: p.id })));
  return JSON.stringify({ principals, roles, policies, assignments, attachments, users, sessions });
}

/** Enable must start from disabled so a no-op cannot masquerade as success. */

const executionContext = asOwner;
test("identity_user_create advertises user.manage only", () => {
  const entry = identityAgentToolCatalog.find((tool) => tool.name === "identity_user_create");
  assert.ok(entry);
  assert.deepEqual(entry.authorization, { permission: "user.manage" });
});

for (const permission of ["member.manage", "user.manage"] as const) {
  test(`identity tools enforce owner protection under ${permission}, including direct handler calls`, async () => {
    const { deps, repos, ownerPrincipalId } = await buildHarness();
    const caller = await addPrincipal(repos, "delegated-caller");
    await grant(repos, caller, [permission]);
    const before = await stateFingerprint(repos);
    await assert.rejects(
      () => wired(deps, "identity_user_update_email").handler(executionContext(caller, { principalId: ownerPrincipalId, email: "attacker@example.com" })),
      (error: unknown) => permission === "member.manage"
        ? error instanceof IdentityForbiddenError && error.message === `principal '${caller}' is not authorized for any of [user.manage]`
        : error instanceof OwnerRequiredError && error.message === "only an owner can modify an owner principal"
    );
    if (permission === "member.manage") {
      await assert.rejects(
        () => wired(deps, "identity_user_create").handler(executionContext(caller, { username: "unauthorized-operator" })),
        (error: unknown) => error instanceof IdentityForbiddenError && error.message === `principal '${caller}' is not authorized for any of [user.manage]`
      );
    }
    assert.equal(await stateFingerprint(repos), before);
    await wired(deps, "identity_user_update_email").handler(executionContext(caller, { principalId: caller, email: "self@example.com" }));
    assert.equal((await repos.users.findByPrincipalId({ workspaceId: WORKSPACE_ID, principalId: caller }))?.email, "self@example.com");
    await wired(deps, "identity_user_update_email").handler(executionContext(ownerPrincipalId, { principalId: ownerPrincipalId, email: "owner@example.com" }));
    assert.equal((await repos.users.findByPrincipalId({ workspaceId: WORKSPACE_ID, principalId: ownerPrincipalId }))?.email, "owner@example.com");
  });
}

function declaredPermissions(toolId: string): string[] {
  const entry = identityAgentToolCatalog.find((tool) => tool.name === toolId);
  assert.ok(entry);
  return entry.authorization.orPermission
    ? [entry.authorization.permission, entry.authorization.orPermission] : [entry.authorization.permission];
}
test("every catalog tool remains wired with its schema, description, and derived read-only flag", async () => {
  const { deps } = await buildHarness();
  const registrations = identityRegistrations(deps);
  assert.deepEqual([...registrations.keys()].sort(), Object.keys(TOOL_INPUTS).sort());
  assert.equal(registrations.size, 15);
  for (const entry of identityAgentToolCatalog) {
    const registration = registrations.get(entry.name);
    assert.ok(registration);
    assert.deepEqual(registration.descriptor.inputSchema, entry.inputSchema);
    assert.equal(registration.descriptor.description, entry.description);
    assert.equal(registration.descriptor.readOnly, entry.sideEffects === "none");
  }
});
for (const toolId of Object.keys(TOOL_INPUTS)) {
  test(`${toolId}: an ungranted principal is refused before any durable write`, async () => {
    const { deps, repos } = await buildHarness();
    await seedTargets(repos);
    const caller = await addPrincipal(repos, "ungranted-caller");
    const before = await stateFingerprint(repos);
    await assert.rejects(() => wired(deps, toolId).handler(executionContext(caller, TOOL_INPUTS[toolId]!)), IdentityForbiddenError);
    assert.equal(await stateFingerprint(repos), before);
  });
}
test("a tool with no declared OR really is single-permission — role.manage holders cannot reach the user tools", async () => {
  const { deps, repos } = await buildHarness();
  await seedTargets(repos);
  const caller = await addPrincipal(repos, "role-manager-only");
  await grant(repos, caller, ["role.manage"]);
  const input = TOOL_INPUTS.identity_user_disable;
  assert.ok(input, "the user-disable fixture must exist");

  await assert.rejects(
    () => wired(deps, "identity_user_disable").handler(executionContext(caller, input)),
    IdentityForbiddenError,
    "role.manage must not open the user-lifecycle tools",
  );
});

// ---------------------------------------------------------------------------
// 4. — an agent cannot use a tool to exceed its own caller. See docs/decisions/DR-007-workspace-and-owner-floors.md.
// ---------------------------------------------------------------------------

test("identity_role_assign: a non-owner caller cannot assign the built-in owner role — the INV-07 clamp survives the tool path", async () => {
  const { deps, repos } = await buildHarness();
  const caller = await addPrincipal(repos, "role-manager");
  await grant(repos, caller, ["role.manage"]);
  const target = await addPrincipal(repos, "escalation-target");

  const roles = await repos.roles.list({ workspaceId: WORKSPACE_ID });
  const ownerRole = roles.find((role) => role.name === "owner");
  assert.ok(ownerRole, "the seed must provide a built-in owner role for this test to mean anything");

  await assert.rejects(
    () => wired(deps, "identity_role_assign").handler(executionContext(caller, { principalId: target, roleId: ownerRole.id })),
    GrantExceedsIssuerError,
    "a role.manage holder that does not itself hold '*' must not be able to confer it through an agent tool",
  );

  const assignments = await repos.principalRoles.listByPrincipalId({ workspaceId: WORKSPACE_ID, principalId: target });
  assert.deepEqual(assignments, [], "a refused grant must write no row");
});

test("identity_role_assign: the OWNER can assign the owner role — the clamp is a bound on the caller, not a blanket ban", async () => {
  const { deps, repos, ownerPrincipalId } = await buildHarness();
  const target = await addPrincipal(repos, "promotion-target");

  const roles = await repos.roles.list({ workspaceId: WORKSPACE_ID });
  const ownerRole = roles.find((role) => role.name === "owner");
  assert.ok(ownerRole);

  await wired(deps, "identity_role_assign").handler(executionContext(ownerPrincipalId, { principalId: target, roleId: ownerRole.id }));

  const assignments = await repos.principalRoles.listByPrincipalId({ workspaceId: WORKSPACE_ID, principalId: target });
  assert.deepEqual(assignments.map((a) => a.roleId), [ownerRole.id]);
});

test("identity_policy_attach: a non-owner caller cannot attach the built-in owner policy — the INV-07 clamp survives this tool path too, identically to identity_role_assign", async () => {
  const { deps, repos } = await buildHarness();
  const caller = await addPrincipal(repos, "policy-manager");
  await grant(repos, caller, ["role.manage"]);
  const target = await addPrincipal(repos, "escalation-target-2");

  const policies = await repos.policies.list({ workspaceId: WORKSPACE_ID });
  const ownerPolicy = policies.find((policy) => policy.name === "owner" || policy.isBuiltin);
  assert.ok(ownerPolicy, "the seed must provide at least one built-in policy for this test to mean anything");

  await assert.rejects(
    () => wired(deps, "identity_policy_attach").handler(executionContext(caller, { principalId: target, policyId: ownerPolicy.id })),
    GrantExceedsIssuerError,
    "a role.manage holder that does not itself hold the policy's permissions unconstrained must not be able to confer them through an agent tool",
  );

  const attachments = await repos.principalPolicies.listByPrincipalId({ workspaceId: WORKSPACE_ID, principalId: target });
  assert.deepEqual(attachments, [], "a refused grant must write no row");
});

test("identity_policy_delete / identity_policy_update: built-in policies are refused, so a tool cannot escalate by relabelling or removing one", async () => {
  const { deps, repos, ownerPrincipalId } = await buildHarness();
  const policies = await repos.policies.list({ workspaceId: WORKSPACE_ID });
  const builtin = policies.find((policy) => policy.isBuiltin);
  assert.ok(builtin, "the seed must provide at least one built-in policy for this test to mean anything");

  await assert.rejects(
    () => wired(deps, "identity_policy_update").handler(executionContext(ownerPrincipalId, { policyId: builtin.id, name: "Trusted Admin" })),
    /built-in/,
  );
  await assert.rejects(
    () => wired(deps, "identity_policy_delete").handler(executionContext(ownerPrincipalId, { policyId: builtin.id })),
    /built-in/,
  );

  const after = await repos.policies.list({ workspaceId: WORKSPACE_ID });
  assert.deepEqual(after.find((policy) => policy.id === builtin.id)?.name, builtin.name);
});

test("identity_user_disable: the seeded owner cannot be disabled through a tool, even by the owner itself", async () => {
  const { deps, ownerPrincipalId } = await buildHarness();

  await assert.rejects(
    () => wired(deps, "identity_user_disable").handler(executionContext(ownerPrincipalId, { principalId: ownerPrincipalId })),
    /seeded owner principal can never be disabled/,
    "locking the workspace out of its own management plane must not be an agent-reachable outcome",
  );
});

test("identity_role_rename / identity_role_delete: built-in roles are refused, so a tool cannot escalate 'viewer' by relabelling or removing it", async () => {
  const { deps, repos, ownerPrincipalId } = await buildHarness();
  const roles = await repos.roles.list({ workspaceId: WORKSPACE_ID });
  const viewer = roles.find((role) => role.name === "viewer");
  assert.ok(viewer?.isBuiltin, "viewer must be seeded built-in for this test to mean anything");

  await assert.rejects(
    () => wired(deps, "identity_role_rename").handler(executionContext(ownerPrincipalId, { roleId: viewer.id, name: "Trusted Admin" })),
    /built-in role cannot be renamed/,
  );
  await assert.rejects(
    () => wired(deps, "identity_role_delete").handler(executionContext(ownerPrincipalId, { roleId: viewer.id })),
    /built-in role cannot be deleted/,
  );

  const after = await repos.roles.list({ workspaceId: WORKSPACE_ID });
  assert.deepEqual(after.find((role) => role.id === viewer.id)?.name, "viewer");
});

// ---------------------------------------------------------------------------
// 5. The ToolPolicy layer, and the deliberate omissions
// ---------------------------------------------------------------------------

test("the ToolPolicy layer is a pass-through 'allow' for every identity registration — enforcement is the domain layer's, by design", async () => {
  const { deps } = await buildHarness();

  for (const [toolId, registration] of identityRegistrations(deps)) {
    const decision = registration.policy.authorize({
      principal: { id: "anyone" },
      run: { id: "run-1" },
      tool: registration.descriptor,
      input: TOOL_INPUTS[toolId],
    });
    assert.equal(decision, "allow", `${toolId}'s ToolPolicy is documented as a pass-through`);
  }
});

test("no password-reset tool is wired — the one identity transition with no INV-07 clamp stays human-UI-only", async () => {
  const { deps } = await buildHarness();
  const wiredIds = [...identityRegistrations(deps).keys()];

  assert.equal(
    wiredIds.some((id) => /password|credential|reset/i.test(id)),
    false,
    "resetUserPassword lets a user.manage holder take over the owner account; it must not be agent-reachable",
  );
  assert.equal(
    identityAgentToolCatalog.some((tool) => /password|credential|reset/i.test(tool.name)),
    false,
    "the omission belongs in the catalog too — an unwired-but-catalogued entry is still advertised by the ADR-014 tool filter",
  );
});

test("identity_policy_list/create/update/delete/attach are wired, but identity_policy_write_permission is NOT — the one policy transition with a shared-object blast radius stays human-UI-only", async () => {
  const { deps } = await buildHarness();
  const wiredIds = [...identityRegistrations(deps).keys()];

  for (const toolId of ["identity_policy_list", "identity_policy_create", "identity_policy_update", "identity_policy_delete", "identity_policy_attach"]) {
    assert.ok(
      wiredIds.includes(toolId),
      `${toolId} should be wired — it mirrors an already-wired role transition's risk profile`,
    );
  }
  assert.equal(
    wiredIds.some((id) => /write.?permission/i.test(id)),
    false,
    "writePolicyPermission can silently widen access for every principal already attached to a shared policy, unlike the single-target tools above — it must not be agent-reachable",
  );
  assert.equal(
    identityAgentToolCatalog.some((tool) => /write.?permission/i.test(tool.name)),
    false,
    "the omission belongs in the catalog too — an unwired-but-catalogued entry is still advertised by the ADR-014 tool filter",
  );
});

test("every wired identity tool declares user.manage or role.manage — never a read-only or unrelated permission", () => {
  for (const toolId of Object.keys(TOOL_INPUTS)) {
    for (const permission of declaredPermissions(toolId)) {
      assert.ok(
        ["user.manage", "role.manage", "member.manage"].includes(permission),
        `${toolId} declares '${permission}', which is not one of the identity-admin permissions`,
      );
    }
  }
});
