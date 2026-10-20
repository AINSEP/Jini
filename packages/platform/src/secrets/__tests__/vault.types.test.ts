import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { assertVaultReplacement, vaultGroupKey, VaultError, type VaultRecord } from "../credential-sets/index.js";

function row(patch: Partial<VaultRecord> = {}): VaultRecord {
  return { workspaceId: "ws", id: "a", kind: "site-assistant", ownerKey: "owner", principalId: "p", binding: "b",
    provider: "host", label: "Main", isDefault: true, revision: 1, sealed: null, last4: null, tokenLength: null,
    meta: {}, createdAt: "2026-10-11T00:00:00Z", updatedAt: "2026-10-11T00:00:00Z", ...patch };
}
const conflict = { code: "conflict", message: "Secrets vault: conflict", name: "VaultError" };
const invalidRecord = { code: "invalid-record", message: "Secrets vault: invalid-record", name: "VaultError" };
const contextError = { code: "context", message: "Secrets vault: context", name: "VaultError" };

describe("VaultError", () => {
  test("carries only the safe code in its message", () => {
    const error = new VaultError({ code: "invalid-meta" });
    assert.ok(error instanceof Error);
    assert.deepEqual([error.name, error.code, error.message], ["VaultError", "invalid-meta", "Secrets vault: invalid-meta"]);
  });
});

describe("vaultGroupKey", () => {
  test("encodes the default-group tuple as JSON", () => {
    assert.equal(vaultGroupKey({ record: row({ principalId: null, provider: null }) }), '["ws","site-assistant","owner",null,null]');
  });
});

describe("assertVaultReplacement CAS", () => {
  test("create accepts revision 1 with no existing row", () => {
    assert.equal(assertVaultReplacement({ record: row(), existing: null, expectedRevision: null }), undefined);
  });

  test("create conflicts when a row already exists", () => {
    assert.throws(() => assertVaultReplacement({ record: row(), existing: row(), expectedRevision: null }), conflict);
  });

  test("replace conflicts when no row exists", () => {
    assert.throws(() => assertVaultReplacement({ record: row({ revision: 2 }), existing: null, expectedRevision: 1 }), conflict);
  });

  test("replace conflicts on a stale revision", () => {
    assert.throws(() => assertVaultReplacement({ record: row({ revision: 3 }), existing: row({ revision: 1 }), expectedRevision: 2 }), conflict);
  });

  test("replace accepts the next revision of the same identity", () => {
    assert.equal(assertVaultReplacement({ record: row({ revision: 2, label: "New", provider: "other", meta: { x: 1 } }), existing: row(), expectedRevision: 1 }), undefined);
  });

  test("create refuses a revision other than 1", () => {
    assert.throws(() => assertVaultReplacement({ record: row({ revision: 2 }), existing: null, expectedRevision: null }), invalidRecord);
  });

  test("replace refuses a revision that is not exactly expected + 1", () => {
    assert.throws(() => assertVaultReplacement({ record: row({ revision: 3 }), existing: row(), expectedRevision: 1 }), invalidRecord);
  });

  test("refuses a non-integer revision", () => {
    assert.throws(() => assertVaultReplacement({ record: row({ revision: 1.5 }), existing: null, expectedRevision: null }), invalidRecord);
  });

  test("refuses an unsafe-integer revision even when arithmetic matches", () => {
    const expectedRevision = Number.MAX_SAFE_INTEGER;
    const existing = row({ revision: expectedRevision });
    assert.throws(() => assertVaultReplacement({ record: row({ revision: expectedRevision + 1 }), existing, expectedRevision }), invalidRecord);
  });

  test("conflict is reported before an invalid revision", () => {
    assert.throws(() => assertVaultReplacement({ record: row({ revision: 9 }), existing: row(), expectedRevision: null }), conflict);
  });
});

describe("assertVaultReplacement immutable identity", () => {
  const changes: [string, Partial<VaultRecord>][] = [
    ["workspaceId", { workspaceId: "other" }], ["kind", { kind: "media-provider" }], ["ownerKey", { ownerKey: "other" }],
    ["principalId", { principalId: null }], ["id", { id: "b" }], ["binding", { binding: null }], ["createdAt", { createdAt: "later" }],
  ];
  for (const [field, change] of changes) {
    test(`refuses a changed ${field}`, () => {
      assert.throws(() => assertVaultReplacement({ record: row({ revision: 2, ...change }), existing: row(), expectedRevision: 1 }), contextError);
    });
  }

  test("invalid revision is reported before an identity change", () => {
    assert.throws(() => assertVaultReplacement({ record: row({ revision: 5, id: "b" }), existing: row(), expectedRevision: 1 }), invalidRecord);
  });
});

describe("assertVaultReplacement vendor subtype", () => {
  const vendor = (meta: VaultRecord["meta"], revision = 1) => row({ kind: "vendor", meta, revision });

  test("missing subtype on both sides is treated as vendor", () => {
    assert.equal(assertVaultReplacement({ record: vendor({}, 2), existing: vendor({}), expectedRevision: 1 }), undefined);
  });

  test("missing previous subtype accepts an explicit vendor subtype", () => {
    assert.equal(assertVaultReplacement({ record: vendor({ credentialType: "vendor" }, 2), existing: vendor({}), expectedRevision: 1 }), undefined);
  });

  test("explicit previous vendor subtype accepts a missing next subtype", () => {
    assert.equal(assertVaultReplacement({ record: vendor({}, 2), existing: vendor({ credentialType: "vendor" }), expectedRevision: 1 }), undefined);
  });

  test("refuses a vendor to custom subtype change", () => {
    assert.throws(() => assertVaultReplacement({ record: vendor({ credentialType: "custom" }, 2), existing: vendor({}), expectedRevision: 1 }), contextError);
  });

  test("refuses a custom to missing subtype change", () => {
    assert.throws(() => assertVaultReplacement({ record: vendor({}, 2), existing: vendor({ credentialType: "custom" }), expectedRevision: 1 }), contextError);
  });

  test("explicit null subtype is not the vendor default", () => {
    assert.throws(() => assertVaultReplacement({ record: vendor({}, 2), existing: vendor({ credentialType: null }), expectedRevision: 1 }), contextError);
  });

  test("non-vendor kinds may change subtype metadata", () => {
    const existing = row({ meta: { credentialType: "vendor" } });
    assert.equal(assertVaultReplacement({ record: row({ revision: 2, meta: { credentialType: "custom" } }), existing, expectedRevision: 1 }), undefined);
  });
});
