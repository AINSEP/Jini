import { describe, expect, it } from "vitest";

import { InMemoryPolicyPermissionRepo, InMemoryPolicyRepo, InMemoryPrincipalPolicyRepo, InMemoryPrincipalRepo, InMemoryPrincipalRoleRepo, InMemoryRolePolicyRepo, InMemoryRoleRepo, InMemorySessionRepo, InMemoryUserRepo, NodeSessionTokens, createTransactionalInMemoryIdentityRepos } from "../../../../server/index.js";
import { createApiKeySecret } from "../../../../identity/api-key-secret.js";
import { createApiKeyPrincipal, createApiKeyService, revokeApiKey, type ApiKeyServiceDeps } from "../../../../identity/api-key-service.js";
import { InMemoryApiKeyRepo } from "../../../../identity/repo.memory.js";
import { toApiKeyIssueResponse } from "../../../http/api-keys.js";
import { refusalOf, signal } from "../../users/__tests__/helpers.js";
import { apiKeyPrincipalCreateRoute } from "../create-principal.js";
import { apiKeyIssueRoute } from "../issue.js";
import { apiKeyRevokeRoute } from "../revoke.js";
import { API_KEY_SESSION_CREDENTIAL_GATE } from "../shared.js";

const WS = "ws-ak";
const NOW = "2026-10-01T12:00:00.000Z";
const { issueApiKey } = createApiKeyService({ keySecret: createApiKeySecret({ prefix: "test_ak_" }) });

async function harness() {
  let id = 0;
  const services: ApiKeyServiceDeps = {
    tokens: new NodeSessionTokens({}),
    repos: createTransactionalInMemoryIdentityRepos({ repos: { principals: new InMemoryPrincipalRepo({}), users: new InMemoryUserRepo({}), sessions: new InMemorySessionRepo({}), roles: new InMemoryRoleRepo({}), policies: new InMemoryPolicyRepo({}), policyPermissions: new InMemoryPolicyPermissionRepo({}), principalPolicies: new InMemoryPrincipalPolicyRepo({}), principalRoles: new InMemoryPrincipalRoleRepo({}), rolePolicies: new InMemoryRolePolicyRepo({}) } }),
    apiKeys: new InMemoryApiKeyRepo(), clock: { nowMs: () => Date.parse(NOW) }, idGen: { newId: () => `ak-${++id}` },
    hasher: { hash: async ({ password }) => `password:${password}`, verify: async ({ hash, password }) => hash === `password:${password}` },
    secretHasher: { hash: async ({ secret }) => `digest:${secret}`, verify: async ({ storedHash, secret }) => storedHash === `digest:${secret}` },
  };
  const { repos } = services;
  for (const [pid, kind] of [["operator", "user"], ["viewer", "user"], ["machine", "api_key"]] as const) {
    await repos.principals.save({ id: pid, workspaceId: WS, kind, displayName: pid, status: "active", createdAt: NOW });
  }
  await repos.policies.save({ id: "manage", workspaceId: WS, name: "manage", isBuiltin: false, isFrozen: false });
  await repos.policyPermissions.save({ id: "manage-perm", workspaceId: WS, policyId: "manage", permission: "apikey.manage", resourceType: null, constraintJson: null });
  await repos.principalPolicies.save({ id: "operator-grant", workspaceId: WS, principalId: "operator", policyId: "manage" });
  await repos.policies.save({ id: "wide", workspaceId: WS, name: "wide", isBuiltin: false, isFrozen: false });
  await repos.policyPermissions.save({ id: "wide-perm", workspaceId: WS, policyId: "wide", permission: "content.write", resourceType: null, constraintJson: null });
  const deps = { workspaceId: WS, apiKeyServices: () => services, createApiKeyPrincipal, issueApiKey, revokeApiKey };
  return { services, deps };
}
const asOperator = { id: "operator" };
const asViewer = { id: "viewer" };
const raw = (params: Record<string, string>, body?: unknown) => ({ body, query: {}, params });

describe("api-key admin route specs", () => {
  it("keeps each route's method, path and success status", () => {
    expect([apiKeyPrincipalCreateRoute, apiKeyIssueRoute, apiKeyRevokeRoute].map((r) => [r.method, r.path, r.successStatus])).toEqual([
      ["post", "/api/admin/v1/api-keys/principals", 201], ["post", "/api/admin/v1/api-keys", 201], ["post", "/api/admin/v1/api-keys/:id/revoke", 204],
    ]);
  });

  it("carries the no-escalation gate's exact copy for the host's session-credential gate", () => {
    expect(API_KEY_SESSION_CREDENTIAL_GATE).toEqual({ message: "api-key credentials may not manage api keys; use an admin session", permission: "apikey.manage" });
  });

  it("parses body fields as-is (no coercion) and tolerates a missing body; revoke keeps the `?? \"\"` id fallback", () => {
    expect(apiKeyPrincipalCreateRoute.parse(raw({}, { displayName: 7, kind: "user" }))).toEqual({ ok: true, value: { displayName: 7, kind: "user" } });
    expect(apiKeyPrincipalCreateRoute.parse(raw({}))).toEqual({ ok: true, value: { displayName: undefined, kind: undefined } });
    expect(apiKeyIssueRoute.parse(raw({}, { principalId: "m", label: "L", policyIds: ["p"], expiresAt: null, extra: 1 }))).toEqual({ ok: true, value: { principalId: "m", label: "L", policyIds: ["p"], expiresAt: null } });
    expect(apiKeyIssueRoute.parse(raw({}, null))).toEqual({ ok: true, value: { principalId: undefined, label: undefined, policyIds: undefined, expiresAt: undefined } });
    expect(apiKeyRevokeRoute.parse(raw({ id: "k1" }))).toEqual({ ok: true, value: { keyId: "k1" } });
    expect(apiKeyRevokeRoute.parse(raw({}))).toEqual({ ok: true, value: { keyId: "" } });
  });

  it("mints a grantless api_key principal in the caller's own workspace", async () => {
    const { deps, services } = await harness();
    const result = await apiKeyPrincipalCreateRoute.handle({ input: { displayName: "  Runner  ", kind: undefined }, deps, context: asOperator }, { signal });
    expect(result).toEqual({ ok: true, value: { principal: { id: "ak-1", kind: "api_key", status: "active", workspaceId: WS, displayName: "Runner" } } });
    expect((await services.repos.principals.findById({ workspaceId: WS, id: "ak-1" }))?.kind).toBe("api_key");
  });

  it("issues a key and answers the one-time rawKey exactly once, never the stored hash", async () => {
    const { deps, services } = await harness();
    const result = await apiKeyIssueRoute.handle({ input: { principalId: "machine", label: "Build", policyIds: ["manage"], expiresAt: undefined }, deps, context: asOperator }, { signal });
    if (!result.ok) throw new Error("expected success");
    const { apiKey } = result.value;
    expect(Object.keys(apiKey)).toEqual(["id", "rawKey", "principalId", "label", "expiresAt"]);
    expect(apiKey).toMatchObject({ principalId: "machine", label: "Build", expiresAt: null });
    const stored = await services.apiKeys.findById({ workspaceId: WS, id: apiKey.id });
    expect(stored?.keyHash).toBe(`digest:${apiKey.rawKey.split(".")[1]}`);
    expect(JSON.stringify(result.value)).not.toContain("digest:");
  });

  it("revokes a key by id (204, no body), idempotently", async () => {
    const { deps, services } = await harness();
    const { apiKey } = await issueApiKey({ deps: services, input: { workspaceId: WS, callerPrincipalId: "operator", principalId: "machine", label: "K", policyIds: ["manage"] } });
    for (let n = 0; n < 2; n++) {
      expect(await apiKeyRevokeRoute.handle({ input: { keyId: apiKey.id }, deps, context: asOperator }, { signal })).toEqual({ ok: true, value: undefined });
    }
    expect((await services.apiKeys.findById({ workspaceId: WS, id: apiKey.id }))?.revokedAt).toBe(NOW);
  });

  describe("refusals (the hand-written `sendApiKeyError` ladder)", () => {
    it("403 FORBIDDEN with permission details for a caller without apikey.manage, on every route, writing nothing", async () => {
      const { deps, services } = await harness();
      const { apiKey } = await issueApiKey({ deps: services, input: { workspaceId: WS, callerPrincipalId: "operator", principalId: "machine", label: "K", policyIds: ["manage"] } });
      const calls = [
        () => apiKeyPrincipalCreateRoute.handle({ input: { displayName: "x", kind: undefined }, deps, context: asViewer }),
        () => apiKeyIssueRoute.handle({ input: { principalId: "machine", label: "x", policyIds: [], expiresAt: undefined }, deps, context: asViewer }),
        () => apiKeyRevokeRoute.handle({ input: { keyId: apiKey.id }, deps, context: asViewer }),
      ];
      for (const call of calls) {
        const refusal = await refusalOf(call);
        expect(refusal.status).toBe(403);
        expect(refusal.body).toMatchObject({ code: "FORBIDDEN", details: { permission: "apikey.manage" } });
        expect(Object.keys(refusal.body as object)).toEqual(["error", "code", "details"]);
      }
      expect((await services.apiKeys.findById({ workspaceId: WS, id: apiKey.id }))?.revokedAt ?? null).toBeNull();
    });

    it("403 GRANT_EXCEEDS_ISSUER with the offending permissions when issuing beyond the caller's grants", async () => {
      const { deps } = await harness();
      expect(await refusalOf(() => apiKeyIssueRoute.handle({ input: { principalId: "machine", label: "x", policyIds: ["wide"], expiresAt: undefined }, deps, context: asOperator }))).toMatchObject({
        status: 403, body: { code: "GRANT_EXCEEDS_ISSUER", details: { offendingPermissions: ["content.write"] } },
      });
    });

    it("400 VALIDATION_ERROR for a bad body (wrong kind, missing label)", async () => {
      const { deps } = await harness();
      expect(await refusalOf(() => apiKeyPrincipalCreateRoute.handle({ input: { displayName: "x", kind: "user" }, deps, context: asOperator }))).toEqual({
        status: 400, body: { error: "'kind' must be 'api_key', got 'user'", code: "VALIDATION_ERROR" },
      });
      expect((await refusalOf(() => apiKeyIssueRoute.handle({ input: { principalId: "machine", label: undefined, policyIds: ["manage"], expiresAt: undefined }, deps, context: asOperator }))).status).toBe(400);
    });

    it("404 RESOURCE_NOT_FOUND for an unknown or foreign key id, revoking nothing", async () => {
      const { deps } = await harness();
      expect(await refusalOf(() => apiKeyRevokeRoute.handle({ input: { keyId: "someone-elses" }, deps, context: asOperator }))).toEqual({
        status: 404, body: { error: "api key 'someone-elses' was not found", code: "RESOURCE_NOT_FOUND" },
      });
    });

    it("rethrows an unmapped failure unchanged for the host's redacted 500", async () => {
      const { deps } = await harness();
      const boom = new Error("db fault /private/keys.db");
      const failing = { ...deps, revokeApiKey: async () => { throw boom; } };
      await expect(apiKeyRevokeRoute.handle({ input: { keyId: "k" }, deps: failing, context: asOperator })).rejects.toBe(boom);
    });
  });

  it("the issue DTO takes rawKey separately and never forwards keyHash", () => {
    const apiKey = { id: "k", principalId: "m", label: "L", keyHash: "digest:secret", workspaceId: WS } as unknown as Parameters<typeof toApiKeyIssueResponse>[0]["apiKey"];
    expect(toApiKeyIssueResponse({ apiKey, rawKey: "raw" })).toEqual({ id: "k", rawKey: "raw", principalId: "m", label: "L", expiresAt: null });
  });
});
