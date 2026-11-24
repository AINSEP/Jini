import assert from "node:assert/strict";
import { test } from "vitest";

import {
  backstopGrantAllows,
  grantAllowsCapability,
  grantAllowsEntityType,
  isGrantActive,
  isBackstopEntityType,
  isPublishTrustRoute,
  parsePublishTrustGrant,
  PUBLISH_TRUST_GRANT_VERSION,
  PUBLISH_TRUST_ROUTES,
} from "../grant.js";

/**
 * @file Authority-narrowing proofs for the publishing grant.
 *
 * The headline property, and the direct answer to Codex's finding that publishing rides the general
 * auth path on ordinary `content.write`: **a stolen publishing credential must not be able to do
 * more than publish.** The two tests that prove it are "a grant claiming content.write is refused"
 * and "the create-post route is not a publishing route".
 */

function validGrantDoc(overrides: Record<string, unknown> = {}) {
  return {
    version: PUBLISH_TRUST_GRANT_VERSION,
    sourceInstallationId: "src-install",
    publicKeys: [{ publicKeyB64u: "AAAA", generation: 1 }],
    workspaceId: "ws-1",
    entityTypes: ["post", "media"],
    capabilities: ["publish_content.read", "publish_content.apply"],
    notAfter: "2099-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function parseOrThrow(doc: Record<string, unknown>) {
  const result = parsePublishTrustGrant({ raw: doc });
  assert.ok(result.ok, `expected a valid grant, got: ${result.ok ? "" : result.reason}`);
  return result.grant;
}

test("a well-formed grant parses", () => {
  const grant = parseOrThrow(validGrantDoc());
  assert.equal(grant.sourceInstallationId, "src-install");
  assert.deepEqual(grant.capabilities, ["publish_content.read", "publish_content.apply"]);
});

test("backstop entity classification accepts only the two raw entity types", () => {
  for (const entityType of ["raw-row", "raw-file"]) {
    assert.equal(isBackstopEntityType({ entityType }), true);
  }
  for (const entityType of ["", "post", "raw", "raw-row/child"]) {
    assert.equal(isBackstopEntityType({ entityType }, {}), false);
  }
});

test("a backstop-capable grant still refuses an entity type it did not enumerate", () => {
  assert.equal(backstopGrantAllows({
    grant: { capabilities: ["publish_content.apply", "publish_content.backstop"], entityTypes: ["raw-row"] },
    entityType: "raw-file",
  }, {}), false);
});

test("a public key generation must be a non-negative integer", () => {
  for (const generation of [undefined, null, "1", -1, 0.5, NaN, Infinity]) {
    assert.deepEqual(parsePublishTrustGrant({ raw: validGrantDoc({ publicKeys: [{ publicKeyB64u: "AAAA", generation }] }) }), {
      ok: false, reason: "each 'publicKeys' entry needs a non-negative integer 'generation'",
    });
  }
  assert.deepEqual(parseOrThrow(validGrantDoc({ publicKeys: [{ publicKeyB64u: "AAAA", generation: 0 }] })).publicKeys,
    [{ publicKeyB64u: "AAAA", generation: 0 }]);
});

test("a grant requires a bounded parseable expiry", () => {
  for (const notAfter of [undefined, null, 42, "", "x".repeat(513), "not-a-date"]) {
    assert.deepEqual(parsePublishTrustGrant({ raw: validGrantDoc({ notAfter }) }), {
      ok: false, reason: "'notAfter' must be an ISO-8601 timestamp",
    });
  }
});

test("repeated capabilities are accepted once, preserving the first occurrence order", () => {
  const capabilities = ["publish_content.apply", "publish_content.read", "publish_content.apply"];
  assert.deepEqual(parseOrThrow(validGrantDoc({ capabilities })).capabilities,
    ["publish_content.apply", "publish_content.read"]);
  assert.deepEqual(capabilities, ["publish_content.apply", "publish_content.read", "publish_content.apply"]);
});

test("an invalid expiry on a hand-built grant is inactive with a valid clock", () => {
  const grant = parseOrThrow(validGrantDoc());
  assert.equal(isGrantActive({ grant: { ...grant, notAfter: "invalid" }, nowIso: "2026-10-16T00:00:00Z" }), false);
});

test("a grant claiming content.write is REFUSED — publishing authority cannot be widened", () => {
  const result = parsePublishTrustGrant({ raw: validGrantDoc({ capabilities: ["publish_content.apply", "content.write"] }) });
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /content\.write.*not a publishing capability/);
});

test("a grant claiming a wildcard capability is REFUSED", () => {
  for (const claimed of ["*", "admin.*", "publish_content.*"]) {
    const result = parsePublishTrustGrant({ raw: validGrantDoc({ capabilities: [claimed] }) });
    assert.equal(result.ok, false, `'${claimed}' must not parse as a publishing capability`);
  }
});

test("a bad capability is refused outright, never silently filtered down to the good ones", () => {
  // Filtering would report success to whoever provisioned the grant and hide the widening attempt.
  const result = parsePublishTrustGrant({ raw: validGrantDoc({ capabilities: ["publish_content.read", "admin.security.tokens.manage"] }) });
  assert.equal(result.ok, false);
});

test("an unknown grant version is refused rather than guessed at", () => {
  const result = parsePublishTrustGrant({ raw: validGrantDoc({ version: 99 }) });
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /unsupported grant version 99/);
});

test("a grant with no public keys is refused", () => {
  assert.equal(parsePublishTrustGrant({ raw: validGrantDoc({ publicKeys: [] }) }).ok, false);
  assert.equal(parsePublishTrustGrant({ raw: validGrantDoc({ publicKeys: "AAAA" }) }).ok, false);
});

test("a grant accepts four public keys but refuses a fifth", () => {
  const publicKeys = Array.from({ length: 5 }, (_, generation) => ({ publicKeyB64u: "AAAA", generation }));
  assert.equal(parseOrThrow(validGrantDoc({ publicKeys: publicKeys.slice(0, 4) })).publicKeys.length, 4);
  assert.deepEqual(parsePublishTrustGrant({ raw: validGrantDoc({ publicKeys }) }), {
    ok: false,
    reason: "'publicKeys' must hold at most 4 keys",
  });
});

test("a grant refuses non-object public key entries without throwing", () => {
  for (const entry of [null, 42, "AAAA"]) {
    assert.deepEqual(parsePublishTrustGrant({ raw: validGrantDoc({ publicKeys: [entry] }) }), {
      ok: false,
      reason: "each 'publicKeys' entry must be an object",
    });
  }
});

test("a grant requires a bounded non-empty public key string", () => {
  for (const publicKeyB64u of [undefined, null, 42, "", "x".repeat(513)]) {
    assert.deepEqual(parsePublishTrustGrant({ raw: validGrantDoc({ publicKeys: [{ publicKeyB64u, generation: 1 }] }) }), {
      ok: false,
      reason: "each 'publicKeys' entry needs a 'publicKeyB64u' string",
    });
  }
});

test("a grant requires a non-empty capabilities array", () => {
  for (const capabilities of [[], undefined, null, {}, "publish_content.read"]) {
    assert.deepEqual(parsePublishTrustGrant({ raw: validGrantDoc({ capabilities }) }), {
      ok: false,
      reason: "'capabilities' must be a non-empty array",
    });
  }
});

for (const field of ["sourceInstallationId", "workspaceId"]) {
  test(`a grant requires a bounded non-empty ${field}`, () => {
    for (const value of [undefined, null, 42, "", "x".repeat(513)]) {
      assert.deepEqual(parsePublishTrustGrant({ raw: validGrantDoc({ [field]: value }) }), {
        ok: false,
        reason: `'${field}' must be a non-empty string`,
      });
    }
  });
}

test("two public keys claiming the same generation are refused, not de-duplicated", () => {
  const result = parsePublishTrustGrant({ raw: validGrantDoc({
      publicKeys: [
        { publicKeyB64u: "AAAA", generation: 1 },
        { publicKeyB64u: "BBBB", generation: 1 },
      ],
    }) });
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /repeats generation 1/);
});

test("a rotation overlap — two keys, two generations — is accepted", () => {
  const grant = parseOrThrow(
    validGrantDoc({
      publicKeys: [
        { publicKeyB64u: "AAAA", generation: 1 },
        { publicKeyB64u: "BBBB", generation: 2 },
      ],
    })
  );
  assert.equal(grant.publicKeys.length, 2);
});

test("entityTypes may not use a wildcard", () => {
  assert.equal(parsePublishTrustGrant({ raw: validGrantDoc({ entityTypes: ["*"] }) }).ok, false);
});

test("a grant requires an entityTypes array", () => {
  for (const entityTypes of [undefined, null, {}, "post"]) {
    assert.deepEqual(parsePublishTrustGrant({ raw: validGrantDoc({ entityTypes }) }), {
      ok: false,
      reason: "'entityTypes' must be an array",
    });
  }
});

test("a grant accepts 64 entity types but refuses a 65th", () => {
  const entityTypes = Array.from({ length: 65 }, (_, i) => `type-${i}`);
  assert.deepEqual(parseOrThrow(validGrantDoc({ entityTypes: entityTypes.slice(0, 64) })).entityTypes, entityTypes.slice(0, 64));
  assert.deepEqual(parsePublishTrustGrant({ raw: validGrantDoc({ entityTypes }) }), {
    ok: false,
    reason: "'entityTypes' must hold at most 64 types",
  });
});

test("a grant requires bounded non-empty entity type strings", () => {
  for (const entry of [undefined, null, 42, "", "x".repeat(513)]) {
    assert.deepEqual(parsePublishTrustGrant({ raw: validGrantDoc({ entityTypes: [entry] }) }), {
      ok: false,
      reason: "each 'entityTypes' entry must be a non-empty string",
    });
  }
});

test("an empty entityTypes list grants NOTHING — silence is not 'all'", () => {
  const grant = parseOrThrow(validGrantDoc({ entityTypes: [] }));
  assert.equal(grantAllowsEntityType({ grant, entityType: "post" }), false);
  assert.equal(grantAllowsEntityType({ grant, entityType: "media" }), false);
});

test("an entity type outside the grant is refused", () => {
  const grant = parseOrThrow(validGrantDoc({ entityTypes: ["post"] }));
  assert.equal(grantAllowsEntityType({ grant, entityType: "post" }), true);
  assert.equal(grantAllowsEntityType({ grant, entityType: "media" }), false);
});

test("a capability outside the grant is refused", () => {
  const grant = parseOrThrow(validGrantDoc({ capabilities: ["publish_content.read"] }));
  assert.equal(grantAllowsCapability({ grant, capability: "publish_content.read" }), true);
  assert.equal(grantAllowsCapability({ grant, capability: "publish_content.apply" }), false);
  assert.equal(grantAllowsCapability({ grant, capability: "content.write" }), false);
});

test("an EXPIRED grant is well-formed but inactive — revocation is target-side", () => {
  const grant = parseOrThrow(validGrantDoc({ notAfter: "2020-01-01T00:00:00.000Z" }));
  assert.equal(isGrantActive({ grant, nowIso: "2026-09-19T00:00:00.000Z" }), false);
  assert.equal(isGrantActive({ grant, nowIso: "2019-01-01T00:00:00.000Z" }), true);
});

test("a grant expires exactly at notAfter, not a moment later", () => {
  const grant = parseOrThrow(validGrantDoc({ notAfter: "2026-09-19T00:00:00.000Z" }));
  assert.equal(isGrantActive({ grant, nowIso: "2026-09-18T23:59:59.999Z" }), true);
  assert.equal(isGrantActive({ grant, nowIso: "2026-09-19T00:00:00.000Z" }), false);
});

test("an unparseable clock is treated as inactive, never as valid", () => {
  const grant = parseOrThrow(validGrantDoc());
  assert.equal(isGrantActive({ grant, nowIso: "not-a-timestamp" }), false);
});

test("a non-object grant is refused", () => {
  for (const bad of [null, undefined, "grant", 42, ["grant"]]) {
    assert.equal(parsePublishTrustGrant({ raw: bad }).ok, false);
  }
});

test("every publishing route is reachable by a publishing credential", () => {
  const base = "/api/admin/v1/workspaces/:workspaceId/publish-content";
  const artifacts = "/api/admin/v1/workspaces/:workspaceId/site-shares/artifacts/:token/:file";
  const required = [
    { method: "PUT", path: artifacts },
    { method: "DELETE", path: artifacts },
    { method: "GET", path: `${base}/export` },
    { method: "GET", path: `${base}/capabilities` },
    { method: "POST", path: `${base}/blobs/probe` },
    { method: "PUT", path: `${base}/blobs/:sha` },
    { method: "GET", path: `${base}/blobs/:sha` },
    { method: "POST", path: `${base}/bundles` },
    { method: "POST", path: `${base}/import/plan` },
    { method: "POST", path: `${base}/import/confirm` },
    { method: "POST", path: `${base}/import/execute` },
  ];
  assert.deepEqual(PUBLISH_TRUST_ROUTES, required);
  for (const route of required) {
    const concrete = route.path.replace(":workspaceId", "ws-1").replace(":sha", "a".repeat(64)).replace(":token", "b".repeat(64)).replace(":file", "site.tovu.zip");
    assert.equal(isPublishTrustRoute({ method: route.method, path: concrete }), true, `${route.method} ${concrete}`);
  }
  for (const route of PUBLISH_TRUST_ROUTES) {
    const concrete = route.path.replace(":workspaceId", "ws-1").replace(":sha", "a".repeat(64)).replace(":token", "b".repeat(64)).replace(":file", "site.tovu.zip");
    assert.equal(isPublishTrustRoute({ method: route.method, path: concrete }), true, `${route.method} ${concrete}`);
  }
});

test("the create-post route is NOT a publishing route — a stolen publish credential cannot write posts", () => {
  // Codex's finding: `routes/posts/create.ts` accepts ordinary `content.write`, the same capability
  // the publish adapter asks for. This is the structural reason a publishing credential cannot
  // reach it regardless of what any grant claims.
  assert.equal(isPublishTrustRoute({ method: "POST", path: "/api/admin/v1/workspaces/ws-1/posts" }), false);
  assert.equal(isPublishTrustRoute({ method: "PUT", path: "/api/admin/v1/workspaces/ws-1/posts/post-1" }), false);
  assert.equal(isPublishTrustRoute({ method: "POST", path: "/api/admin/v1/workspaces/ws-1/api-keys" }), false);
  assert.equal(isPublishTrustRoute({ method: "GET", path: "/api/admin/v1/system/site-key" }), false);
});

test("the peers routes are NOT reachable — a publishing credential cannot edit publishing config", () => {
  assert.equal(isPublishTrustRoute({ method: "GET", path: "/api/admin/v1/workspaces/ws-1/publish-content/peers" }), false);
  assert.equal(isPublishTrustRoute({ method: "POST", path: "/api/admin/v1/workspaces/ws-1/publish-content/peers" }), false);
  assert.equal(isPublishTrustRoute({ method: "DELETE", path: "/api/admin/v1/workspaces/ws-1/publish-content/peers/p-1" }), false);
});

test("the wrong method on a publishing path is refused", () => {
  assert.equal(isPublishTrustRoute({ method: "DELETE", path: "/api/admin/v1/workspaces/ws-1/publish-content/bundles" }), false);
  assert.equal(isPublishTrustRoute({ method: "POST", path: "/api/admin/v1/workspaces/ws-1/publish-content/export" }), false);
});

test("a :param matches exactly one real segment — no traversal, no empty, no swallowing", () => {
  const base = "/api/admin/v1/workspaces";
  assert.equal(isPublishTrustRoute({ method: "PUT", path: `${base}/ws-1/publish-content/blobs/..` }), false);
  assert.equal(isPublishTrustRoute({ method: "PUT", path: `${base}/ws-1/publish-content/blobs/.` }), false);
  assert.equal(isPublishTrustRoute({ method: "PUT", path: `${base}/ws-1/publish-content/blobs/` }), false);
  assert.equal(isPublishTrustRoute({ method: "PUT", path: `${base}/ws-1/publish-content/blobs/a/b` }), false);
  assert.equal(isPublishTrustRoute({ method: "POST", path: `${base}/ws-1/publish-content/bundles/extra` }), false);
});

test("a path that merely starts with a publishing route is refused", () => {
  assert.equal(
    isPublishTrustRoute({ method: "POST", path: "/api/admin/v1/workspaces/ws-1/publish-content/bundles-and-more" }),
    false
  );
});

test("a query string does not smuggle a path past the check", () => {
  assert.equal(
    isPublishTrustRoute({ method: "POST", path: "/api/admin/v1/workspaces/ws-1/publish-content/bundles?x=1" }),
    true
  );
  assert.equal(isPublishTrustRoute({ method: "POST", path: "/api/admin/v1/workspaces/ws-1/posts?x=/publish-content/bundles" }), false);
});
