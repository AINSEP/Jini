import { messages as federationMessages, clientInfo, testPermissionGate } from "./fixtures.js";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test, onTestFinished, vi } from "vitest";
import { federatedToolApprovalFingerprint, type FederatedToolIdentity } from "../tool-approvals.js";

const identity: FederatedToolIdentity = {
  "connectionId": "service",
  "remoteName": "inspect",
  "declaredAnnotations": {
    "readOnlyHint": true,
    "destructiveHint": false
  },
  "origin": {
    "kind": "roster",
    "admissionRevision": "revision-1"
  },
  "description": "Inspect records",
  "inputSchema": {
    "type": "object",
    "properties": {
      "limit": {
        "type": "integer"
      }
    },
    "additionalProperties": false
  }
};
// Manually derived from the source's ordered array and canonicalJson sorted object keys.
const preimage = "[\"g3-approval-v2\",\"service\",[\"roster\",\"revision-1\"],\"inspect\",{\"destructiveHint\":false,\"readOnlyHint\":true},\"Inspect records\",{\"additionalProperties\":false,\"properties\":{\"limit\":{\"type\":\"integer\"}},\"type\":\"object\"}]";
const expected = "52563c77027dd3082f7517c9c2511035936c27fc9d3d7cca2fa257a2d663ce09";

// PARITY
test("approval v2 keeps the stored fingerprint byte-identical", () => {
  assert.equal(federatedToolApprovalFingerprint({ identity, fingerprintDomain: "g3-approval-v2" }), expected);
  assert.equal(createHash("sha256").update(preimage).digest("hex"), expected);
});
// PARITY
test("nested key order is canonical; drift invalidates approval", () => {
  assert.equal(federatedToolApprovalFingerprint({ fingerprintDomain: "g3-approval-v2", identity: { ...identity, inputSchema: {
    properties: { limit: { type: "integer" } }, type: "object", additionalProperties: false,
  }}}), expected);
  for (const changed of [
    { ...identity, description: "Changed" },
    { ...identity, origin: { kind: "roster" as const, admissionRevision: "revision-2" } },
    { ...identity, declaredAnnotations: { readOnlyHint: false } },
    { ...identity, inputSchema: { type: "object" } },
  ]) assert.notEqual(federatedToolApprovalFingerprint({ identity: changed, fingerprintDomain: "g3-approval-v2" }), expected);
});

// REGRESSION: fails if federatedToolApprovalFingerprint restores a fixed fingerprint domain.
test("host fingerprint domain changes invalidate remembered approvals", () => {
  assert.notEqual(federatedToolApprovalFingerprint({ identity, fingerprintDomain: "host-v3" }), expected);
});

// PARITY: a preset connection has no admission revision, so only its kind is pinned.
test("preset origin pins only the kind and differs from roster and absent origins", () => {
  const presetIdentity: FederatedToolIdentity = { ...identity, origin: { kind: "preset" } };
  const presetPreimage = preimage.replace("[\"roster\",\"revision-1\"]", "[\"preset\"]");
  const absentPreimage = preimage.replace("[\"roster\",\"revision-1\"]", "null");
  const preset = federatedToolApprovalFingerprint({ identity: presetIdentity, fingerprintDomain: "g3-approval-v2" });
  const absent = federatedToolApprovalFingerprint({ identity: { ...identity, origin: undefined }, fingerprintDomain: "g3-approval-v2" });
  assert.equal(preset, createHash("sha256").update(presetPreimage).digest("hex"));
  assert.equal(absent, createHash("sha256").update(absentPreimage).digest("hex"));
  assert.notEqual(preset, expected);
  assert.notEqual(preset, absent);
});

// PARITY: values JSON cannot express (undefined array slots, functions) hash as `null`, like JSON.stringify.
test("unserialisable schema values canonicalise to null instead of vanishing", () => {
  const withHole = federatedToolApprovalFingerprint({ fingerprintDomain: "d", identity: { ...identity, inputSchema: { enum: [undefined, "a"] } } });
  const withNull = federatedToolApprovalFingerprint({ fingerprintDomain: "d", identity: { ...identity, inputSchema: { enum: [null, "a"] } } });
  const withFn = federatedToolApprovalFingerprint({ fingerprintDomain: "d", identity: { ...identity, inputSchema: { enum: [() => 1, "a"] } } });
  const withoutSlot = federatedToolApprovalFingerprint({ fingerprintDomain: "d", identity: { ...identity, inputSchema: { enum: ["a"] } } });
  assert.equal(withHole, withNull);
  assert.equal(withFn, withNull);
  assert.notEqual(withHole, withoutSlot);
});
