import assert from "node:assert/strict";
import { test } from "vitest";

import { parsePublishTrustGrant, PUBLISH_TRUST_GRANT_VERSION } from "../grant.js";

/**
 * @file Branch-by-branch pins for `parsePublishTrustGrant` and its public-key parser: every
 * rejection reason verbatim and the ORDER the fields are checked in. A grant is the trust root of
 * the publishing path, so "which reason wins" is pinned, not just "it is refused".
 */

const KEY = "k".repeat(43);

function doc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: PUBLISH_TRUST_GRANT_VERSION,
    sourceInstallationId: "src-install",
    publicKeys: [{ publicKeyB64u: KEY, generation: 1 }],
    workspaceId: "ws-1",
    entityTypes: ["post"],
    capabilities: ["publish_content.read"],
    notAfter: "2099-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function reasonFor(raw: unknown): string | null {
  const parsed = parsePublishTrustGrant({ raw });
  return parsed.ok ? null : parsed.reason;
}

function keysReason(publicKeys: unknown): string | null {
  return reasonFor(doc({ publicKeys }));
}

test("a well-formed document parses into exactly the grant fields", () => {
  assert.deepEqual(parsePublishTrustGrant({ raw: { ...doc({ capabilities: ["publish_content.read", "publish_content.read"] }), extra: "dropped" } }), {
    ok: true,
    grant: {
      version: PUBLISH_TRUST_GRANT_VERSION,
      sourceInstallationId: "src-install",
      publicKeys: [{ publicKeyB64u: KEY, generation: 1 }],
      workspaceId: "ws-1",
      entityTypes: ["post"],
      capabilities: ["publish_content.read"],
      notAfter: "2099-01-01T00:00:00.000Z",
    },
  });
});

for (const raw of [null, "grant", 7, []]) {
  test(`${JSON.stringify(raw)} is refused as not a JSON object`, () => {
    assert.equal(reasonFor(raw), "grant must be a JSON object");
  });
}

test("an unsupported version is named alongside the implemented one", () => {
  assert.equal(reasonFor(doc({ version: 2 })), "unsupported grant version 2; this install implements version 1");
});

test("a missing version is named as undefined", () => {
  const { version: _version, ...rest } = doc();
  assert.equal(reasonFor(rest), "unsupported grant version undefined; this install implements version 1");
});

test("a string version is refused rather than coerced", () => {
  assert.equal(reasonFor(doc({ version: "1" })), "unsupported grant version 1; this install implements version 1");
});

test("the version is checked before the source installation", () => {
  assert.equal(reasonFor(doc({ version: 0, sourceInstallationId: "" })), "unsupported grant version 0; this install implements version 1");
});

for (const value of ["", "x".repeat(513), 42, undefined]) {
  test(`sourceInstallationId ${JSON.stringify(value)?.slice(0, 12)} is refused`, () => {
    assert.equal(reasonFor(doc({ sourceInstallationId: value })), "'sourceInstallationId' must be a non-empty string");
  });
}

test("a 512-character sourceInstallationId is accepted", () => {
  assert.equal(reasonFor(doc({ sourceInstallationId: "x".repeat(512) })), null);
});

test("the source installation is checked before the workspace", () => {
  assert.equal(reasonFor(doc({ sourceInstallationId: "", workspaceId: "" })), "'sourceInstallationId' must be a non-empty string");
});

test("a non-string workspaceId is refused", () => {
  assert.equal(reasonFor(doc({ workspaceId: 1 })), "'workspaceId' must be a non-empty string");
});

test("the workspace is checked before the expiry", () => {
  assert.equal(reasonFor(doc({ workspaceId: "", notAfter: "never" })), "'workspaceId' must be a non-empty string");
});

for (const notAfter of ["", "never", 4102444800000, "x".repeat(513)]) {
  test(`notAfter ${JSON.stringify(notAfter).slice(0, 12)} is refused`, () => {
    assert.equal(reasonFor(doc({ notAfter })), "'notAfter' must be an ISO-8601 timestamp");
  });
}

test("the expiry is checked before the public keys", () => {
  assert.equal(reasonFor(doc({ notAfter: "never", publicKeys: [] })), "'notAfter' must be an ISO-8601 timestamp");
});

test("the public keys are checked before the capabilities", () => {
  assert.equal(reasonFor(doc({ publicKeys: [], capabilities: [] })), "'publicKeys' must be a non-empty array");
});

test("the capabilities are checked before the entity types", () => {
  assert.equal(reasonFor(doc({ capabilities: [], entityTypes: "post" })), "'capabilities' must be a non-empty array");
});

test("the entity types are checked last", () => {
  assert.equal(reasonFor(doc({ entityTypes: ["*"] })), "'entityTypes' may not use '*'; a publishing grant enumerates its types");
});

for (const publicKeys of [undefined, {}, []]) {
  test(`publicKeys ${JSON.stringify(publicKeys)} is refused as not a non-empty array`, () => {
    assert.equal(keysReason(publicKeys), "'publicKeys' must be a non-empty array");
  });
}

test("five public keys are refused before any entry is inspected", () => {
  assert.equal(keysReason([null, null, null, null, null]), "'publicKeys' must hold at most 4 keys");
});

test("four public keys with distinct generations are accepted", () => {
  assert.equal(keysReason([0, 1, 2, 3].map((generation) => ({ publicKeyB64u: KEY, generation }))), null);
});

for (const entry of [null, "key", 3]) {
  test(`public key entry ${JSON.stringify(entry)} is refused as not an object`, () => {
    assert.equal(keysReason([entry]), "each 'publicKeys' entry must be an object");
  });
}

test("an array entry passes the object check and is refused for its missing key", () => {
  assert.equal(keysReason([[]]), "each 'publicKeys' entry needs a 'publicKeyB64u' string");
});

for (const publicKeyB64u of ["", "k".repeat(513), 9, undefined]) {
  test(`publicKeyB64u ${JSON.stringify(publicKeyB64u)?.slice(0, 12)} is refused`, () => {
    assert.equal(keysReason([{ publicKeyB64u, generation: 1 }]), "each 'publicKeys' entry needs a 'publicKeyB64u' string");
  });
}

test("the key string is checked before the generation", () => {
  assert.equal(keysReason([{ publicKeyB64u: "", generation: -1 }]), "each 'publicKeys' entry needs a 'publicKeyB64u' string");
});

for (const generation of ["1", 1.5, -1, Number.NaN, undefined]) {
  test(`generation ${String(generation)} is refused`, () => {
    assert.equal(keysReason([{ publicKeyB64u: KEY, generation }]), "each 'publicKeys' entry needs a non-negative integer 'generation'");
  });
}

test("generation zero is accepted", () => {
  assert.equal(keysReason([{ publicKeyB64u: KEY, generation: 0 }]), null);
});

test("a repeated generation is refused and named", () => {
  assert.equal(
    keysReason([{ publicKeyB64u: KEY, generation: 1 }, { publicKeyB64u: "other", generation: 1 }]),
    "'publicKeys' repeats generation 1"
  );
});

test("the first bad entry decides the reason", () => {
  assert.equal(
    keysReason([{ publicKeyB64u: KEY, generation: 1 }, null, { publicKeyB64u: KEY, generation: 1 }]),
    "each 'publicKeys' entry must be an object"
  );
});

test("parsed keys carry only the key and generation, in document order", () => {
  const parsed = parsePublishTrustGrant({ raw: doc({ publicKeys: [{ publicKeyB64u: "b", generation: 2, note: "x" }, { publicKeyB64u: "a", generation: 1 }] }) });
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.grant.publicKeys, [{ publicKeyB64u: "b", generation: 2 }, { publicKeyB64u: "a", generation: 1 }]);
});
