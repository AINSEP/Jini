import assert from "node:assert/strict";
import { test } from "vitest";
import { buildVendorCredentialAad } from "../credential-sets/aad.js";
test("is deterministic — the same inputs always produce the same string", () => {
    const input = { workspaceId: "ws-1", vendorId: "github" as const, id: "cred-1" };
    assert.equal(buildVendorCredentialAad(input), buildVendorCredentialAad(input));
    assert.equal(buildVendorCredentialAad(input), "vendor-credential-set:v1:ws-1:github:cred-1");
});
test("differs when workspaceId differs", () => {
    const a = buildVendorCredentialAad({ workspaceId: "ws-1", vendorId: "github", id: "cred-1" });
    const b = buildVendorCredentialAad({ workspaceId: "ws-2", vendorId: "github", id: "cred-1" });
    assert.notEqual(a, b);
});
test("differs when vendorId differs", () => {
    const a = buildVendorCredentialAad({ workspaceId: "ws-1", vendorId: "github", id: "cred-1" });
    const b = buildVendorCredentialAad({ workspaceId: "ws-1", vendorId: "gitlab", id: "cred-1" });
    assert.notEqual(a, b);
});
test("differs when id differs", () => {
    const a = buildVendorCredentialAad({ workspaceId: "ws-1", vendorId: "github", id: "cred-1" });
    const b = buildVendorCredentialAad({ workspaceId: "ws-1", vendorId: "github", id: "cred-2" });
    assert.notEqual(a, b);
});
test("differs from the OLD publish-credential-set AAD format for the same inputs — the whole point of a fresh v1, not a v2", () => {
    const oldStyle = `publish-credential-set:v1:ws-1:github-pages:cred-1`;
    const newStyle = buildVendorCredentialAad({ workspaceId: "ws-1", vendorId: "github", id: "cred-1" });
    assert.notEqual(oldStyle, newStyle);
});
import { formatAad } from "../aad.js";
test("formatAad preserves the deployed colon-separated format", () => {
    assert.equal(formatAad({ kind: "vendor-credential-set", version: "v1", parts: ["ws-1", "github", "cred-1"] }), "vendor-credential-set:v1:ws-1:github:cred-1");
});
