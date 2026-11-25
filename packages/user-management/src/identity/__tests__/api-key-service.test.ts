import { assertVersionedWrite } from "@jini-ai/core/optimistic-concurrency";
import { NodeSessionTokens } from "../../server/index.js";
import { createTransactionalInMemoryIdentityRepos } from "../../server/index.js";
import assert from "node:assert/strict";
import { test } from "vitest";

import { GrantExceedsIssuerError, IdentityForbiddenError, IdentityNotFoundError, IdentityValidationError } from "../../core/index.js";
import { InMemoryPolicyPermissionRepo, InMemoryPolicyRepo, InMemoryPrincipalPolicyRepo, InMemoryPrincipalRepo, InMemoryPrincipalRoleRepo, InMemoryRolePolicyRepo, InMemoryRoleRepo, InMemorySessionRepo, InMemoryUserRepo, resolveEffectivePermissions } from "../../server/index.js";
import { createApiKeySecret } from "../api-key-secret.js";
import { createApiKeyPrincipal, createApiKeyService, revokeApiKey, type ApiKeyServiceDeps } from "../api-key-service.js";
import type { ApiKeyRecord } from "../api-key-types.js";
import { InMemoryApiKeyRepo } from "../repo.memory.js";

/** The host binds its own scheme prefix; this suite binds a fixture one through the same factory. */
const { issueApiKey, authenticateApiKey } = createApiKeyService({ keySecret: createApiKeySecret({ prefix: "test_ak_" }) });

/** A settable `{ nowMs }` clock — the only clock shape `ApiKeyServiceDeps` reads. */
function createFakeClock({ startIso }: { startIso: string }) {
  let nowMs = Date.parse(startIso);
  return { nowMs: () => nowMs, set: (iso: string) => { nowMs = Date.parse(iso); } };
}

const WS = "ws-b08";
const NOW = "2026-10-01T12:00:00.000Z";

async function harness() {
  let id = 0;
  const clock = createFakeClock({ startIso: NOW });
  const verified: Array<[string, string]> = [];
  const deps: ApiKeyServiceDeps = {
    tokens: new NodeSessionTokens({}),
    repos: createTransactionalInMemoryIdentityRepos({ repos: { principals: new InMemoryPrincipalRepo({}), users: new InMemoryUserRepo({ assertVersionedWrite }), sessions: new InMemorySessionRepo({}), roles: new InMemoryRoleRepo({ assertVersionedWrite }), policies: new InMemoryPolicyRepo({ assertVersionedWrite }), policyPermissions: new InMemoryPolicyPermissionRepo({}), principalPolicies: new InMemoryPrincipalPolicyRepo({}), principalRoles: new InMemoryPrincipalRoleRepo({}), rolePolicies: new InMemoryRolePolicyRepo({}) } }),
    apiKeys: new InMemoryApiKeyRepo(), clock, idGen: { newId: () => `b08-${++id}` },
    hasher: { hash: async ({ password }) => `password:${password}`, verify: async ({ hash, password }) => hash === `password:${password}` },
    secretHasher: { hash: async ({ secret }) => `digest:${secret}`, verify: async ({ storedHash, secret }) => { verified.push([storedHash, secret]); return storedHash === `digest:${secret}`; } },
  };
  await deps.repos.principals.save({ id: "issuer", workspaceId: WS, kind: "user", displayName: "Owner", status: "active", createdAt: NOW });
  await deps.repos.policies.save({ version: 1, id: "issuer-policy", workspaceId: WS, name: "issuer", isBuiltin: false, isFrozen: false });
  await deps.repos.principalPolicies.save({ id: "issuer-grant", workspaceId: WS, principalId: "issuer", policyId: "issuer-policy" });
  await deps.repos.policyPermissions.save({ id: "owner-permission", workspaceId: WS, policyId: "issuer-policy", permission: "*", resourceType: null, constraintJson: null });
  await deps.repos.policies.save({ version: 1, id: "source", workspaceId: WS, name: "source", isBuiltin: false, isFrozen: false });
  await deps.repos.policyPermissions.save({ id: "source-read", workspaceId: WS, policyId: "source", permission: "content.read", resourceType: "entry", constraintJson: '{"type":"recipe"}' });
  const { principal } = await createApiKeyPrincipal({ deps, input: { workspaceId: WS, callerPrincipalId: "issuer", displayName: "  Runner  " } });
  return { deps, principal, verified, setNow: (value: string) => clock.set(value), input: { workspaceId: WS, callerPrincipalId: "issuer", principalId: principal.id, label: "  Build key  ", policyIds: ["source"] } };
}

test("issuance freezes exact constrained permissions, canonicalizes expiry and survives source-policy widening", async () => {
  const h = await harness();
  await h.deps.repos.policyPermissions.save({ id: "source-write", workspaceId: WS, policyId: "source", permission: "content.write", resourceType: "post", constraintJson: null });
  const issued = await issueApiKey({ deps: h.deps, input: { ...h.input, expiresAt: "2026-10-02T09:00:00-04:00" } });
  assert.equal(issued.apiKey.label, "Build key");
  assert.equal(issued.apiKey.expiresAt, "2026-10-02T13:00:00.000Z");
  const stored = await h.deps.apiKeys.findById({ workspaceId: WS, id: issued.apiKey.id });
  assert.ok(stored);
  assert.equal(stored.keyHash, `digest:${issued.rawKey.split(".")[1]}`);
  assert.equal("rawKey" in stored, false);
  assert.equal((await h.deps.repos.policies.findById({ workspaceId: WS, id: stored.issuedPolicyId! }))?.isFrozen, true);
  const permissions = () => resolveEffectivePermissions({ deps: h.deps.repos, principalId: h.principal.id, workspaceId: WS });
  const read = (rows: Awaited<ReturnType<typeof permissions>>) => rows.map(({ permission, resourceType, constraintJson }) => ({ permission, resourceType, constraintJson }));
  const expected = [{ permission: "content.read", resourceType: "entry", constraintJson: '{"type":"recipe"}' }, { permission: "content.write", resourceType: "post", constraintJson: null }];
  assert.deepEqual(read(await permissions()), expected);
  await h.deps.repos.policyPermissions.save({ id: "widened", workspaceId: WS, policyId: "source", permission: "content.write", resourceType: null, constraintJson: null });
  assert.deepEqual(read(await permissions()), expected);
  await h.deps.repos.policyPermissions.deleteByPolicyId({ workspaceId: WS, policyId: "source" });
  // F6.3/F6.4: exercise the authority the running authorization path resolves.
  assert.deepEqual(read(await permissions()), expected);
  assert.equal((await authenticateApiKey({ deps: h.deps, input: { workspaceId: WS, rawKey: issued.rawKey } }))?.principal.id, h.principal.id);
  assert.equal((await h.deps.apiKeys.findById({ workspaceId: WS, id: stored.id }))?.lastUsedAt, NOW);
});

test("concurrent issuances for one grantless principal cannot union distinct snapshots", async () => {
  const h = await harness();
  await h.deps.repos.policies.save({ version: 1, id: "other-source", workspaceId: WS, name: "other-source", isBuiltin: false, isFrozen: false });
  await h.deps.repos.policyPermissions.save({ id: "other-write", workspaceId: WS, policyId: "other-source", permission: "content.write", resourceType: null, constraintJson: null });
  const attempts = await Promise.allSettled([
    issueApiKey({ deps: h.deps, input: h.input }),
    issueApiKey({ deps: h.deps, input: { ...h.input, policyIds: ["other-source"] } }),
  ]);
  assert.equal(attempts.filter(result => result.status === "fulfilled").length, 1);
  const rejected = attempts.find(result => result.status === "rejected");
  assert.ok(rejected?.status === "rejected");
  assert.ok(rejected.reason instanceof IdentityValidationError);
  assert.match(rejected.reason.message, /already carries grants/);
  const keys = await h.deps.apiKeys.listByPrincipalId({ workspaceId: WS, principalId: h.principal.id });
  assert.equal(keys.length, 1);
  assert.equal((await h.deps.repos.principalPolicies.listByPrincipalId({ workspaceId: WS, principalId: h.principal.id })).length, 1);
  const effective = await resolveEffectivePermissions({ deps: h.deps.repos, principalId: h.principal.id, workspaceId: WS });
  const snapshot = await h.deps.repos.policyPermissions.listByPolicyId({ workspaceId: WS, policyId: keys[0]!.issuedPolicyId! });
  assert.deepEqual(effective, snapshot);
  assert.equal(effective.length, 1, "the losing request adds no permission");
  assert.equal((await h.deps.repos.policies.list({ workspaceId: WS })).filter(policy => policy.isFrozen).length, 1);
});

test("failed key persistence rolls back all issuance snapshot writes", async () => {
  const h = await harness();
  h.deps.apiKeys.save = async () => { throw new Error("key persistence failed"); };
  await assert.rejects(issueApiKey({ deps: h.deps, input: h.input }), /key persistence failed/);
  assert.deepEqual(await h.deps.repos.principalPolicies.listByPrincipalId({ workspaceId: WS, principalId: h.principal.id }), []);
  assert.deepEqual((await h.deps.repos.policies.list({ workspaceId: WS })).map(policy => policy.id).sort(), ["issuer-policy", "source"]);
});

for (const restriction of [{ resourceType: "entry", constraintJson: null }, { resourceType: null, constraintJson: '{"type":"recipe"}' }]) {
  test(`issuance refuses a permission the issuer holds only with ${JSON.stringify(restriction)}`, async () => {
    const h = await harness();
    await h.deps.repos.policyPermissions.deleteByPolicyId({ workspaceId: WS, policyId: "issuer-policy" });
    await h.deps.repos.policyPermissions.save({ id: "manage", workspaceId: WS, policyId: "issuer-policy", permission: "apikey.manage", resourceType: null, constraintJson: null });
    await h.deps.repos.policyPermissions.save({ id: "limited", workspaceId: WS, policyId: "issuer-policy", permission: "content.read", ...restriction });
    await assert.rejects(issueApiKey({ deps: h.deps, input: h.input }), GrantExceedsIssuerError);
    assert.deepEqual(await h.deps.apiKeys.listByPrincipalId({ workspaceId: WS, principalId: h.principal.id }), []);
    assert.deepEqual(await h.deps.repos.principalPolicies.listByPrincipalId({ workspaceId: WS, principalId: h.principal.id }), []);
    assert.deepEqual((await h.deps.repos.policies.list({ workspaceId: WS })).map((p) => p.id).sort(), ["issuer-policy", "source"]);
  });
}

for (const badInput of [{ label: "x".repeat(256) }, { policyIds: [" "] }, { policyIds: [] }, { expiresAt: "not-a-date" }, { principalId: " " }]) {
  test(`invalid issuance input ${Object.keys(badInput)[0]} creates no snapshot or key`, async () => {
    const h = await harness();
    await assert.rejects(issueApiKey({ deps: h.deps, input: { ...h.input, ...badInput } }), IdentityValidationError);
    assert.deepEqual((await h.deps.repos.policies.list({ workspaceId: WS })).map((p) => p.id).sort(), ["issuer-policy", "source"]);
    assert.deepEqual(await h.deps.apiKeys.listByPrincipalId({ workspaceId: WS, principalId: h.principal.id }), []);
  });
}

test("revoking twice keeps the original timestamp and removes effective authority", async () => {
  const h = await harness();
  const issued = await issueApiKey({ deps: h.deps, input: h.input });
  const input = { workspaceId: WS, callerPrincipalId: "issuer", keyId: issued.apiKey.id };
  await revokeApiKey({ deps: h.deps, input });
  h.setNow("2026-10-02T12:00:00.000Z");
  await revokeApiKey({ deps: h.deps, input });
  assert.equal((await h.deps.apiKeys.findById({ workspaceId: WS, id: input.keyId }))?.revokedAt, NOW);
  assert.deepEqual(await resolveEffectivePermissions({ deps: h.deps.repos, workspaceId: WS, principalId: h.principal.id }), []);
  assert.equal(await authenticateApiKey({ deps: h.deps, input: { workspaceId: WS, rawKey: issued.rawKey } }), null);
});

test("authentication racing revocation cannot make the key usable again", async () => {
  const h = await harness();
  const issued = await issueApiKey({ deps: h.deps, input: h.input });
  const verify = h.deps.secretHasher.verify;
  let revokeDuringVerification = true;
  h.deps.secretHasher.verify = async ({ storedHash, secret }) => {
    if (revokeDuringVerification) {
      revokeDuringVerification = false;
      await revokeApiKey({ deps: h.deps, input: { workspaceId: WS, callerPrincipalId: "issuer", keyId: issued.apiKey.id } });
    }
    return verify({ storedHash, secret });
  };
  await authenticateApiKey({ deps: h.deps, input: { workspaceId: WS, rawKey: issued.rawKey } });
  const stored = await h.deps.apiKeys.findById({ workspaceId: WS, id: issued.apiKey.id });
  assert.equal(stored?.revokedAt, NOW, "recording usage must preserve the concurrent revocation");
  assert.equal(stored?.lastUsedAt, undefined, "a stale usage write must not update a revoked row");
  assert.equal(await authenticateApiKey({ deps: h.deps, input: { workspaceId: WS, rawKey: issued.rawKey } }), null);
});

test("a future expiry expressed with an offset authenticates by instant and records usage", async () => {
  const h = await harness();
  const key: ApiKeyRecord = { id: "key", workspaceId: WS, principalId: h.principal.id, label: "Runner", keyHash: "digest:secret", prefix: "test_ak_0123456789ab", expiresAt: "2026-10-01T09:00:00-04:00", createdAt: NOW };
  await h.deps.apiKeys.save(key);
  const result = await authenticateApiKey({ deps: h.deps, input: { workspaceId: WS, rawKey: "test_ak_0123456789ab.secret" } });
  assert.equal(result?.principal.id, h.principal.id);
  assert.equal(result?.apiKey.id, "key");
  assert.equal((await h.deps.apiKeys.findById({ workspaceId: WS, id: "key" }))?.lastUsedAt, NOW);
});

test("a disabled machine cannot receive a key and no partial snapshot is persisted", async () => {
  const h = await harness();
  await h.deps.repos.principals.save({ ...h.principal, status: "disabled" });
  await assert.rejects(issueApiKey({ deps: h.deps, input: h.input }), (error) => {
    assert(error instanceof IdentityValidationError);
    assert.equal(error.message, `principal '${h.principal.id}' is disabled`);
    return true;
  });
  assert.deepEqual(await h.deps.apiKeys.listByPrincipalId({ workspaceId: WS, principalId: h.principal.id }), []);
  assert.deepEqual((await h.deps.repos.policies.list({ workspaceId: WS })).map((p) => p.id).sort(), ["issuer-policy", "source"]);
});

for (const variant of ["revoked", "expiry-boundary", "disabled", "wrong-kind", "missing-principal", "wrong-secret"] as const) {
  test(`authentication rejects ${variant}, verifies the secret first and never records usage`, async () => {
    const h = await harness();
    const key: ApiKeyRecord = { id: "key", workspaceId: WS, principalId: h.principal.id, label: "Runner", keyHash: "digest:secret", prefix: "test_ak_0123456789ab", createdAt: NOW };
    if (variant === "revoked") key.revokedAt = "2026-09-30T00:00:00Z";
    if (variant === "expiry-boundary") key.expiresAt = "2026-10-01T08:00:00-04:00";
    if (variant === "disabled") await h.deps.repos.principals.save({ ...h.principal, status: "disabled" });
    if (variant === "wrong-kind") await h.deps.repos.principals.save({ ...h.principal, kind: "user" });
    if (variant === "missing-principal") key.principalId = "missing";
    await h.deps.apiKeys.save(key);
    const secret = variant === "wrong-secret" ? "wrong" : "secret";
    assert.equal(await authenticateApiKey({ deps: h.deps, input: { workspaceId: WS, rawKey: `test_ak_0123456789ab.${secret}` } }), null);
    assert.deepEqual(h.verified, [["digest:secret", secret]]);
    assert.equal((await h.deps.apiKeys.findById({ workspaceId: WS, id: "key" }))?.lastUsedAt, undefined);
  });
}

test("an unknown well-formed key verifies a decoy; malformed input never reaches the hasher", async () => {
  const h = await harness();
  const hashed: string[] = [];
  h.deps.secretHasher.hash = async ({ secret }) => { hashed.push(secret); return "opaque-decoy-digest"; };
  assert.equal(await authenticateApiKey({ deps: h.deps, input: { workspaceId: WS, rawKey: "malformed" } }), null);
  assert.deepEqual(h.verified, []);
  assert.deepEqual(hashed, []);
  assert.equal(await authenticateApiKey({ deps: h.deps, input: { workspaceId: WS, rawKey: "test_ak_0123456789ab.unknown-secret" } }), null);
  // F2.5: verify must receive the hash returned by the injected port, never an arbitrary value.
  assert.deepEqual(h.verified, [["opaque-decoy-digest", "unknown-secret"]]);
  assert.equal(hashed.length, 1);
  assert.notEqual(hashed[0], "unknown-secret");
  assert.equal(await authenticateApiKey({ deps: h.deps, input: { workspaceId: WS, rawKey: "test_ak_0123456789ab.another-secret" } }), null);
  assert.deepEqual(h.verified, [["opaque-decoy-digest", "unknown-secret"], ["opaque-decoy-digest", "another-secret"]]);
  assert.equal(hashed.length, 1, "the same hasher reuses its decoy");
});

test("a valid source followed by a missing policy creates no partial snapshot or key", async () => {
  // F4.4/F6.3: all earlier guards pass; the missing second source must stop every write.
  const h = await harness();
  await assert.rejects(issueApiKey({ deps: h.deps, input: { ...h.input, policyIds: ["source", "missing-policy"] } }), (error) => {
    assert(error instanceof IdentityNotFoundError);
    assert.equal(error.message, "policy 'missing-policy' was not found");
    return true;
  });
  assert.deepEqual((await h.deps.repos.policies.list({ workspaceId: WS })).map((p) => p.id).sort(), ["issuer-policy", "source"]);
  assert.deepEqual(await h.deps.apiKeys.listByPrincipalId({ workspaceId: WS, principalId: h.principal.id }), []);
  assert.deepEqual(await h.deps.repos.principalPolicies.listByPrincipalId({ workspaceId: WS, principalId: h.principal.id }), []);
});

test("the grant clamp checks the second source policy even when the first permission is held", async () => {
  // F4.3: checking only the first source would grant system.write that the issuer lacks.
  const h = await harness();
  await h.deps.repos.policyPermissions.deleteByPolicyId({ workspaceId: WS, policyId: "issuer-policy" });
  for (const permission of ["apikey.manage", "content.read"]) {
    await h.deps.repos.policyPermissions.save({ id: `issuer-${permission}`, workspaceId: WS, policyId: "issuer-policy", permission, resourceType: null, constraintJson: null });
  }
  await h.deps.repos.policies.save({ version: 1, id: "second-source", workspaceId: WS, name: "Privileged", isBuiltin: false, isFrozen: false });
  await h.deps.repos.policyPermissions.save({ id: "second-permission", workspaceId: WS, policyId: "second-source", permission: "system.write", resourceType: null, constraintJson: null });
  await assert.rejects(issueApiKey({ deps: h.deps, input: { ...h.input, policyIds: ["source", "second-source"] } }), (error) => {
    assert(error instanceof GrantExceedsIssuerError);
    assert.equal(error.message, "principal 'issuer' cannot grant permission(s) it does not hold unconstrained: system.write");
    return true;
  });
  assert.deepEqual((await h.deps.repos.policies.list({ workspaceId: WS })).map((p) => p.id).sort(), ["issuer-policy", "second-source", "source"]);
  assert.deepEqual(await h.deps.apiKeys.listByPrincipalId({ workspaceId: WS, principalId: h.principal.id }), []);
  assert.deepEqual(await h.deps.repos.principalPolicies.listByPrincipalId({ workspaceId: WS, principalId: h.principal.id }), []);
});

test("a trimmed name or label exactly 255 characters long is accepted and persisted", async () => {
  const h = await harness();
  const { principal } = await createApiKeyPrincipal({ deps: h.deps, input: { workspaceId: WS, callerPrincipalId: "issuer", displayName: ` ${"n".repeat(255)} ` } });
  assert.equal((await h.deps.repos.principals.findById({ workspaceId: WS, id: principal.id }))?.displayName, "n".repeat(255));
  const issued = await issueApiKey({ deps: h.deps, input: { ...h.input, principalId: principal.id, label: ` ${"l".repeat(255)} ` } });
  assert.equal((await h.deps.apiKeys.findById({ workspaceId: WS, id: issued.apiKey.id }))?.label, "l".repeat(255));
});

test("principal creation accepts the explicit machine kind and refuses every privileged kind", async () => {
  const h = await harness();
  const { principal } = await createApiKeyPrincipal({ deps: h.deps, input: {
    workspaceId: WS, callerPrincipalId: "issuer", kind: "api_key", displayName: "  Explicit machine  ",
  } });
  assert.equal(principal.kind, "api_key");
  assert.equal(principal.status, "active");
  assert.equal(principal.displayName, "Explicit machine");
  assert.deepEqual(await h.deps.repos.principals.findById({ workspaceId: WS, id: principal.id }), principal);
  for (const kind of [null, "user", "system", "user-local", 42]) {
    await assert.rejects(createApiKeyPrincipal({ deps: h.deps, input: {
      workspaceId: WS, callerPrincipalId: "issuer", kind, displayName: "Rejected",
    } }), { constructor: IdentityValidationError, message: `'kind' must be 'api_key', got '${String(kind)}'` });
  }
});

test("principal display names must be strings within the trimmed bounds", async () => {
  const h = await harness();
  for (const displayName of [undefined, null, 42, "", " \t ", "x".repeat(256)]) {
    await assert.rejects(createApiKeyPrincipal({ deps: h.deps, input: {
      workspaceId: WS, callerPrincipalId: "issuer", displayName,
    } }), { constructor: IdentityValidationError, message: "'displayName' must be 1..255 characters after trimming" });
  }
});

for (const [field, value, message] of [
  ["label", null, "'label' must be 1..255 characters after trimming"],
  ["label", "  ", "'label' must be 1..255 characters after trimming"],
  ["policyIds", null, "'policyIds' must be a non-empty array of policy ids"],
  ["policyIds", "source", "'policyIds' must be a non-empty array of policy ids"],
  ["policyIds", [42], "'policyIds' entries must be non-blank policy ids"],
  ["principalId", null, "'principalId' is required"],
] as const) {
  test(`invalid ${field} ${JSON.stringify(value)} refuses issuance before any write`, async () => {
    const h = await harness();
    await assert.rejects(issueApiKey({ deps: h.deps, input: { ...h.input, [field]: value } }), {
      constructor: IdentityValidationError, message,
    });
    assert.deepEqual((await h.deps.repos.policies.list({ workspaceId: WS })).map(p => p.id).sort(), ["issuer-policy", "source"]);
    assert.deepEqual(await h.deps.apiKeys.listByPrincipalId({ workspaceId: WS, principalId: h.principal.id }), []);
  });
}

test("all key transitions reject an unauthorized caller before revealing missing targets or bad inputs", async () => {
  const h = await harness();
  await h.deps.repos.policyPermissions.deleteByPolicyId({ workspaceId: WS, policyId: "issuer-policy" });
  await assert.rejects(createApiKeyPrincipal({ deps: h.deps, input: {
    workspaceId: WS, callerPrincipalId: "issuer", displayName: null, kind: "system",
  } }), IdentityForbiddenError);
  await assert.rejects(issueApiKey({ deps: h.deps, input: { ...h.input, principalId: "missing", label: null } }), IdentityForbiddenError);
  await assert.rejects(revokeApiKey({ deps: h.deps, input: { workspaceId: WS, callerPrincipalId: "issuer", keyId: "missing" } }), IdentityForbiddenError);
  assert.deepEqual(await h.deps.apiKeys.listByPrincipalId({ workspaceId: WS, principalId: h.principal.id }), []);
});

test("a missing or foreign principal cannot receive a key", async () => {
  const h = await harness();
  await h.deps.repos.principals.save({ ...h.principal, id: "foreign", workspaceId: "other-ws" });
  for (const principalId of ["missing", "foreign"]) {
    await assert.rejects(issueApiKey({ deps: h.deps, input: { ...h.input, principalId } }), {
      constructor: IdentityNotFoundError, message: `principal '${principalId}' was not found`,
    });
  }
  assert.deepEqual((await h.deps.repos.policies.list({ workspaceId: WS })).map(p => p.id).sort(), ["issuer-policy", "source"]);
});

test("an active human cannot be used as an API-key principal", async () => {
  const h = await harness();
  await assert.rejects(issueApiKey({ deps: h.deps, input: { ...h.input, principalId: "issuer" } }), {
    constructor: IdentityValidationError, message: "ISSUE_API_KEY target must be a machine (kind='api_key') principal, got kind='user'",
  });
});

for (const grantKind of ["role", "policy"] as const) {
  test(`a principal with an existing ${grantKind} grant cannot receive a snapshot`, async () => {
    const h = await harness();
    if (grantKind === "role") {
      await h.deps.repos.roles.save({ version: 1, id: "role", workspaceId: WS, name: "Runner role", isBuiltin: false });
      await h.deps.repos.principalRoles.save({ id: "grant", workspaceId: WS, principalId: h.principal.id, roleId: "role" });
    } else {
      await h.deps.repos.principalPolicies.save({ id: "grant", workspaceId: WS, principalId: h.principal.id, policyId: "source" });
    }
    await assert.rejects(issueApiKey({ deps: h.deps, input: h.input }), {
      constructor: IdentityValidationError,
      message: `principal '${h.principal.id}' already carries grants; ISSUE_API_KEY requires a grantless principal so the key's authority equals exactly the policies attached here`,
    });
    assert.deepEqual(await h.deps.apiKeys.listByPrincipalId({ workspaceId: WS, principalId: h.principal.id }), []);
    assert.deepEqual((await h.deps.repos.policies.list({ workspaceId: WS })).map(p => p.id).sort(), ["issuer-policy", "source"]);
  });
}

test("an owner wildcard source is refused even though the issuer is an owner", async () => {
  const h = await harness();
  await h.deps.repos.policyPermissions.save({ id: "source-wildcard", workspaceId: WS, policyId: "source", permission: "*", resourceType: null, constraintJson: null });
  await assert.rejects(issueApiKey({ deps: h.deps, input: h.input }), {
    constructor: IdentityValidationError, message: "policy 'source' carries the owner wildcard '*'; an API-key snapshot may never carry it",
  });
  assert.deepEqual((await h.deps.repos.policies.list({ workspaceId: WS })).map(p => p.id).sort(), ["issuer-policy", "source"]);
  assert.deepEqual(await h.deps.apiKeys.listByPrincipalId({ workspaceId: WS, principalId: h.principal.id }), []);
});

test("an empty source policy issues a grantless snapshot without requiring extra issuer permissions", async () => {
  const h = await harness();
  await h.deps.repos.policyPermissions.deleteByPolicyId({ workspaceId: WS, policyId: "source" });
  await h.deps.repos.policyPermissions.deleteByPolicyId({ workspaceId: WS, policyId: "issuer-policy" });
  await h.deps.repos.policyPermissions.save({ id: "manage", workspaceId: WS, policyId: "issuer-policy", permission: "apikey.manage", resourceType: null, constraintJson: null });
  const issued = await issueApiKey({ deps: h.deps, input: h.input });
  assert.deepEqual(await resolveEffectivePermissions({ deps: h.deps.repos, workspaceId: WS, principalId: h.principal.id }), []);
  assert.deepEqual((await h.deps.repos.principalPolicies.listByPrincipalId({ workspaceId: WS, principalId: h.principal.id })).map(row => row.policyId), [issued.apiKey.issuedPolicyId]);
  assert.equal((await authenticateApiKey({ deps: h.deps, input: { workspaceId: WS, rawKey: issued.rawKey } }))?.principal.id, h.principal.id);
});

for (const expiresAt of [null, ""] as const) {
  test(`an explicit ${JSON.stringify(expiresAt)} expiry issues a usable key with no expiry`, async () => {
    const h = await harness();
    const issued = await issueApiKey({ deps: h.deps, input: { ...h.input, expiresAt } });
    assert.equal(issued.apiKey.expiresAt, undefined);
    assert.equal((await authenticateApiKey({ deps: h.deps, input: { workspaceId: WS, rawKey: issued.rawKey } }))?.principal.id, h.principal.id);
  });
}

test("a scoped manager holding the exact permission unconstrained can issue it without a wildcard", async () => {
  const h = await harness();
  await h.deps.repos.policyPermissions.deleteByPolicyId({ workspaceId: WS, policyId: "issuer-policy" });
  for (const permission of ["apikey.manage", "content.read"]) {
    await h.deps.repos.policyPermissions.save({ id: `issuer-${permission}`, workspaceId: WS, policyId: "issuer-policy", permission, resourceType: null, constraintJson: null });
  }
  await h.deps.repos.policyPermissions.deleteByPolicyId({ workspaceId: WS, policyId: "source" });
  await h.deps.repos.policyPermissions.save({ id: "source-read", workspaceId: WS, policyId: "source", permission: "content.read" });
  const issued = await issueApiKey({ deps: h.deps, input: { ...h.input, principalId: ` ${h.principal.id} `, policyIds: [" source "] } });
  const rows = await h.deps.repos.policyPermissions.listByPolicyId({ workspaceId: WS, policyId: issued.apiKey.issuedPolicyId! });
  assert.deepEqual(rows.map(({ permission, resourceType, constraintJson }) => ({ permission, resourceType, constraintJson })),
    [{ permission: "content.read", resourceType: null, constraintJson: null }]);
  assert.equal(issued.apiKey.principalId, h.principal.id);
});

test("revoking a missing key gives the specific not-found error", async () => {
  const h = await harness();
  await assert.rejects(revokeApiKey({ deps: h.deps, input: { workspaceId: WS, callerPrincipalId: "issuer", keyId: "missing" } }), {
    constructor: IdentityNotFoundError, message: "api key 'missing' was not found",
  });
});

test("revocation supports a legacy key without a snapshot policy", async () => {
  const h = await harness();
  const key: ApiKeyRecord = { id: "legacy", workspaceId: WS, principalId: h.principal.id, label: "Legacy", keyHash: "digest:secret", prefix: "test_ak_0123456789ab", createdAt: NOW };
  await h.deps.apiKeys.save(key);
  const expected = { ...key, revokedAt: NOW };
  assert.deepEqual(await revokeApiKey({ deps: h.deps, input: { workspaceId: WS, callerPrincipalId: "issuer", keyId: key.id } }), { apiKey: expected });
  assert.deepEqual(await h.deps.apiKeys.findById({ workspaceId: WS, id: key.id }), expected);
  assert.equal(await authenticateApiKey({ deps: h.deps, input: { workspaceId: WS, rawKey: "test_ak_0123456789ab.secret" } }), null);
});

for (const restriction of [
  { resourceType: "entry", constraintJson: null },
  { resourceType: null, constraintJson: '{"type":"recipe"}' },
]) {
  test(`a constrained wildcard ${JSON.stringify(restriction)} cannot delegate otherwise unheld permissions`, async () => {
    const h = await harness();
    await h.deps.repos.policyPermissions.deleteByPolicyId({ workspaceId: WS, policyId: "issuer-policy" });
    await h.deps.repos.policyPermissions.save({ id: "manage", workspaceId: WS, policyId: "issuer-policy", permission: "apikey.manage", resourceType: null, constraintJson: null });
    await h.deps.repos.policyPermissions.save({ id: "limited-wildcard", workspaceId: WS, policyId: "issuer-policy", permission: "*", ...restriction });
    await assert.rejects(issueApiKey({ deps: h.deps, input: h.input }), error => {
      assert.ok(error instanceof GrantExceedsIssuerError);
      assert.deepEqual(error.offendingPermissions, ["content.read"]);
      assert.equal(error.message, "principal 'issuer' cannot grant permission(s) it does not hold unconstrained: content.read");
      return true;
    });
    assert.deepEqual(await h.deps.apiKeys.listByPrincipalId({ workspaceId: WS, principalId: h.principal.id }), []);
    assert.deepEqual((await h.deps.repos.policies.list({ workspaceId: WS })).map(p => p.id).sort(), ["issuer-policy", "source"]);
  });
}
